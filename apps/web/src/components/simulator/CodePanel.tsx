import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useSimulatorContext } from "./SimulatorProvider";
import { cn } from "@/lib/utils";
import { useEffect, useMemo, useState } from "react";
import Prism from "prismjs";
import { buildScenarioFromCode } from "@/lib/simulator/customScenario";
import "prismjs/components/prism-javascript";
import "prismjs/themes/prism-tomorrow.css";

export function CodePanel({ className }: { className?: string }) {
  const { state, currentScenario, loadScenario, reset } = useSimulatorContext();
  const [activeTab, setActiveTab] = useState("template");
  const [editorCode, setEditorCode] = useState(currentScenario?.code ?? "");
  const [editorError, setEditorError] = useState<string | null>(null);

  useEffect(() => {
    if (currentScenario?.id !== "custom-editor") {
      setEditorCode(currentScenario?.code ?? "");
    }
  }, [currentScenario]);

  const highlightedCode = useMemo(() => {
    if (!currentScenario) return [];
    
    const html = Prism.highlight(
      currentScenario.code,
      Prism.languages.javascript,
      "javascript"
    );
    
    return html.split("\n");
  }, [currentScenario]);

  const highlightLines = state.highlightedLines;

  const runEditorCode = () => {
    const { scenario, errors } = buildScenarioFromCode(editorCode);
    if (!scenario) {
      setEditorError(errors.join(" "));
      return;
    }

    setEditorError(null);
    loadScenario(scenario);
    reset();
    setActiveTab("template");
  };

  return (
    <Card
      size="sm"
      className={cn("flex h-full flex-col overflow-hidden", className ?? "")}
    >
      <CardHeader className="border-b gap-3">
        <div>
          <CardTitle className="text-sm">{currentScenario?.title ?? "Code"}</CardTitle>
          <CardDescription>
            {currentScenario?.description ?? "Select a scenario or run custom code."}
          </CardDescription>
        </div>
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="h-8 w-full">
            <TabsTrigger value="template" className="flex-1">Simulation</TabsTrigger>
            <TabsTrigger value="editor" className="flex-1">Code Editor</TabsTrigger>
          </TabsList>
        </Tabs>
      </CardHeader>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="min-h-0 flex-1 overflow-hidden">
        <TabsContent value="template" className="mt-0 min-h-0 flex-1 overflow-hidden">
          {!currentScenario ? (
            <CardContent className="flex min-h-0 h-full items-center justify-center text-sm text-muted-foreground">
              No scenario selected
            </CardContent>
          ) : (
            <CardContent className="min-h-0 h-full overflow-auto p-0 font-mono text-sm">
              <pre className="p-4">
                {highlightedCode.map((lineHtml, i) => {
                  const lineNum = i + 1;
                  const isHighlighted = highlightLines.includes(lineNum);

                  return (
                    <div
                      key={i}
                      className={`group flex rounded-sm px-1 transition-colors duration-150 hover:bg-muted/40 ${
                        isHighlighted ? "bg-primary/10 ring-1 ring-primary/20" : ""
                      }`}
                    >
                      <span className="w-10 shrink-0 select-none pr-3 text-right text-[11px] leading-6 text-muted-foreground/60">
                        {lineNum}
                      </span>
                      <code
                        className={
                          isHighlighted
                            ? "leading-6 text-foreground"
                            : "leading-6"
                        }
                        dangerouslySetInnerHTML={{ __html: lineHtml || " " }}
                      />
                    </div>
                  );
                })}
              </pre>
            </CardContent>
          )}
        </TabsContent>

        <TabsContent value="editor" className="mt-0 min-h-0 flex-1 overflow-hidden">
          <CardContent className="flex h-full min-h-0 flex-col gap-3 p-3">
            <textarea
              value={editorCode}
              onChange={(e) => setEditorCode(e.target.value)}
              className="min-h-0 flex-1 resize-none rounded-md border bg-muted/30 p-3 font-mono text-xs outline-none ring-offset-background transition focus-visible:ring-2 focus-visible:ring-ring"
              spellCheck={false}
              placeholder={'console.log("start");\n\nPromise.resolve().then(() => {\n  console.log("microtask");\n});\n\nsetTimeout(() => {\n  console.log("macrotask");\n}, 0);'}
            />
            {editorError && (
              <p className="text-xs text-destructive">{editorError}</p>
            )}
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground">
                Supported: console.log, Promise.then, queueMicrotask, setTimeout.
              </p>
              <Button size="sm" onClick={runEditorCode}>
                Run in Simulator
              </Button>
            </div>
          </CardContent>
        </TabsContent>
      </Tabs>

      {currentScenario?.explanation && activeTab === "template" && (
        <div className="shrink-0 border-t bg-muted/20 px-4 py-3 text-xs text-muted-foreground">
          <strong className="text-foreground">Why?</strong>{" "}
          {currentScenario.explanation}
        </div>
      )}
    </Card>
  );
}
