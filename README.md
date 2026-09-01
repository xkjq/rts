# RTS

RTS is a quick and dirty clone of the RCR radiology test system that supports the
full set of RCR exam types (Anatomy / Rapid / Longs).

## Loading Packets

Packets can be loaded via ajax or though files as long as the are formatted correctly.

## Versioning & Updates

The app always tries to keep users on the latest version using cache-busting URLs
and a client-side update check. The version is shown in the nav bar (`RTS v1.0.0`)
and exposed as `window.RTS_VERSION` for easy debugging.

- **To cut a release:** `./scripts/release.sh 1.1.0` (see below)
- **Full docs:** [VERSIONING.md](VERSIONING.md)
- **For AI agents / contributors:** [AGENTS.md](AGENTS.md)

### Quick release

```bash
./scripts/release.sh 1.1.0   # bumps js/version.js, version.json and index.html ?v= URLs
git diff                     # review
git add js/version.js version.json index.html
git commit -m "release: v1.1.0"
git tag v1.1.0
git push origin master --tags
```

## Development

```bash
npm install
npm test        # unit tests (jest)
npm run lint    # eslint
```

## License
[GPL3](https://choosealicense.com/licenses/gpl-3.0/)