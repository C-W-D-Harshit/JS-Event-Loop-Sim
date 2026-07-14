import { describe, expect, test } from "bun:test";

import { createInitialState, simulatorReducer } from "./engine";
import { traceToSteps } from "./traceToSteps";
import type { TraceEvent } from "./traceTypes";
import type { Scenario } from "./types";

const loc = { lineStart: 1, lineEnd: 1, columnStart: 0, columnEnd: 1 };

describe("traceToSteps", () => {
  test("replays microtasks before timers and finishes cleanly", () => {
    const trace: TraceEvent[] = [
      { kind: "phase", phase: "script" },
      { kind: "call.enter", frameId: "main", label: "main()", loc },
      {
        kind: "schedule.macrotask",
        taskId: "timer-1",
        taskType: "setTimeout",
        label: "setTimeout (0ms)",
        delayMs: 0,
        loc,
      },
      {
        kind: "schedule.microtask",
        taskId: "promise-1",
        label: "Promise.then callback",
        loc,
      },
      { kind: "call.exit", frameId: "main" },
      { kind: "task.start", taskId: "promise-1", queue: "microtask", loc },
      { kind: "console.log", message: "promise", loc },
      { kind: "task.end", taskId: "promise-1" },
      { kind: "task.start", taskId: "timer-1", queue: "macrotask", loc },
      { kind: "console.log", message: "timer", loc },
      { kind: "task.end", taskId: "timer-1" },
      { kind: "done" },
    ];
    const converted = traceToSteps(trace);
    const scenario: Scenario = {
      id: "trace-test",
      title: "Trace test",
      description: "",
      category: "fundamentals",
      runtime: "browser",
      code: "",
      expectedOutput: converted.expectedOutput,
      explanation: "",
      steps: converted.steps,
    };

    let state = simulatorReducer(createInitialState(), {
      type: "LOAD_SCENARIO",
      scenario,
    });
    for (const step of converted.steps) {
      state = simulatorReducer(state, { type: "EXECUTE_STEP", step });
    }

    expect(converted.expectedOutput).toEqual(["promise", "timer"]);
    expect(state.consoleOutput).toEqual(["promise", "timer"]);
    expect(state.callStack).toEqual([]);
    expect(state.microtaskQueue).toEqual([]);
    expect(state.macrotaskQueue).toEqual([]);
    expect(state.status).toBe("completed");
  });

  test("removes cancelled timers instead of leaving ghost tasks", () => {
    const trace: TraceEvent[] = [
      { kind: "phase", phase: "script" },
      {
        kind: "schedule.macrotask",
        taskId: "timer-cancelled",
        taskType: "setTimeout",
        label: "setTimeout (10ms)",
        delayMs: 10,
        loc,
      },
      { kind: "cancel.macrotask", taskId: "timer-cancelled" },
      { kind: "done" },
    ];
    const converted = traceToSteps(trace);
    const scenario: Scenario = {
      id: "cancel-test",
      title: "Cancel test",
      description: "",
      category: "fundamentals",
      runtime: "browser",
      code: "",
      expectedOutput: [],
      explanation: "",
      steps: converted.steps,
    };

    let state = simulatorReducer(createInitialState(), {
      type: "LOAD_SCENARIO",
      scenario,
    });
    for (const step of converted.steps) {
      state = simulatorReducer(state, { type: "EXECUTE_STEP", step });
    }

    expect(state.webApis).toEqual([]);
    expect(state.macrotaskQueue).toEqual([]);
    expect(state.status).toBe("completed");
  });
});
