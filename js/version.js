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
export const VERSION = "1.0.3";

// A short git/commit identifier (optional). Keep in sync with version.json.
export const BUILD = "589c732";

// URL (relative to the site root) of the static version manifest.
export const VERSION_URL = "version.json";

// How often (ms) to re-check for a newer deployed version.
export const CHECK_INTERVAL = 60 * 1000;

/**
 * Cache-bust a static asset URL with the current version so browsers always
 * fetch the latest build after a release.
 * @param {string} url - e.g. "js/main.js"
 * @returns {string} e.g. "js/main.js?v=1.0.0"
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
 * @returns {Promise<{current:string, remote:string|null, update:boolean}>}
 */
export async function checkForUpdate(onUpdate, url = VERSION_URL) {
  const current = VERSION;
  try {
    const response = await fetch(url, { cache: "no-store", headers: { "Cache-Control": "no-cache" } });
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
 * @returns {Function} stop() - cancels the polling interval
 */
export function startUpdateChecker(onUpdate) {
  checkForUpdate(onUpdate);
  const interval = setInterval(() => checkForUpdate(onUpdate), CHECK_INTERVAL);
  return () => clearInterval(interval);
}

// Expose version info globally for easy debugging from the browser console.
try {
  window.RTS_VERSION = VERSION;
  window.RTS_BUILD = BUILD;
} catch (e) {
  // Non-browser environment (e.g. tests); ignore.
}
