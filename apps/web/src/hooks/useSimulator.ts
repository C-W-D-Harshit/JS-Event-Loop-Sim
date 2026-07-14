import { useReducer, useCallback, useEffect, useRef, useState } from 'react';
import type { SimulatorState, Scenario, Runtime, TaskType, ScenarioStep } from '@/lib/simulator/types';
import { simulatorReducer, createInitialState } from '@/lib/simulator/engine';
import { scenarios } from '@/lib/simulator/scenarios';
import { runSandbox, type SandboxResult } from '@/lib/simulator/runSandbox';
import { traceToSteps } from '@/lib/simulator/traceToSteps';
import { DEFAULT_SANDBOX_LIMITS } from '@/lib/simulator/traceTypes';

interface Diagnostic {
  message: string;
  line?: number;
  column?: number;
}

export function useSimulator(initialRuntime: Runtime = 'browser') {
  const [state, dispatch] = useReducer(simulatorReducer, initialRuntime, createInitialState);
  const scenarioRef = useRef<Scenario | null>(null);
  const stepIndexRef = useRef(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [editableCode, setEditableCode] = useState<string>('');
  const [sandboxCompiled, setSandboxCompiled] = useState<{ code: string; steps: ScenarioStep[]; expectedOutput: string[] } | null>(null);
  const [diagnostics, setDiagnostics] = useState<Diagnostic[]>([]);
  const [isSandboxRunning, setIsSandboxRunning] = useState(false);
  const [sandboxError, setSandboxError] = useState<string | null>(null);

  const currentScenario = scenarioRef.current;

  const loadScenario = useCallback((scenario: Scenario) => {
    scenarioRef.current = scenario;
    stepIndexRef.current = 0;
    setEditableCode(scenario.code);
    setSandboxCompiled(null);
    setDiagnostics([]);
    setSandboxError(null);
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
    const nextScenario = scenarios.find((scenario) =>
      runtime === 'browser'
        ? scenario.id === 'settimeout-vs-promise'
        : scenario.id === 'nexttick-vs-promise'
    ) ?? scenarios.find((scenario) => scenario.runtime === runtime || scenario.runtime === 'both');

    stepIndexRef.current = 0;
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

    if (nextScenario) {
      scenarioRef.current = nextScenario;
      setEditableCode(nextScenario.code);
      setSandboxCompiled(null);
      setDiagnostics([]);
      setSandboxError(null);
      dispatch({ type: 'LOAD_SCENARIO', scenario: nextScenario });
      return;
    }

    scenarioRef.current = null;
    dispatch({ type: 'SET_RUNTIME', runtime });
  }, []);

  const setSpeed = useCallback((speed: number) => {
    dispatch({ type: 'SET_SPEED', speed });
  }, []);

  const jumpToStep = useCallback((step: number) => {
    const scenario = scenarioRef.current;
    if (!scenario) return;

    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

    const target = Math.max(0, Math.min(step, scenario.steps.length));
    dispatch({ type: 'LOAD_SCENARIO', scenario });
    for (let index = 0; index < target; index += 1) {
      dispatch({ type: 'EXECUTE_STEP', step: scenario.steps[index] });
    }
    stepIndexRef.current = target;
  }, []);

  const enqueueTask = useCallback((taskType: TaskType, label?: string) => {
    dispatch({ type: 'ENQUEUE_TASK', taskType, label });
  }, []);

  const compileAndLoad = useCallback(async (code: string) => {
    setEditableCode(code);
    setIsSandboxRunning(true);
    setSandboxError(null);
    setDiagnostics([]);

    try {
      const result: SandboxResult = await runSandbox(code, DEFAULT_SANDBOX_LIMITS);

      if (result.status === 'ok') {
        const { steps, expectedOutput } = traceToSteps(result.trace);

        setSandboxCompiled({
          code,
          steps,
          expectedOutput,
        });

        const sandboxScenario: Scenario = {
          id: 'editable',
          title: 'Editable Scenario',
          description: 'User-edited code',
          category: 'fundamentals',
          runtime: 'both',
          code,
          expectedOutput,
          steps,
          explanation: 'This is an editable scenario compiled from user code.',
        };

        scenarioRef.current = sandboxScenario;
        stepIndexRef.current = 0;
        dispatch({ type: 'LOAD_SCENARIO', scenario: sandboxScenario });

        setIsSandboxRunning(false);
        return true;
      } else {
        let errorMessage: string;
        switch (result.status) {
          case 'timeout':
            errorMessage = 'Execution timeout: code took too long to run';
            break;
          case 'limits':
            errorMessage = result.errorMessage || 'Execution limits exceeded';
            break;
          case 'error':
            errorMessage = result.errorMessage || 'Runtime error';
            break;
          default:
            errorMessage = 'Unknown error';
        }

        setSandboxError(errorMessage);
        setDiagnostics([{ message: errorMessage }]);
        setIsSandboxRunning(false);
        return false;
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      setSandboxError(errorMessage);
      setDiagnostics([{ message: errorMessage }]);
      setIsSandboxRunning(false);

      return false;
    }
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

    editableCode,
    setEditableCode,
    compiled: sandboxCompiled,
    diagnostics,
    compileAndLoad,
    hasDiagnostics: diagnostics.length > 0,
    sandboxError,
    isSandboxRunning,

    isPlaying: state.status === 'running',
    isPaused: state.status === 'paused',
    isCompleted: state.status === 'completed',
    isIdle: state.status === 'idle',
    canStepForward: state.status !== 'completed' && !!scenarioRef.current,
    canStepBackward: state.currentStep > 0,
  };
}

export type UseSimulatorReturn = ReturnType<typeof useSimulator>;
