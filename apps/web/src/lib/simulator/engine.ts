import type {
  SimulatorState,
  SimulatorAction,
  ScenarioStep,
  ScenarioAction,
  StackFrame,
  Task,
  AsyncOperation,
  EventLogEntry,
  Phase,
  Runtime,
  Scenario,
} from './types';
import { getTaskColor, COLORS } from './types';

let idCounter = 0;
function generateId(prefix: string): string {
  return `${prefix}-${++idCounter}`;
}

export function createInitialState(runtime: Runtime = 'browser'): SimulatorState {
  return {
    runtime,
    phase: 'idle',
    status: 'idle',
    callStack: [],
    webApis: [],
    microtaskQueue: [],
    macrotaskQueue: [],
    nextTickQueue: [],
    renderPipeline: [],
    consoleOutput: [],
    eventLog: [],
    currentStep: 0,
    history: [],
    playbackSpeed: 1,
    currentScenarioId: null,
    highlightedLines: [],
  };
}

function saveSnapshot(state: SimulatorState): SimulatorState {
  const { history, eventLog, ...rest } = state;
  return {
    ...state,
    history: [
      ...history,
      {
        step: state.currentStep,
        state: JSON.parse(JSON.stringify(rest)),
      },
    ],
  };
}

function addEventLog(
  state: SimulatorState,
  entry: Omit<EventLogEntry, 'step' | 'timestamp'>
): SimulatorState {
  return {
    ...state,
    eventLog: [
      ...state.eventLog,
      {
        ...entry,
        step: state.currentStep,
        timestamp: Date.now(),
      },
    ],
  };
}

function executeAction(state: SimulatorState, action: ScenarioAction): SimulatorState {
  switch (action.type) {
    case 'pushStack': {
      const frame: StackFrame = {
        ...action.frame,
        id: generateId('frame'),
      };
      const newState = {
        ...state,
        callStack: [...state.callStack, frame],
        highlightedLines: [action.frame.sourceLineStart, action.frame.sourceLineEnd],
      };
      return addEventLog(newState, {
        action: 'push',
        target: 'callStack',
        taskId: frame.id,
        taskLabel: frame.label,
      });
    }

    case 'popStack': {
      const popped = state.callStack[state.callStack.length - 1];
      const newState = {
        ...state,
        callStack: state.callStack.slice(0, -1),
        highlightedLines: state.callStack.length > 1
          ? [state.callStack[state.callStack.length - 2].sourceLineStart]
          : [],
      };
      return addEventLog(newState, {
        action: 'pop',
        target: 'callStack',
        taskId: popped?.id,
        taskLabel: popped?.label,
      });
    }

    case 'log': {
      const newState = {
        ...state,
        consoleOutput: [...state.consoleOutput, action.message],
      };
      return addEventLog(newState, {
        action: 'log',
        target: 'console',
        message: action.message,
      });
    }

    case 'enqueueMicrotask': {
      const task: Task = {
        ...action.task,
        id: generateId('microtask'),
        createdAtStep: state.currentStep,
        color: action.task.color || getTaskColor(action.task.type),
      };
      const newState = {
        ...state,
        microtaskQueue: [...state.microtaskQueue, task],
      };
      return addEventLog(newState, {
        action: 'enqueue',
        target: 'microtaskQueue',
        taskId: task.id,
        taskLabel: task.label,
      });
    }

    case 'enqueueMacrotask': {
      const task: Task = {
        ...action.task,
        id: generateId('macrotask'),
        createdAtStep: state.currentStep,
        color: action.task.color || getTaskColor(action.task.type),
      };
      const newState = {
        ...state,
        macrotaskQueue: [...state.macrotaskQueue, task],
      };
      return addEventLog(newState, {
        action: 'enqueue',
        target: 'macrotaskQueue',
        taskId: task.id,
        taskLabel: task.label,
      });
    }

    case 'enqueueNextTick': {
      const task: Task = {
        ...action.task,
        id: generateId('nexttick'),
        createdAtStep: state.currentStep,
        color: action.task.color || COLORS.nextTick,
      };
      const newState = {
        ...state,
        nextTickQueue: [...state.nextTickQueue, task],
      };
      return addEventLog(newState, {
        action: 'enqueue',
        target: 'nextTickQueue',
        taskId: task.id,
        taskLabel: task.label,
      });
    }

    case 'startAsync': {
      const operation: AsyncOperation = {
        ...action.operation,
        id: generateId('async'),
        progress: 0,
      };
      const newState = {
        ...state,
        webApis: [...state.webApis, operation],
      };
      return addEventLog(newState, {
        action: 'start',
        target: 'webApis',
        taskId: operation.id,
        taskLabel: operation.label,
      });
    }

    case 'cancelAsync': {
      const operation = state.webApis.find((item) => item.traceId === action.traceId);
      if (!operation) return state;

      return addEventLog(
        {
          ...state,
          webApis: state.webApis.filter((item) => item.traceId !== action.traceId),
        },
        {
          action: 'complete',
          target: 'webApis',
          taskId: operation.id,
          taskLabel: `${operation.label} (cancelled)`,
        }
      );
    }

    case 'tickAsync': {
      const updatedApis: AsyncOperation[] = [];
      let newState = state;

      for (const op of state.webApis) {
        const remaining = op.remainingSteps - 1;
        if (remaining <= 0) {
          const task: Task = {
            ...op.callbackTask,
            id: generateId('callback'),
            createdAtStep: state.currentStep,
          };

          const isMicrotask = op.type === 'fetch' || op.type === 'promise';
          if (isMicrotask) {
            newState = {
              ...newState,
              microtaskQueue: [...newState.microtaskQueue, task],
            };
          } else {
            newState = {
              ...newState,
              macrotaskQueue: [...newState.macrotaskQueue, task],
            };
          }

          newState = addEventLog(newState, {
            action: 'complete',
            target: 'webApis',
            taskId: op.id,
            taskLabel: op.label,
          });
        } else {
          updatedApis.push({
            ...op,
            remainingSteps: remaining,
            progress: ((op.totalSteps - remaining) / op.totalSteps) * 100,
          });
        }
      }

      return {
        ...newState,
        webApis: updatedApis,
      };
    }

    case 'setPhase': {
      return {
        ...state,
        phase: action.phase,
      };
    }

    case 'dequeueAndRun': {
      let queue: Task[];
      let target: EventLogEntry['target'];

      switch (action.queue) {
        case 'microtask':
          queue = state.microtaskQueue;
          target = 'microtaskQueue';
          break;
        case 'macrotask':
          queue = state.macrotaskQueue;
          target = 'macrotaskQueue';
          break;
        case 'nextTick':
          queue = state.nextTickQueue;
          target = 'nextTickQueue';
          break;
      }

      if (queue.length === 0) return state;

      const [task, ...rest] = queue;
      const frame: StackFrame = {
        id: generateId('frame'),
        label: task.label,
        sourceLineStart: task.sourceLineStart,
        sourceLineEnd: task.sourceLineEnd,
        color: task.color,
      };

      let newState = {
        ...state,
        callStack: [...state.callStack, frame],
        highlightedLines: [task.sourceLineStart, task.sourceLineEnd],
      };

      switch (action.queue) {
        case 'microtask':
          newState.microtaskQueue = rest;
          break;
        case 'macrotask':
          newState.macrotaskQueue = rest;
          break;
        case 'nextTick':
          newState.nextTickQueue = rest;
          break;
      }

      return addEventLog(newState, {
        action: 'dequeue',
        target,
        taskId: task.id,
        taskLabel: task.label,
      });
    }

    case 'runRender': {
      return addEventLog(
        { ...state, phase: 'render' },
        { action: 'start', target: 'render', message: 'Render cycle' }
      );
    }

    case 'setHighlightedLines': {
      return {
        ...state,
        highlightedLines: action.lines,
      };
    }

    case 'complete': {
      return {
        ...state,
        status: 'completed',
        phase: 'idle',
        highlightedLines: [],
      };
    }

    default:
      return state;
  }
}

export function simulatorReducer(
  state: SimulatorState,
  action: SimulatorAction
): SimulatorState {
  switch (action.type) {
    case 'LOAD_SCENARIO': {
      idCounter = 0;
      const scenario = action.scenario;
      return {
        ...createInitialState(scenario.runtime === 'both' ? state.runtime : scenario.runtime),
        currentScenarioId: scenario.id,
        status: 'idle',
      };
    }

    case 'SET_RUNTIME': {
      return {
        ...state,
        runtime: action.runtime,
      };
    }

    case 'STEP_FORWARD': {
      if (state.status === 'completed') return state;
      return {
        ...saveSnapshot(state),
        currentStep: state.currentStep + 1,
        status: 'paused',
      };
    }

    case 'STEP_BACKWARD': {
      if (state.currentStep === 0 || state.history.length === 0) return state;
      const prevSnapshot = state.history[state.history.length - 1];
      if (!prevSnapshot) return state;

      return {
        ...prevSnapshot.state,
        history: state.history.slice(0, -1),
        eventLog: state.eventLog,
        currentStep: prevSnapshot.step,
        status: 'paused',
      };
    }

    case 'PLAY': {
      if (state.status === 'completed') return state;
      return { ...state, status: 'running' };
    }

    case 'PAUSE': {
      return { ...state, status: 'paused' };
    }

    case 'RESET': {
      idCounter = 0;
      return {
        ...createInitialState(state.runtime),
        currentScenarioId: state.currentScenarioId,
        playbackSpeed: state.playbackSpeed,
      };
    }

    case 'SET_SPEED': {
      return { ...state, playbackSpeed: action.speed };
    }

    case 'JUMP_TO_STEP': {
      const targetSnapshot = state.history.find((s) => s.step === action.step);
      if (!targetSnapshot) return state;

      return {
        ...targetSnapshot.state,
        history: state.history.filter((s) => s.step <= action.step),
        eventLog: state.eventLog.filter((e) => e.step <= action.step),
        currentStep: action.step,
        status: 'paused',
      };
    }

    case 'EXECUTE_STEP': {
      const stepState = saveSnapshot(state);
      const newState = executeAction(stepState, action.step.action);
      return {
        ...newState,
        currentStep: state.currentStep + 1,
      };
    }

    case 'TICK': {
      return executeAction(state, { type: 'tickAsync' });
    }

    case 'ENQUEUE_TASK': {
      const { taskType, label } = action;
      const taskLabel = label || `${taskType} callback`;

      switch (taskType) {
        case 'promise':
        case 'queueMicrotask':
        case 'mutationObserver':
          return executeAction(state, {
            type: 'enqueueMicrotask',
            task: {
              type: taskType,
              label: taskLabel,
              sourceLineStart: 0,
              sourceLineEnd: 0,
              color: getTaskColor(taskType),
            },
          });

        case 'setTimeout':
        case 'setInterval':
        case 'domEvent':
          return executeAction(state, {
            type: 'enqueueMacrotask',
            task: {
              type: taskType,
              label: taskLabel,
              sourceLineStart: 0,
              sourceLineEnd: 0,
              color: getTaskColor(taskType),
            },
          });

        case 'nextTick':
          return executeAction(state, {
            type: 'enqueueNextTick',
            task: {
              type: taskType,
              label: taskLabel,
              sourceLineStart: 0,
              sourceLineEnd: 0,
              color: getTaskColor(taskType),
            },
          });

        default:
          return state;
      }
    }

    default:
      return state;
  }
}

export function getPhaseLabel(phase: Phase, runtime: Runtime): string {
  if (runtime === 'browser') {
    switch (phase) {
      case 'idle': return 'Idle';
      case 'script': return 'Evaluate Script';
      case 'task': return 'Run Task';
      case 'microtasks': return 'Drain Microtasks';
      case 'render': return 'Render';
      default: return phase;
    }
  } else {
    switch (phase) {
      case 'idle': return 'Idle';
      case 'script': return 'Evaluate Script';
      case 'timers': return 'Timers';
      case 'pending': return 'Pending Callbacks';
      case 'poll': return 'Poll';
      case 'check': return 'Check';
      case 'close': return 'Close Callbacks';
      case 'microtasks': return 'Microtasks';
      default: return phase;
    }
  }
}

export function getBrowserPhases(): Phase[] {
  return ['script', 'task', 'microtasks'];
}

export function getNodePhases(): Phase[] {
  return ['script', 'timers', 'pending', 'poll', 'check', 'close'];
}
