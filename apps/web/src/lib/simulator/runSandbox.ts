import type { SandboxLimits, TraceEvent } from "./traceTypes";
import type { RunRequest, RunEvent, TraceEventMessage, RunResultMessage } from "./sandboxProtocol";
import { instrument } from "./instrument";

export interface SandboxResult {
  status: "ok" | "error" | "timeout" | "limits";
  trace: TraceEvent[];
  errorMessage?: string;
}

export async function runSandbox(
  originalCode: string,
  limits: SandboxLimits = {
    maxTicks: 50000,
    maxRuntimeMs: 750,
    maxTraceEvents: 20000,
  }
): Promise<SandboxResult> {
  if (typeof Worker === "undefined") {
    return {
      status: "error",
      trace: [],
      errorMessage: "Web Worker not available",
    };
  }

  let trace: TraceEvent[] = [];
  let completed = false;

  return new Promise<SandboxResult>((resolve) => {
    let worker: Worker | null = null;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const cleanup = () => {
      if (completed) return;
      completed = true;
      if (timeoutId) clearTimeout(timeoutId);
      if (worker) {
        try {
          worker.terminate();
        } catch {}
      }
    };

    const handleMessage = (e: MessageEvent<RunEvent>) => {
      const msg = e.data;

      if (msg.type === "trace") {
        trace.push(...(msg as TraceEventMessage).events);
        if (trace.length > limits.maxTraceEvents) {
          cleanup();
          resolve({
            status: "limits",
            trace,
            errorMessage: "Limit exceeded: maxTraceEvents",
          });
        }
      } else if (msg.type === "result") {
        const result = msg as RunResultMessage;
        cleanup();

        if (result.status === "ok") {
          resolve({
            status: "ok",
            trace,
          });
        } else {
          resolve({
            status: result.status,
            trace,
            errorMessage: result.errorMessage,
          });
        }
      }
    };

    const handleError = (error: ErrorEvent) => {
      cleanup();
      resolve({
        status: "error",
        trace,
        errorMessage: error.message || "Worker error",
      });
    };

    try {
      let instrumentedCode: string;
      try {
        instrumentedCode = instrument(originalCode);
      } catch (error: unknown) {
        cleanup();
        const message =
          error instanceof Error ? error.message : "Unknown instrumentation error";
        resolve({
          status: "error",
          trace: [],
          errorMessage: `Instrumentation error: ${message}`,
        });
        return;
      }

      worker = new Worker(new URL("./sandbox.worker.ts", import.meta.url), {
        type: "module",
      });
      worker.addEventListener("message", handleMessage);
      worker.addEventListener("error", handleError);

      timeoutId = setTimeout(() => {
        cleanup();
        resolve({
          status: "timeout",
          trace,
          errorMessage: "Execution timeout",
        });
      }, limits.maxRuntimeMs + 1000);

      const request: RunRequest = {
        type: "run",
        code: instrumentedCode,
        limits,
      };

      worker.postMessage(request);
    } catch (error) {
      cleanup();
      resolve({
        status: "error",
        trace: [],
        errorMessage: error instanceof Error ? error.message : "Failed to run sandbox",
      });
    }
  });
}