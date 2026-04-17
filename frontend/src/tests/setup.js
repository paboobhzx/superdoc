import "@testing-library/jest-dom";

// Vitest+JSDOM should provide localStorage, but some environments expose a stub
// without the standard methods. Keep tests resilient by polyfilling when needed.
if (
  typeof globalThis.localStorage !== "object" ||
  typeof globalThis.localStorage.getItem !== "function"
) {
  const store = new Map();
  globalThis.localStorage = {
    getItem(key) {
      const v = store.get(String(key));
      return v === undefined ? null : v;
    },
    setItem(key, value) {
      store.set(String(key), String(value));
    },
    removeItem(key) {
      store.delete(String(key));
    },
    clear() {
      store.clear();
    },
    key(i) {
      return Array.from(store.keys())[i] ?? null;
    },
    get length() {
      return store.size;
    },
  };
}
