#!/usr/bin/env bash
# scripts/push-demo.sh <demo> [--dry-run] [--open] [--deploy]
#
# Assembles and pushes one demo (docs/test-harness-design.md §4.0/§4.1,
# bd memory test-demo-harness-hybrid-model-2026-06-18):
#   1. Read examples/demos/<demo>/demo.config.json -> { host, uses[] }.
#   2. Assemble a temp build dir: shared wrapper (examples/demo-harness/*)
#      + each uses[] library's source (libs/<Name>/*.js, which includes its
#      co-located <name>Demo.js) + optional demo-specific Code.js glue.
#   3. Render a transient .clasp.json { scriptId: harness-hosts.json[host +
#      "ScriptId"], rootDir: <build dir> }.
#   4. clasp push (skipped under --dry-run). If harness-hosts.json[host + "Id"]
#      (the container id) is set, print a URL to the container so the user has
#      something to open the demo with, not just the script editor.
#
# Nothing committed can drift: the build dir and .clasp.json are generated
# fresh each run and discarded; the only persistent config is
# libs/harness-hosts.json (host container ids + scriptIds) and each demo's
# demo.config.json.
#
# One demo lives per host at a time -- pushing overwrites the host's prior
# content (by design; see docs/test-harness-design.md §4.1).
#
# Requires: jq, clasp (clasp only required when actually pushing).

set -euo pipefail

usage() {
  cat >&2 <<'EOF'
Usage: scripts/push-demo.sh <demo> [options]

  <demo>        Name of a directory under examples/demos/ containing a
                demo.config.json.

Options:
  --dry-run     Assemble the build dir and render .clasp.json, but do not
                run clasp push. Prints the assembled file list and the
                rendered .clasp.json so the assembly can be inspected/tested
                without a real host scriptId.
  --open        After a successful push, run `clasp open` (ignored with
                --dry-run).
  --deploy      After a successful push, run `clasp deploy` (ignored with
                --dry-run).
  --build-dir <dir>
                Use <dir> instead of a fresh mktemp dir (handy for
                inspecting output; not cleaned up automatically).
  -h, --help    Show this help.
EOF
}

DEMO_NAME=""
DRY_RUN=0
DO_OPEN=0
DO_DEPLOY=0
BUILD_DIR=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) DRY_RUN=1; shift ;;
    --open) DO_OPEN=1; shift ;;
    --deploy) DO_DEPLOY=1; shift ;;
    --build-dir) BUILD_DIR="${2:?--build-dir requires a path}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    -*) echo "Unknown option: $1" >&2; usage; exit 1 ;;
    *)
      if [[ -n "$DEMO_NAME" ]]; then
        echo "Unexpected extra argument: $1" >&2
        usage
        exit 1
      fi
      DEMO_NAME="$1"
      shift
      ;;
  esac
done

if [[ -z "$DEMO_NAME" ]]; then
  echo "Missing required <demo> argument." >&2
  usage
  exit 1
fi

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEMO_DIR="$REPO_ROOT/examples/demos/$DEMO_NAME"
CONFIG_FILE="$DEMO_DIR/demo.config.json"
WRAPPER_DIR="$REPO_ROOT/examples/demo-harness"
HOSTS_FILE="$REPO_ROOT/libs/harness-hosts.json"

if [[ ! -d "$DEMO_DIR" ]]; then
  echo "FAIL: demo directory not found: $DEMO_DIR" >&2
  exit 1
fi

if [[ ! -f "$CONFIG_FILE" ]]; then
  echo "FAIL: missing $CONFIG_FILE" >&2
  exit 1
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "FAIL: jq is required but not found on PATH." >&2
  exit 1
fi

HOST="$(jq -r '.host // empty' "$CONFIG_FILE")"
if [[ -z "$HOST" ]]; then
  echo "FAIL: $CONFIG_FILE has no .host field." >&2
  exit 1
fi

mapfile -t USES < <(jq -r '.uses[]? // empty' "$CONFIG_FILE")
if [[ "${#USES[@]}" -eq 0 ]]; then
  echo "FAIL: $CONFIG_FILE has no (or empty) .uses[] array." >&2
  exit 1
fi

if [[ -z "$BUILD_DIR" ]]; then
  BUILD_DIR="$(mktemp -d -t "push-demo-${DEMO_NAME}-XXXXXX")"
else
  mkdir -p "$BUILD_DIR"
fi

echo "Assembling demo '$DEMO_NAME' (host=$HOST, uses=${USES[*]}) into $BUILD_DIR"

# 1. Shared wrapper
if [[ ! -d "$WRAPPER_DIR" ]]; then
  echo "FAIL: shared wrapper directory not found: $WRAPPER_DIR" >&2
  exit 1
fi
cp -v "$WRAPPER_DIR"/*.js "$BUILD_DIR/" 2>/dev/null || {
  echo "FAIL: no .js files found in $WRAPPER_DIR" >&2
  exit 1
}

# 2. Each uses[] library's source (production + co-located <name>Demo.js),
#    plus any co-located .html assets (e.g. LibSidebar's NotificationSidebar.html,
#    served via HtmlService.createHtmlOutputFromFile()).
for LIB in "${USES[@]}"; do
  LIB_DIR="$REPO_ROOT/libs/$LIB"
  if [[ ! -d "$LIB_DIR" ]]; then
    echo "FAIL: library directory not found for '$LIB': $LIB_DIR" >&2
    exit 1
  fi
  shopt -s nullglob
  LIB_JS_FILES=("$LIB_DIR"/*.js)
  LIB_HTML_FILES=("$LIB_DIR"/*.html)
  shopt -u nullglob
  if [[ "${#LIB_JS_FILES[@]}" -eq 0 ]]; then
    echo "FAIL: no .js files found directly under $LIB_DIR for library '$LIB'." >&2
    exit 1
  fi
  for f in "${LIB_JS_FILES[@]}"; do
    cp -v "$f" "$BUILD_DIR/"
  done
  for f in "${LIB_HTML_FILES[@]}"; do
    cp -v "$f" "$BUILD_DIR/"
  done
done

# 3. Optional demo-specific glue (e.g. cross-library Code.js)
shopt -s nullglob
DEMO_JS_FILES=("$DEMO_DIR"/*.js)
shopt -u nullglob
for f in "${DEMO_JS_FILES[@]}"; do
  cp -v "$f" "$BUILD_DIR/"
done

# Optional appsscript.json: prefer the demo's own, fall back to the wrapper's.
if [[ -f "$DEMO_DIR/appsscript.json" ]]; then
  cp -v "$DEMO_DIR/appsscript.json" "$BUILD_DIR/"
elif [[ -f "$WRAPPER_DIR/appsscript.json" ]]; then
  cp -v "$WRAPPER_DIR/appsscript.json" "$BUILD_DIR/"
fi

# 4. Resolve host scriptId and render a transient .clasp.json
if [[ ! -f "$HOSTS_FILE" ]]; then
  echo "FAIL: $HOSTS_FILE not found." >&2
  exit 1
fi

SCRIPT_ID="$(jq -r --arg key "${HOST}ScriptId" '.[$key] // empty' "$HOSTS_FILE")"
CONTAINER_ID="$(jq -r --arg key "${HOST}Id" '.[$key] // empty' "$HOSTS_FILE")"
if [[ -z "$SCRIPT_ID" ]]; then
  echo "FAIL: no '${HOST}ScriptId' configured for host '$HOST' in $HOSTS_FILE." >&2
  echo "      (expected under DRY-RUN too, until the host is provisioned)" >&2
  if [[ "$DRY_RUN" -ne 1 ]]; then
    exit 1
  fi
  SCRIPT_ID="<unset: ${HOST}ScriptId>"
fi

CLASP_JSON="$BUILD_DIR/.clasp.json"
jq -n --arg scriptId "$SCRIPT_ID" --arg rootDir "$BUILD_DIR" \
  '{scriptId: $scriptId, rootDir: $rootDir}' > "$CLASP_JSON"

echo
echo "Assembled files:"
find "$BUILD_DIR" -maxdepth 1 -type f -printf '  %f\n' | sort

echo
echo "Rendered .clasp.json:"
cat "$CLASP_JSON"
echo

if [[ "$DRY_RUN" -eq 1 ]]; then
  echo "DRY RUN: skipping clasp push. Build dir left at: $BUILD_DIR"
  exit 0
fi

if [[ "$SCRIPT_ID" == "<unset: "* ]]; then
  echo "FAIL: cannot push -- host '$HOST' has no scriptId configured in $HOSTS_FILE." >&2
  exit 1
fi

if ! command -v clasp >/dev/null 2>&1; then
  echo "FAIL: clasp is required to push but not found on PATH." >&2
  exit 1
fi

echo "Pushing to host '$HOST' (scriptId: $SCRIPT_ID)..."
(cd "$BUILD_DIR" && clasp push)

if [[ -n "$CONTAINER_ID" ]]; then
  CONTAINER_URL=""
  case "$HOST" in
    sheet) CONTAINER_URL="https://docs.google.com/spreadsheets/d/$CONTAINER_ID/edit" ;;
    doc) CONTAINER_URL="https://docs.google.com/document/d/$CONTAINER_ID/edit" ;;
  esac
  if [[ -n "$CONTAINER_URL" ]]; then
    echo "Container URL: $CONTAINER_URL"
  fi
fi

if [[ "$DO_OPEN" -eq 1 ]]; then
  (cd "$BUILD_DIR" && clasp open)
fi

if [[ "$DO_DEPLOY" -eq 1 ]]; then
  (cd "$BUILD_DIR" && clasp deploy)
fi

echo "Done. Build dir: $BUILD_DIR"
