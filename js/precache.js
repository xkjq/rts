/**
 * Exam pre-caching.
 *
 * Before an exam starts, RTS downloads every image it will need and stores the
 * raw bytes in the Cache Storage API, keyed by the image URL. The viewer serves
 * images from that local cache, so no network access is required once the exam
 * has begun.
 *
 * Media URLs are content-versioned by the server (`?v=<hash>`), so a cached URL
 * is reused only while the underlying image is unchanged. Re-caching after a
 * server edit therefore downloads only the images that actually changed.
 *
 * This module is deliberately free of DOM/jQuery dependencies so the pure parts
 * can be unit tested; the browser-only globals (`caches`, `fetch`,
 * `navigator.storage`) are injectable for tests and degrade gracefully when
 * unavailable.
 */

export const IMAGE_CACHE_NAME = "rts-images-v1";
export const DEFAULT_CONCURRENCY = 6;

/**
 * Resolve a (possibly root-relative) URL to an absolute one so it is a stable
 * cache key. `data:`/`blob:` URLs are returned unchanged.
 *
 * @param {string} url
 * @returns {string}
 */
export function normalizeUrl(url) {
  if (typeof url !== "string" || !url) return "";
  if (url.startsWith("data:") || url.startsWith("blob:")) return url;
  if (typeof location !== "undefined" && location.href) {
    try {
      return new URL(url, location.href).href;
    } catch (e) {
      return url;
    }
  }
  return url;
}

/**
 * True for URLs that should be downloaded and cached (i.e. real network
 * resources, not inline data.
 *
 * @param {string} url
 * @returns {boolean}
 */
export function isCacheableUrl(url) {
  if (typeof url !== "string" || !url) return false;
  return !url.startsWith("data:") && !url.startsWith("blob:");
}

function pushImage(value, out) {
  if (typeof value === "string") {
    if (isCacheableUrl(value)) out.push(normalizeUrl(value));
  } else if (Array.isArray(value)) {
    for (const item of value) pushImage(item, out);
  }
}

/**
 * Collect every cacheable image URL referenced by one question payload.
 *
 * Handles the flat `images` arrays used by anatomy/rapids/shorts, the nested
 * series arrays used by longs, and `feedback_images`.
 *
 * @param {object} questionData
 * @returns {string[]} unique, normalised URLs
 */
export function collectImageUrls(questionData) {
  if (!questionData || typeof questionData !== "object") return [];
  const out = [];
  pushImage(questionData.images, out);
  pushImage(questionData.feedback_images, out);
  return [...new Set(out)];
}

/**
 * Collect every cacheable image URL across a set of question payloads.
 *
 * @param {object[]} questionDatas
 * @returns {string[]} unique, normalised URLs
 */
export function collectExamImageUrls(questionDatas) {
  const out = new Set();
  for (const questionData of questionDatas || []) {
    for (const url of collectImageUrls(questionData)) out.add(url);
  }
  return [...out];
}

/**
 * Open the Cache Storage bucket used for exam images, or return null when the
 * Cache API is unavailable.
 */
export async function openImageCache() {
  if (typeof caches === "undefined") return null;
  try {
    return await caches.open(IMAGE_CACHE_NAME);
  } catch (e) {
    return null;
  }
}

/**
 * Return the cached Response for a URL, or undefined.
 */
export async function getCachedImage(url, cache = null) {
  const store = cache || (await openImageCache());
  if (!store) return undefined;
  return store.match(normalizeUrl(url));
}

export async function isImageCached(url, cache = null) {
  return !!(await getCachedImage(url, cache));
}

/**
 * Download the given URLs into Cache Storage.
 *
 * Already-cached URLs are skipped (resume), downloads are bounded to
 * `concurrency`, and each URL is retried `retries` times before being recorded
 * as missing. `onProgress(result, url)` is called after each URL settles so the
 * caller can render progress.
 *
 * @param {string[]} urls
 * @param {object} [options]
 * @returns {Promise<{total:number, downloaded:number, skipped:number,
 *                    failed:number, bytes:number, missing:string[]}>}
 */
export async function prefetchImageUrls(urls, options = {}) {
  const {
    concurrency = DEFAULT_CONCURRENCY,
    retries = 2,
    onProgress = null,
    signal = null,
    fetchFn = typeof fetch !== "undefined" ? fetch : null,
    cache = null,
  } = options;

  const store = cache || (await openImageCache());
  const targets = [
    ...new Set((urls || []).filter(isCacheableUrl).map(normalizeUrl)),
  ];
  const result = {
    total: targets.length,
    downloaded: 0,
    skipped: 0,
    failed: 0,
    bytes: 0,
    missing: [],
  };

  if (targets.length === 0) return result;

  if (!store || !fetchFn) {
    // Without Cache Storage / fetch we cannot pre-cache; report everything
    // missing so the caller can fall back to limited mode.
    result.failed = targets.length;
    result.missing = targets.slice();
    return result;
  }

  let next = 0;
  async function worker() {
    for (;;) {
      if (signal && signal.aborted) return;
      const i = next++;
      if (i >= targets.length) return;
      const url = targets[i];

      if (await isImageCached(url, store)) {
        result.skipped++;
        if (onProgress) onProgress(result, url);
        continue;
      }

      let done = false;
      for (let attempt = 0; attempt <= retries && !done; attempt++) {
        try {
          const response = await fetchFn(url, signal ? { signal } : undefined);
          if (!response || !response.ok) {
            throw new Error(`HTTP ${response ? response.status : "?"}`);
          }
          result.bytes += Number(response.headers.get("content-length") || 0);
          await store.put(url, response);
          result.downloaded++;
          done = true;
        } catch (err) {
          if (attempt >= retries) {
            result.failed++;
            result.missing.push(url);
            if (typeof console !== "undefined") {
              console.warn(`pre-cache failed for ${url}:`, err);
            }
          }
        }
      }
      if (onProgress) onProgress(result, url);
    }
  }

  const workerCount = Math.max(1, Math.min(concurrency, targets.length));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return result;
}

/**
 * Remove the given URLs from the image cache. Returns the number deleted.
 */
export async function deleteCachedImages(urls) {
  const store = await openImageCache();
  if (!store) return 0;
  let deleted = 0;
  for (const url of new Set((urls || []).filter(isCacheableUrl).map(normalizeUrl))) {
    if (await store.delete(url)) deleted++;
  }
  return deleted;
}

/**
 * Delete the whole image cache bucket. Returns true when it existed.
 */
export async function clearImageCache() {
  if (typeof caches === "undefined") return false;
  try {
    return await caches.delete(IMAGE_CACHE_NAME);
  } catch (e) {
    return false;
  }
}

/**
 * Ask the browser to keep this origin's storage (so the cached exam is not
 * evicted). Safe to call repeatedly.
 */
export async function requestPersistentStorage() {
  if (
    typeof navigator === "undefined" ||
    !navigator.storage ||
    typeof navigator.storage.persist !== "function"
  ) {
    return false;
  }
  try {
    return await navigator.storage.persist();
  } catch (e) {
    return false;
  }
}

/**
 * Return `{usage, quota}` for this origin, or null when unavailable.
 */
export async function estimateStorage() {
  if (
    typeof navigator === "undefined" ||
    !navigator.storage ||
    typeof navigator.storage.estimate !== "function"
  ) {
    return null;
  }
  try {
    return await navigator.storage.estimate();
  } catch (e) {
    return null;
  }
}

/**
 * Pre-cache every image referenced by a set of question payloads.
 *
 * @param {object[]} questionDatas
 * @param {object} [options] passed through to `prefetchImageUrls`
 */
export async function preCacheExam(questionDatas, options = {}) {
  const urls = collectExamImageUrls(questionDatas);
  const result = await prefetchImageUrls(urls, options);
  return { urls, ...result };
}

// Default retention for completed exams. After this, their question data and
// (exclusively-owned) cached images are pruned. Active/in-progress sessions are
// never pruned.
export const COMPLETED_EXAM_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Return the eids of completed sessions older than the retention window.
 *
 * @param {object[]} sessions - session records (with `eid`, `status`, `date`)
 * @param {number} [now]
 * @param {number} [retentionMs]
 * @returns {string[]} unique eids
 */
export function selectExpiredExams(
  sessions,
  now = Date.now(),
  retentionMs = COMPLETED_EXAM_RETENTION_MS
) {
  const expired = [];
  for (const session of sessions || []) {
    if (!session) continue;
    if (session.status === "active") continue;
    const date = Number(session.date || 0);
    if (!date) continue;
    if (now - date > retentionMs && session.eid) expired.push(session.eid);
  }
  return [...new Set(expired)];
}

/**
 * Return the URLs in `urls` that are not present in `keep`.
 *
 * Used to avoid deleting an image that is still referenced by a retained exam.
 *
 * @param {string[]} urls
 * @param {string[]} keep
 * @returns {string[]} unique URLs to remove
 */
export function subtractUrls(urls, keep) {
  const keepSet = new Set((keep || []).filter(isCacheableUrl).map(normalizeUrl));
  const remove = [];
  for (const raw of urls || []) {
    if (!isCacheableUrl(raw)) continue;
    const url = normalizeUrl(raw);
    if (!keepSet.has(url)) remove.push(url);
  }
  return [...new Set(remove)];
}
