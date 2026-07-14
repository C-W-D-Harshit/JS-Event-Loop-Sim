export interface SourceLoc {
  lineStart: number;
  lineEnd: number;
  columnStart: number;
  columnEnd: number;
}

export type TraceEvent =
  | { kind: "phase"; phase: "script" | "task" | "microtasks" }
  | { kind: "call.enter"; frameId: string; label: string; loc: SourceLoc }
  | { kind: "call.exit"; frameId: string }
  | { kind: "console.log"; message: string; loc: SourceLoc }
  | {
      kind: "schedule.macrotask";
      taskId: string;
      taskType: "setTimeout" | "setInterval" | "setImmediate";
      label: string;
      delayMs: number;
      loc: SourceLoc;
    }
  | { kind: "cancel.macrotask"; taskId: string }
  | { kind: "schedule.microtask"; taskId: string; label: string; loc: SourceLoc }
  | { kind: "schedule.nexttick"; taskId: string; label: string; loc: SourceLoc }
  | {
      kind: "await.suspend";
      taskId: string;
      frameId: string;
      label: string;
      loc: SourceLoc;
    }
  | {
      kind: "await.resume";
      taskId: string;
      frameId: string;
      label: string;
      loc: SourceLoc;
    }
  | {
      kind: "task.start";
      taskId: string;
      queue: "macrotask" | "microtask" | "nextTick";
      loc: SourceLoc;
    }
  | { kind: "task.end"; taskId: string }
  | { kind: "tick"; loc: SourceLoc }
  | { kind: "error"; message: string; stack: string | null; loc: SourceLoc | null }
  | { kind: "done" };

export interface SandboxLimits {
  maxTicks: number;
  maxRuntimeMs: number;
  maxTraceEvents: number;
}

export const DEFAULT_SANDBOX_LIMITS: SandboxLimits = {
  maxTicks: 50000,
  maxRuntimeMs: 750,
  maxTraceEvents: 20000,
};
