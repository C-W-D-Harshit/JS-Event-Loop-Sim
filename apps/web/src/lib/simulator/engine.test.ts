import { describe, expect, test } from "bun:test";

import { createInitialState, simulatorReducer } from "./engine";
import { scenarios } from "./scenarios";
import type { Scenario, SimulatorState } from "./types";

function runScenario(scenario: Scenario): SimulatorState {
  let state = simulatorReducer(createInitialState("browser"), {
    type: "LOAD_SCENARIO",
    scenario,
  });

  for (const step of scenario.steps) {
    state = simulatorReducer(state, { type: "EXECUTE_STEP", step });
  }

  return state;
}

describe("simulatorReducer", () => {
  test.each(scenarios.map((scenario) => [scenario.id, scenario] as const))(
    "%s finishes with the documented output",
    (_id, scenario) => {
      const state = runScenario(scenario);

      expect(state.consoleOutput).toEqual(scenario.expectedOutput);
      expect(state.currentStep).toBe(scenario.steps.length);
      expect(state.status).toBe("completed");
      expect(state.callStack).toEqual([]);
    }
  );

  test("backward restores the exact state before the last action", () => {
    const scenario = scenarios.find((item) => item.id === "hello-sync");
    if (!scenario) throw new Error("hello-sync scenario is missing");

    let state = simulatorReducer(createInitialState(), {
      type: "LOAD_SCENARIO",
      scenario,
    });
    for (const step of scenario.steps.slice(0, 4)) {
      state = simulatorReducer(state, { type: "EXECUTE_STEP", step });
    }

    expect(state.consoleOutput).toEqual(["first"]);
    expect(state.currentStep).toBe(4);

    state = simulatorReducer(state, { type: "STEP_BACKWARD" });

    expect(state.consoleOutput).toEqual([]);
    expect(state.currentStep).toBe(3);
    expect(state.status).toBe("paused");
  });
});
