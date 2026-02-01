import { useState, useEffect, useRef } from "react";
import { Play, RotateCcw, Sparkles, Keyboard } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import Prism from "prismjs";
import "prismjs/themes/prism-tomorrow.css";
import "prismjs/components/prism-javascript";

interface CodeEditorProps {
  onRunCode: (code: string) => void;
  isRunning?: boolean;
}

export function CodeEditor({ onRunCode, isRunning }: CodeEditorProps) {
  const [code, setCode] = useState(`// Write your JavaScript code here
// Try: setTimeout, Promise.then, async/await, console.log

console.log("Start");

setTimeout(() => {
  console.log("setTimeout callback");
}, 0);

Promise.resolve().then(() => {
  console.log("Promise.then callback");
});

console.log("End");`);

  const [presets] = useState([
    {
      id: 'basic-settimeout',
      name: 'Basic setTimeout',
      description: 'Classic setTimeout vs sync execution',
      code: `console.log("Start");

setTimeout(() => {
  console.log("setTimeout callback");
}, 0);

console.log("End");`
    },
    {
      id: 'promise-chain',
      name: 'Promise Chain',
      description: 'Multiple .then() calls in sequence',
      code: `console.log("Start");

Promise.resolve()
  .then(() => {
    console.log("Then 1");
    return Promise.resolve();
  })
  .then(() => {
    console.log("Then 2");
  });

console.log("End");`
    },
    {
      id: 'async-await',
      name: 'Async/Await',
      description: 'How async/await desugars to Promises',
      code: `console.log("Start");

async function foo() {
  console.log("Inside async function");
  await Promise.resolve();
  console.log("After await");
}

foo();
console.log("End");`
    },
    {
      id: 'mixed',
      name: 'Mixed Patterns',
      description: 'Classic interview question',
      code: `console.log("1");

setTimeout(() => {
  console.log("2");
}, 0);

Promise.resolve().then(() => {
  console.log("3");
});

console.log("4");`
    },
    {
      id: 'multiple-settimeout',
      name: 'Multiple setTimeouts',
      description: 'Different delays, same order?',
      code: `console.log("Start");

setTimeout(() => console.log("100ms"), 100);
setTimeout(() => console.log("0ms"), 0);
setTimeout(() => console.log("50ms"), 50);

console.log("End");`
    },
    {
      id: 'nested-promises',
      name: 'Nested Promises',
      description: 'Promises inside promises',
      code: `console.log("Start");

Promise.resolve().then(() => {
  console.log("Outer then");
  Promise.resolve().then(() => {
    console.log("Inner then");
  });
});

console.log("End");`
    },
    {
      id: 'async-function-promise',
      name: 'Async Function + Promise',
      description: 'Mixing async functions and direct Promises',
      code: `console.log("1");

async function async1() {
  console.log("2");
  await Promise.resolve();
  console.log("3");
}

async1();
Promise.resolve().then(() => console.log("4"));
console.log("5");`
    },
    {
      id: 'catch-block',
      name: 'Promise Error Handling',
      description: 'How .catch() fits in the queue',
      code: `console.log("Start");

Promise.reject("Error")
  .then(() => console.log("Then"))
  .catch((err) => console.log("Catch:", err));

console.log("End");`
    },
    {
      id: 'multiple-await',
      name: 'Multiple Awaits',
      description: 'Each await creates a microtask checkpoint',
      code: `console.log("Start");

async function foo() {
  console.log("Before 1st await");
  await Promise.resolve();
  console.log("After 1st await");

  await Promise.resolve();
  console.log("After 2nd await");
}

foo();
console.log("End");`
    },
    {
      id: 'settimeout-promise-mix',
      name: 'Complex Mix',
      description: 'Combining multiple async patterns',
      code: `console.log("1");

setTimeout(() => console.log("2"), 0);

Promise.resolve()
  .then(() => {
    console.log("3");
    return Promise.resolve();
  })
  .then(() => console.log("4"));

setTimeout(() => console.log("5"), 0);

console.log("6");`
    }
  ]);

  const [activePreset, setActivePreset] = useState('');
  const [activeTab, setActiveTab] = useState<'editor' | 'presets'>('editor');
  const editorRef = useRef<HTMLPreElement>(null);

  // Highlight code with Prism
  useEffect(() => {
    if (editorRef.current) {
      Prism.highlightElement(editorRef.current);
    }
  }, [code, activeTab]);

  const handleRun = () => {
    onRunCode(code);
  };

  const handleReset = () => {
    setActivePreset('');
    setCode(`// Write your JavaScript code here
// Try: setTimeout, Promise.then, async/await, console.log

console.log("Start");

setTimeout(() => {
  console.log("setTimeout callback");
}, 0);

Promise.resolve().then(() => {
  console.log("Promise.then callback");
});

console.log("End");`);
  };

  const loadPreset = (preset: typeof presets[0]) => {
    setCode(preset.code);
    setActivePreset(preset.id);
    setActiveTab('editor');
  };

  const handleCodeChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setCode(e.target.value);
    setActivePreset('');
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Handle Ctrl/Cmd + Enter to run
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      handleRun();
    }
    // Handle Tab key for indentation
    if (e.key === 'Tab') {
      e.preventDefault();
      const start = e.currentTarget.selectionStart;
      const end = e.currentTarget.selectionEnd;
      const newValue = code.substring(0, start) + '  ' + code.substring(end);
      setCode(newValue);
      // Move cursor after the inserted spaces
      setTimeout(() => {
        e.currentTarget.selectionStart = e.currentTarget.selectionEnd = start + 2;
      }, 0);
    }
  };

  return (
    <Card className="h-full flex flex-col">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <Sparkles className="size-4" />
              Custom Code Editor
            </CardTitle>
            <CardDescription className="text-xs">
              Write JavaScript code to visualize its event loop behavior
            </CardDescription>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleReset}
              disabled={isRunning}
            >
              <RotateCcw className="size-3.5 mr-1.5" />
              Reset
            </Button>
            <Button
              size="sm"
              onClick={handleRun}
              disabled={isRunning}
            >
              <Play className="size-3.5 mr-1.5" />
              Run Code
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex-1 flex flex-col overflow-hidden p-0 pt-0">
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'editor' | 'presets')} className="h-full flex flex-col">
          <TabsList className="w-full justify-start rounded-none border-b px-3 h-10 bg-muted/30">
            <TabsTrigger value="editor" className="text-sm">Editor</TabsTrigger>
            <TabsTrigger value="presets" className="text-sm">Presets</TabsTrigger>
          </TabsList>

          <TabsContent value="editor" className="flex-1 p-0 m-0 overflow-hidden relative">
            {/* Syntax highlighted display */}
            <div className="absolute inset-0 overflow-hidden">
              <pre
                ref={editorRef}
                className="absolute inset-0 m-0 p-3 font-mono text-sm leading-relaxed bg-transparent pointer-events-none whitespace-pre-wrap break-words"
                aria-hidden="true"
              >
                <code className="language-javascript">{code || '// Write your JavaScript code here...'}</code>
              </pre>
            </div>

            {/* Actual textarea for editing */}
            <textarea
              value={code}
              onChange={handleCodeChange}
              onKeyDown={handleKeyDown}
              placeholder="// Write your JavaScript code here..."
              className="w-full h-full font-mono text-sm leading-relaxed p-3 bg-transparent text-transparent caret-foreground resize-none focus:outline-none absolute inset-0"
              spellCheck={false}
            />

            {/* Keyboard shortcut hint */}
            <div className="absolute bottom-2 right-2 flex items-center gap-1 text-xs text-muted-foreground bg-background/80 px-2 py-1 rounded border">
              <Keyboard className="size-3" />
              <span>Ctrl+Enter to run</span>
            </div>
          </TabsContent>

          <TabsContent value="presets" className="flex-1 p-3 m-0 overflow-hidden">
            <div className="space-y-2 overflow-y-auto h-full pr-1">
              {presets.map((preset) => (
                <Button
                  key={preset.id}
                  variant={activePreset === preset.id ? "default" : "outline"}
                  className="w-full justify-start text-left h-auto py-3 px-3"
                  onClick={() => loadPreset(preset)}
                  disabled={isRunning}
                >
                  <div className="flex flex-col min-w-0">
                    <span className="font-medium text-sm">{preset.name}</span>
                    <span className="text-xs text-muted-foreground truncate">
                      {preset.description}
                    </span>
                  </div>
                </Button>
              ))}
            </div>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
