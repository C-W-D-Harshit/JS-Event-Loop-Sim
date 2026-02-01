import type { Scenario, ScenarioStep } from './types';
import { COLORS } from './types';

/**
 * Parses user JavaScript code and generates simulation steps
 * This is a simplified parser that detects common async patterns
 */
export function parseUserCode(code: string): Omit<Scenario, 'id' | 'title' | 'description' | 'category' | 'runtime' | 'explanation'> {
  const lines = code.split('\n');
  const steps: ScenarioStep[] = [];
  const expectedOutput: string[] = [];
  let lineMap = new Map<number, number>(); // Map original line numbers to parsed lines

  // Remove empty lines and comments for parsing, but keep track
  const cleanCodeLines = lines.map((line, idx) => ({ line, originalIdx: idx }))
    .filter(({ line }) => line.trim() && !line.trim().startsWith('//'));

  const cleanCode = cleanCodeLines.map(({ line, originalIdx }, idx) => {
    lineMap.set(idx + 1, originalIdx + 1);
    return line;
  }).join('\n');

  // Parse the code to extract operations
  const operations = extractOperations(cleanCode, cleanCodeLines);

  // Generate execution steps
  generateExecutionSteps(operations, steps, expectedOutput, lineMap);

  return {
    code,
    expectedOutput,
    steps,
  };
}

interface Operation {
  type: 'log' | 'setTimeout' | 'promise' | 'asyncAwait' | 'asyncFunctionCall' | 'catch';
  lineStart: number;
  lineEnd: number;
  content: string;
  callbackContent?: string;
  delay?: number;
  depth: number;
}

function extractOperations(code: string, lines: Array<{ line: string; originalIdx: number }>): Operation[] {
  const operations: Operation[] = [];
  const codeLines = code.split('\n');

  for (let i = 0; i < codeLines.length; i++) {
    const line = codeLines[i].trim();
    const lineNum = i + 1;

    // Detect console.log (standalone, not inside callback)
    const logMatch = line.match(/console\.log\s*\(\s*['"`](.*?)['"`]\s*\)/);
    if (logMatch && !line.includes('setTimeout') && !line.includes('.then') && !line.includes('.catch')) {
      operations.push({
        type: 'log',
        lineStart: lineMap.get(lineNum) || lineNum,
        lineEnd: lineMap.get(lineNum) || lineNum,
        content: logMatch[1],
        depth: 0,
      });
      continue;
    }

    // Detect async function call
    const asyncCallMatch = line.match(/(\w+)\(\)\s*;?$/);
    if (asyncCallMatch && line.includes('async') && !line.includes('function')) {
      operations.push({
        type: 'asyncFunctionCall',
        lineStart: lineMap.get(lineNum) || lineNum,
        lineEnd: lineMap.get(lineNum) || lineNum,
        content: asyncCallMatch[1],
        depth: 0,
      });
      continue;
    }

    // Detect setTimeout (arrow function or regular callback)
    const setTimeoutMatch = line.match(/setTimeout\s*\(\s*(\([^)]*\)|\([^)]*\)\s*=>\s*\{[^}]*\}|function\s*\([^)]*\)\s*\{[^}]*\})\s*,\s*(\d+)\s*\)/);
    if (setTimeoutMatch) {
      operations.push({
        type: 'setTimeout',
        lineStart: lineMap.get(lineNum) || lineNum,
        lineEnd: findCallbackEnd(codeLines, i) || lineMap.get(lineNum) || lineNum,
        content: setTimeoutMatch[1],
        delay: parseInt(setTimeoutMatch[2], 10),
        depth: 0,
      });
      continue;
    }

    // Detect Promise.then chain
    const promiseMatch = line.match(/Promise\.resolve\s*\(\s*\)(?:\.then\s*\([^)]*\))+/);
    if (promiseMatch) {
      // Find the end of the entire promise chain
      let endLine = i;
      let braceCount = 0;
      for (let j = i; j < codeLines.length; j++) {
        const testLine = codeLines[j];
        for (const char of testLine) {
          if (char === '{') braceCount++;
          if (char === '}') {
            braceCount--;
            if (braceCount <= 0 && j > i) {
              endLine = j + 1;
              break;
            }
          }
        }
        if (endLine > i) break;
        // Also check if next line doesn't start with .then or more Promise code
        if (j > i && !codeLines[j].trim().startsWith('.then') && !codeLines[j].trim().startsWith('Promise')) {
          endLine = j;
          break;
        }
      }

      operations.push({
        type: 'promise',
        lineStart: lineMap.get(lineNum) || lineNum,
        lineEnd: lineMap.get(endLine) || endLine,
        content: codeLines.slice(i, endLine).join('\n'),
        depth: 0,
      });
      continue;
    }

    // Detect Promise.catch
    const catchMatch = line.match(/\.catch\s*\(/);
    if (catchMatch) {
      operations.push({
        type: 'catch',
        lineStart: lineMap.get(lineNum) || lineNum,
        lineEnd: findCallbackEnd(codeLines, i) || lineMap.get(lineNum) || lineNum,
        content: line,
        depth: 0,
      });
      continue;
    }

    // Detect async function declaration
    const asyncMatch = line.match(/async\s+function\s+(\w+)\s*\(/);
    if (asyncMatch) {
      const funcEnd = findFunctionEnd(codeLines, i);
      const funcBody = codeLines.slice(i, funcEnd + 1).join('\n');
      const awaitMatches = funcBody.match(/await\s+/g);

      if (awaitMatches) {
        operations.push({
          type: 'asyncAwait',
          lineStart: lineMap.get(lineNum) || lineNum,
          lineEnd: lineMap.get(funcEnd + 1) || funcEnd + 1,
          content: funcBody,
          depth: 0,
        });
      }
    }
  }

  return operations;
}

function findCallbackEnd(lines: string[], startIndex: number): number {
  let braceCount = 0;
  let hasStarted = false;

  for (let i = startIndex; i < lines.length; i++) {
    for (const char of lines[i]) {
      if (char === '{') {
        braceCount++;
        hasStarted = true;
      } else if (char === '}') {
        braceCount--;
        if (hasStarted && braceCount === 0) {
          return i + 1; // Return line number (1-indexed)
        }
      }
    }
  }
  return startIndex;
}

function findFunctionEnd(lines: string[], startIndex: number): number {
  let braceCount = 0;
  let hasStarted = false;

  for (let i = startIndex; i < lines.length; i++) {
    for (const char of lines[i]) {
      if (char === '{') {
        braceCount++;
        hasStarted = true;
      } else if (char === '}') {
        braceCount--;
        if (hasStarted && braceCount === 0) {
          return i; // Return index
        }
      }
    }
  }
  return startIndex;
}

function generateExecutionSteps(
  operations: Operation[],
  steps: ScenarioStep[],
  expectedOutput: string[],
  lineMap: Map<number, number>
): void {
  // Start with script phase
  steps.push({ type: 'execute', action: { type: 'setPhase', phase: 'script' } });
  steps.push({
    type: 'execute',
    action: {
      type: 'pushStack',
      frame: {
        label: 'main()',
        sourceLineStart: 1,
        sourceLineEnd: operations.length > 0 ? operations[operations.length - 1].lineEnd : 1,
        color: COLORS.sync,
      },
    },
  });

  const macrotaskQueue: Array<{ type: 'log' | 'error', content: string, lineStart: number, lineEnd: number, taskLabel: string }> = [];
  const microtaskQueue: Array<{ type: 'log' | 'error', content: string, lineStart: number, lineEnd: number, taskLabel: string }> = [];
  const asyncFunctions: Map<string, { name: string, logs: string[], awaitCount: number, lineStart: number, lineEnd: number }> = new Map();

  // First pass: collect async functions
  for (const op of operations) {
    if (op.type === 'asyncAwait') {
      const funcNameMatch = op.content.match(/async\s+function\s+(\w+)/);
      const funcName = funcNameMatch ? funcNameMatch[1] : 'anonymous';

      // Extract all console.log statements from the function
      const logMatches = op.content.matchAll(/console\.log\s*\(\s*['"`](.*?)['"`]\s*\)/g);
      const logs = Array.from(logMatches).map(m => m[1]);

      // Count await statements
      const awaitCount = (op.content.match(/await\s+/g) || []).length;

      asyncFunctions.set(funcName, {
        name: funcName,
        logs,
        awaitCount,
        lineStart: op.lineStart,
        lineEnd: op.lineEnd
      });
    }
  }

  // Process operations in order
  for (const op of operations) {
    switch (op.type) {
      case 'log':
        steps.push({
          type: 'execute',
          action: {
            type: 'pushStack',
            frame: {
              label: `console.log("${op.content}")`,
              sourceLineStart: op.lineStart,
              sourceLineEnd: op.lineEnd,
              color: COLORS.sync,
            },
          },
        });
        steps.push({ type: 'execute', action: { type: 'log', message: op.content } });
        expectedOutput.push(op.content);
        steps.push({ type: 'execute', action: { type: 'popStack' } });
        break;

      case 'asyncFunctionCall': {
        const funcInfo = asyncFunctions.get(op.content);
        if (funcInfo && funcInfo.logs.length > 0) {
          // Push async function call to stack
          steps.push({
            type: 'execute',
            action: {
              type: 'pushStack',
              frame: {
                label: `${funcInfo.name}()`,
                sourceLineStart: op.lineStart,
                sourceLineEnd: op.lineEnd,
                color: COLORS.sync,
              },
            },
          });

          // First log is synchronous (before any await)
          if (funcInfo.logs.length > 0) {
            steps.push({
              type: 'execute',
              action: {
                type: 'pushStack',
                frame: {
                  label: `console.log("${funcInfo.logs[0]}")`,
                  sourceLineStart: funcInfo.lineStart,
                  sourceLineEnd: funcInfo.lineStart,
                  color: COLORS.sync,
                },
              },
            });
            steps.push({ type: 'execute', action: { type: 'log', message: funcInfo.logs[0] } });
            expectedOutput.push(funcInfo.logs[0]);
            steps.push({ type: 'execute', action: { type: 'popStack' } });
          }

          // Each await creates a microtask
          for (let i = 0; i < funcInfo.awaitCount && i < funcInfo.logs.length; i++) {
            // Enqueue microtask for post-await logs
            const logIndex = i + 1;
            if (logIndex < funcInfo.logs.length) {
              steps.push({
                type: 'enqueue',
                action: {
                  type: 'enqueueMicrotask',
                  task: {
                    type: 'promise',
                    label: `${funcInfo.name}() resume (await ${i + 1})`,
                    sourceLineStart: funcInfo.lineStart,
                    sourceLineEnd: funcInfo.lineEnd,
                    color: COLORS.promise,
                  },
                },
              });

              microtaskQueue.push({
                type: 'log',
                content: funcInfo.logs[logIndex],
                lineStart: funcInfo.lineStart,
                lineEnd: funcInfo.lineEnd,
                taskLabel: `${funcInfo.name}() resume`
              });
            }
          }

          steps.push({ type: 'execute', action: { type: 'popStack' } });
        }
        break;
      }

      case 'setTimeout':
        steps.push({
          type: 'execute',
          action: {
            type: 'pushStack',
            frame: {
              label: `setTimeout(..., ${op.delay}ms)`,
              sourceLineStart: op.lineStart,
              sourceLineEnd: op.lineEnd,
              color: COLORS.setTimeout,
            },
          },
        });
        steps.push({
          type: 'enqueue',
          action: {
            type: 'startAsync',
            operation: {
              type: 'setTimeout',
              label: `Timer (${op.delay}ms)`,
              sourceLineStart: op.lineStart,
              sourceLineEnd: op.lineEnd,
              totalSteps: 1,
              remainingSteps: 1,
              callbackTask: {
                type: 'setTimeout',
                label: 'setTimeout callback',
                sourceLineStart: op.lineStart + 1,
                sourceLineEnd: op.lineEnd - 1,
                color: COLORS.setTimeout,
              },
              color: COLORS.setTimeout,
            },
          },
        });
        steps.push({ type: 'execute', action: { type: 'popStack' } });

        // Extract log from callback if present
        const timeoutLogMatch = op.content.match(/console\.log\s*\(\s*['"`](.*?)['"`]\s*\)/);
        if (timeoutLogMatch) {
          macrotaskQueue.push({
            type: 'log',
            lineStart: op.lineStart + 1,
            lineEnd: op.lineEnd - 1,
            content: timeoutLogMatch[1],
            taskLabel: 'setTimeout callback'
          });
        }
        break;

      case 'promise':
        // Extract all then callbacks
        const thenMatches = op.content.matchAll(/\.then\s*\(([^)]*)\)/g);
        let thenIndex = 0;

        for (const match of Array.from(thenMatches)) {
          const callback = match[1];
          const thenStart = op.lineStart + thenIndex;
          const thenEnd = op.lineEnd;

          steps.push({
            type: 'execute',
            action: {
              type: 'pushStack',
              frame: {
                label: 'Promise.resolve().then(...)',
                sourceLineStart: thenStart,
                sourceLineEnd: thenEnd,
                color: COLORS.promise,
              },
            },
          });
          steps.push({
            type: 'enqueue',
            action: {
              type: 'enqueueMicrotask',
              task: {
                type: 'promise',
                label: `Promise.then callback ${thenIndex + 1}`,
                sourceLineStart: thenStart,
                sourceLineEnd: thenEnd,
                color: COLORS.promise,
              },
            },
          });
          steps.push({ type: 'execute', action: { type: 'popStack' } });

          // Extract log from this then callback
          const thenLogMatch = op.content.match(new RegExp(`console\\.log\\s*\\(\\s*['"](.*?)['"]`));
          if (thenLogMatch) {
            microtaskQueue.push({
              type: 'log',
              lineStart: thenStart,
              lineEnd: thenEnd,
              content: thenLogMatch[1],
              taskLabel: `Promise.then ${thenIndex + 1}`
            });
          }

          thenIndex++;
        }
        break;

      case 'catch':
        steps.push({
          type: 'execute',
          action: {
            type: 'pushStack',
            frame: {
              label: '.catch(...)',
              sourceLineStart: op.lineStart,
              sourceLineEnd: op.lineEnd,
              color: COLORS.promise,
            },
          },
        });
        steps.push({
          type: 'enqueue',
          action: {
            type: 'enqueueMicrotask',
            task: {
              type: 'promise',
              label: '.catch callback',
              sourceLineStart: op.lineStart,
              sourceLineEnd: op.lineEnd,
              color: COLORS.promise,
            },
          },
        });
        steps.push({ type: 'execute', action: { type: 'popStack' } });

        // Extract error message from catch
        const catchLogMatch = op.content.match(/console\.log\s*\(\s*['"`](.*?)['"`]\s*\)/);
        if (catchLogMatch) {
          microtaskQueue.push({
            type: 'log',
            lineStart: op.lineStart,
            lineEnd: op.lineEnd,
            content: catchLogMatch[1],
            taskLabel: '.catch callback'
          });
        }
        break;

      case 'asyncAwait':
        // Already handled in asyncFunctionCall
        break;
    }
  }

  // Pop main
  steps.push({ type: 'execute', action: { type: 'popStack' } });

  // Process microtask queue first
  steps.push({ type: 'execute', action: { type: 'setPhase', phase: 'microtasks' } });
  for (const task of microtaskQueue) {
    steps.push({
      type: 'execute',
      action: {
        type: 'dequeueAndRun',
        queue: 'microtask',
      },
    });
    steps.push({
      type: 'execute',
      action: {
        type: 'pushStack',
        frame: {
          label: task.taskLabel,
          sourceLineStart: task.lineStart,
          sourceLineEnd: task.lineEnd,
          color: COLORS.promise,
        },
      },
    });
    steps.push({
      type: 'execute',
      action: {
        type: 'pushStack',
        frame: {
          label: `console.log("${task.content}")`,
          sourceLineStart: task.lineStart,
          sourceLineEnd: task.lineEnd,
          color: COLORS.promise,
        },
      },
    });
    steps.push({ type: 'execute', action: { type: 'log', message: task.content } });
    expectedOutput.push(task.content);
    steps.push({ type: 'execute', action: { type: 'popStack' } });
    steps.push({ type: 'execute', action: { type: 'popStack' } });
  }

  // Process macrotask queue
  steps.push({ type: 'execute', action: { type: 'setPhase', phase: 'task' } });
  for (const task of macrotaskQueue) {
    steps.push({
      type: 'execute',
      action: {
        type: 'dequeueAndRun',
        queue: 'macrotask',
      },
    });
    steps.push({
      type: 'execute',
      action: {
        type: 'pushStack',
        frame: {
          label: task.taskLabel,
          sourceLineStart: task.lineStart,
          sourceLineEnd: task.lineEnd,
          color: COLORS.setTimeout,
        },
      },
    });
    steps.push({
      type: 'execute',
      action: {
        type: 'pushStack',
        frame: {
          label: `console.log("${task.content}")`,
          sourceLineStart: task.lineStart,
          sourceLineEnd: task.lineEnd,
          color: COLORS.setTimeout,
        },
      },
    });
    steps.push({ type: 'execute', action: { type: 'log', message: task.content } });
    expectedOutput.push(task.content);
    steps.push({ type: 'execute', action: { type: 'popStack' } });
    steps.push({ type: 'execute', action: { type: 'popStack' } });
  }

  // Complete
  steps.push({ type: 'complete', action: { type: 'complete' } });
}

/**
 * Creates a custom scenario from user code
 */
export function createCustomScenario(code: string): Scenario {
  const parsed = parseUserCode(code);

  return {
    id: `custom-${Date.now()}`,
    title: 'Custom Code',
    description: 'Your custom JavaScript code',
    category: 'fundamentals',
    runtime: 'browser',
    code: parsed.code,
    expectedOutput: parsed.expectedOutput,
    steps: parsed.steps,
    explanation: 'Custom code scenario - observe the event loop behavior of your own code.',
  };
}
