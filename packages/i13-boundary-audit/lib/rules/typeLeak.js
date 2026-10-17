'use strict';

const path = require('path');
const { matchesAny } = require('../glob.js');
const { toArray } = require('../util.js');
const { defaultHandleMethods } = require('../gasHandleMethods.js');

/**
 * I13 type-leak check (GAS-Core-0ws), two tiers in one rule. Both are gated on the project's
 * declared PUBLIC SURFACE (`publicSurface`: owner-file glob -> function-name glob(s)); a file with
 * no matching surface declaration is never examined. A missing declaration is a silent no-op.
 *
 * Tier A (JSDoc surface check): a surface function whose @returns / @param type names a declared
 *   platform TYPE (`platformTypes`) is a violation. Verifies a DECLARATION, not a value.
 * Tier B (intra-file return taint): a surface function returning a value that traces, through
 *   ESLint scope analysis within this file, to a governed global (`ownership` keys) is a violation.
 *   Only a return from a SURFACE function is checked, so a private helper handing a raw object to
 *   another function inside the owning file is never flagged.
 *
 * Soundness limits are documented in README.md; neither tier is sound.
 */

/** Reads a balanced `{...}` type expression starting at `text[start] === '{'`. */
function readBraced(text, start) {
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}') {
      depth--;
      if (depth === 0) return { body: text.slice(start + 1, i), end: i };
    }
  }
  return null;
}

/** Identifier-ish tokens of a JSDoc type expression, as last dotted segments. */
function typeTokens(typeExpr) {
  const cleaned = typeExpr
    .replace(/(['"]).*?\1/g, ' ') // string literal types
    .replace(/[A-Za-z_$][\w$]*\s*\??\s*:/g, ' '); // record keys: {sheet: Sheet} -> {  Sheet}
  const tokens = cleaned.match(/[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*/g) || [];
  return tokens.map((t) => t.split('.').pop());
}

/** [{ tag, typeExpr, line }] for every `@returns|@return|@param {T}` in a JSDoc block comment. */
function parseTags(comment) {
  const out = [];
  comment.value.split('\n').forEach((text, i) => {
    const m = /@(returns?|param|arg|argument)\b\s*/.exec(text);
    if (!m) return;
    const braceAt = m.index + m[0].length;
    const line = comment.loc.start.line + i;
    if (text[braceAt] !== '{') {
      out.push({ tag: m[1], typeExpr: null, line });
      return;
    }
    const braced = readBraced(text, braceAt);
    out.push({ tag: m[1], typeExpr: braced ? braced.body : null, line });
  });
  return out;
}

const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'DevStandard I13 type-leak amendment (draft): a declared public-surface function must not name or return a platform type.',
    },
    schema: [
      {
        type: 'object',
        properties: {
          ownership: { type: 'object' },
          platformTypes: { type: 'array' },
          publicSurface: { type: 'object' },
          handleMethods: { type: 'array' },
          requireReturns: { type: 'boolean' },
          baseDir: { type: 'string' },
        },
        additionalProperties: false,
      },
    ],
  },
  create(context) {
    const options = context.options[0] || {};
    const ownership = options.ownership || {};
    const platformTypes = new Set(options.platformTypes || []);
    const publicSurface = options.publicSurface || {};
    const handleMethods = new Set(options.handleMethods || defaultHandleMethods);
    const requireReturns = options.requireReturns === true;
    const baseDir = options.baseDir || (typeof context.cwd === 'string' ? context.cwd : process.cwd());
    const filename = typeof context.filename === 'string' ? context.filename : context.getFilename();
    const relPath = path.relative(baseDir, filename).replace(/\\/g, '/');

    // Gate: this file must match a declared surface owner, else nothing here applies.
    const namePatterns = [];
    for (const [fileGlob, patterns] of Object.entries(publicSurface)) {
      if (matchesAny(relPath, [fileGlob])) namePatterns.push(...toArray(patterns));
    }
    if (namePatterns.length === 0) return {};

    const sourceCode = typeof context.sourceCode === 'object' ? context.sourceCode : context.getSourceCode();
    const governed = new Set(Object.keys(ownership));
    const tierA = platformTypes.size > 0;
    const tierB = governed.size > 0;
    if (!tierA && !tierB && !requireReturns) return {};

    const fnStack = [];
    const returnsByFn = new Map(); // function node -> [returned expressions]
    const surfaceFns = []; // { fn, name, docTarget }

    function isSurfaceName(name) {
      return matchesAny(name, namePatterns);
    }

    function noteFunction(fn) {
      fnStack.push(fn);
      returnsByFn.set(fn, []);
      if (fn.type === 'ArrowFunctionExpression' && fn.body.type !== 'BlockStatement') {
        returnsByFn.get(fn).push(fn.body); // expression body is an implicit return
      }
    }

    // `var X_foo = function () {}` / `var X_foo = () => {}` at the top level.
    function registerAssigned(node) {
      const decl = node.parent;
      if (
        decl.type === 'VariableDeclarator' &&
        decl.id.type === 'Identifier' &&
        decl.init === node &&
        decl.parent.type === 'VariableDeclaration' &&
        decl.parent.parent.type === 'Program' &&
        isSurfaceName(decl.id.name)
      ) {
        surfaceFns.push({ fn: node, name: decl.id.name, docTarget: decl.parent });
      }
    }

    function findVariable(node) {
      let scope = sourceCode.getScope(node);
      while (scope) {
        const v = scope.set.get(node.name);
        if (v) return v;
        scope = scope.upper;
      }
      return null;
    }

    /**
     * Returns the governed global name a value derives from, or null. `seen` guards cycles.
     * Propagates through: the global itself, calls of handle-returning methods on a tainted
     * object, `a || b` / `a && b` / `a ? b : c` / `(a, b)` / await, local variable initialisers
     * and later assignments. Everything else (params, helper calls, properties, array/object
     * literals, destructuring) is untainted - see README "soundness limits".
     */
    function taintOf(expr, seen) {
      if (!expr) return null;
      switch (expr.type) {
        case 'Identifier': {
          const v = findVariable(expr);
          if (!v || v.defs.length === 0) return governed.has(expr.name) ? expr.name : null;
          if (seen.has(v)) return null;
          seen.add(v);
          for (const def of v.defs) {
            if (def.type === 'Variable' && def.node.id.type === 'Identifier' && def.node.init) {
              const t = taintOf(def.node.init, seen);
              if (t) return t;
            }
          }
          for (const ref of v.references) {
            if (ref.writeExpr && ref.isWrite() && !ref.init) {
              const t = taintOf(ref.writeExpr, seen);
              if (t) return t;
            }
          }
          return null;
        }
        case 'CallExpression': {
          const callee = expr.callee;
          if (
            callee.type === 'MemberExpression' &&
            !callee.computed &&
            handleMethods.has(callee.property.name)
          ) {
            return taintOf(callee.object, seen);
          }
          return null;
        }
        case 'ChainExpression':
          return taintOf(expr.expression, seen);
        case 'AwaitExpression':
          return taintOf(expr.argument, seen);
        case 'LogicalExpression':
          return taintOf(expr.left, seen) || taintOf(expr.right, seen);
        case 'ConditionalExpression':
          return taintOf(expr.consequent, seen) || taintOf(expr.alternate, seen);
        case 'SequenceExpression':
          return taintOf(expr.expressions[expr.expressions.length - 1], seen);
        case 'AssignmentExpression':
          return taintOf(expr.right, seen);
        default:
          return null;
      }
    }

    function describe(expr) {
      const text = sourceCode.getText(expr).replace(/\s+/g, ' ');
      return text.length > 60 ? text.slice(0, 57) + '...' : text;
    }

    function checkSurfaceFunction({ fn, name, docTarget }) {
      const returns = returnsByFn.get(fn) || [];

      const comments = sourceCode
        .getCommentsBefore(docTarget)
        .filter((c) => c.type === 'Block' && c.value.startsWith('*'));
      const doc = comments[comments.length - 1];
      const tags = doc ? parseTags(doc) : [];

      if (tierA) {
        for (const t of tags) {
          if (!t.typeExpr) continue;
          const hit = typeTokens(t.typeExpr).find((tok) => platformTypes.has(tok));
          if (hit) {
            context.report({
              loc: { line: t.line, column: 0 },
              message:
                `I13 type-leak (JSDoc): public-surface function "${name}" declares ` +
                `@${t.tag} {${t.typeExpr}}, naming platform type "${hit}". The owner's public ` +
                `surface must expose a type the owner defines, not the platform's. ` +
                `See packages/i13-boundary-audit/README.md.`,
            });
          }
        }
      }

      if (requireReturns && returns.length > 0) {
        const hasReturnsTag = tags.some((t) => t.tag === 'return' || t.tag === 'returns');
        if (!hasReturnsTag) {
          context.report({
            node: fn.id || docTarget,
            message:
              `I13 type-leak (JSDoc): public-surface function "${name}" returns a value but has ` +
              `no @returns annotation, so Tier A cannot check what it exposes.`,
          });
        }
      }

      if (tierB) {
        for (const arg of returns) {
          const source = taintOf(arg, new Set());
          if (source) {
            context.report({
              node: arg,
              message:
                `I13 type-leak (return): public-surface function "${name}" returns ` +
                `\`${describe(arg)}\`, a value derived from governed platform global ` +
                `"${source}". Wrap it in a type this module defines before it crosses the ` +
                `public surface. See packages/i13-boundary-audit/README.md.`,
            });
          }
        }
      }
    }

    return {
      FunctionDeclaration(node) {
        noteFunction(node);
        if (node.parent.type === 'Program' && node.id && isSurfaceName(node.id.name)) {
          surfaceFns.push({ fn: node, name: node.id.name, docTarget: node });
        }
      },
      FunctionExpression(node) {
        noteFunction(node);
        registerAssigned(node);
      },
      ArrowFunctionExpression(node) {
        noteFunction(node);
        registerAssigned(node);
      },
      ReturnStatement(node) {
        const fn = fnStack[fnStack.length - 1];
        if (fn && node.argument) returnsByFn.get(fn).push(node.argument);
      },
      'FunctionDeclaration:exit'() {
        fnStack.pop();
      },
      'FunctionExpression:exit'() {
        fnStack.pop();
      },
      'ArrowFunctionExpression:exit'() {
        fnStack.pop();
      },
      'Program:exit'() {
        for (const entry of surfaceFns) checkSurfaceFunction(entry);
      },
    };
  },
};

module.exports = rule;
