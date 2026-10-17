'use strict';

/**
 * Minimal glob matcher for ownership/exception file globs (`*`, `**`, literal path segments).
 * Deliberately small and dependency-free — see README.md "Dependencies" for why this tool
 * avoids pulling in a glob library for what is a handful of straightforward patterns.
 */
function globToRegExp(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        re += '.*';
        i++;
        if (glob[i + 1] === '/') i++; // "**/foo" also matches "foo" (zero directories)
      } else {
        re += '[^/]*';
      }
    } else if ('.+^${}()|[]\\'.includes(c)) {
      re += '\\' + c;
    } else {
      re += c;
    }
  }
  return new RegExp('^' + re + '$');
}

function matchesGlob(relPath, glob) {
  return globToRegExp(glob).test(relPath.replace(/\\/g, '/'));
}

function matchesAny(relPath, globs) {
  return globs.some((g) => matchesGlob(relPath, g));
}

module.exports = { matchesGlob, matchesAny };
