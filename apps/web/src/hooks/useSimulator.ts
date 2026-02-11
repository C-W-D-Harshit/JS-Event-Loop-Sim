import { useReducer, useCallback, useEffect, useRef } from 'react';
import type { SimulatorState, Scenario, Runtime, TaskType, ScenarioStep } from '@/lib/simulator/types';
import { simulatorReducer, createInitialState } from '@/lib/simulator/engine';
import { scenarios } from '@/lib/simulator/scenarios';

export function useSimulator(initialRuntime: Runtime = 'browser') {
  const [state, dispatch] = useReducer(simulatorReducer, initialRuntime, createInitialState);
  const scenarioRef = useRef<Scenario | null>(null);
  const stepIndexRef = useRef(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const currentScenario = scenarioRef.current;

  const loadScenario = useCallback((scenario: Scenario) => {
    scenarioRef.current = scenario;
    stepIndexRef.current = 0;
    dispatch({ type: 'LOAD_SCENARIO', scenario });
  }, []);

  const loadScenarioById = useCallback((id: string) => {
    const scenario = scenarios.find((s) => s.id === id);
    if (scenario) {
      loadScenario(scenario);
    }
  }, [loadScenario]);

  const executeNextStep = useCallback(() => {
    const scenario = scenarioRef.current;
    if (!scenario) return false;

    const stepIndex = stepIndexRef.current;
    if (stepIndex >= scenario.steps.length) {
      dispatch({ type: 'PAUSE' });
      return false;
    }

    const step: ScenarioStep = scenario.steps[stepIndex];
    dispatch({ type: 'EXECUTE_STEP', step });
    stepIndexRef.current = stepIndex + 1;

    if (step.action.type === 'complete') {
      dispatch({ type: 'PAUSE' });
      return false;
    }

    return true;
  }, []);

  const stepForward = useCallback(() => {
    executeNextStep();
  }, [executeNextStep]);

  const stepBackward = useCallback(() => {
    if (stepIndexRef.current > 0) {
      stepIndexRef.current -= 1;
    }
    dispatch({ type: 'STEP_BACKWARD' });
  }, []);

  const play = useCallback(() => {
    if (state.status === 'completed' && scenarioRef.current) {
      stepIndexRef.current = 0;
      dispatch({ type: 'LOAD_SCENARIO', scenario: scenarioRef.current });
    }
    dispatch({ type: 'PLAY' });
  }, [state.status]);

  const pause = useCallback(() => {
    dispatch({ type: 'PAUSE' });
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const reset = useCallback(() => {
    stepIndexRef.current = 0;
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    dispatch({ type: 'RESET' });
  }, []);

  const setRuntime = useCallback((runtime: Runtime) => {
    scenarioRef.current = null;
    stepIndexRef.current = 0;
    dispatch({ type: 'SET_RUNTIME', runtime });
    dispatch({ type: 'RESET' });
  }, []);

  const setSpeed = useCallback((speed: number) => {
    dispatch({ type: 'SET_SPEED', speed });
  }, []);

  const jumpToStep = useCallback((step: number) => {
    dispatch({ type: 'JUMP_TO_STEP', step });
    stepIndexRef.current = step;
  }, []);

  const enqueueTask = useCallback((taskType: TaskType, label?: string) => {
    dispatch({ type: 'ENQUEUE_TASK', taskType, label });
  }, []);

  useEffect(() => {
    if (state.status === 'running') {
      const interval = 1000 / state.playbackSpeed;
      intervalRef.current = setInterval(() => {
        const hasMore = executeNextStep();
        if (!hasMore) {
          pause();
        }
      }, interval);

      return () => {
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
          intervalRef.current = null;
        }
      };
    }
  }, [state.status, state.playbackSpeed, executeNextStep, pause]);

  useEffect(() => {
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const defaultScenario = scenarios.find(
      (s) => s.id === 'settimeout-vs-promise' && (s.runtime === 'browser' || s.runtime === 'both')
    );
    if (defaultScenario && !scenarioRef.current) {
      loadScenario(defaultScenario);
    }
  }, [loadScenario]);

  return {
    state,
    currentScenario,
    scenarios,

    loadScenario,
    loadScenarioById,
    stepForward,
    stepBackward,
    play,
    pause,
    reset,
    setRuntime,
    setSpeed,
    jumpToStep,
    enqueueTask,

    isPlaying: state.status === 'running',
    isPaused: state.status === 'paused',
    isCompleted: state.status === 'completed',
    isIdle: state.status === 'idle',
    canStepForward: state.status !== 'completed' && !!scenarioRef.current,
    canStepBackward: state.currentStep > 0,
  };
}

export type UseSimulatorReturn = ReturnType<typeof useSimulator>;
