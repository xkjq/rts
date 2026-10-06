/**
 * Function to randomise an array order
 * @param {array} array
 */
export function shuffleArray(array) {
  var currentIndex = array.length,
    temporaryValue,
    randomIndex;
  // While there remain elements to shuffle...
  while (0 !== currentIndex) {
    // Pick a remaining element...
    randomIndex = Math.floor(Math.random() * currentIndex);
    currentIndex -= 1;
    // And swap it with the current element.
    temporaryValue = array[currentIndex];
    array[currentIndex] = array[randomIndex];
    array[randomIndex] = temporaryValue;
  }
  return array;
}

export function formatBytes(bytes, decimals = 2) {
  if (bytes === 0) return "0 Bytes";

  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ["Bytes", "KB", "MB", "GB", "TB", "PB", "EB", "ZB", "YB"];

  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + " " + sizes[i];
}

/**
 * Format bytes as human-readable text.
 * 
 * @param bytes Number of bytes.
 * @param si True to use metric (SI) units, aka powers of 1000. False to use 
 *           binary (IEC), aka powers of 1024.
 * @param dp Number of decimal places to display.
 * 
 * @return Formatted string.
 */
export function humanFileSize(bytes, si=false, dp=1) {
  const thresh = si ? 1000 : 1024;

  if (Math.abs(bytes) < thresh) {
    return bytes + ' B';
  }

  const units = si 
    ? ['kB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'] 
    : ['KiB', 'MiB', 'GiB', 'TiB', 'PiB', 'EiB', 'ZiB', 'YiB'];
  let u = -1;
  const r = 10**dp;

  do {
    bytes /= thresh;
    ++u;
  } while (Math.round(Math.abs(bytes) * r) / r >= thresh && u < units.length - 1);


  return bytes.toFixed(dp) + ' ' + units[u];
}

export function normalizeEid(eid) {
  if (eid == null) return "";
  return String(eid).trim();
}

export function getEidVariants(eid, type = null) {
  const s = normalizeEid(eid);
  const variants = new Set();
  if (s) {
    variants.add(s);
    if (s.includes("/")) {
      const parts = s.split("/");
      variants.add(parts[parts.length - 1]);
    } else if (type) {
      variants.add(`${type}/${s}`);
    }
  }
  return Array.from(variants);
}

/**
 * Match a saved exam against the exam_generated_map built from an exam list.
 *
 * exam_generated_map is keyed by every eid variant from getEidVariants, which
 * includes the bare numeric id (e.g. "1" for both "short/1" and "anatomy/1").
 * Matching purely on those bare keys lets an exam of one type cross-match an
 * exam of another type that happens to share the same numeric id, causing
 * bogus cache invalidation. Entries therefore store their exam type at index 2
 * and are only matched when the type agrees (or when either side has no type).
 *
 * @param {object} savedExam - saved_exams record (has eid, type/exam_type)
 * @param {object} exam_generated_map - variant -> [exam_json_id, question_json_id_hash, exam_type]
 * @returns {string|null} the matching variant key, or null
 */
export function findMatchingEid(savedExam, exam_generated_map) {
  if (!savedExam || !exam_generated_map) return null;
  const savedExamType = savedExam.exam_type || savedExam.type;
  const variants = getEidVariants(savedExam.eid, savedExamType);
  for (const v of variants) {
    if (!exam_generated_map.hasOwnProperty(v)) continue;
    // Type-prefixed variants (contain "/") are unambiguous.
    if (v.includes("/")) return v;
    // Bare variants are ambiguous across exam types - only match when the
    // types agree (or when either side is untyped, e.g. legacy packets).
    const entryType = exam_generated_map[v][2];
    if (!savedExamType || !entryType || entryType === savedExamType) {
      return v;
    }
  }
  return null;
}

/**
 * Get a cookie value by name from document.cookie.
 * @param {string} name - e.g. "csrftoken"
 * @returns {string|null} - decoded cookie value, or null if not found
 */
export function getCookie(name) {
  if (typeof document === "undefined" || !document.cookie) return null;
  const prefix = name + "=";
  const cookies = document.cookie.split(";");
  for (let i = 0; i < cookies.length; i++) {
    const cookie = cookies[i].trim();
    if (cookie.startsWith(prefix)) {
      return decodeURIComponent(cookie.substring(prefix.length));
    }
  }
  return null;
}

/**
 * Return the path part of a URL, dropping any query string or fragment.
 * @param {string} url
 * @returns {string}
 */
export function urlPath(url) {
  if (typeof url !== "string") return "";
  return url.split("#")[0].split("?")[0];
}

/**
 * Best-effort check for whether a media URL points at a DICOM object.
 *
 * A DICOM URL either ends in `.dcm` (ignoring a `?v=<content hash>` cache
 * query) or uses an extensionless final path segment (e.g. `/media/.../12345`).
 * Versioned URLs like `/media/x.dcm?v=abc123` must still be recognised as DICOM.
 *
 * @param {string} url
 * @returns {boolean}
 */
export function isDicomUrl(url) {
  const path = urlPath(url);
  if (!path) return false;
  if (path.toLowerCase().endsWith(".dcm")) return true;
  return /(?:\/|^)[^.\/]+$/.test(path);
}

/**
 * Build the per-question JSON URL for an exam.
 *
 * Based exam URLs (e.g. `/longs/exam/json/5/123/abc`) get `/question/<id>`
 * appended. Unbased exam URLs end in `/unbased`, and the matching server route
 * inserts the question path *before* that suffix
 * (`/longs/exam/json/5/123/abc/question/9/unbased`), so we must not simply
 * concatenate.
 *
 * @param {string} examUrl - exam JSON URL (without any `?v=` query)
 * @param {string|number} questionId
 * @returns {string}
 */
export function questionUrlForExam(examUrl, questionId) {
  const suffix = "/unbased";
  if (examUrl.endsWith(suffix)) {
    return `${examUrl.slice(0, -suffix.length)}/question/${questionId}${suffix}`;
  }
  return `${examUrl}/question/${questionId}`;
}