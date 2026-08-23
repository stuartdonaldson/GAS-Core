'use strict';

/**
 * Pure string transform: replaces each placeholder token with its stamped value. Filesystem-free
 * so it is unit-testable independent of any real source file (all three pre-package copies did
 * this). Missing-placeholder = hard failure, always — a source edit that silently drops one must
 * not ship a page with a literal `null` baked into it.
 */
function stampSource_(src, placeholders, { label = 'source' } = {}) {
  let out = src;
  for (const [placeholder, value] of Object.entries(placeholders)) {
    if (!out.includes(placeholder)) {
      throw new Error(`${label}: expected placeholder not found: ${placeholder}`);
    }
    out = out.replace(placeholder, value);
  }
  return out;
}

module.exports = { stampSource_ };
