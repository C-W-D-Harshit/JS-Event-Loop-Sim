import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useSimulatorContext } from "./SimulatorProvider";
import { cn } from "@/lib/utils";
import { useState, useEffect, useCallback } from "react";
import { CodeEditor } from "./CodeEditor";

export function CodePanel({ className }: { className?: string }) {
  const {
    state,
    currentScenario,
    editableCode,
    diagnostics,
    compileAndLoad,
    hasDiagnostics,
    isSandboxRunning,
    sandboxError,
  } = useSimulatorContext();

  const [isEditing, setIsEditing] = useState(false);
  const [localCode, setLocalCode] = useState("");

  useEffect(() => {
    if (currentScenario) {
      setLocalCode(currentScenario.code);
    }
  }, [currentScenario]);

  const handleSave = useCallback(async () => {
    const succeeded = await compileAndLoad(localCode);
    if (succeeded) setIsEditing(false);
  }, [localCode, compileAndLoad]);

  const handleCancel = useCallback(() => {
    setLocalCode(currentScenario?.code || editableCode || "");
    setIsEditing(false);
  }, [currentScenario, editableCode]);

  const handleDoubleClick = useCallback(() => {
    if (!isEditing && !isSandboxRunning) {
      setIsEditing(true);
    }
  }, [isEditing, isSandboxRunning]);

  const highlightedLines = state.highlightedLines;

  if (!currentScenario) {
    return (
      <Card size="sm" className="flex h-full flex-col">
        <CardHeader className="border-b">
          <CardTitle>Code</CardTitle>
          <CardDescription>Select a scenario to view the code.</CardDescription>
        </CardHeader>
        <CardContent className="flex min-h-0 flex-1 items-center justify-center text-sm text-muted-foreground">
          No scenario selected
        </CardContent>
      </Card>
    );
  }

  return (
    <Card
      size="sm"
      className={cn("flex h-full flex-col overflow-hidden", className ?? "")}
    >
      <CardHeader className="border-b">
        <div className="flex items-center justify-between">
          <div className="flex-1">
            <CardTitle className="text-sm">
              {currentScenario.title}
              {isSandboxRunning && (
                <span className="ml-2 rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">
                  Running...
                </span>
              )}
              {sandboxError && !isEditing && (
                <span className="ml-2 rounded-full bg-destructive/10 px-2 py-0.5 text-xs text-destructive">
                  Error
                </span>
              )}
            </CardTitle>
            <CardDescription>
              {currentScenario.description}
              {isEditing && (
                <span className="ml-2 text-primary"> - Editing mode</span>
              )}
              {isSandboxRunning && (
                <span className="ml-2 text-primary"> - Compiling sandbox...</span>
              )}
            </CardDescription>
          </div>
          {!isSandboxRunning && !isEditing && (
            <button
              type="button"
              onClick={handleDoubleClick}
              className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
            >
              Edit Code
            </button>
          )}
          {isEditing && !isSandboxRunning && (
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleCancel}
                className="rounded-md bg-muted px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted/80"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSave}
                className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
              >
                Save & Run
              </button>
            </div>
          )}
        </div>
      </CardHeader>

      {sandboxError && !isEditing && (
        <div className="border-b bg-destructive/10 px-4 py-3 text-xs text-destructive">
          <strong className="font-semibold">Error:</strong> {sandboxError}
          <button
            type="button"
            onClick={handleDoubleClick}
            className="mt-2 ml-2 text-sm underline hover:no-underline"
            disabled={isSandboxRunning}
          >
            Edit to fix →
          </button>
        </div>
      )}

      {isSandboxRunning && (
        <div className="border-b bg-primary/10 px-4 py-3 text-xs text-primary">
          <div className="flex items-center gap-2">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            <span>Running sandbox execution...</span>
            <span className="text-muted-foreground">(Instrumenting and executing code in Web Worker)</span>
          </div>
        </div>
      )}

      {hasDiagnostics && !isEditing && !sandboxError && (
        <div className="border-b bg-destructive/10 px-4 py-3 text-xs text-destructive">
          <strong className="font-semibold">Compilation Error(s):</strong>
          <div className="mt-1 space-y-1">
            {diagnostics.map((diag) => (
              <div
                key={`${diag.line ?? "global"}-${diag.column ?? 0}-${diag.message}`}
                className="font-mono"
              >
                {diag.line && `Line ${diag.line}: `}
                {diag.message}
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={handleDoubleClick}
            className="mt-2 text-sm underline hover:no-underline"
            disabled={isSandboxRunning}
          >
            Double-click to fix →
          </button>
        </div>
      )}

      <CardContent
        className={cn(
          "min-h-0 flex-1 overflow-auto p-0 font-mono text-sm",
          isSandboxRunning ? "opacity-50" : ""
        )}
        onDoubleClick={!isSandboxRunning ? handleDoubleClick : undefined}
        style={{ cursor: isEditing ? 'text' : (!isSandboxRunning ? 'default' : 'not-allowed') }}
      >
        <CodeEditor
          code={isEditing ? localCode : currentScenario.code}
          highlightedLines={highlightedLines}
          readOnly={!isEditing || isSandboxRunning}
          onChange={setLocalCode}
          className="h-full"
        />
      </CardContent>

      {currentScenario.explanation && !isEditing && !isSandboxRunning && (
        <div className="shrink-0 border-t bg-muted/20 px-4 py-3 text-xs text-muted-foreground">
          <strong className="text-foreground">Why?</strong>{" "}
          {currentScenario.explanation}
        </div>
      )}

      {!isEditing && !isSandboxRunning && !hasDiagnostics && !sandboxError && currentScenario.explanation && (
        <div className="shrink-0 border-t bg-muted/10 px-4 py-2 text-xs text-muted-foreground">
          💡 Tip: Double-click the code to start editing
        </div>
      )}
    </Card>
  );
}
