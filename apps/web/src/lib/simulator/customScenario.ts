import type { Scenario, ScenarioStep } from './types';
import { COLORS } from './types';

type StatementType = 'log' | 'setTimeout' | 'promiseThen' | 'queueMicrotask';

interface Statement {
  type: StatementType;
  line: number;
  endLine: number;
  message?: string;
  body?: Statement[];
}

interface ScheduledTask {
  queue: 'microtask' | 'macrotask';
  label: string;
  line: number;
  endLine: number;
  color: string;
  body: Statement[];
  taskType: 'promise' | 'queueMicrotask' | 'setTimeout';
}

interface ParseResult {
  statements: Statement[];
  errors: string[];
}

function stripQuotes(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'")) ||
    (trimmed.startsWith('`') && trimmed.endsWith('`'))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function findBlockEnd(lines: string[], startIdx: number): number {
  let openBraces = 0;
  let seenOpeningBrace = false;

  for (let i = startIdx; i < lines.length; i += 1) {
    const line = lines[i];
    for (const char of line) {
      if (char === '{') {
        openBraces += 1;
        seenOpeningBrace = true;
      } else if (char === '}') {
        openBraces -= 1;
        if (seenOpeningBrace && openBraces === 0) {
          return i;
        }
      }
    }
  }

  return -1;
}

function parseStatements(lines: string[], start = 0, end = lines.length): ParseResult {
  const statements: Statement[] = [];
  const errors: string[] = [];

  let i = start;
  while (i < end) {
    const rawLine = lines[i] || '';
    const line = rawLine.trim();

    if (!line || line.startsWith('//')) {
      i += 1;
      continue;
    }

    if (line.startsWith('console.log(')) {
      const messageMatch = rawLine.match(/console\.log\((.+)\)\s*;?\s*$/);
      if (!messageMatch) {
        errors.push(`Line ${i + 1}: Unable to parse console.log.`);
      } else {
        statements.push({
          type: 'log',
          line: i + 1,
          endLine: i + 1,
          message: stripQuotes(messageMatch[1] || ''),
        });
      }
      i += 1;
      continue;
    }

    if (line.includes('setTimeout') && line.includes('=>')) {
      const blockEnd = findBlockEnd(lines, i);
      if (blockEnd < 0) {
        errors.push(`Line ${i + 1}: setTimeout callback block is not closed.`);
        i += 1;
        continue;
      }

      const body = parseStatements(lines, i + 1, blockEnd);
      errors.push(...body.errors);
      statements.push({
        type: 'setTimeout',
        line: i + 1,
        endLine: blockEnd + 1,
        body: body.statements,
      });
      i = blockEnd + 1;
      continue;
    }

    if ((line.includes('Promise.resolve') || line.startsWith('.then(') || line.includes('.then(')) && line.includes('=>')) {
      const blockEnd = findBlockEnd(lines, i);
      if (blockEnd < 0) {
        errors.push(`Line ${i + 1}: Promise.then callback block is not closed.`);
        i += 1;
        continue;
      }

      const body = parseStatements(lines, i + 1, blockEnd);
      errors.push(...body.errors);
      statements.push({
        type: 'promiseThen',
        line: i + 1,
        endLine: blockEnd + 1,
        body: body.statements,
      });
      i = blockEnd + 1;
      continue;
    }

    if (line.includes('queueMicrotask') && line.includes('=>')) {
      const blockEnd = findBlockEnd(lines, i);
      if (blockEnd < 0) {
        errors.push(`Line ${i + 1}: queueMicrotask callback block is not closed.`);
        i += 1;
        continue;
      }

      const body = parseStatements(lines, i + 1, blockEnd);
      errors.push(...body.errors);
      statements.push({
        type: 'queueMicrotask',
        line: i + 1,
        endLine: blockEnd + 1,
        body: body.statements,
      });
      i = blockEnd + 1;
      continue;
    }

    errors.push(`Line ${i + 1}: Unsupported statement \`${line}\`.`);
    i += 1;
  }

  return { statements, errors };
}

export function buildScenarioFromCode(code: string): { scenario: Scenario | null; errors: string[] } {
  const lines = code.split('\n');
  const parsed = parseStatements(lines);
  if (parsed.errors.length > 0) {
    return { scenario: null, errors: parsed.errors };
  }

  const steps: ScenarioStep[] = [];
  const expectedOutput: string[] = [];
  const microtasks: ScheduledTask[] = [];
  const macrotasks: ScheduledTask[] = [];

  const addLog = (message: string, line: number, color = COLORS.sync) => {
    steps.push({ type: 'execute', action: { type: 'pushStack', frame: { label: `console.log(${JSON.stringify(message)})`, sourceLineStart: line, sourceLineEnd: line, color } } });
    steps.push({ type: 'execute', action: { type: 'log', message } });
    steps.push({ type: 'execute', action: { type: 'popStack' } });
    expectedOutput.push(message);
  };

  const scheduleTask = (statement: Statement) => {
    if (!statement.body) return;

    if (statement.type === 'setTimeout') {
      steps.push({
        type: 'enqueue',
        action: {
          type: 'enqueueMacrotask',
          task: {
            type: 'setTimeout',
            label: 'setTimeout callback',
            sourceLineStart: statement.line,
            sourceLineEnd: statement.endLine,
            color: COLORS.setTimeout,
          },
        },
      });
      macrotasks.push({
        queue: 'macrotask',
        label: 'setTimeout callback',
        line: statement.line,
        endLine: statement.endLine,
        color: COLORS.setTimeout,
        body: statement.body,
        taskType: 'setTimeout',
      });
      return;
    }

    const taskType = statement.type === 'queueMicrotask' ? 'queueMicrotask' : 'promise';
    const label = statement.type === 'queueMicrotask' ? 'queueMicrotask callback' : 'Promise.then callback';
    steps.push({
      type: 'enqueue',
      action: {
        type: 'enqueueMicrotask',
        task: {
          type: taskType,
          label,
          sourceLineStart: statement.line,
          sourceLineEnd: statement.endLine,
          color: COLORS.promise,
        },
      },
    });
    microtasks.push({
      queue: 'microtask',
      label,
      line: statement.line,
      endLine: statement.endLine,
      color: COLORS.promise,
      body: statement.body,
      taskType,
    });
  };

  const runStatements = (statements: Statement[], contextColor = COLORS.sync) => {
    for (const statement of statements) {
      if (statement.type === 'log') {
        addLog(statement.message || '', statement.line, contextColor);
      } else {
        scheduleTask(statement);
      }
    }
  };

  const runTask = (task: ScheduledTask) => {
    steps.push({ type: 'execute', action: { type: 'dequeueAndRun', queue: task.queue } });
    runStatements(task.body, task.color);
    steps.push({ type: 'execute', action: { type: 'popStack' } });
  };

  steps.push({ type: 'execute', action: { type: 'setPhase', phase: 'script' } });
  steps.push({
    type: 'execute',
    action: {
      type: 'pushStack',
      frame: {
        label: 'main()',
        sourceLineStart: 1,
        sourceLineEnd: Math.max(1, lines.length),
        color: COLORS.sync,
      },
    },
  });

  runStatements(parsed.statements);

  steps.push({ type: 'execute', action: { type: 'popStack' } });

  while (microtasks.length > 0 || macrotasks.length > 0) {
    if (microtasks.length > 0) {
      steps.push({ type: 'execute', action: { type: 'setPhase', phase: 'microtasks' } });
      while (microtasks.length > 0) {
        const task = microtasks.shift();
        if (task) {
          runTask(task);
        }
      }
    }

    if (macrotasks.length > 0) {
      steps.push({ type: 'execute', action: { type: 'setPhase', phase: 'task' } });
      const task = macrotasks.shift();
      if (task) {
        runTask(task);
      }
    }
  }

  steps.push({ type: 'complete', action: { type: 'complete' } });

  const scenario: Scenario = {
    id: 'custom-editor',
    title: 'Custom Code',
    description: 'Code entered in the editor',
    category: 'fundamentals',
    runtime: 'browser',
    code,
    expectedOutput,
    steps,
    explanation:
      'Custom scenario generated from your code. Supported APIs: console.log, Promise.then, queueMicrotask, and setTimeout.',
  };

  return { scenario, errors: [] };
}
