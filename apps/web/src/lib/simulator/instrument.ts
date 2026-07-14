import { parse, type ParserPlugin } from "@babel/parser";
import traverse, { type NodePath } from "@babel/traverse";
import generate from "@babel/generator";
import * as t from "@babel/types";
import type { SourceLoc } from "./traceTypes";

let frameIdCounter = 0;
let functionFrames = new WeakMap<t.Function, { frameId: string; label: string }>();

function getFrameId(): string {
  return `frame-${++frameIdCounter}`;
}

function sourceLocFromNode(node: t.Node): SourceLoc {
  if (!node.loc) {
    return { lineStart: 1, lineEnd: 1, columnStart: 0, columnEnd: 0 };
  }

  return {
    lineStart: node.loc.start.line || 1,
    lineEnd: node.loc.end.line || 1,
    columnStart: node.loc.start.column || 0,
    columnEnd: node.loc.end.column || 0,
  };
}

function getFunctionLabel(node: t.Function): string {
  if ('id' in node && node.id && t.isIdentifier(node.id)) {
    return `${node.id.name}()`;
  }
  return "(anonymous)";
}

function createTickExpression(loc: SourceLoc): t.ExpressionStatement {
  const locObject = createLocObjectExpression(loc);
  return t.expressionStatement(
    t.callExpression(t.memberExpression(t.identifier("__sim"), t.identifier("tick")), [
      locObject,
    ])
  );
}

function isSimStatement(node: t.Statement): boolean {
  if (!t.isExpressionStatement(node)) return false;
  const expr = node.expression;
  if (!t.isCallExpression(expr)) return false;
  const callee = expr.callee;
  if (!t.isMemberExpression(callee)) return false;
  if (!t.isIdentifier(callee.object) || callee.object.name !== "__sim") return false;
  if (!t.isIdentifier(callee.property)) return false;
  return callee.property.name === "tick" || callee.property.name === "emit";
}

function createLocObjectExpression(loc: SourceLoc): t.ObjectExpression {
  return t.objectExpression([
    t.objectProperty(t.identifier("lineStart"), t.numericLiteral(loc.lineStart)),
    t.objectProperty(t.identifier("lineEnd"), t.numericLiteral(loc.lineEnd)),
    t.objectProperty(t.identifier("columnStart"), t.numericLiteral(loc.columnStart)),
    t.objectProperty(t.identifier("columnEnd"), t.numericLiteral(loc.columnEnd)),
  ]);
}

function createEmitExpression(kind: string, props: t.ObjectProperty[]): t.ExpressionStatement {
  return t.expressionStatement(
    t.callExpression(t.memberExpression(t.identifier("__sim"), t.identifier("emit")), [
      t.objectExpression([
        t.objectProperty(t.identifier("kind"), t.stringLiteral(kind)),
        ...props,
      ]),
    ])
  );
}

function emitPhase(phase: "script" | "task" | "microtasks"): t.ExpressionStatement {
  return createEmitExpression("phase", [
    t.objectProperty(t.identifier("phase"), t.stringLiteral(phase)),
  ]);
}

function emitCallEnter(frameId: string, label: string, loc: SourceLoc): t.ExpressionStatement {
  return createEmitExpression("call.enter", [
    t.objectProperty(t.identifier("frameId"), t.stringLiteral(frameId)),
    t.objectProperty(t.identifier("label"), t.stringLiteral(label)),
    t.objectProperty(t.identifier("loc"), createLocObjectExpression(loc)),
  ]);
}

function emitCallExit(frameId: string): t.ExpressionStatement {
  return createEmitExpression("call.exit", [
    t.objectProperty(t.identifier("frameId"), t.stringLiteral(frameId)),
  ]);
}

export function instrument(code: string): string {
  frameIdCounter = 0;
  functionFrames = new WeakMap();

  const plugins: ParserPlugin[] = [
    // Widely-used, browser-safe modern JS features
    "asyncGenerators",
    "bigInt",
    "classPrivateMethods",
    "classPrivateProperties",
    "classProperties",
    "dynamicImport",
    "exportDefaultFrom",
    "exportNamespaceFrom",
    "importMeta",
    "logicalAssignment",
    "nullishCoalescingOperator",
    "numericSeparator",
    "objectRestSpread",
    "optionalCatchBinding",
    "optionalChaining",
    "privateIn",
    "topLevelAwait",
  ];

  let ast: t.File;
  try {
    ast = parse(code, {
      sourceType: "unambiguous",
      plugins,
    });
  } catch (error) {
    throw new Error(`Parser error: ${error instanceof Error ? error.message : "Unknown parse error"}`);
  }

  const mainFrameId = getFrameId();
  const mainLoc = sourceLocFromNode(ast.program);

  const phaseScript = emitPhase("script");
  const callEnter = emitCallEnter(mainFrameId, "main()", mainLoc);
  const callExit = emitCallExit(mainFrameId);
  traverse(ast, {
    Function: {
      enter(path: NodePath<t.Function>) {
        const node = path.node;
        const body = node.body;
        const frameId = getFrameId();
        const label = getFunctionLabel(node);
        const fnLoc = sourceLocFromNode(node);
        functionFrames.set(node, { frameId, label });

        const enterCall = emitCallEnter(frameId, label, fnLoc);
        const exitCall = emitCallExit(frameId);

        if (t.isBlockStatement(body)) {
          const originalBody = body.body;
          body.body = [
            enterCall,
            t.tryStatement(
              t.blockStatement(originalBody),
              null,
              t.blockStatement([exitCall])
            ),
          ];
        } else {
          const newBody = t.blockStatement([
            enterCall,
            t.tryStatement(
              t.blockStatement([t.returnStatement(body)]),
              null,
              t.blockStatement([exitCall])
            ),
          ]);
          node.body = newBody;
        }
      },
    },

    AwaitExpression: {
      enter(path: NodePath<t.AwaitExpression>) {
        const functionParent = path.getFunctionParent();
        if (!functionParent || !t.isFunction(functionParent.node)) return;
        const frame = functionFrames.get(functionParent.node);
        if (!frame) return;

        const loc = sourceLocFromNode(path.node);
        path.node.argument = t.callExpression(
          t.memberExpression(t.identifier("__sim"), t.identifier("awaitValue")),
          [
            path.node.argument,
            t.stringLiteral(frame.frameId),
            t.stringLiteral(frame.label),
            createLocObjectExpression(loc),
          ]
        );
        path.skip();
      },
    },

    // Ensure tight-loop bodies also tick (prevents `while(true){}` from freezing).
    WhileStatement: {
      enter(path: NodePath<t.WhileStatement>) {
        const loc = sourceLocFromNode(path.node);
        const tick = createTickExpression(loc);
        const body = path.node.body;
        if (t.isBlockStatement(body)) {
          if (body.body[0] && isSimStatement(body.body[0])) return;
          body.body.unshift(tick);
        } else {
          path.node.body = t.blockStatement([tick, body]);
        }
      },
    },
    DoWhileStatement: {
      enter(path: NodePath<t.DoWhileStatement>) {
        const loc = sourceLocFromNode(path.node);
        const tick = createTickExpression(loc);
        const body = path.node.body;
        if (t.isBlockStatement(body)) {
          if (body.body[0] && isSimStatement(body.body[0])) return;
          body.body.unshift(tick);
        } else {
          path.node.body = t.blockStatement([tick, body]);
        }
      },
    },
    ForStatement: {
      enter(path: NodePath<t.ForStatement>) {
        const loc = sourceLocFromNode(path.node);
        const tick = createTickExpression(loc);
        const body = path.node.body;
        if (t.isBlockStatement(body)) {
          if (body.body[0] && isSimStatement(body.body[0])) return;
          body.body.unshift(tick);
        } else {
          path.node.body = t.blockStatement([tick, body]);
        }
      },
    },
    ForInStatement: {
      enter(path: NodePath<t.ForInStatement>) {
        const loc = sourceLocFromNode(path.node);
        const tick = createTickExpression(loc);
        const body = path.node.body;
        if (t.isBlockStatement(body)) {
          if (body.body[0] && isSimStatement(body.body[0])) return;
          body.body.unshift(tick);
        } else {
          path.node.body = t.blockStatement([tick, body]);
        }
      },
    },
    ForOfStatement: {
      enter(path: NodePath<t.ForOfStatement>) {
        const loc = sourceLocFromNode(path.node);
        const tick = createTickExpression(loc);
        const body = path.node.body;
        if (t.isBlockStatement(body)) {
          if (body.body[0] && isSimStatement(body.body[0])) return;
          body.body.unshift(tick);
        } else {
          path.node.body = t.blockStatement([tick, body]);
        }
      },
    },

    Statement: {
      enter(path: NodePath<t.Statement>) {
        const node: t.Statement = path.node;
        // Synthetic statements inserted by this transform have no source
        // location and must not produce user-visible ticks.
        if (!node.loc) return;
        if (isSimStatement(node)) return;
        if (
          t.isBlockStatement(node) ||
          t.isFunctionDeclaration(node) ||
          t.isFunctionExpression(node) ||
          t.isArrowFunctionExpression(node)
        ) {
          return;
        }

        const loc = sourceLocFromNode(node);
        const tick = createTickExpression(loc);
        path.insertBefore(tick);
      },
    },
  });

  ast.program.body.unshift(phaseScript, callEnter);
  // `done` is emitted by the sandbox only after all queued work settles.
  // Emitting it here would incorrectly complete before timers/microtasks run.
  ast.program.body.push(callExit);

  const generated = generate(ast, {
    retainLines: false,
    compact: false,
  });

  return generated.code;
}
