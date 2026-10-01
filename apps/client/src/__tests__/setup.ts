// Clean up any DOM nodes rendered during the previous test
import { afterEach } from 'vitest';

afterEach(() => {
  if (typeof document !== 'undefined') {
    document.body.innerHTML = '';
  }
});

// jsdom does not implement ResizeObserver — provide a real class implementation
class ResizeObserverPolyfill {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = ResizeObserverPolyfill as unknown as typeof ResizeObserver;
}

// jsdom doesn't provide a complete localStorage implementation in all modes
const store: Record<string, string> = {};
const localStorageImpl = {
  getItem: (key: string) => store[key] ?? null,
  setItem: (key: string, value: string) => {
    store[key] = String(value);
  },
  removeItem: (key: string) => {
    delete store[key];
  },
  clear: () => {
    Object.keys(store).forEach((k) => delete store[k]);
  },
  key: (index: number) => Object.keys(store)[index] ?? null,
  get length() {
    return Object.keys(store).length;
  },
} as Storage;
(globalThis as Record<string, unknown>).localStorage = localStorageImpl;

// jsdom doesn't support matchMedia — provide a real MediaQueryList implementation
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string): MediaQueryList => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }),
});
