import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { SimulatorProvider } from "@/components/simulator/SimulatorProvider";
import { CallStack } from "@/components/simulator/CallStack";
import { Queues } from "@/components/simulator/Queues";
import { PhaseIndicator } from "@/components/simulator/PhaseIndicator";
import { Controls } from "@/components/simulator/Controls";
import { CodePanel } from "@/components/simulator/CodePanel";
import { ConsolePanel } from "@/components/simulator/ConsolePanel";
import { ScenarioSelector } from "@/components/simulator/ScenarioSelector";
import { CodeEditor } from "@/components/simulator/CodeEditor";
import { Panel, Group, Separator } from "react-resizable-panels";
import { useSimulatorContext } from "@/components/simulator/SimulatorProvider";

export const Route = createFileRoute("/")({
  component: HomeComponent,
});

function HomeContent() {
  const [isCustomMode, setIsCustomMode] = useState(false);
  const { loadCustomCode, isRunning: isSimulatorRunning } = useSimulatorContext();

  useEffect(() => {
    const handleCustomMode = (e: CustomEvent<{ active: boolean }>) => {
      setIsCustomMode(e.detail.active);
    };

    window.addEventListener('customCodeMode', handleCustomMode as EventListener);
    return () => {
      window.removeEventListener('customCodeMode', handleCustomMode as EventListener);
    };
  }, []);

  const handleRunCode = (code: string) => {
    loadCustomCode(code);
  };

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background">
      <header className="shrink-0 border-b bg-background/80 backdrop-blur">
        <div className="flex items-center gap-4 px-4 py-2">
          <h1 className="shrink-0 text-base font-semibold tracking-tight">
            JS Event Loop
          </h1>
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <ScenarioSelector />
            <div className="hidden items-center gap-2 lg:flex">
              <PhaseIndicator />
            </div>
          </div>
          <Controls />
        </div>
      </header>

      <main className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-2 lg:hidden">
        <div className="shrink-0">
          <PhaseIndicator />
        </div>
        {isCustomMode && (
          <div className="min-h-[400px]">
            <CodeEditor onRunCode={handleRunCode} isRunning={isSimulatorRunning} />
          </div>
        )}
        {!isCustomMode && (
          <>
            <CallStack className="min-h-[300px]" />
            <div className="min-h-[300px]">
              <CodePanel />
            </div>
            <div className="min-h-[200px]">
              <ConsolePanel />
            </div>
          </>
        )}
      </main>

      <main className="hidden min-h-0 flex-1 p-2 lg:block">
        <Group orientation="horizontal" className="h-full">
          <Panel id="left-column" defaultSize={25} minSize={15}>
            <Group orientation="vertical" className="h-full">
              <Panel id="callstack" defaultSize={60} minSize={20}>
                <CallStack className="h-full" />
              </Panel>
              <Separator className="my-1 h-1 rounded bg-border transition-colors hover:bg-primary/50 data-[resize-handle-state=drag]:bg-primary" />
              <Panel id="console" defaultSize={40} minSize={15}>
                <ConsolePanel />
              </Panel>
            </Group>
          </Panel>

          <Separator className="my-1 h-auto w-1 rounded bg-border transition-colors hover:bg-primary/50 data-[resize-handle-state=drag]:bg-primary" />

          <Panel id="queues" defaultSize={30} minSize={20}>
            <Queues />
          </Panel>

          <Separator className="my-1 h-auto w-1 rounded bg-border transition-colors hover:bg-primary/50 data-[resize-handle-state=drag]:bg-primary" />

          <Panel id="code" defaultSize={45} minSize={25}>
            {isCustomMode ? (
              <CodeEditor onRunCode={handleRunCode} isRunning={isSimulatorRunning} />
            ) : (
              <CodePanel />
            )}
          </Panel>
        </Group>
      </main>
    </div>
  );
}

function HomeComponent() {
  return (
    <SimulatorProvider>
      <HomeContent />
    </SimulatorProvider>
  );
}
