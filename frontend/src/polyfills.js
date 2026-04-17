// Minimal polyfills for browser bundles that expect Node-style globals.
// Keep this tiny and explicit to avoid pulling heavy shims.
if (typeof globalThis.global === "undefined") {
  globalThis.global = globalThis;
}

if (typeof globalThis.process === "undefined") {
  globalThis.process = { env: {} };
}

