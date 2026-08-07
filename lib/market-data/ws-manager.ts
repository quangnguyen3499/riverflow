import type { ConnectionStatus } from '@/lib/types';

export const WS_HOSTS = [
  'wss://data-stream.market-data source.vision',
  'wss://stream.market-data source.com:443',
] as const;

export type WsListener = (data: unknown) => void;

// WebSocket readyState values, inlined so the module can be imported on the
// server (where the global WebSocket may not exist) without touching it.
const CONNECTING = 0;
const OPEN = 1;

const BACKOFF_BASE_MS = 1_000;
const BACKOFF_CAP_MS = 30_000;
const MAX_CONSECUTIVE_FAILURES = 4;
const POLLING_RETRY_MS = 30_000; // low-frequency retry cadence while status is 'polling'

/** Delay before retry number `failure` (1-based): 1s, 2s, 4s, … capped at 30s. */
export function backoffDelay(failure: number): number {
  return Math.min(BACKOFF_BASE_MS * 2 ** (failure - 1), BACKOFF_CAP_MS);
}

type SocketFactory = (url: string) => WebSocket;

/**
 * One shared combined-stream connection (spec §4.1).
 *
 * - URL: `<host>/stream?streams=a/b/c`; frames arrive as `{stream, data}`.
 * - Streams added while OPEN use live SUBSCRIBE messages; on every (re)connect
 *   the URL carries all currently subscribed streams, so reconnects resubscribe
 *   automatically.
 * - Reconnect: exponential backoff 1s→30s cap, rotating hosts each failure.
 *   After 4 consecutive failures across both hosts, status becomes 'polling'
 *   (spec §6) — but retries continue at a low 30s frequency (status stays
 *   'polling' during those attempts); a successful open restores 'streaming'.
 *   connect() and disconnect() both cancel a pending 30s retry.
 */
export class WsManager {
  private readonly makeSocket: SocketFactory;
  private socket: WebSocket | null = null;
  private readonly listeners = new Map<string, Set<WsListener>>();
  private readonly statusListeners = new Set<(s: ConnectionStatus) => void>();
  private _status: ConnectionStatus = 'connecting';
  private failures = 0; // consecutive non-manual closes
  private hostIndex = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pollingRetryTimer: ReturnType<typeof setTimeout> | null = null;
  private msgId = 0;

  constructor(makeSocket: SocketFactory = (url) => new WebSocket(url)) {
    this.makeSocket = makeSocket;
  }

  get status(): ConnectionStatus {
    return this._status;
  }

  onStatus(cb: (s: ConnectionStatus) => void): () => void {
    this.statusListeners.add(cb);
    return () => {
      this.statusListeners.delete(cb);
    };
  }

  /**
   * Start (or restart after 'polling' / disconnect()). Idempotent: no-op while
   * a socket is connecting/open or a backoff retry is already scheduled. A
   * pending 30s polling retry is cancelled and replaced by an immediate fresh
   * cycle from the primary host.
   */
  connect(): void {
    if (
      this.socket &&
      (this.socket.readyState === CONNECTING || this.socket.readyState === OPEN)
    ) {
      return;
    }
    if (this.pollingRetryTimer !== null) {
      // Caller wants a fresh cycle right now — skip the low-frequency wait.
      clearTimeout(this.pollingRetryTimer);
      this.pollingRetryTimer = null;
    }
    if (this.reconnectTimer !== null) return;
    this.failures = 0;
    this.hostIndex = 0;
    this.setStatus('connecting');
    this.open();
  }

  /** Close cleanly: cancel any pending retry (backoff or 30s polling) and never auto-reconnect. */
  disconnect(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.pollingRetryTimer !== null) {
      clearTimeout(this.pollingRetryTimer);
      this.pollingRetryTimer = null;
    }
    const sock = this.socket;
    this.socket = null;
    if (sock) {
      // Detach first so the close event cannot re-enter the retry logic.
      sock.onopen = null;
      sock.onmessage = null;
      sock.onclose = null;
      sock.onerror = null;
      sock.close();
    }
  }

  /** Register a listener for a stream (e.g. "!miniTicker@arr"). Returns unsubscribe. */
  subscribe(stream: string, cb: WsListener): () => void {
    let subs = this.listeners.get(stream);
    const isNewStream = subs === undefined;
    if (subs === undefined) {
      subs = new Set();
      this.listeners.set(stream, subs);
    }
    subs.add(cb);
    if (isNewStream && this.socket?.readyState === OPEN) {
      this.sendJson({ method: 'SUBSCRIBE', params: [stream], id: ++this.msgId });
    }

    let active = true;
    return () => {
      if (!active) return;
      active = false;
      const set = this.listeners.get(stream);
      if (!set) return;
      set.delete(cb);
      if (set.size === 0) {
        this.listeners.delete(stream);
        if (this.socket?.readyState === OPEN) {
          this.sendJson({ method: 'UNSUBSCRIBE', params: [stream], id: ++this.msgId });
        }
      }
    };
  }

  private setStatus(s: ConnectionStatus): void {
    if (s === this._status) return;
    this._status = s;
    for (const cb of [...this.statusListeners]) cb(s);
  }

  private sendJson(msg: object): void {
    this.socket?.send(JSON.stringify(msg));
  }

  private open(): void {
    const host = WS_HOSTS[this.hostIndex];
    const streamsAtOpen = [...this.listeners.keys()];
    const url = `${host}/stream?streams=${streamsAtOpen.join('/')}`;
    const sock = this.makeSocket(url);
    this.socket = sock;

    sock.onopen = () => {
      if (sock !== this.socket) return;
      this.failures = 0;
      this.setStatus('streaming');
      // Streams subscribed while this socket was still connecting are not in
      // the URL — attach them now.
      const inUrl = new Set(streamsAtOpen);
      for (const stream of this.listeners.keys()) {
        if (!inUrl.has(stream)) {
          this.sendJson({ method: 'SUBSCRIBE', params: [stream], id: ++this.msgId });
        }
      }
    };

    sock.onmessage = (ev: MessageEvent) => {
      if (sock !== this.socket) return;
      if (typeof ev.data !== 'string') return;
      let frame: unknown;
      try {
        frame = JSON.parse(ev.data);
      } catch {
        return; // malformed frame — ignore
      }
      if (typeof frame !== 'object' || frame === null) return;
      const { stream, data } = frame as { stream?: unknown; data?: unknown };
      if (typeof stream !== 'string') return; // e.g. SUBSCRIBE acks {result,id}
      const subs = this.listeners.get(stream);
      if (!subs) return;
      for (const cb of [...subs]) cb(data); // copy: a cb may unsubscribe mid-dispatch
    };

    sock.onerror = () => {
      // Browsers always follow error with close; all retry logic lives in onclose.
    };

    sock.onclose = () => {
      if (sock !== this.socket) return; // superseded socket or manual disconnect
      this.socket = null;
      this.failures += 1;
      this.hostIndex = (this.hostIndex + 1) % WS_HOSTS.length; // rotate hosts
      if (this.failures >= MAX_CONSECUTIVE_FAILURES) {
        // Polled data drives the UI now, but keep trying at a low 30s cadence
        // so the stream recovers on its own. Status stays 'polling' during
        // these attempts; a successful open flips it back to 'streaming'.
        this.setStatus('polling');
        this.pollingRetryTimer = setTimeout(() => {
          this.pollingRetryTimer = null;
          this.open();
        }, POLLING_RETRY_MS);
        return;
      }
      this.setStatus('reconnecting');
      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = null;
        this.open();
      }, backoffDelay(this.failures));
    };
  }
}

/** Module singleton — the whole app shares one connection. */
export const wsManager = new WsManager();
