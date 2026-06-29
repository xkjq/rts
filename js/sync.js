// Background Sync Module for RTS

import { db } from "./db.js";

let syncInterval = null;
let debounceTimeout = null;
let currentStatus = "saved"; // "saved", "syncing", "failed"

/**
 * Update the sync UI state
 * @param {string} status - "saved", "syncing", "failed"
 */
export function updateSyncUI(status) {
  currentStatus = status;
  const container = document.getElementById("sync-status");
  if (!container) return;

  let html = "";
  switch (status) {
    case "syncing":
      html = `
        <span class="sync-dot syncing"></span>
        <span class="sync-text">Saving to server...</span>
      `;
      break;
    case "failed":
      html = `
        <span class="sync-dot failed"></span>
        <span class="sync-text">Offline - Save failed</span>
      `;
      break;
    case "saved":
    default:
      html = `
        <span class="sync-dot saved"></span>
        <span class="sync-text">Saved to server</span>
      `;
      break;
  }
  container.innerHTML = html;
}

/**
 * Perform background synchronization of unsynced answers
 */
export async function performSync(exam_details, URLS) {
  if (!exam_details || !exam_details.eid) return;

  // Find all unsynced answers for this exam/cid/aid
  const unsynced = await db.answers
    .where({
      aid: exam_details.aid,
      cid: exam_details.cid,
      eid: exam_details.eid,
    })
    .filter(ans => ans.synced === false)
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

  try {
    const response = await new Promise((resolve, reject) => {
      $.post(URLS.exam_submit_url, json, null, "json")
        .done(resolve)
        .fail(reject);
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
    console.error("Autosubmission failed:", error);
    updateSyncUI("failed");
  }
}

/**
 * Trigger an immediate, debounced sync (2s delay after last change)
 */
export function triggerImmediateSync(exam_details, URLS) {
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

  // Set initial state
  updateSyncUI("saved");

  // Run periodic sync every 15 seconds
  syncInterval = setInterval(() => {
    performSync(exam_details, URLS);
  }, 15000);
}
