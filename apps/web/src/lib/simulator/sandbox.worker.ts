import type { TraceEvent, SourceLoc } from "./traceTypes";
import type { RunRequest, RunEvent } from "./sandboxProtocol";

const DEFAULT_LOC: SourceLoc = {
  lineStart: 1,
  lineEnd: 1,
  columnStart: 0,
  columnEnd: 0,
};

const nativeSetTimeout = globalThis.setTimeout.bind(globalThis);
const nativeQueueMicrotask = globalThis.queueMicrotask.bind(globalThis);
const nativePromiseThen = Promise.prototype.then;
const internalPromises = new WeakSet<Promise<unknown>>();

let ticks = 0;
let startTime = 0;
let emittedEventCount = 0;
let traceEvents: TraceEvent[] = [];
let limits = { maxTicks: 50000, maxRuntimeMs: 750, maxTraceEvents: 20000 };
let terminated = false;
let evaluationComplete = false;
let drainScheduled = false;
let lastLoc: SourceLoc | null = null;
let taskIdCounter = 0;
let timerIdCounter = 0;
let timerOrderCounter = 0;
let virtualTime = 0;

interface VirtualTimer {
  id: number;
  taskId: string;
  taskType: "setTimeout" | "setInterval" | "setImmediate";
  label: string;
  delay: number;
  dueAt: number;
  order: number;
  callback: (...args: unknown[]) => unknown;
  args: unknown[];
  loc: SourceLoc;
  repeating: boolean;
  cancelled: boolean;
}

let timers: VirtualTimer[] = [];
const timersById = new Map<number, VirtualTimer>();

interface MicrotaskJob {
  taskId: string;
  queue: "microtask" | "nextTick";
  loc: SourceLoc;
  run: () => void;
}

let nextTickJobs: MicrotaskJob[] = [];
let microtaskJobs: MicrotaskJob[] = [];
let microtaskDrainScheduled = false;

const nextTaskId = (prefix: string) => `${prefix}-${++taskIdCounter}`;

const postMessageToMain = (message: RunEvent) => {
  self.postMessage(message);
};

const flushEvents = () => {
  if (traceEvents.length === 0) return;
  postMessageToMain({ type: "trace", events: traceEvents });
  traceEvents = [];
};

const postLimitExceeded = (limit: string) => {
  if (terminated) return;
  terminated = true;
  flushEvents();
  postMessageToMain({
    type: "result",
    status: "limits",
    errorMessage: `Limit exceeded: ${limit}`,
  });
};

const emit = (event: TraceEvent) => {
  if (terminated) return;
  emittedEventCount += 1;
  if (emittedEventCount > limits.maxTraceEvents) {
    postLimitExceeded("maxTraceEvents");
    throw new Error("__SIM_LIMIT__maxTraceEvents");
  }
  traceEvents.push(event);
  if (traceEvents.length >= 25) flushEvents();
};

const sendError = (error: unknown) => {
  if (terminated) return;
  terminated = true;
  flushEvents();
  postMessageToMain({
    type: "result",
    status: "error",
    errorMessage: error instanceof Error ? error.message : String(error),
  });
};

const checkLimits = () => {
  ticks += 1;
  if (ticks > limits.maxTicks) {
    postLimitExceeded("maxTicks");
    throw new Error("__SIM_LIMIT__maxTicks");
  }
  if (Date.now() - startTime > limits.maxRuntimeMs) {
    postLimitExceeded("maxRuntimeMs");
    throw new Error("__SIM_LIMIT__maxRuntimeMs");
  }
};

const drainMicrotaskJobs = () => {
  microtaskDrainScheduled = false;
  if (terminated) return;

  try {
    while (nextTickJobs.length > 0 || microtaskJobs.length > 0) {
      // nextTick has priority at every checkpoint. Re-checking it after each
      // regular microtask also handles nextTicks created inside Promise jobs.
      const job = nextTickJobs.shift() ?? microtaskJobs.shift();
      if (!job) break;
      emit({ kind: "task.start", taskId: job.taskId, queue: job.queue, loc: job.loc });
      checkLimits();
      job.run();
      emit({ kind: "task.end", taskId: job.taskId });
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("__SIM_LIMIT__")) return;
    sendError(error);
  }
};

const scheduleMicrotaskDrain = () => {
  if (terminated || microtaskDrainScheduled) return;
  microtaskDrainScheduled = true;
  nativeQueueMicrotask(drainMicrotaskJobs);
};

const finish = () => {
  if (terminated) return;
  emit({ kind: "done" });
  flushEvents();
  terminated = true;
  postMessageToMain({ type: "result", status: "ok" });
};

const scheduleDrain = () => {
  if (terminated || drainScheduled || !evaluationComplete) return;
  drainScheduled = true;
  // A native task boundary lets the host drain every Promise/queueMicrotask
  // callback before the next simulated macrotask.
  nativeSetTimeout(drainTimers, 0);
};

const drainTimers = () => {
  drainScheduled = false;
  if (terminated) return;

  timers = timers
    .filter((timer) => !timer.cancelled)
    .sort((a, b) => a.dueAt - b.dueAt || a.order - b.order);

  const timer = timers.shift();
  if (!timer) {
    finish();
    return;
  }

  virtualTime = Math.max(virtualTime, timer.dueAt);
  if (!timer.repeating) timersById.delete(timer.id);

  emit({
    kind: "task.start",
    taskId: timer.taskId,
    queue: "macrotask",
    loc: timer.loc,
  });

  try {
    checkLimits();
    timer.callback(...timer.args);
    emit({ kind: "task.end", taskId: timer.taskId });

    if (timer.repeating && !timer.cancelled) {
      timer.taskId = nextTaskId("interval");
      timer.dueAt = virtualTime + timer.delay;
      timer.order = ++timerOrderCounter;
      timers.push(timer);
      emit({
        kind: "schedule.macrotask",
        taskId: timer.taskId,
        taskType: "setInterval",
        label: timer.label,
        delayMs: timer.delay,
        loc: timer.loc,
      });
    }
  } catch (error) {
    emit({ kind: "task.end", taskId: timer.taskId });
    if (error instanceof Error && error.message.startsWith("__SIM_LIMIT__")) return;
    sendError(error);
    return;
  }

  scheduleDrain();
};

const scheduleTimer = (
  taskType: VirtualTimer["taskType"],
  callback: (...args: unknown[]) => unknown,
  delay = 0,
  args: unknown[] = [],
  repeating = false
) => {
  checkLimits();
  if (typeof callback !== "function") {
    throw new TypeError(`${taskType} callback must be a function`);
  }

  const normalizedDelay = Number.isFinite(Number(delay))
    ? Math.max(0, Number(delay))
    : 0;
  const id = ++timerIdCounter;
  const taskId = nextTaskId(taskType === "setImmediate" ? "immediate" : "timer");
  const loc = lastLoc ?? DEFAULT_LOC;
  const label =
    taskType === "setImmediate"
      ? "setImmediate callback"
      : `${taskType} (${normalizedDelay}ms)`;
  const timer: VirtualTimer = {
    id,
    taskId,
    taskType,
    label,
    delay: normalizedDelay,
    dueAt: virtualTime + normalizedDelay,
    order: ++timerOrderCounter,
    callback,
    args,
    loc,
    repeating,
    cancelled: false,
  };

  timers.push(timer);
  timersById.set(id, timer);
  emit({
    kind: "schedule.macrotask",
    taskId,
    taskType,
    label,
    delayMs: normalizedDelay,
    loc,
  });
  scheduleDrain();
  return id;
};

const clearTimer = (id: number | undefined) => {
  if (id === undefined) return;
  const timer = timersById.get(Number(id));
  if (!timer) return;
  timer.cancelled = true;
  timersById.delete(timer.id);
  emit({ kind: "cancel.macrotask", taskId: timer.taskId });
};

(globalThis as typeof globalThis & { __sim: unknown }).__sim = {
  tick: (loc: SourceLoc) => {
    if (terminated) return;
    checkLimits();
    lastLoc = loc;
    emit({ kind: "tick", loc });
  },
  emit: (event: TraceEvent) => emit(event),
  awaitValue: (value: unknown, frameId: string, label: string, loc: SourceLoc) => {
    const taskId = nextTaskId("await");
    emit({ kind: "await.suspend", taskId, frameId, label, loc });
    return nativePromiseThen.call(
      Promise.resolve(value),
      (resolved) => {
        emit({ kind: "await.resume", taskId, frameId, label, loc });
        return resolved;
      },
      (error) => {
        emit({ kind: "await.resume", taskId, frameId, label, loc });
        throw error;
      }
    );
  },
};

const originalConsoleLog = globalThis.console.log.bind(globalThis.console);
globalThis.console.log = (...args: unknown[]) => {
  if (terminated) return;
  checkLimits();
  const message = args
    .map((arg) => {
      if (typeof arg === "string") return arg;
      if (arg === null) return "null";
      if (arg === undefined) return "undefined";
      if (typeof arg === "object") {
        try {
          return JSON.stringify(arg);
        } catch {
          return "[Object]";
        }
      }
      return String(arg);
    })
    .join(" ");

  emit({ kind: "console.log", message, loc: lastLoc ?? DEFAULT_LOC });
  originalConsoleLog(...args);
};

globalThis.setTimeout = ((callback: TimerHandler, delay?: number, ...args: unknown[]) =>
  scheduleTimer("setTimeout", callback as (...args: unknown[]) => unknown, delay, args)
) as typeof globalThis.setTimeout;
globalThis.clearTimeout = ((id?: number) => clearTimer(id)) as typeof globalThis.clearTimeout;

globalThis.setInterval = ((callback: TimerHandler, delay?: number, ...args: unknown[]) =>
  scheduleTimer("setInterval", callback as (...args: unknown[]) => unknown, delay, args, true)
) as typeof globalThis.setInterval;
globalThis.clearInterval = ((id?: number) => clearTimer(id)) as typeof globalThis.clearInterval;

(globalThis as any).setImmediate = (
  callback: unknown,
  ...args: unknown[]
) => scheduleTimer("setImmediate", callback as (...args: unknown[]) => unknown, 0, args);

globalThis.queueMicrotask = (callback: VoidFunction) => {
  if (terminated) return;
  checkLimits();
  const taskId = nextTaskId("microtask");
  const loc = lastLoc ?? DEFAULT_LOC;
  emit({ kind: "schedule.microtask", taskId, label: "queueMicrotask callback", loc });

  nativeQueueMicrotask(() => {
    microtaskJobs.push({ taskId, queue: "microtask", loc, run: callback });
    scheduleMicrotaskDrain();
  });
};

const processObject = ((globalThis as any).process ??= {});
processObject.nextTick = (callback: (...args: unknown[]) => unknown, ...args: unknown[]) => {
  if (terminated) return;
  checkLimits();
  if (typeof callback !== "function") {
    throw new TypeError("process.nextTick callback must be a function");
  }
  const taskId = nextTaskId("nexttick");
  const loc = lastLoc ?? DEFAULT_LOC;
  emit({ kind: "schedule.nexttick", taskId, label: "process.nextTick callback", loc });
  nextTickJobs.push({
    taskId,
    queue: "nextTick",
    loc,
    run: () => {
      callback(...args);
    },
  });
  scheduleMicrotaskDrain();
};

Promise.prototype.then = function <TResult1 = unknown, TResult2 = never>(
  this: Promise<unknown>,
  onFulfilled?: ((value: unknown) => TResult1 | PromiseLike<TResult1>) | null,
  onRejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
) {
  if (internalPromises.has(this)) {
    return nativePromiseThen.call(this, onFulfilled, onRejected);
  }
  const hasHandler = typeof onFulfilled === "function" || typeof onRejected === "function";
  if (!hasHandler || terminated) {
    return nativePromiseThen.call(this, onFulfilled, onRejected);
  }

  checkLimits();
  const taskId = nextTaskId("promise");
  const loc = lastLoc ?? DEFAULT_LOC;
  const label = typeof onFulfilled === "function" ? "Promise.then callback" : "Promise.catch callback";
  let scheduled = false;

  const wrap = <T>(handler: ((value: T) => unknown) | null | undefined) => {
    if (typeof handler !== "function") return handler;
    return (value: T) => {
      if (terminated) return handler(value);
      // Registering `.then` on a pending Promise does not enqueue a job yet.
      // Emit the queue event only once the reaction actually becomes runnable.
      if (!scheduled) {
        scheduled = true;
        emit({ kind: "schedule.microtask", taskId, label, loc });
      }
      const deferred = new Promise((resolve, reject) => {
        microtaskJobs.push({
          taskId,
          queue: "microtask",
          loc,
          run: () => {
            try {
              resolve(handler(value));
            } catch (error) {
              reject(error);
              throw error;
            }
          },
        });
        scheduleMicrotaskDrain();
      });
      internalPromises.add(deferred);
      return deferred;
    };
  };

  return nativePromiseThen.call(this, wrap(onFulfilled), wrap(onRejected));
} as typeof Promise.prototype.then;

self.addEventListener("unhandledrejection", (event) => {
  event.preventDefault();
  sendError(event.reason ?? new Error("Unhandled Promise rejection"));
});

self.onmessage = (event: MessageEvent<RunRequest>) => {
  if (event.data.type !== "run") return;

  ticks = 0;
  emittedEventCount = 0;
  startTime = Date.now();
  traceEvents = [];
  limits = event.data.limits;
  terminated = false;
  evaluationComplete = false;
  drainScheduled = false;
  lastLoc = null;
  taskIdCounter = 0;
  timerIdCounter = 0;
  timerOrderCounter = 0;
  virtualTime = 0;
  timers = [];
  timersById.clear();
  nextTickJobs = [];
  microtaskJobs = [];
  microtaskDrainScheduled = false;

  try {
    // The worker is isolated and force-terminated by runSandbox on completion
    // or timeout. Instrumentation adds cooperative limits for tight loops.
    // eslint-disable-next-line no-eval
    eval(event.data.code);
    evaluationComplete = true;
    scheduleDrain();
  } catch (error) {
    flushEvents();
    if (error instanceof Error && error.message.startsWith("__SIM_LIMIT__")) return;
    sendError(error);
  }
};
