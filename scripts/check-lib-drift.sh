#!/usr/bin/env bash
# Run from the root of a consumer repo that vendors GAS-Core libs via a git
# submodule (e.g. at vendor/gas-core, pinned to a libs/<Lib>/<lib>-vN.N.N tag).
#
# GAS/clasp needs a flat copy of each lib file inside the script directory
# (clasp pushes files relative to rootDir; it doesn't resolve submodule
# paths), so each lib is vendored as: a copy living where clasp expects it,
# kept in sync with the submodule's pinned copy. This script fails if either
# goes out of sync, so drift is caught instead of silently forked.
#
# Usage: check-lib-drift.sh <submodule-path> <pairs-file>
#   pairs-file: one "submodule-relative-path  vendored-copy-path" pair per line
#
# Example pairs-file line:
#   libs/LibSheets/libSheets.js  script/libSheets.js

set -euo pipefail

SUBMODULE_PATH="${1:?usage: check-lib-drift.sh <submodule-path> <pairs-file>}"
PAIRS_FILE="${2:?usage: check-lib-drift.sh <submodule-path> <pairs-file>}"

fail=0

status_char=$(git submodule status -- "$SUBMODULE_PATH" | cut -c1)
if [[ "$status_char" != " " ]]; then
  echo "FAIL: $SUBMODULE_PATH is not cleanly pinned to its recorded commit (status '$status_char')." >&2
  echo "      Run 'git submodule update --init $SUBMODULE_PATH' or commit the intended pin." >&2
  fail=1
fi

if [[ -n "$(git status --porcelain -- "$SUBMODULE_PATH")" ]]; then
  echo "FAIL: $SUBMODULE_PATH has local modifications. Do not hand-edit vendored lib code —" >&2
  echo "      branch GAS-Core, fix it there, bump the tag, then re-pin here." >&2
  fail=1
fi

while IFS=$'\t ' read -r sub_rel vendored_rel; do
  [[ -z "${sub_rel:-}" ]] && continue
  sub_file="$SUBMODULE_PATH/$sub_rel"
  if [[ ! -f "$sub_file" ]]; then
    echo "FAIL: $sub_file not found in submodule." >&2
    fail=1
    continue
  fi
  if [[ ! -f "$vendored_rel" ]]; then
    echo "FAIL: $vendored_rel (vendored copy) not found." >&2
    fail=1
    continue
  fi
  if ! diff -q "$sub_file" "$vendored_rel" >/dev/null; then
    echo "FAIL: $vendored_rel has drifted from $sub_file." >&2
    echo "      Re-copy from the submodule, or if the vendored copy has an" >&2
    echo "      intentional improvement, branch GAS-Core and contribute it" >&2
    echo "      upstream instead of letting the fork stand." >&2
    fail=1
  fi
done < "$PAIRS_FILE"

if [[ "$fail" -eq 0 ]]; then
  echo "OK: $SUBMODULE_PATH clean and all vendored copies match."
fi
exit "$fail"
