/**
 * Web Storage shim for the jsdom test environment.
 *
 * Node 26 ships its own `globalThis.localStorage`/`sessionStorage`, which are
 * unusable without the `--localstorage-file` flag (they evaluate to
 * `undefined`). Vitest's jsdom environment only copies a window key onto
 * `globalThis` when Node has not already defined it, so those stubs win and
 * tests see no Web Storage at all. Vitest does expose the JSDOM instance as
 * `globalThis.jsdom`, so re-point the globals at jsdom's real Storage objects.
 */
const jsdomWindow = (globalThis as { jsdom?: { window: Window } }).jsdom?.window;

for (const key of ['localStorage', 'sessionStorage'] as const) {
  // Read from jsdom only — touching Node's stub emits an ExperimentalWarning.
  const storage = jsdomWindow?.[key];
  if (storage) {
    Object.defineProperty(globalThis, key, { value: storage, configurable: true });
  }
}
