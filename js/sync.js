// Background Sync Module for RTS

import { db } from "./db.js?v=1.2.0";

let syncInterval = null;
let debounceTimeout = null;
let currentStatus = "saved"; // "saved", "syncing", "failed", "practice"

/**
 * Update the sync UI state
 * @param {string} status - "saved", "syncing", "failed", "practice"
 */
export function updateSyncUI(status) {
  currentStatus = status;
  const container = document.getElementById("sync-status");
  if (!container) return;

  let html = "";
  switch (status) {
    case "practice":
      html = `<span class="sync-dot practice" title="Practice mode (local only)"></span>`;
      break;
    case "syncing":
      html = `<span class="sync-dot syncing" title="Saving to server..."></span>`;
      break;
    case "failed":
      html = `<span class="sync-dot failed" title="Offline - Save failed"></span>`;
      break;
    case "saved":
    default:
      html = `<span class="sync-dot saved" title="Saved to server"></span>`;
      break;
  }
  container.innerHTML = html;
}

/**
 * Perform background synchronization of unsynced answers
 */
export async function performSync(exam_details, URLS) {
  if (!exam_details || !exam_details.exam_mode || !exam_details.eid) return;

  try {
    // Find all unsynced answers for this exam/cid/aid
    const unsynced = await db.answers
      .where({
        aid: exam_details.aid,
        cid: exam_details.cid,
        eid: exam_details.eid,
      })
      .filter(ans => ans.synced === false && !ans.archived)
      .toArray();

    if (unsynced.length === 0) {
      if (currentStatus === "syncing") {
        updateSyncUI("saved");
      }
      return;
    }

    updateSyncUI("syncing");

    const json = {
      eid: exam_details.eid,
      cid: exam_details.cid,
      start_time: exam_details.start_time,
      answers: JSON.stringify(unsynced),
      in_progress: "true",
    };

    const response = await new Promise((resolve, reject) => {
      $.ajax({
        type: "POST",
        url: URLS.exam_submit_url,
        data: json,
        dataType: "json",
        global: false, // Prevents triggering global ajaxStart / ajaxStop spinners
        success: resolve,
        error: reject,
      });
    });

    if (response && response.success) {
      // Mark as synced in Dexie database
      await db.transaction("rw", db.answers, async () => {
        for (const ans of unsynced) {
          ans.synced = true;
          await db.answers.put(ans);
        }
      });
      updateSyncUI("saved");
    } else {
      updateSyncUI("failed");
    }
  } catch (error) {
    if (error && error.name === "DatabaseClosedError") {
      // Another tab closed/deleted the database (versionchange). The
      // database is recreated on the next page load, so there is nothing
      // to submit and no point retrying or flagging a server failure.
      return;
    }
    console.error("Autosubmission failed:", error);
    updateSyncUI("failed");
  }
}

/**
 * Trigger an immediate, debounced sync (2s delay after last change)
 */
export function triggerImmediateSync(exam_details, URLS) {
  if (!exam_details || !exam_details.exam_mode) return;

  if (debounceTimeout) {
    clearTimeout(debounceTimeout);
  }
  debounceTimeout = setTimeout(() => {
    performSync(exam_details, URLS);
  }, 2000);
}

/**
 * Initialize background sync process
 */
export function initSync(exam_details, URLS) {
  // Clear any existing sync process
  if (syncInterval) {
    clearInterval(syncInterval);
  }

  // Setup click redirect to remote user answers on the server if in exam mode
  const container = document.getElementById("sync-status");
  if (container) {
    if (exam_details && exam_details.exam_mode) {
      $(container).css("cursor", "pointer");
      $(container).off("click").on("click", () => {
        let url = URLS.exam_results_url;
        if (url) {
          if (exam_details.cid) {
            if (exam_details.cid.startsWith("u-")) {
              url = URLS.exam_user_results_url || url;
            } else {
              url = `${url}${exam_details.cid}`;
              const passcode = localStorage.getItem("cid.passcode");
              if (passcode) {
                url = `${url}/${passcode}`;
              }
            }
          }
          window.open(url, "_blank");
        }
      });
    } else {
      $(container).css("cursor", "default");
      $(container).off("click");
    }
  }

  if (!exam_details || !exam_details.exam_mode) {
    updateSyncUI("practice");
    return;
  }

  // Check if there are unsynced answers at startup
  db.answers
    .where({
      aid: exam_details.aid,
      cid: exam_details.cid,
      eid: exam_details.eid,
    })
    .filter(ans => ans.synced === false)
    .toArray()
    .then(unsynced => {
      if (unsynced && unsynced.length > 0) {
        updateSyncUI("failed"); // Unsynced answers exist; they aren't accepted by server yet
        performSync(exam_details, URLS);
      } else {
        updateSyncUI("saved");
      }
    })
    .catch(() => {
      updateSyncUI("saved");
    });

  // Run periodic sync every 15 seconds
  syncInterval = setInterval(() => {
    performSync(exam_details, URLS);
  }, 15000);
}
