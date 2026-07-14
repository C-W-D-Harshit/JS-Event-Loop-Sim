import type process from "process";

declare global {
  /**
   * Browser-safe `process` shim injected in `src/main.tsx`.
   *
   * This exists to satisfy dependencies (e.g., Babel) that access `process.env`
   * in non-Node environments.
   */
  // eslint-disable-next-line no-var
  var process: typeof process | undefined;
}

export {};
