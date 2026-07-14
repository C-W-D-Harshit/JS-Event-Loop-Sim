import type { TraceEvent, SandboxLimits } from "./traceTypes";

export interface RunRequest {
  type: "run";
  code: string;
  limits: SandboxLimits;
}

export interface TraceEventMessage {
  type: "trace";
  events: TraceEvent[];
}

export interface RunResultMessage {
  type: "result";
  status: "ok" | "error" | "timeout" | "limits";
  errorMessage?: string;
}

export type RunEvent = TraceEventMessage | RunResultMessage;