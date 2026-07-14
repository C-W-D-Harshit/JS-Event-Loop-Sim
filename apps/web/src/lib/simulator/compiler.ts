import type { ScenarioStep, ScenarioAction, Scenario } from './types';
import { COLORS } from './types';
import * as acorn from 'acorn';
import * as walk from 'acorn-walk';

interface Diagnostic {
  message: string;
  line?: number;
  column?: number;
}

interface CompileResult {
  compiled: { code: string; steps: ScenarioStep[]; expectedOutput: string[] };
  diagnostics: Diagnostic[];
}

interface CompileError {
  message: string;
  line?: number;
  column?: number;
}

class CompilerError extends Error {
  line?: number;
  column?: number;

  constructor(message: string, line?: number, column?: number) {
    super(message);
    this.name = 'CompilerError';
    this.line = line;
    this.column = column;
  }
}

function getLineAndColumn(node: acorn.Node): { line: number; column: number } {
  const loc = node.loc;
  if (!loc) throw new CompilerError('Missing source location information');
  return { line: loc.start.line, column: loc.start.column };
}

let stepCounter = 0;
let taskIdCounter = 0;

function generateStep(type: ScenarioStep['type'], action: ScenarioAction): ScenarioStep {
  return { type, action };
}

function generateTaskId(): string {
  return `task-${++taskIdCounter}`;
}

function resetCounters() {
  stepCounter = 0;
  taskIdCounter = 0;
}

export function compileConsoleLog(node: acorn.CallExpression): ScenarioStep[] {
  const { line, column } = getLineAndColumn(node);
  const arg = node.arguments[0];

  let message = '';
  if (!arg) {
    throw new CompilerError('console.log requires at least one argument', line, column);
  }

  if (arg.type === 'Literal') {
    message = String(arg.value);
  } else if (arg.type === 'Identifier') {
    message = arg.name;
  } else if (arg.type === 'BinaryExpression') {
    message = `[expression at line ${line}]`;
  } else if (arg.type === 'MemberExpression') {
    message = `[object at line ${line}]`;
  } else {
    message = `[${arg.type} at line ${line}]`;
  }

  return [
    generateStep('execute', { type: 'pushStack', frame: { label: `console.log("${message}")`, sourceLineStart: line, sourceLineEnd: line, color: COLORS.sync } }),
    generateStep('execute', { type: 'log', message }),
    generateStep('execute', { type: 'popStack' }),
  ];
}

export function compileSetTimeout(node: acorn.CallExpression): ScenarioStep[] {
  const { line } = getLineAndColumn(node);

  if (node.arguments.length < 2) {
    throw new CompilerError('setTimeout requires 2 arguments: callback and delay', line);
  }

  const callback = node.arguments[0];
  const delayArg = node.arguments[1];

  if (callback.type !== 'ArrowFunctionExpression' && callback.type !== 'FunctionExpression') {
    throw new CompilerError('setTimeout callback must be a function', line);
  }

  let delay = '0';
  if (delayArg.type === 'Literal') {
    delay = String(delayArg.value);
  }

  const callbackSteps = compileFunctionBody(callback.body as any, line);
  const callbackLabel = `setTimeout callback (line ${line})`;

  const steps: ScenarioStep[] = [
    generateStep('execute', { type: 'pushStack', frame: { label: `setTimeout(..., ${delay})`, sourceLineStart: line, sourceLineEnd: line, color: COLORS.setTimeout } }),
    generateStep('execute', {
      type: 'startAsync',
      operation: {
        type: 'setTimeout',
        label: `Timer (${delay}ms)`,
        sourceLineStart: line,
        sourceLineEnd: line,
        totalSteps: 1,
        remainingSteps: 1,
        callbackTask: {
          id: generateTaskId(),
          type: 'setTimeout',
          label: callbackLabel,
          sourceLineStart: line,
          sourceLineEnd: line,
          color: COLORS.setTimeout,
        },
        color: COLORS.setTimeout,
      },
    }),
    generateStep('execute', { type: 'popStack' }),
  ];

  return steps;
}

export function compilePromiseResolveThen(node: acorn.CallExpression): ScenarioStep[] {
  const { line } = getLineAndColumn(node);

  if (node.callee.type !== 'MemberExpression') {
    throw new CompilerError('Expected Promise.resolve().then()', line);
  }

  const thenCall = node.callee;
  const thenCallback = node.arguments[0];

  if (thenCall.property.type !== 'Identifier' || thenCall.property.name !== 'then') {
    throw new CompilerError('Expected Promise.resolve().then()', line);
  }

  if (!thenCallback || (thenCallback.type !== 'ArrowFunctionExpression' && thenCallback.type !== 'FunctionExpression')) {
    throw new CompilerError('then() requires a callback function', line);
  }

  const callbackSteps = compileFunctionBody(thenCallback.body as any, line);
  const callbackLabel = 'Promise.then callback';

  const steps: ScenarioStep[] = [
    generateStep('execute', { type: 'pushStack', frame: { label: 'Promise.resolve().then(...)', sourceLineStart: line, sourceLineEnd: line, color: COLORS.promise } }),
    generateStep('enqueue', { type: 'enqueueMicrotask', task: { type: 'promise', label: callbackLabel, sourceLineStart: line, sourceLineEnd: line, color: COLORS.promise } }),
    generateStep('execute', { type: 'popStack' }),
  ];

  return steps;
}

export function compileQueueMicrotask(node: acorn.CallExpression): ScenarioStep[] {
  const { line } = getLineAndColumn(node);

  if (node.arguments.length < 1) {
    throw new CompilerError('queueMicrotask requires a callback function', line);
  }

  const callback = node.arguments[0];
  if (callback.type !== 'ArrowFunctionExpression' && callback.type !== 'FunctionExpression') {
    throw new CompilerError('queueMicrotask callback must be a function', line);
  }

  const callbackSteps = compileFunctionBody(callback.body as any, line);
  const callbackLabel = 'queueMicrotask callback';

  const steps: ScenarioStep[] = [
    generateStep('execute', { type: 'pushStack', frame: { label: 'queueMicrotask(...)', sourceLineStart: line, sourceLineEnd: line, color: COLORS.promise } }),
    generateStep('enqueue', { type: 'enqueueMicrotask', task: { type: 'queueMicrotask', label: callbackLabel, sourceLineStart: line, sourceLineEnd: line, color: COLORS.promise } }),
    generateStep('execute', { type: 'popStack' }),
  ];

  return steps;
}

export function compileProcessNextTick(node: acorn.CallExpression): ScenarioStep[] {
  const { line } = getLineAndColumn(node);

  if (node.arguments.length < 1) {
    throw new CompilerError('process.nextTick requires a callback function', line);
  }

  const callback = node.arguments[0];
  if (callback.type !== 'ArrowFunctionExpression' && callback.type !== 'FunctionExpression') {
    throw new CompilerError('process.nextTick callback must be a function', line);
  }

  const callbackSteps = compileFunctionBody(callback.body as any, line);
  const callbackLabel = 'nextTick callback';

  const steps: ScenarioStep[] = [
    generateStep('execute', { type: 'pushStack', frame: { label: 'process.nextTick(...)', sourceLineStart: line, sourceLineEnd: line, color: COLORS.nextTick } }),
    generateStep('enqueue', { type: 'enqueueNextTick', task: { type: 'nextTick', label: callbackLabel, sourceLineStart: line, sourceLineEnd: line, color: COLORS.nextTick } }),
    generateStep('execute', { type: 'popStack' }),
  ];

  return steps;
}

export function compileSetImmediate(node: acorn.CallExpression): ScenarioStep[] {
  const { line } = getLineAndColumn(node);

  if (node.arguments.length < 1) {
    throw new CompilerError('setImmediate requires a callback function', line);
  }

  const callback = node.arguments[0];
  if (callback.type !== 'ArrowFunctionExpression' && callback.type !== 'FunctionExpression') {
    throw new CompilerError('setImmediate callback must be a function', line);
  }

  const callbackSteps = compileFunctionBody(callback.body as any, line);
  const callbackLabel = 'setImmediate callback';

  const steps: ScenarioStep[] = [
    generateStep('execute', { type: 'pushStack', frame: { label: 'setImmediate(...)', sourceLineStart: line, sourceLineEnd: line, color: COLORS.setImmediate } }),
    generateStep('enqueue', { type: 'enqueueMacrotask', task: { type: 'setImmediate', label: callbackLabel, sourceLineStart: line, sourceLineEnd: line, color: COLORS.setImmediate } }),
    generateStep('execute', { type: 'popStack' }),
  ];

  return steps;
}

function compileFunctionBody(body: acorn.BlockStatement | acorn.ExpressionStatement | acorn.Expression, parentLine: number): ScenarioStep[] {
  const steps: ScenarioStep[] = [];

  if (body.type === 'BlockStatement') {
    for (const stmt of body.body) {
      const stmtSteps = compileStatement(stmt);
      steps.push(...stmtSteps);
    }
  } else if (body.type === 'ExpressionStatement') {
    const stmtSteps = compileStatement(body);
    steps.push(...stmtSteps);
  } else {
    const stmtSteps = compileExpression(body);
    steps.push(...stmtSteps);
  }

  return steps;
}

function compileStatement(node: acorn.Statement | acorn.ModuleDeclaration): ScenarioStep[] {
  switch (node.type) {
    case 'ExpressionStatement':
      return compileExpression(node.expression);

    case 'VariableDeclaration':
      const varSteps: ScenarioStep[] = [];
      for (const declarator of node.declarations) {
        if (declarator.init) {
          const initSteps = compileExpression(declarator.init);
          varSteps.push(...initSteps);
        }
      }
      return varSteps;

    default:
      return [];
  }
}

function compileExpression(node: acorn.Expression): ScenarioStep[] {
  if (!node.loc) return [];

  switch (node.type) {
    case 'CallExpression': {
      const callee = node.callee;

      if (callee.type === 'MemberExpression') {
        const obj = callee.object;
        const prop = callee.property;

        if (obj.type === 'Identifier' && obj.name === 'process' && prop.type === 'Identifier' && prop.name === 'nextTick') {
          return compileProcessNextTick(node as any);
        }

        if (obj.type === 'Identifier' && obj.name === 'console' && prop.type === 'Identifier' && prop.name === 'log') {
          return compileConsoleLog(node as any);
        }

        if (obj.type === 'CallExpression') {
          const innerCallee = obj.callee;

          if (innerCallee.type === 'MemberExpression') {
            const innerObj = innerCallee.object;
            const innerProp = innerCallee.property;

            if (innerProp.type === 'Identifier' && innerProp.name === 'resolve' && innerObj.type === 'Identifier' && innerObj.name === 'Promise') {
              return compilePromiseResolveThen(obj as any);
            }
          }
        }

        if (obj.type === 'Identifier' && obj.name === 'Promise' && prop.type === 'Identifier' && prop.name === 'resolve') {
          return compilePromiseResolveThen(node as any);
        }
      }

      if (callee.type === 'Identifier') {
        if (callee.name === 'setTimeout') {
          return compileSetTimeout(node as any);
        }
        if (callee.name === 'queueMicrotask') {
          return compileQueueMicrotask(node as any);
        }
        if (callee.name === 'setImmediate') {
          return compileSetImmediate(node as any);
        }
      }

      if (callee.type === 'CallExpression') {
        return compileExpression(callee);
      }

      const { line } = getLineAndColumn(node);
      throw new CompilerError(`Unsupported function call: ${callee.type}`, line);
    }

    default:
      return [];
  }
}

function compileAsyncFunction(node: acorn.FunctionDeclaration | acorn.FunctionExpression): ScenarioStep[] {
  const { line } = getLineAndColumn(node);
  const name = node.type === 'FunctionDeclaration' && node.id ? node.id.name : 'anonymous';

  const steps: ScenarioStep[] = [];

  if (node.body.type === 'BlockStatement') {
    for (const stmt of node.body.body) {
      const stmtSteps = compileStatement(stmt);
      steps.push(...stmtSteps);

      if (stmt.type === 'ExpressionStatement' && stmt.expression.type === 'AwaitExpression') {
        const awaitLine = stmt.expression.loc?.start.line || line;
        const callbackSteps = [];
        for (let i = node.body.body.indexOf(stmt) + 1; i < node.body.body.length; i++) {
          callbackSteps.push(...compileStatement(node.body.body[i]));
        }

        if (callbackSteps.length > 0) {
          steps.push(generateStep('execute', { type: 'pushStack', frame: { label: `await Promise.resolve()`, sourceLineStart: awaitLine, sourceLineEnd: awaitLine, color: COLORS.promise } }));
          steps.push(generateStep('enqueue', { type: 'enqueueMicrotask', task: { type: 'promise', label: `${name}() continuation`, sourceLineStart: awaitLine, sourceLineEnd: awaitLine, color: COLORS.promise } }));
          steps.push(generateStep('execute', { type: 'popStack' }));
        }
      }
    }
  }

  return steps;
}

function detectRuntime(code: string): 'browser' | 'node' {
  if (code.includes('process.nextTick') || code.includes('setImmediate')) {
    return 'node';
  }
  return 'browser';
}

function extractExpectedOutput(steps: ScenarioStep[]): string[] {
  const output: string[] = [];
  for (const step of steps) {
    if (step.action.type === 'log') {
      output.push(step.action.message);
    }
  }
  return output;
}

export function compileScenarioFromCode(code: string): CompileResult {
  resetCounters();

  try {
    const ast = acorn.parse(code, {
      ecmaVersion: 2022,
      sourceType: 'script',
      locations: true,
    });

    const runtime = detectRuntime(code);
    const steps: ScenarioStep[] = [];

    steps.push(generateStep('execute', { type: 'setPhase', phase: 'script' }));
    steps.push(generateStep('execute', { type: 'pushStack', frame: { label: 'main()', sourceLineStart: 1, sourceLineEnd: ast.loc!.end.line, color: COLORS.sync } }));

    if (ast.type === 'Program') {
      for (const node of ast.body) {
        if (node.type === 'FunctionDeclaration' && node.async) {
          continue;
        }
        const nodeSteps = compileStatement(node);
        steps.push(...nodeSteps);
      }

      for (const node of ast.body) {
        if (node.type === 'FunctionDeclaration' && node.async) {
          const funcName = node.id?.name || 'anonymous';
          steps.push(generateStep('execute', { type: 'pushStack', frame: { label: `${funcName}()`, sourceLineStart: node.loc!.start.line, sourceLineEnd: node.loc!.end.line, color: COLORS.sync } }));
          const funcSteps = compileAsyncFunction(node);
          steps.push(...funcSteps);
          steps.push(generateStep('execute', { type: 'popStack' }));
        }
      }
    }

    const functionCalls: { line: number; label: string }[] = [];

    walk.simple(ast, {
      CallExpression(node) {
        if (node.callee.type === 'Identifier' && node.callee.loc) {
          const name = node.callee.name;
          const line = node.callee.loc.start.line;
          functionCalls.push({ line, label: `${name}()` });
        }
      },
    });

    for (const call of functionCalls) {
      if (!steps.some(s => s.action.type === 'pushStack' && 'label' in s.action.frame && s.action.frame.label.includes(call.label))) {
        steps.push(generateStep('execute', { type: 'pushStack', frame: { label: call.label, sourceLineStart: call.line, sourceLineEnd: call.line, color: COLORS.sync } }));
        steps.push(generateStep('execute', { type: 'popStack' }));
      }
    }

    steps.push(generateStep('execute', { type: 'popStack' }));

    const microtaskCount = steps.filter(s => s.action.type === 'enqueueMicrotask').length;
    const macrotaskCount = steps.filter(s => s.action.type === 'enqueueMacrotask').length;
    const nextTickCount = steps.filter(s => s.action.type === 'enqueueNextTick').length;

    if (runtime === 'browser') {
      if (microtaskCount > 0) {
        steps.push(generateStep('execute', { type: 'setPhase', phase: 'microtasks' }));
        for (let i = 0; i < microtaskCount; i++) {
          steps.push(generateStep('execute', { type: 'dequeueAndRun', queue: 'microtask' }));
        }
      }
      if (macrotaskCount > 0) {
        steps.push(generateStep('execute', { type: 'setPhase', phase: 'task' }));
        for (let i = 0; i < macrotaskCount; i++) {
          steps.push(generateStep('execute', { type: 'dequeueAndRun', queue: 'macrotask' }));
        }
      }
    } else {
      if (nextTickCount > 0) {
        steps.push(generateStep('execute', { type: 'setPhase', phase: 'microtasks' }));
        for (let i = 0; i < nextTickCount; i++) {
          steps.push(generateStep('execute', { type: 'dequeueAndRun', queue: 'nextTick' }));
        }
      }
      if (microtaskCount > 0) {
        steps.push(generateStep('execute', { type: 'setPhase', phase: 'microtasks' }));
        for (let i = 0; i < microtaskCount; i++) {
          steps.push(generateStep('execute', { type: 'dequeueAndRun', queue: 'microtask' }));
        }
      }
      if (macrotaskCount > 0) {
        steps.push(generateStep('execute', { type: 'setPhase', phase: 'task' }));
        for (let i = 0; i < macrotaskCount; i++) {
          steps.push(generateStep('execute', { type: 'dequeueAndRun', queue: 'macrotask' }));
        }
      }
    }

    steps.push(generateStep('complete', { type: 'complete' }));

    const expectedOutput = extractExpectedOutput(steps);

    return {
      compiled: {
        code,
        steps,
        expectedOutput,
      },
      diagnostics: [],
    };
} catch (error) {
      const knownError = error as Error & { loc?: { line: number; column: number } };
      if ('loc' in knownError && knownError.loc) {
        return {
          compiled: { code, steps: [], expectedOutput: [] },
          diagnostics: [
            {
              message: knownError.message,
              line: knownError.loc.line,
              column: knownError.loc.column,
            },
          ],
        };
      }

      if (error instanceof CompilerError) {
        return {
          compiled: { code, steps: [], expectedOutput: [] },
          diagnostics: [
            {
              message: error.message,
              line: error.line,
              column: error.column,
            },
          ],
        };
      }

      return {
        compiled: { code, steps: [], expectedOutput: [] },
        diagnostics: [
          {
            message: error instanceof Error ? error.message : 'Unknown compilation error',
          },
        ],
      };
    }
}