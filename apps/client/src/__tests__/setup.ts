// Clean up any DOM nodes rendered during the previous test
import { afterEach, vi } from 'vitest';

afterEach(() => {
  if (typeof document !== 'undefined') {
    document.body.innerHTML = '';
  }
  vi.restoreAllMocks();
});

// jsdom does not implement ResizeObserver — stub it
global.ResizeObserver = vi.fn().mockImplementation(() => ({
  observe: vi.fn(),
  unobserve: vi.fn(),
  disconnect: vi.fn(),
}));

// jsdom doesn't provide localStorage by default — stub for tests that use it
const store: Record<string, string> = {};
const localStorageMock = {
  getItem: (key: string) => store[key] ?? null,
  setItem: (key: string, value: string) => { store[key] = String(value); },
  removeItem: (key: string) => { delete store[key]; },
  clear: () => { Object.keys(store).forEach((k) => delete store[k]); },
  key: (index: number) => Object.keys(store)[index] ?? null,
  get length() { return Object.keys(store).length; },
} as Storage;
(globalThis as any).localStorage = localStorageMock;

// jsdom doesn't support matchMedia — stub for responsive UI tests
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});
