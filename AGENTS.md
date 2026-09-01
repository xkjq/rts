# AGENTS.md

Guidance for AI agents and contributors working on the RTS codebase.

## Project overview

- RTS is a **static, no-build** web app (GitHub Pages / Jekyll). No bundler; ES
  modules loaded directly by the browser from `js/main.js`.
- All JS lives in `js/`, CSS in `css/`, vendored libraries in `lib/`, tests in `tests/`.
- `js/config.js` is **gitignored** (per-deployment config). The app expects it
  but it is not committed — do not assume it exists. `js/main.js` reads
  `config.base_url`, `config.allow_users`, `config.standalone`, etc.

## Versioning (important — keep in sync)

The version appears in **three** places and all must agree:

1. `js/version.js` — `export const VERSION` and `export const BUILD`
2. `version.json` — `version`, `build`, `released`
3. `index.html` — `?v=` cache-busting query strings on JS/CSS assets

**Always use the build script to bump the version**, never edit them by hand:

```bash
./scripts/release.sh <semver>   # e.g. ./scripts/release.sh 1.1.0
```

The script updates all three files and sets `BUILD` to the current git commit
hash. See [VERSIONING.md](VERSIONING.md) for the full release/debug workflow.

When changing version-related code, remember:

- `checkForUpdate()` in `js/version.js` fetches `version.json` with `no-store`
  so it never sees a cached manifest.
- The update prompt is de-duplicated via `localStorage["rts.dismissedVersion"]`.
- Sentry is initialized with `initSentry(VERSION)` so errors carry a release tag.

## Commands

```bash
npm install        # install dev deps (jest, eslint)
npm test           # run jest unit tests in tests/
npm run lint       # eslint --fix (Google style, double quotes, es6 modules)
```

Tests use `NODE_OPTIONS=--experimental-vm-modules jest` (set in package.json).
If `node_modules` is absent, tests/lint cannot run — `node --check <file>` can
be used as a fallback syntax check.

## Conventions & gotchas

- **CID type consistency:** candidate IDs must stay **strings** throughout.
  `js/main.js` `#btn-login` was previously `parseInt(...)`; do not re-introduce
  integer CIDs. Answers are keyed by `[aid+cid+eid+qid+qidn]` in IndexedDB and a
  number vs string CID breaks answer persistence across reloads.
- ES modules: use `import`/`export`, matching existing files (`js/main.js`,
  `js/sync.js`, `js/db.js`, `js/interact.js`, `js/version.js`, `js/sentry.js`).
- jQuery is available globally (`$`) in browser code, but test files mock it.
- `db.js` defines Dexie databases: `db` (answers) and `question_db` (questions).
- `sync.js` handles background answer submission and the `sync-status` UI.
- Keep the version badge (`#app-version`) and `window.RTS_VERSION` intact — they
  are the primary debugging aids for support.
- Do not commit secrets. The Sentry DSN in `js/sentry.js` is a client-side
  public DSN (safe by design).