import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ConnectionStatus } from '@/lib/types';
import { WsManager, wsManager, WS_HOSTS, backoffDelay } from '@/lib/market-data/ws-manager';

// ---------------------------------------------------------------------------
// MockWebSocket — test stand-in for the browser WebSocket. The manager only
// touches: url, readyState, send(), close(), and the on* handler properties.
// Tests play the server side via the simulate* helpers.
// ---------------------------------------------------------------------------
class MockWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  readyState: number = MockWebSocket.CONNECTING;
  /** Raw payloads passed to send(), in order. */
  sent: string[] = [];

  onopen: ((ev: Event) => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onclose: ((ev: CloseEvent) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;

  constructor(public readonly url: string) {}

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    if (this.readyState === MockWebSocket.CLOSED) return;
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.(new CloseEvent('close'));
  }

  /** Server accepted the connection. */
  simulateOpen(): void {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.(new Event('open'));
  }

  /** Server pushed a combined-stream frame (object is JSON-stringified). */
  simulateMessage(frame: unknown): void {
    this.onmessage?.(new MessageEvent('message', { data: JSON.stringify(frame) }));
  }

  /** Server pushed a raw (possibly invalid) text payload. */
  simulateRaw(data: string): void {
    this.onmessage?.(new MessageEvent('message', { data }));
  }

  /** Connection failed or dropped (browsers fire close either way). */
  simulateFailure(): void {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.(new CloseEvent('close'));
  }
}

/** Fresh manager wired to a recording socket factory. */
function makeHarness() {
  const sockets: MockWebSocket[] = [];
  const factory = vi.fn((url: string): WebSocket => {
    const s = new MockWebSocket(url);
    sockets.push(s);
    return s as unknown as WebSocket;
  });
  const manager = new WsManager(factory);
  return { sockets, factory, manager };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('backoffDelay', () => {
  it('doubles from 1s and caps at 30s', () => {
    expect(backoffDelay(1)).toBe(1_000);
    expect(backoffDelay(2)).toBe(2_000);
    expect(backoffDelay(3)).toBe(4_000);
    expect(backoffDelay(4)).toBe(8_000);
    expect(backoffDelay(5)).toBe(16_000);
    expect(backoffDelay(6)).toBe(30_000);
    expect(backoffDelay(10)).toBe(30_000);
  });
});

describe('connection lifecycle', () => {
  it('starts with status "connecting"', () => {
    const { manager } = makeHarness();
    expect(manager.status).toBe('connecting');
  });

  it('connect() opens a combined-stream URL on the primary host with all subscribed streams', () => {
    const { manager, sockets, factory } = makeHarness();
    manager.subscribe('!miniTicker@arr', () => {});
    manager.subscribe('btcusdt@kline_1m', () => {});
    manager.connect();
    expect(factory).toHaveBeenCalledTimes(1);
    expect(sockets[0].url).toBe(
      'wss://data-stream.market-data source.vision/stream?streams=!miniTicker@arr/btcusdt@kline_1m',
    );
    expect(sockets[0].url.startsWith(WS_HOSTS[0])).toBe(true);
  });

  it('connect() is idempotent while a socket is connecting or open', () => {
    const { manager, sockets, factory } = makeHarness();
    manager.connect();
    manager.connect(); // still CONNECTING → no second socket
    expect(factory).toHaveBeenCalledTimes(1);
    sockets[0].simulateOpen();
    manager.connect(); // OPEN → no second socket
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it('transitions connecting → streaming on open and notifies onStatus listeners', () => {
    const { manager, sockets } = makeHarness();
    const seen: ConnectionStatus[] = [];
    manager.onStatus((s) => seen.push(s));
    manager.connect();
    expect(manager.status).toBe('connecting');
    sockets[0].simulateOpen();
    expect(manager.status).toBe('streaming');
    expect(seen).toEqual(['streaming']); // fires on change only
  });

  it('onStatus() returns an unsubscribe that stops notifications', () => {
    const { manager, sockets } = makeHarness();
    const seen: ConnectionStatus[] = [];
    const off = manager.onStatus((s) => seen.push(s));
    manager.connect();
    off();
    sockets[0].simulateOpen();
    expect(seen).toEqual([]);
    expect(manager.status).toBe('streaming');
  });
});

describe('frame dispatch', () => {
  it('dispatches {stream, data} frames to the matching stream listeners only', () => {
    const { manager, sockets } = makeHarness();
    const mini = vi.fn();
    const kline = vi.fn();
    manager.subscribe('!miniTicker@arr', mini);
    manager.subscribe('btcusdt@kline_1m', kline);
    manager.connect();
    sockets[0].simulateOpen();

    sockets[0].simulateMessage({
      stream: '!miniTicker@arr',
      data: [{ s: 'BTCUSDT', c: '67241.50' }],
    });

    expect(mini).toHaveBeenCalledTimes(1);
    expect(mini).toHaveBeenCalledWith([{ s: 'BTCUSDT', c: '67241.50' }]);
    expect(kline).not.toHaveBeenCalled();
  });

  it('ignores malformed JSON frames without throwing', () => {
    const { manager, sockets } = makeHarness();
    const cb = vi.fn();
    manager.subscribe('!miniTicker@arr', cb);
    manager.connect();
    sockets[0].simulateOpen();

    expect(() => sockets[0].simulateRaw('{"stream": "!miniTicker@arr", "data"')).not.toThrow();
    expect(cb).not.toHaveBeenCalled();
  });

  it('ignores frames without a stream field (e.g. SUBSCRIBE acks)', () => {
    const { manager, sockets } = makeHarness();
    const cb = vi.fn();
    manager.subscribe('!miniTicker@arr', cb);
    manager.connect();
    sockets[0].simulateOpen();

    sockets[0].simulateMessage({ result: null, id: 1 }); // the ack shape
    expect(cb).not.toHaveBeenCalled();
  });
});

describe('subscribe / unsubscribe', () => {
  it('subscribing a new stream on an open socket sends a SUBSCRIBE message', () => {
    const { manager, sockets } = makeHarness();
    manager.subscribe('!miniTicker@arr', () => {});
    manager.connect();
    sockets[0].simulateOpen();
    expect(sockets[0].sent).toHaveLength(0); // URL already carried the stream

    manager.subscribe('ethusdt@kline_1m', () => {});
    expect(sockets[0].sent).toHaveLength(1);
    expect(JSON.parse(sockets[0].sent[0])).toEqual({
      method: 'SUBSCRIBE',
      params: ['ethusdt@kline_1m'],
      id: 1,
    });
  });

  it('a stream subscribed while the socket is still connecting is SUBSCRIBEd on open', () => {
    const { manager, sockets } = makeHarness();
    manager.connect(); // no streams yet → empty streams param
    manager.subscribe('btcusdt@kline_1m', () => {});
    expect(sockets[0].sent).toHaveLength(0); // cannot send while CONNECTING

    sockets[0].simulateOpen();
    expect(sockets[0].sent).toHaveLength(1);
    expect(JSON.parse(sockets[0].sent[0])).toEqual({
      method: 'SUBSCRIBE',
      params: ['btcusdt@kline_1m'],
      id: 1,
    });
  });

  it('unsubscribe stops delivery and sends UNSUBSCRIBE when the last listener leaves', () => {
    const { manager, sockets } = makeHarness();
    const cb = vi.fn();
    const off = manager.subscribe('btcusdt@kline_1m', cb);
    manager.connect();
    sockets[0].simulateOpen();

    off();
    sockets[0].simulateMessage({ stream: 'btcusdt@kline_1m', data: { k: {} } });
    expect(cb).not.toHaveBeenCalled();

    const last = JSON.parse(sockets[0].sent.at(-1)!);
    expect(last.method).toBe('UNSUBSCRIBE');
    expect(last.params).toEqual(['btcusdt@kline_1m']);
  });

  it('unsubscribing one listener keeps other listeners of the same stream working', () => {
    const { manager, sockets } = makeHarness();
    const a = vi.fn();
    const b = vi.fn();
    const offA = manager.subscribe('btcusdt@kline_1m', a);
    manager.subscribe('btcusdt@kline_1m', b);
    manager.connect();
    sockets[0].simulateOpen();

    offA();
    expect(sockets[0].sent).toHaveLength(0); // b still listening → no UNSUBSCRIBE

    sockets[0].simulateMessage({ stream: 'btcusdt@kline_1m', data: 42 });
    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledWith(42);
  });

  it('calling the same unsubscribe twice is harmless', () => {
    const { manager, sockets } = makeHarness();
    const off = manager.subscribe('btcusdt@kline_1m', vi.fn());
    manager.connect();
    sockets[0].simulateOpen();

    off();
    expect(() => off()).not.toThrow();
    const unsubs = sockets[0].sent.filter((m) => JSON.parse(m).method === 'UNSUBSCRIBE');
    expect(unsubs).toHaveLength(1);
  });
});

/** Fail the initial attempt and the 3 backoff retries → status 'polling' (30s low-frequency retry pending). */
function driveToPolling(manager: WsManager, sockets: MockWebSocket[]): void {
  manager.connect();
  sockets[0].simulateFailure(); // failure 1 → retry in 1s
  vi.advanceTimersByTime(1_000);
  sockets[1].simulateFailure(); // failure 2 → retry in 2s
  vi.advanceTimersByTime(2_000);
  sockets[2].simulateFailure(); // failure 3 → retry in 4s
  vi.advanceTimersByTime(4_000);
  sockets[3].simulateFailure(); // failure 4 → 'polling' + 30s retry timer
}

describe('reconnect, backoff, host rotation', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('on failure: status "reconnecting", retry on the other host after exactly 1s', () => {
    const { manager, sockets, factory } = makeHarness();
    manager.subscribe('!miniTicker@arr', () => {});
    manager.connect();

    sockets[0].simulateFailure();
    expect(manager.status).toBe('reconnecting');

    vi.advanceTimersByTime(999);
    expect(factory).toHaveBeenCalledTimes(1); // not yet

    vi.advanceTimersByTime(1);
    expect(factory).toHaveBeenCalledTimes(2);
    expect(sockets[1].url.startsWith(WS_HOSTS[1])).toBe(true); // rotated
  });

  it('backoff doubles per consecutive failure (1s, 2s, 4s) while alternating hosts', () => {
    const { manager, sockets, factory } = makeHarness();
    manager.connect();

    sockets[0].simulateFailure(); // host 0 failed
    vi.advanceTimersByTime(1_000);
    expect(sockets[1].url.startsWith(WS_HOSTS[1])).toBe(true);

    sockets[1].simulateFailure(); // host 1 failed
    vi.advanceTimersByTime(1_999);
    expect(factory).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(1); // 2s elapsed
    expect(sockets[2].url.startsWith(WS_HOSTS[0])).toBe(true);

    sockets[2].simulateFailure(); // host 0 failed again
    vi.advanceTimersByTime(3_999);
    expect(factory).toHaveBeenCalledTimes(3);
    vi.advanceTimersByTime(1); // 4s elapsed
    expect(sockets[3].url.startsWith(WS_HOSTS[1])).toBe(true);
  });

  it('reconnect URL re-includes every subscribed stream and delivery resumes', () => {
    const { manager, sockets } = makeHarness();
    manager.subscribe('!miniTicker@arr', () => {});
    manager.connect();
    sockets[0].simulateOpen();

    const cb = vi.fn();
    manager.subscribe('ethusdt@kline_1m', cb); // added live via SUBSCRIBE message

    sockets[0].simulateFailure();
    vi.advanceTimersByTime(1_000);
    expect(sockets[1].url).toBe(
      'wss://stream.market-data source.com:443/stream?streams=!miniTicker@arr/ethusdt@kline_1m',
    );

    sockets[1].simulateOpen();
    expect(sockets[1].sent).toHaveLength(0); // URL carried everything — no re-SUBSCRIBE spam
    sockets[1].simulateMessage({ stream: 'ethusdt@kline_1m', data: { e: 'kline' } });
    expect(cb).toHaveBeenCalledWith({ e: 'kline' });
  });

  it('a successful open resets the backoff to 1s and the failure count', () => {
    const { manager, sockets, factory } = makeHarness();
    manager.connect();
    sockets[0].simulateFailure(); // failure 1
    vi.advanceTimersByTime(1_000);

    sockets[1].simulateOpen(); // recovered → counters reset
    expect(manager.status).toBe('streaming');

    sockets[1].simulateFailure(); // drop of a live connection = failure 1 again
    expect(manager.status).toBe('reconnecting');
    vi.advanceTimersByTime(999);
    expect(factory).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(1); // 1s again, not 2s
    expect(factory).toHaveBeenCalledTimes(3);
    expect(sockets[2].url.startsWith(WS_HOSTS[0])).toBe(true); // rotated away from host 1
  });

  it('after 4 consecutive failures across both hosts: status "polling", then a low-frequency retry every 30s', () => {
    const { manager, sockets, factory } = makeHarness();
    const statuses: ConnectionStatus[] = [];
    manager.onStatus((s) => statuses.push(s));

    driveToPolling(manager, sockets);

    expect(manager.status).toBe('polling');
    // hosts were alternated: 0, 1, 0, 1
    expect(sockets.map((s) => s.url.startsWith(WS_HOSTS[0]))).toEqual([true, false, true, false]);

    vi.advanceTimersByTime(29_999);
    expect(factory).toHaveBeenCalledTimes(4); // not yet — low-frequency retry is 30s
    vi.advanceTimersByTime(1);
    expect(factory).toHaveBeenCalledTimes(5); // retry attempt fired
    expect(manager.status).toBe('polling'); // status only changes on a successful open
    expect(statuses).toEqual(['reconnecting', 'polling']); // change events only — no churn

    sockets[4].simulateFailure(); // the 30s attempt failed → next retry in another 30s
    expect(manager.status).toBe('polling');
    vi.advanceTimersByTime(30_000);
    expect(factory).toHaveBeenCalledTimes(6);
  });

  it('a successful 30s polling retry restores status "streaming" and clears the retry timer', () => {
    const { manager, sockets, factory } = makeHarness();
    const statuses: ConnectionStatus[] = [];
    manager.onStatus((s) => statuses.push(s));

    driveToPolling(manager, sockets);
    expect(manager.status).toBe('polling');

    vi.advanceTimersByTime(30_000);
    expect(factory).toHaveBeenCalledTimes(5); // low-frequency retry attempt

    sockets[4].simulateOpen();
    expect(manager.status).toBe('streaming');
    expect(statuses).toEqual(['reconnecting', 'polling', 'streaming']);

    vi.advanceTimersByTime(600_000);
    expect(factory).toHaveBeenCalledTimes(5); // recovered — no stray retries left
  });

  it('connect() after polling cancels the pending 30s retry and starts over from the primary host', () => {
    const { manager, sockets, factory } = makeHarness();
    driveToPolling(manager, sockets);
    expect(manager.status).toBe('polling');

    manager.connect();
    expect(manager.status).toBe('connecting');
    expect(factory).toHaveBeenCalledTimes(5);
    expect(sockets[4].url.startsWith(WS_HOSTS[0])).toBe(true);

    sockets[4].simulateOpen();
    expect(manager.status).toBe('streaming');

    vi.advanceTimersByTime(600_000);
    expect(factory).toHaveBeenCalledTimes(5); // the pending 30s polling retry was cancelled
  });
});

describe('disconnect', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('disconnect() closes the socket and never reconnects', () => {
    const { manager, sockets, factory } = makeHarness();
    manager.subscribe('!miniTicker@arr', () => {});
    manager.connect();
    sockets[0].simulateOpen();

    manager.disconnect();
    expect(sockets[0].readyState).toBe(MockWebSocket.CLOSED);

    vi.advanceTimersByTime(600_000);
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it('disconnect() during backoff cancels the pending retry', () => {
    const { manager, sockets, factory } = makeHarness();
    manager.connect();
    sockets[0].simulateFailure();
    expect(manager.status).toBe('reconnecting');

    manager.disconnect();
    vi.advanceTimersByTime(600_000);
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it('disconnect() while polling cancels the pending 30s retry', () => {
    const { manager, sockets, factory } = makeHarness();
    driveToPolling(manager, sockets);
    expect(manager.status).toBe('polling');

    manager.disconnect();
    vi.advanceTimersByTime(600_000);
    expect(factory).toHaveBeenCalledTimes(4); // no 30s attempt after a manual close
  });

  it('connect() works again after disconnect()', () => {
    const { manager, sockets, factory } = makeHarness();
    manager.connect();
    sockets[0].simulateOpen();
    manager.disconnect();

    manager.connect();
    expect(factory).toHaveBeenCalledTimes(2);
    sockets[1].simulateOpen();
    expect(manager.status).toBe('streaming');
  });
});

describe('singleton', () => {
  it('wsManager is a shared WsManager instance that has not connected', () => {
    expect(wsManager).toBeInstanceOf(WsManager);
    expect(wsManager.status).toBe('connecting');
  });
});
