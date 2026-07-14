import type { TraceEvent } from "./traceTypes";
import type { ScenarioStep } from "./types";
import { COLORS } from "./types";

interface Frame {
  frameId: string;
  label: string;
  lineStart: number;
  lineEnd: number;
}

let taskIdCounter = 0;

function generateTaskId(): string {
  return `task-${++taskIdCounter}`;
}

export function traceToSteps(trace: TraceEvent[]): { steps: ScenarioStep[]; expectedOutput: string[] } {
  taskIdCounter = 0;
  const steps: ScenarioStep[] = [];
  const expectedOutput: string[] = [];
  const callStack: Frame[] = [];

  for (const event of trace) {
    switch (event.kind) {
      case "phase": {
        steps.push({
          type: "execute",
          action: {
            type: "setPhase",
            phase: event.phase,
          },
        });
        break;
      }

      case "call.enter": {
        const frame: Frame = {
          frameId: event.frameId,
          label: event.label,
          lineStart: event.loc.lineStart,
          lineEnd: event.loc.lineEnd,
        };

        callStack.push(frame);

        steps.push({
          type: "execute",
          action: {
            type: "pushStack",
            frame: {
              label: event.label,
              sourceLineStart: event.loc.lineStart,
              sourceLineEnd: event.loc.lineEnd,
              color: COLORS.sync,
            },
          },
        });
        break;
      }

      case "call.exit": {
        const frameIndex = callStack.findIndex((f) => f.frameId === event.frameId);
        if (frameIndex >= 0) {
          callStack.splice(frameIndex, 1);
        }

        steps.push({
          type: "execute",
          action: {
            type: "popStack",
          },
        });
        break;
      }

      case "console.log": {
        const loc = event.loc;
        steps.push({
          type: "execute",
          action: {
            type: "log",
            message: event.message,
          },
        });

        steps.push({
          type: "execute",
          action: {
            type: "setHighlightedLines",
            lines: [loc.lineStart, loc.lineEnd],
          },
        });

        expectedOutput.push(event.message);
        break;
      }

      case "schedule.macrotask": {
        const color = event.taskType === "setImmediate" ? COLORS.setImmediate : COLORS.setTimeout;
        const callbackTask = {
          id: generateTaskId(),
          type: event.taskType,
          label: event.label,
          sourceLineStart: event.loc.lineStart,
          sourceLineEnd: event.loc.lineEnd,
          color,
        };

        steps.push({
          type: "execute",
          action: {
            type: "pushStack",
            frame: {
              label: event.label,
              sourceLineStart: event.loc.lineStart,
              sourceLineEnd: event.loc.lineEnd,
              color,
            },
          },
        });

        steps.push({
          type: "execute",
          action: {
            type: "startAsync",
            operation: {
              type: event.taskType,
              traceId: event.taskId,
              label: event.label,
              sourceLineStart: event.loc.lineStart,
              sourceLineEnd: event.loc.lineEnd,
              totalSteps: 1,
              remainingSteps: 1,
              callbackTask,
              color,
            },
          },
        });

        steps.push({
          type: "execute",
          action: {
            type: "popStack",
          },
        });
        break;
      }

      case "cancel.macrotask": {
        steps.push({
          type: "execute",
          action: {
            type: "cancelAsync",
            traceId: event.taskId,
          },
        });
        break;
      }

      case "schedule.microtask": {
        steps.push({
          type: "execute",
          action: {
            type: "pushStack",
            frame: {
              label: event.label,
              sourceLineStart: event.loc.lineStart,
              sourceLineEnd: event.loc.lineEnd,
              color: COLORS.promise,
            },
          },
        });

        steps.push({
          type: "enqueue",
          action: {
            type: "enqueueMicrotask",
            task: {
              type: "promise",
              label: event.label,
              sourceLineStart: event.loc.lineStart,
              sourceLineEnd: event.loc.lineEnd,
              color: COLORS.promise,
            },
          },
        });

        steps.push({
          type: "execute",
          action: {
            type: "popStack",
          },
        });
        break;
      }

      case "schedule.nexttick": {
        steps.push({
          type: "enqueue",
          action: {
            type: "enqueueNextTick",
            task: {
              type: "nextTick",
              label: event.label,
              sourceLineStart: event.loc.lineStart,
              sourceLineEnd: event.loc.lineEnd,
              color: COLORS.nextTick,
            },
          },
        });
        break;
      }

      case "await.suspend": {
        steps.push({ type: "execute", action: { type: "popStack" } });
        steps.push({
          type: "enqueue",
          action: {
            type: "enqueueMicrotask",
            task: {
              type: "promise",
              label: `${event.label} continuation`,
              sourceLineStart: event.loc.lineStart,
              sourceLineEnd: event.loc.lineEnd,
              color: COLORS.promise,
            },
          },
        });
        break;
      }

      case "await.resume": {
        steps.push({
          type: "execute",
          action: { type: "setPhase", phase: "microtasks" },
        });
        steps.push({
          type: "execute",
          action: { type: "dequeueAndRun", queue: "microtask" },
        });
        steps.push({ type: "execute", action: { type: "popStack" } });
        steps.push({
          type: "execute",
          action: {
            type: "pushStack",
            frame: {
              label: event.label,
              sourceLineStart: event.loc.lineStart,
              sourceLineEnd: event.loc.lineEnd,
              color: COLORS.promise,
            },
          },
        });
        break;
      }

      case "task.start": {
        const queue = event.queue;

        if (queue === "macrotask") {
          steps.push({
            type: "tick",
            action: {
              type: "tickAsync",
            },
          });
        }

        steps.push({
          type: "execute",
          action: {
            type: "setPhase",
            phase: queue === "macrotask" ? "task" : "microtasks",
          },
        });

        steps.push({
          type: "execute",
          action: {
            type: "dequeueAndRun",
            queue: queue === "nextTick" ? "nextTick" : queue,
          },
        });
        break;
      }

      case "task.end": {
        steps.push({
          type: "execute",
          action: {
            type: "popStack",
          },
        });
        break;
      }

      case "tick": {
        const loc = event.loc;
        steps.push({
          type: "execute",
          action: {
            type: "setHighlightedLines",
            lines: [loc.lineStart, loc.lineEnd],
          },
        });
        break;
      }

      case "error": {
        steps.push({
          type: "execute",
          action: {
            type: "log",
            message: `ERROR: ${event.message}`,
          },
        });
        break;
      }

      case "done": {
        steps.push({
          type: "complete",
          action: {
            type: "complete",
          },
        });
        break;
      }
    }
  }

  return { steps, expectedOutput };
}
