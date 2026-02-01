import { Globe, Server, Code2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useSimulatorContext } from "./SimulatorProvider";
import { scenarios } from "@/lib/simulator/scenarios";
import type { Runtime } from "@/lib/simulator/types";
import { useState } from "react";

export function ScenarioSelector() {
  const { state, loadScenarioById, setRuntime, currentScenario, loadCustomCode } =
    useSimulatorContext();

  const [isCustomMode, setIsCustomMode] = useState(false);

  const filteredScenarios = scenarios.filter(
    (s) => s.runtime === "both" || s.runtime === state.runtime
  );

  const handleCustomCodeClick = () => {
    setIsCustomMode(true);
    // Dispatch event to notify parent component
    window.dispatchEvent(new CustomEvent('customCodeMode', { detail: { active: true } }));
  };

  const handleScenarioClick = (id: string) => {
    setIsCustomMode(false);
    loadScenarioById(id);
    window.dispatchEvent(new CustomEvent('customCodeMode', { detail: { active: false } }));
  };

  const runtimeOptions: { value: Runtime; label: string; icon: typeof Globe }[] = [
    { value: "browser", label: "Browser", icon: Globe },
    { value: "node", label: "Node.js", icon: Server },
  ];

  const currentScenarioLabel = currentScenario
    ? currentScenario.title
    : "Choose scenario";

  return (
    <div className="flex items-center gap-3">
      <Tabs
        value={state.runtime}
        onValueChange={(value) => setRuntime(value as Runtime)}
        className="gap-0"
      >
        <TabsList className="h-8">
          {runtimeOptions.map(({ value, label, icon: Icon }) => (
            <TabsTrigger key={value} value={value} className="gap-1.5 px-2.5">
              <Icon className="size-3.5" />
              {label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <Button
        variant={isCustomMode ? "default" : "outline"}
        size="sm"
        className="gap-1.5"
        onClick={handleCustomCodeClick}
      >
        <Code2 className="size-3.5" />
        Custom Code
      </Button>

      <DropdownMenu>
        <DropdownMenuTrigger
          render={(triggerProps) => (
            <Button
              {...triggerProps}
              variant="outline"
              size="sm"
              className="min-w-[14rem] justify-between font-normal"
            >
              <span className="truncate">{currentScenarioLabel}</span>
              <span className="text-muted-foreground">▾</span>
            </Button>
          )}
        />

        <DropdownMenuContent align="end" className="min-w-[18rem]">
          <DropdownMenuGroup>
            <DropdownMenuLabel>Scenarios</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {filteredScenarios.map((scenario) => (
              <DropdownMenuItem
                key={scenario.id}
                onClick={() => handleScenarioClick(scenario.id)}
              >
                <div className="flex min-w-0 flex-col">
                  <span className="truncate">{scenario.title}</span>
                  <span className="text-muted-foreground truncate">
                    {scenario.description}
                  </span>
                </div>
                {currentScenario?.id === scenario.id && (
                  <span className="ml-2 text-muted-foreground">✓</span>
                )}
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
