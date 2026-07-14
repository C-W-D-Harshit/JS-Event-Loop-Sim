import { afterEach, describe, expect, test } from "bun:test";

import { instrument } from "./instrument";
import type { SourceLoc, TraceEvent } from "./traceTypes";

const resultKey = "__eventLoopSimulatorInstrumentTestResult";

afterEach(() => {
  delete (globalThis as Record<string, unknown>)[resultKey];
});

function executeInstrumented(code: string) {
  const events: TraceEvent[] = [];
  const sim = {
    tick: (loc: SourceLoc) => {
      void loc;
    },
    emit: (event: TraceEvent) => events.push(event),
  };

  const execute = new Function("__sim", instrument(code));
  execute(sim);
  return events;
}

describe("instrument", () => {
  test("preserves expression-bodied arrow return values", () => {
    const events = executeInstrumented(
      `globalThis.${resultKey} = ((value) => value + 1)(41);`
    );

    expect((globalThis as Record<string, unknown>)[resultKey]).toBe(42);
    expect(events.filter((event) => event.kind === "call.enter")).toHaveLength(2);
    expect(events.filter((event) => event.kind === "call.exit")).toHaveLength(2);
  });

  test("emits call.exit when a function returns early", () => {
    const events = executeInstrumented(`
      function choose(value) {
        if (value) return "yes";
        return "no";
      }
      globalThis.${resultKey} = choose(true);
    `);

    expect((globalThis as Record<string, unknown>)[resultKey]).toBe("yes");
    const enters = events.filter((event) => event.kind === "call.enter");
    const exits = events.filter((event) => event.kind === "call.exit");
    expect(exits).toHaveLength(enters.length);
  });

  test("leaves completion to the sandbox scheduler", () => {
    const events = executeInstrumented("void 0;");
    expect(events.some((event) => event.kind === "done")).toBe(false);
  });
});
