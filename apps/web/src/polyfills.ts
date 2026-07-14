import process from "process";

/**
 * Polyfills/shims that must run before the app imports other modules.
 *
 * Some browser-bundled dependencies (notably parts of Babel) may reference
 * `process` (usually `process.env.*`) at module evaluation time. Vite does not
 * polyfill Node globals, so without this we can crash with:
 * `ReferenceError: process is not defined`.
 */
if (typeof globalThis.process === "undefined") {
  globalThis.process = process;
}
