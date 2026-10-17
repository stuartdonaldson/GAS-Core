'use strict';

const path = require('path');
const { matchesAny } = require('../glob.js');
const { toArray } = require('../util.js');

/**
 * The actual check, as a single custom ESLint rule rather than a stack of `no-restricted-globals`
 * config blocks.
 *
 * `no-restricted-globals` was the mechanism scoped for this bead, and was tried first: one flat
 * config block per governed identifier, each with its own `ignores` (the owner/exception file
 * globs) and a `rules: { 'no-restricted-globals': [...] }` entry. It does not work for more than
 * one governed identifier at a time — ESLint's flat-config cascade merges `rules` by key across
 * every block whose `files`/`ignores` match a given file, and the LAST matching block wins for
 * that key. With N identifier blocks all matching every JS file (differing only in `ignores`), only
 * the last-declared identifier's restriction ever actually applied to any given file — verified
 * directly against NDocs while doing AC5 (see README.md "Why a custom rule, not stacked
 * no-restricted-globals blocks"). A single rule that receives the whole ownership map as options
 * and does the per-identifier, per-file decision itself sidesteps that collision entirely, and is
 * the same underlying idea (restrict named globals) `no-restricted-globals` itself is built on:
 * find the global variable/reference in scope, report each usage.
 */
const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'DevStandard I13: platform-boundary identifiers may be named only in their declared owner(s).',
    },
    schema: [
      {
        type: 'object',
        properties: {
          ownership: { type: 'object' },
          exceptions: { type: 'array' },
          baseDir: { type: 'string' },
        },
        additionalProperties: false,
      },
    ],
  },
  create(context) {
    const options = context.options[0] || {};
    const ownership = options.ownership || {};
    const exceptions = options.exceptions || [];
    const baseDir = options.baseDir || (typeof context.cwd === 'string' ? context.cwd : process.cwd());
    const filename = typeof context.filename === 'string' ? context.filename : context.getFilename();
    const relPath = path.relative(baseDir, filename).replace(/\\/g, '/');

    const identifiers = Object.keys(ownership);
    if (identifiers.length === 0) return {};

    return {
      'Program:exit'() {
        const sourceCode = typeof context.sourceCode === 'object' ? context.sourceCode : context.getSourceCode();
        const globalScope = sourceCode.scopeManager.globalScope;

        for (const identifier of identifiers) {
          const owners = toArray(ownership[identifier]);
          const exceptionGlobs = exceptions
            .filter((e) => e.identifier === identifier)
            .map((e) => e.file);
          const allowed = [...owners, ...exceptionGlobs];

          // This file IS a declared owner or exception for this identifier — nothing to report.
          if (matchesAny(relPath, allowed)) continue;

          // Two paths to the identifier's references, because a consuming project's own
          // eslint.config.js may or may not declare every governed identifier in
          // languageOptions.globals: if it does, resolved references live on the Variable in
          // globalScope.set; if it doesn't, they show up as unresolved `through` references.
          // Checking both means this rule does not silently miss a boundary a project forgot to
          // add to its own globals list.
          const globalVar = globalScope.set.get(identifier);
          const references = globalVar
            ? globalVar.references
            : globalScope.through.filter((ref) => ref.identifier.name === identifier);

          for (const ref of references) {
            context.report({
              node: ref.identifier,
              message:
                `I13 (platform-boundary ownership): "${identifier}" is a governed platform ` +
                `boundary identifier. Its declared owner(s): ${owners.join(', ')}. Name it ` +
                `only there, or add a reasoned exception to this project's i13.config.js. ` +
                `See packages/i13-boundary-audit/README.md.`,
            });
          }
        }
      },
    };
  },
};

module.exports = rule;
