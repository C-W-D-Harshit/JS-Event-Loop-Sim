export type Runtime = 'browser' | 'node';

export type SimulatorStatus = 'idle' | 'running' | 'paused' | 'completed';

export type Phase =
  | 'idle'
  | 'script'
  | 'task'
  | 'microtasks'
  | 'render'
  | 'timers'
  | 'pending'
  | 'poll'
  | 'check'
  | 'close';

export type TaskType =
  | 'sync'
  | 'setTimeout'
  | 'setInterval'
  | 'promise'
  | 'queueMicrotask'
  | 'fetch'
  | 'domEvent'
  | 'rAF'
  | 'mutationObserver'
  | 'nextTick'
  | 'setImmediate'
  | 'io';

export interface StackFrame {
  id: string;
  label: string;
  sourceLineStart: number;
  sourceLineEnd: number;
  color: string;
}

export interface Task {
  id: string;
  type: TaskType;
  label: string;
  sourceLineStart: number;
  sourceLineEnd: number;
  createdAtStep: number;
  color: string;
  delay?: number;
  firesAtStep?: number;
}

export interface AsyncOperation {
  id: string;
  traceId?: string;
  type: TaskType;
  label: string;
  sourceLineStart: number;
  sourceLineEnd: number;
  progress: number;
  totalSteps: number;
  remainingSteps: number;
  callbackTask: Omit<Task, 'createdAtStep'>;
  color: string;
}

export interface RenderStep {
  id: string;
  type: 'rAF' | 'style' | 'layout' | 'paint';
  label: string;
}

export interface EventLogEntry {
  step: number;
  timestamp: number;
  action: 'enqueue' | 'dequeue' | 'push' | 'pop' | 'complete' | 'start' | 'log';
  target: 'callStack' | 'microtaskQueue' | 'macrotaskQueue' | 'webApis' | 'nextTickQueue' | 'console' | 'render';
  taskId?: string;
  taskLabel?: string;
  message?: string;
}

export interface SimulatorState {
  runtime: Runtime;
  phase: Phase;
  status: SimulatorStatus;
  callStack: StackFrame[];
  webApis: AsyncOperation[];
  microtaskQueue: Task[];
  macrotaskQueue: Task[];
  nextTickQueue: Task[];
  renderPipeline: RenderStep[];
  consoleOutput: string[];
  eventLog: EventLogEntry[];
  currentStep: number;
  history: SimulatorSnapshot[];
  playbackSpeed: number;
  currentScenarioId: string | null;
  highlightedLines: number[];
}

export interface SimulatorSnapshot {
  step: number;
  state: Omit<SimulatorState, 'history' | 'eventLog'>;
}

export interface ScenarioStep {
  type: 'execute' | 'enqueue' | 'resolve' | 'complete' | 'log' | 'tick';
  action: ScenarioAction;
}

export type ScenarioAction =
  | { type: 'pushStack'; frame: Omit<StackFrame, 'id'> }
  | { type: 'popStack' }
  | { type: 'log'; message: string }
  | { type: 'enqueueMicrotask'; task: Omit<Task, 'id' | 'createdAtStep'> }
  | { type: 'enqueueMacrotask'; task: Omit<Task, 'id' | 'createdAtStep'> }
  | { type: 'enqueueNextTick'; task: Omit<Task, 'id' | 'createdAtStep'> }
  | { type: 'startAsync'; operation: Omit<AsyncOperation, 'id' | 'progress'> }
  | { type: 'cancelAsync'; traceId: string }
  | { type: 'tickAsync' }
  | { type: 'setPhase'; phase: Phase }
  | { type: 'dequeueAndRun'; queue: 'microtask' | 'macrotask' | 'nextTick' }
  | { type: 'runRender' }
  | { type: 'setHighlightedLines'; lines: number[] }
  | { type: 'complete' };

export interface Scenario {
  id: string;
  title: string;
  description: string;
  category: 'fundamentals' | 'browser' | 'node' | 'tricky';
  runtime: Runtime | 'both';
  code: string;
  expectedOutput: string[];
  steps: ScenarioStep[];
  explanation: string;
}

export type SimulatorAction =
  | { type: 'LOAD_SCENARIO'; scenario: Scenario }
  | { type: 'SET_RUNTIME'; runtime: Runtime }
  | { type: 'STEP_FORWARD' }
  | { type: 'STEP_BACKWARD' }
  | { type: 'PLAY' }
  | { type: 'PAUSE' }
  | { type: 'RESET' }
  | { type: 'SET_SPEED'; speed: number }
  | { type: 'JUMP_TO_STEP'; step: number }
  | { type: 'ENQUEUE_TASK'; taskType: TaskType; label?: string }
  | { type: 'EXECUTE_STEP'; step: ScenarioStep }
  | { type: 'TICK' };

export const COLORS = {
  callStack: '#60a5fa',
  microtask: '#a78bfa',
  macrotask: '#fbbf24',
  webApi: '#94a3b8',
  render: '#34d399',
  nextTick: '#f472b6',
  sync: '#60a5fa',
  promise: '#a78bfa',
  setTimeout: '#fbbf24',
  fetch: '#38bdf8',
  domEvent: '#fb923c',
  rAF: '#34d399',
  setImmediate: '#2dd4bf',
  io: '#a3e635',
} as const;

export function getTaskColor(type: TaskType): string {
  switch (type) {
    case 'sync':
      return COLORS.sync;
    case 'promise':
    case 'queueMicrotask':
    case 'mutationObserver':
      return COLORS.microtask;
    case 'setTimeout':
    case 'setInterval':
    case 'domEvent':
      return COLORS.macrotask;
    case 'fetch':
    case 'io':
      return COLORS.fetch;
    case 'rAF':
      return COLORS.rAF;
    case 'nextTick':
      return COLORS.nextTick;
    case 'setImmediate':
      return COLORS.setImmediate;
    default:
      return COLORS.callStack;
  }
}
