/**
 * Version & Update system for RTS.
 *
 * Single source of truth for the deployed app version. On a static host
 * (GitHub Pages / Jekyll) there is no app server, so we:
 *   - expose the version for UI + console + Sentry debugging, and
 *   - poll a static `version.json` to detect when a newer build is deployed,
 *     prompting the user to reload so they always run the latest code.
 *
 * Usage:
 *   import { VERSION, checkForUpdate } from "./version.js";
 */

// Bump this on every release. Must match the `version` field in version.json.
export const VERSION = "1.1.0";

// A short git/commit identifier (optional). Keep in sync with version.json.
export const BUILD = "3d3b13b";

// URL (relative to the site root) of the static version manifest.
export const VERSION_URL = "version.json";

// How often (ms) to re-check for a newer deployed version.
export const CHECK_INTERVAL = 60 * 1000;

/**
 * Cache-bust a static asset URL with the current version so browsers always
 * fetch the latest build after a release.
 * @param {string} url - e.g. "js/main.js"
 * @returns {string} e.g. "js/main.js?v=1.1.0"
 */
export function cacheBust(url) {
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}v=${encodeURIComponent(VERSION)}`;
}

/**
 * Fetch the deployed version manifest and compare it with the running VERSION.
 * If a newer version is live, call `onUpdate(newVersion)` so the caller can
 * prompt a reload. `cache:false` ensures we never get a stale manifest.
 * @param {Function} onUpdate - callback(newVersion)
 * @param {string} [url=VERSION_URL] - URL of the version manifest
 * @param {Function} [shouldCheck=null] - optional predicate; if false, skips check
 * @returns {Promise<{current:string, remote:string|null, update:boolean, skipped?:boolean}>}
 */
export async function checkForUpdate(onUpdate, url = VERSION_URL, shouldCheck = null) {
  if (typeof url === "function") {
    shouldCheck = url;
    url = VERSION_URL;
  }

  if (typeof shouldCheck === "function" && !shouldCheck()) {
    console.debug("[Version] Skipping update check: check condition returned false");
    return { current: VERSION, remote: null, update: false, skipped: true };
  }

  const current = VERSION;
  try {
    const sep = url.includes("?") ? "&" : "?";
    const cacheBustedUrl = `${url}${sep}_=${Date.now()}`;
    const response = await fetch(cacheBustedUrl, { cache: "no-store", headers: { "Cache-Control": "no-cache" } });
    if (!response.ok) {
      console.warn(`[Version] Unable to fetch ${url}: ${response.status}`);
      return { current, remote: null, update: false };
    }
    const manifest = await response.json();
    const remote = manifest && manifest.version ? String(manifest.version) : null;

    const update = !!remote && remote !== current;
    if (update) {
      console.info(`[Version] Update available: ${current} -> ${remote}`);
      if (typeof onUpdate === "function") {
        onUpdate(remote);
      }
    }
    return { current, remote, update };
  } catch (err) {
    console.warn("[Version] Update check failed:", err);
    return { current, remote: null, update: false };
  }
}

/**
 * Start polling for a newer version. Call once at startup.
 * @param {Function} onUpdate - callback(newVersion)
 * @param {Function} [shouldCheck=null] - optional predicate; if false, skips check
 * @returns {Function} stop() - cancels the polling interval
 */
export function startUpdateChecker(onUpdate, shouldCheck = null) {
  checkForUpdate(onUpdate, VERSION_URL, shouldCheck);
  const interval = setInterval(() => checkForUpdate(onUpdate, VERSION_URL, shouldCheck), CHECK_INTERVAL);
  return () => clearInterval(interval);
}

// Expose version info globally for easy debugging from the browser console.
try {
  window.RTS_VERSION = VERSION;
  window.RTS_BUILD = BUILD;
} catch (e) {
  // Non-browser environment (e.g. tests); ignore.
}
