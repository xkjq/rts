# Versioning, Release & Debugging

RTS ships as a **static site** (GitHub Pages / Jekyll). There is no app server and
no bundler, so "always run the latest version" is handled with **cache-busting
URLs** plus a **client-side update check**.

This document explains how the version system works, how to cut a release, and
how to debug which version a user is running.

---

## How the version system works

The app version is tracked in **three places** that must always agree:

| File | Field | Purpose |
|------|-------|---------|
| `js/version.js` | `VERSION`, `BUILD` | Constants consumed by the app (UI badge, logs, update check). |
| `version.json` | `version`, `build`, `released` | Static manifest fetched (with `no-store`) to detect new deployments. |
| `index.html` | `?v=` query strings | Cache-busting on JS/CSS assets so browsers fetch the latest build. |

### Update flow (why users get the latest version)

1. `js/version.js` exposes `VERSION` and `BUILD` and polls `version.json` every
   60 seconds (`checkForUpdate` / `startUpdateChecker`).
2. When a **newer** `version.json` is deployed, the app prompts the user to
   reload. The prompt is shown once per version (remembered in
   `localStorage["rts.dismissedVersion"]`).
3. On reload the user gets the new `index.html`, whose `?v=` cache-busting query
   strings force the browser to download the new JS/CSS instead of stale cache.

### Debugging aids (built in)

| Where | What you see |
|-------|--------------|
| UI | `RTS v1.0.0` badge next to the app name in the nav bar. |
| Console | `RTS v1.0.0 (abc1234)` logged at startup; `window.RTS_VERSION` / `window.RTS_BUILD` available. |
| Sentry | Errors are tagged with the `release` (= version) so you can see which build a user ran. |
| Update log | `[Version] Update available: 1.0.0 -> 1.1.0` in the console. |

---

## Cutting a release

Use the build script — it keeps all three files in sync and sets `BUILD` to the
current git commit hash so you can always trace a build to its source commit.

```bash
./scripts/release.sh 1.1.0
```

What it does:

1. Validates the version is a valid semver (`1.1.0`, `1.1.0-beta` …).
2. Sets `VERSION` and `BUILD` in `js/version.js` (`BUILD` = short git hash, or
   `dev` outside a git repo).
3. Updates `version` / `build` / `released` in `version.json`.
4. Rewrites every `?v=` cache-busting query string in `index.html` to the new version.
5. Prints the changed files and the suggested commit/tag/push commands.

The script **only edits files** — it does not commit or push. Review `git diff`
first.

```bash
# Example full release
./scripts/release.sh 1.1.0
git diff                                  # sanity check
git add js/version.js version.json index.html
git commit -m "release: v1.1.0"
git tag v1.1.0
git push origin master --tags             # plus your deploy remote, if any
# deploy to GitHub Pages / static host
```

> **Note:** if you deploy from a branch (e.g. GitHub Pages builds from `master`),
> the `BUILD` hash recorded by `scripts/release.sh` is the hash **before** the
> release commit. That's fine — it still identifies the exact code that was
> built. If you want the hash to include the release commit itself, amend after
> committing (or bump `BUILD` manually).

---

## Manual version bump (if you can't run the script)

If you prefer not to use the script, update all three places by hand:

1. `js/version.js` → `export const VERSION = "x.y.z";`
2. `version.json` → `"version": "x.y.z"`
3. `index.html` → every `?v=…` becomes `?v=x.y.z`
   (currently on the CSS links and `js/main.js`)

Missing any of the three means the UI badge, the update check, or the
cache-busting will disagree with the others.

---

## Debugging a user-reported issue

1. Ask the user (or check Sentry) for the version — the UI badge or
   `window.RTS_VERSION` in the console.
2. The `BUILD` (git hash) tells you the exact commit they're running.
3. Check the console for:
   - `RTS vX.Y.Z (hash)` at startup → the running version.
   - `[Version] Update available: …` → they may be on an older build.
   - `[Sentry] Error monitoring initialized …` → Sentry release tagging.
4. If they are on an old build and a newer one is deployed, have them reload the
   page (or just wait for the update prompt).

---

## Testing

Run the unit tests before/after releases (if dependencies are installed):

```bash
npm install
npm test
npm run lint
```