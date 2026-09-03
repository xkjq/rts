#!/usr/bin/env bash
#
# RTS release build script.
#
# Keeps the version metadata in sync across the three places the app uses it,
# so users always fetch the latest code and it is easy to debug which build
# a user is running:
#
#   1. js/version.js   - VERSION (and BUILD) constants consumed by the app
#   2. version.json    - static manifest fetched by js/version.js to detect
#                        when a newer version has been deployed
#   3. index.html + js modules - `?v=` cache-busting query strings on JS/CSS
#      assets and ES module imports
#
# Usage:
#   ./scripts/release.sh <new-version>      # e.g. ./scripts/release.sh 1.1.0
#
# The version string should be a semver value such as "1.1.0" (no "v" prefix).
# The BUILD field is set to the current git commit hash (or "dev" if not in
# a git repo) so the exact commit a user is running is easy to identify.
#
# This script only edits files; it does NOT commit or push. Review the diff,
# then commit, tag and push yourself (see the summary printed at the end).
#
set -euo pipefail

cd "$(dirname "$0")/.."          # run from the repo root
ROOT="$(pwd)"

VERSION_FILE="$ROOT/js/version.js"
MANIFEST_FILE="$ROOT/version.json"
INDEX_FILE="$ROOT/index.html"

if [ $# -ne 1 ]; then
  echo "Usage: $0 <new-version>" >&2
  echo "  e.g. $0 1.1.0" >&2
  exit 1
fi

NEW_VERSION="$1"

# --- Validate the version string is a sane semver (e.g. 1.2.3 or 1.2.3-beta) ---
if ! printf '%s' "$NEW_VERSION" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+([.-][0-9A-Za-z.-]+)?$'; then
  echo "Error: version '$NEW_VERSION' does not look like a valid semver (e.g. 1.2.3)." >&2
  exit 1
fi

# --- Work out the BUILD identifier (git commit hash, or 'dev') ---
if git rev-parse --short HEAD >/dev/null 2>&1; then
  BUILD_ID="$(git rev-parse --short HEAD)"
else
  BUILD_ID="dev"
fi

echo "=== RTS release build ==="
echo "  New version : $NEW_VERSION"
echo "  Build id    : $BUILD_ID"
echo

# --- Sanity checks before mutating anything ---
for f in "$VERSION_FILE" "$MANIFEST_FILE" "$INDEX_FILE"; do
  if [ ! -f "$f" ]; then
    echo "Error: required file not found: $f" >&2
    exit 1
  fi
done

# --- 1. Update js/version.js (VERSION and BUILD) ---
if ! grep -q 'export const VERSION' "$VERSION_FILE"; then
  echo "Error: could not find 'export const VERSION' in $VERSION_FILE" >&2
  exit 1
fi
sed -i.bak \
  -e "s/^export const VERSION = .*/export const VERSION = \"$NEW_VERSION\";/" \
  -e "s/^export const BUILD = .*/export const BUILD = \"$BUILD_ID\";/" \
  "$VERSION_FILE"
rm -f "$VERSION_FILE.bak"

# --- 2. Update version.json (version + build) ---
python3 - "$MANIFEST_FILE" "$NEW_VERSION" "$BUILD_ID" <<'PY'
import json, sys, datetime
path, version, build = sys.argv[1], sys.argv[2], sys.argv[3]
with open(path) as f:
    data = json.load(f)
data["version"] = version
data["build"] = build
data["released"] = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
with open(path, "w") as f:
    json.dump(data, f, indent=2)
    f.write("\n")
PY

# --- 3. Update index.html and JS modules (?v= cache-busting query strings) ---
# Bump the version query string on every cache-busted asset / ES module import
# (index.html, js/main.js, js/interact.js, js/sync.js, ...) so a release
# refreshes the whole module graph. Files without `?v=` (e.g. the gitignored
# js/config.js) are intentionally left untouched.
if ! grep -q '?v=' "$INDEX_FILE"; then
  echo "Warning: no '?v=' cache-busting query strings found in $INDEX_FILE" >&2
fi
sed -i.bak -E "s/(\?v=)[0-9A-Za-z._-]+/\1${NEW_VERSION}/g" "$INDEX_FILE"
rm -f "$INDEX_FILE.bak"

for js_file in "$ROOT"/js/*.js; do
  if grep -q '?v=' "$js_file"; then
    sed -i.bak -E "s/(\?v=)[0-9A-Za-z._-]+/\1${NEW_VERSION}/g" "$js_file"
    rm -f "$js_file.bak"
  fi
done

echo "=== Done. Changed files: ==="
git status --short

echo
echo "Next steps:"
echo "  1. Review the diff:  git diff"
echo "  2. Commit:           git add js/version.js version.json index.html js/*.js && git commit -m \"release: v${NEW_VERSION}\""
echo "  3. Tag:              git tag \"v${NEW_VERSION}\""
echo "  4. Push:             git push origin master --tags   (and/or your deploy remote)"
echo "  5. Deploy the built files to your static host (GitHub Pages etc.)."
