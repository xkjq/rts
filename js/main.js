/* global Dexie, cornerstone, cornerstoneTools, cornerstoneBase64ImageLoader, cornerstoneWebImageLoader, cornerstoneWADOImageLoader */
import * as helper from "./helpers.js?v=1.0.10";
import * as viewer from "./viewer.js?v=1.0.10";
import * as interact from "./interact.js?v=1.0.10";
import * as config from "./config.js";
import { db, question_db } from "./db.js?v=1.0.10";
import { initSync, triggerImmediateSync, updateSyncUI } from "./sync.js?v=1.0.10";
import { initSentry } from "./sentry.js?v=1.0.10";
import { VERSION, BUILD, startUpdateChecker } from "./version.js?v=1.0.10";

initSentry(VERSION);

function safeCleanupViewerMemory() {
  if (typeof viewer !== "undefined" && typeof viewer.cleanupViewerMemory === "function") {
    viewer.cleanupViewerMemory();
  } else {
    try {
      if (typeof cornerstone !== "undefined" && cornerstone.imageCache) {
        cornerstone.imageCache.purgeCache();
      }
      if (typeof cornerstoneWADOImageLoader !== "undefined") {
        const loader = cornerstoneWADOImageLoader.wadouri || (cornerstoneWADOImageLoader.default && cornerstoneWADOImageLoader.default.wadouri);
        if (loader) {
          if (loader.fileManager && loader.fileManager.purge) loader.fileManager.purge();
          if (loader.dataSetCacheManager && loader.dataSetCacheManager.purge) loader.dataSetCacheManager.purge();
        }
      }
    } catch (e) {
      console.debug("Fallback viewer cleanup failed", e);
    }
  }
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

export async function archiveExamAnswers(eid, oldExamJsonId, newExamJsonId) {
  const variants = getEidVariants(eid);
  for (const variant of variants) {
    try {
      await db.answers
        .where("eid")
        .equals(variant)
        .modify((ans) => {
          ans.archived = true;
          ans.archived_at = new Date().toISOString();
          if (oldExamJsonId != null) ans.archived_exam_json_id = oldExamJsonId;
          if (newExamJsonId != null) ans.replaced_by_exam_json_id = newExamJsonId;
        });
    } catch (e) {
      console.debug("Error archiving answers for eid variant", variant, e);
    }
  }
}

export async function invalidateExamQuestions(saved_exam) {
  if (!saved_exam) return;
  const qids = new Set();
  if (saved_exam.order && Array.isArray(saved_exam.order)) {
    saved_exam.order.forEach((q) => qids.add(String(q)));
  }
  if (saved_exam.question_requests && typeof saved_exam.question_requests === "object") {
    Object.keys(saved_exam.question_requests).forEach((q) => qids.add(String(q)));
  }
  const examType = saved_exam.exam_type || saved_exam.type;

  for (const qid of qids) {
    try {
      if (examType) {
        await question_db.question_data.where(["qid", "type"]).equals([qid, examType]).delete();
      }
      await question_db.question_data.where("qid").equals(qid).delete();
    } catch (e) {
      console.debug("Error deleting invalidated question from question_data", qid, e);
    }
  }
}

function initLogging() {
  try {
    const urlParams = new URLSearchParams(window.location.search);
    let logLevel = urlParams.get("log");
    
    if (logLevel !== null) {
      if (logLevel === "1" || logLevel === "true") {
        logLevel = "debug";
      } else if (logLevel === "0" || logLevel === "false") {
        logLevel = "silent";
      }
      localStorage.setItem("rts.logLevel", logLevel);
    } else {
      logLevel = localStorage.getItem("rts.logLevel");
    }
    
    if (!logLevel || !["silent", "error", "warn", "info", "debug"].includes(logLevel)) {
      logLevel = "warn";
    }
    
    log.setLevel(logLevel);
    
    // Redirect console methods through loglevel so they can be silenced consistently
    console.debug = log.debug.bind(log);
    console.log = log.info.bind(log);
    console.warn = log.warn.bind(log);
    console.error = log.error.bind(log);
    
    log.info(`RTS logging level initialized to: ${logLevel}`);
  } catch (e) {
    log.setLevel("warn");
    console.warn("Failed to initialize custom log level, falling back to warn:", e);
  }
}

initLogging();

// Version display + update detection (runs early so it works even if exam loading fails)
function initVersionSystem() {
  log.info(`RTS v${VERSION} (${BUILD})`);

  const versionEl = document.getElementById("app-version");
  if (versionEl) {
    versionEl.textContent = ` v${VERSION}`;
    versionEl.title = `RTS v${VERSION} (${BUILD})`;
  }

  const versionFullEl = document.getElementById("app-version-full");
  if (versionFullEl) {
    versionFullEl.textContent = `RTS v${VERSION}`;
  }
  const versionBuildEl = document.getElementById("app-version-build");
  if (versionBuildEl) {
    versionBuildEl.textContent = `Build: ${BUILD}`;
  }

  // Detect a newly deployed version and prompt a reload so users stay current.
  const onUpdate = (newVersion) => {
    // Only prompt once per new version (remembered in localStorage).
    if (localStorage.getItem("rts.dismissedVersion") === newVersion) {
      return;
    }
    if (!confirm(`A new version of RTS is available (v${newVersion}).\n\nClick OK to reload and get the latest version.`)) {
      localStorage.setItem("rts.dismissedVersion", newVersion);
      return;
    }
    localStorage.removeItem("rts.dismissedVersion");
    window.location.reload();
  };
  startUpdateChecker(onUpdate);
}

function checkForceReset() {
  try {
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get("reset") === "1" || urlParams.get("reset") === "true") {
      log.info("Force reset parameter detected. Resetting all local data...");
      
      // Clear databases
      try {
        window.indexedDB.deleteDatabase("answers_database");
        window.indexedDB.deleteDatabase("questions_database");
      } catch (dbErr) {
        log.error("Failed to delete indexedDB databases:", dbErr);
      }
      
      // Clear storage
      localStorage.clear();
      sessionStorage.clear();
      
      // Clean query parameter from URL to prevent infinite loops, notify and reload
      const cleanUrl = window.location.protocol + "//" + window.location.host + window.location.pathname;
      alert("The application has been completely reset. All local data, storage, and databases have been cleared. Click OK to reload.");
      window.location.href = cleanUrl;
    }
  } catch (e) {
    log.error("Error during force reset:", e);
  }
}

checkForceReset();


let URLS = {};

let standalone = false;

if (config.standalone != "" && config.standalone != undefined) {
  standalone = config.standalone
}

let allow_users = false;

if (config.allow_users != "" && config.allow_users != undefined) {
  allow_users = config.allow_users
}



// Generate urls base on base_url
let baseUrl = config.base_url;
if (!baseUrl || baseUrl.includes("localhost") || baseUrl === "/") {
  // Dynamically use current origin in browser to prevent Host/Port/CORS mismatches
  baseUrl = window.location.origin + "/";
}
URLS.base_url = baseUrl;
URLS.exam_query_url = baseUrl + "exam/json";
URLS.exam_submit_url = baseUrl + "exam/submit";
URLS.exam_status_url = baseUrl + "exam/status";
URLS.exam_results_url = baseUrl + "cid/";
URLS.exam_user_results_url = baseUrl + "user/scores";
URLS.question_feedback_url = baseUrl + "feedback/";
URLS.question_answer_submit_url = baseUrl + "feedback/answer";
URLS.login_url = baseUrl + "accounts/login/?next=/rts";
URLS.logout_url = baseUrl + "accounts/logout/?next=/rts";

// Override individual urls
let urls_to_check = ["exam_query_url",  "exam_submit_url", "exam_status_url", 
  "exam_results_url", "question_feedback_url", 
  "question_answer_submit_url", "login_url", "logout_url"]

for (let url of urls_to_check) {
  if (config[url] != "" && config[url] != undefined) {
    URLS[url] = config[url];
  }
}

log.debug("URLS")
log.debug(URLS)

export function sendExamStatus(status, extra = "") {
  if (!exam_details || !exam_details.eid) return;

  const activeCid = (typeof global_cid !== "undefined" && global_cid) ? String(global_cid) : (exam_details.cid ? String(exam_details.cid) : (localStorage.getItem("cid.cid") || ""));
  const activePasscode = (typeof global_passcode !== "undefined" && global_passcode) ? global_passcode : (exam_details.passcode || localStorage.getItem("cid.passcode") || "");

  if (!activeCid) return;

  const payload = {
    eid: exam_details.eid,
    cid: activeCid,
    passcode: activePasscode,
    status: status,
    start_time: exam_details.start_time || (Date.now() / 1000),
    extra: extra || "",
  };

  $.ajax({
    type: "POST",
    url: URLS.exam_status_url,
    data: payload,
    dataType: "json",
    global: false,
    success: function(res) {
      log.debug("Exam status logged:", status, res);
    },
    error: function(err) {
      log.warn("Failed to log exam status:", status, err);
    }
  });
}


// Parse URL parameters to allow enabling exam mode via GET param
let url_exam_mode = false;
(function() {
  try {
    const params = new URLSearchParams(window.location.search);
    const examParam = params.get("exam_mode");
    if (examParam !== null) {
      if (examParam === "1" || String(examParam).toLowerCase() === "true") {
        url_exam_mode = true;
        let el = $("#load-exam-packet-instructions")
        el.html("You are in exam mode.");
        
        let button = $("<button class='exit-exam-mode'>Exit Exam Mode</button>");

        button.click(() => { 
            // Remove exam_mode param from URL and reload page
            params.delete("exam_mode");
            const newUrl = `${window.location.pathname}?${params.toString()}`;
            window.location.href = newUrl;
        })
        el.append(button);
        el.append("<br/>Click on exam below to load it.");
        
        log.debug("URL parameter enabled exam mode");
      }
    }
  } catch (e) {
    log.debug("Unable to parse URL parameters", e);
  }
})();


let exam_details = {
  aid: null,
  cid: "",
  eid: 5678,
  passcode: "abc",
  exam_mode: false,
  number_of_questions: null,
  question_order: [],
  start_time: null,
};

// If URL param set exam mode earlier, apply it now (exam_details is defined)
if (typeof url_exam_mode !== "undefined" && url_exam_mode) {
  exam_details.exam_mode = true;
  log.debug("Applied URL exam mode to exam_details");
}

//let packet_list = [];
let packet_name = null;
let questions = null;
let session_questions_fallback = null;
let questions_correct = {};
let question_type = null;
let loaded_question = null;
let review_mode = false;
let exam_time = null;
let packet_time = null;
let date_started = null;
let score = 0;
let packet_json_id = null;

let global_cid = null;
let global_passcode = null;
let global_uid = null;
let global_username = null;
let userInfoSet = false;

/**
 * Set user info in the UI independently of packets/exams.
 */
function updateLoginUI() {
  const isDjangoUser = global_uid != null || (global_username != null && global_username !== "");
  const isCandidate = global_cid != null && global_cid !== "" && !String(global_cid).startsWith("u-") && global_passcode != null && global_passcode !== "";

  $("#user-actions").show();

  if (isDjangoUser) {
    $("#user").empty().text(`User: ${global_username}`);
    $("#candidate-details").empty();
    $("#btn-candidate-login").hide();
    $("#btn-user-login").hide();
    $("#btn-user-logout").val("Log out").show();
  } else if (isCandidate) {
    $("#user").empty();
    $("#candidate-details").empty().text(`Current: CID ${global_cid} / Passcode ${global_passcode}`);
    $("#btn-candidate-login").hide();
    if (allow_users) {
      $("#btn-user-login").show();
    } else {
      $("#btn-user-login").hide();
    }
    $("#btn-user-logout").val("Log out").show();
  } else {
    $("#user").empty();
    $("#candidate-details").empty();
    $("#btn-candidate-login").show();
    if (allow_users) {
      $("#btn-user-login").show();
    } else {
      $("#btn-user-login").hide();
    }
    $("#btn-user-logout").hide();
  }
}

function handleUserLogout() {
  localStorage.removeItem("cid.cid");
  localStorage.removeItem("cid.passcode");

  // Clear cid and passcode from URL query parameters if present
  try {
    const url = new URL(window.location.href);
    if (url.searchParams.has("cid") || url.searchParams.has("passcode")) {
      url.searchParams.delete("cid");
      url.searchParams.delete("passcode");
      window.history.replaceState({}, document.title, url.pathname + (url.search ? url.search : ""));
    }
  } catch (e) {
    console.debug("Error clearing URL parameters on logout:", e);
  }

  if (global_uid != null && URLS.logout_url != undefined && URLS.logout_url !== "") {
    window.location = URLS.logout_url;
  } else {
    global_cid = null;
    global_passcode = null;
    global_uid = null;
    global_username = null;
    userInfoSet = false;
    updateLoginUI();
    retrievePacketList("all");
  }
}

/**
 * Set user info in the UI independently of packets/exams.
 */
function setUserInfo(data) {
  if (userInfoSet || !data || !data.user) return;
  userInfoSet = true;

  global_uid = data.user_id;
  global_username = data.user;

  if (global_cid == null) {
    global_cid = "u-" + global_uid;
  }

  updateLoginUI();
}

// Map of eid -> friendly exam name (populated when exam list is loaded)
let examNameMap = {};

/**
 * Render candidate details in the options panel if both CID and passcode are present.
 * Uses `global_cid`/`global_passcode` if set, otherwise falls back to localStorage.
 */
function showCandidateDetails() {
  let cidToShow = global_cid;
  let passToShow = global_passcode;

  if ((cidToShow === null || cidToShow === undefined) || (passToShow === null || passToShow === undefined)) {
    cidToShow = localStorage.getItem("cid.cid");
    passToShow = localStorage.getItem("cid.passcode");
  }

  // Only show when both values exist and are non-empty
  if (cidToShow != null && cidToShow !== "" && passToShow != null && passToShow !== "") {
    global_cid = cidToShow;
    global_passcode = passToShow;

    updateLoginUI();

    // If an exam results URL is configured, update the options link to point to the candidate's results
    if (URLS.exam_results_url != "" && URLS.exam_results_url != undefined) {
      let resultsUrl = `${URLS.exam_results_url}${global_cid}/${global_passcode}`;
      log.debug(`Setting exam results url to ${resultsUrl}`);
      $("#options-link")
        .empty()
        .append(
          `<a href="${resultsUrl}" target="_blank"><div class="packet-button">Results and answers</div></a>`
        );
    }
  } else {
    updateLoginUI();
  }
}

let allow_self_marking = true;

let timer = null;

let use_local_question_cache = false;



cornerstone.imageCache.setMaximumSizeBytes(5128800);

// Set up cornerstone (the dicom viewer)
cornerstoneBase64ImageLoader.external.cornerstone = cornerstone;
cornerstoneWebImageLoader.external.cornerstone = cornerstone;
// cornerstoneWebImageLoader.configure({
//  beforeSend: function(xhr) {
//    // Add custom headers here (e.g. auth tokens)
//    //xhr.setRequestHeader('x-auth-token', 'my auth token');
//  }
// });

cornerstoneWADOImageLoader.external.cornerstone = cornerstone;

// cornerstoneWADOImageLoader.configure({
//  beforeSend: function(xhr) {
//    // Add custom headers here (e.g. auth tokens)
//    //xhr.setRequestHeader('APIKEY', 'my auth token');
//  }
// });

cornerstoneTools.init();

function putAnswer(answer) {
  answer.time_answered = new Date().toISOString();
  answer.synced = false;
  updateSyncUI("syncing");
  db.answers.put(answer).then(() => {
    triggerImmediateSync(exam_details, URLS);
  });
}

retrievePacketList();

initVersionSystem();

updateLoginUI();

try {
  refreshDatabaseSettings();
}
catch {
  log.warn("unable to check database settings")
}

/**
 * Retrieves a list of available packets via JSON ajax requests
 * Will initially try /packets/ (for example if index.php generates the list)
 * and then fallback to packets.json
 *
 * if exam_query_url is defined in config.js this will be used in preference
 */
function showLoadingState($btn, $targetContainer) {
  if (!$btn || !$btn.length) return null;
  let oldText = $btn.text();
  $btn.prop("disabled", true).text("...");
  if ($targetContainer && $targetContainer.length) {
    $targetContainer.css({
      "opacity": "0.4",
      "transition": "opacity 0.2s"
    });
  }
  return function restore(success = true) {
    $btn.prop("disabled", false).text(oldText);
    if ($targetContainer && $targetContainer.length) {
      $targetContainer.css("opacity", "1");
      if (success) {
        $targetContainer.fadeOut(100).fadeIn(100);
      }
    }
  };
}

async function retrievePacketList(target = "all", onComplete = null) {
  log.info(`Load users from database...`)
  let cid = localStorage.getItem("cid.cid")
  let passcode = localStorage.getItem("cid.passcode")

  // Set a default (user) results link
  $("#options-link")
    .empty()
    .append(
      `<a href="${URLS.exam_user_results_url}" target="_blank"><div class="packet-button">Results and answers</div></a>`
    );

  if (cid != null && passcode != null) {
    global_cid = cid;
    global_passcode = passcode;

    // Update the candidate details display (only shows when both values exist)
    showCandidateDetails();
  } else {
    log.info("Try and set CID / Passcode from current URL")
    try {
      const params = new URLSearchParams(window.location.search);
      const cidParam = params.get("cid");
      const passParam = params.get("passcode");

      // Only set if BOTH parameters exist and are non-empty
      if (cidParam !== null && passParam !== null && cidParam !== "" && passParam !== "") {
        cid = cidParam;
        passcode = passParam;
        log.info("CID and passcode extracted from URL", cid, passcode);
        log.info("adding to local db");
        localStorage.setItem("cid.cid", cid);
        localStorage.setItem("cid.passcode", passcode);

        // Update globals and UI without reloading
        global_cid = cid;
        global_passcode = passcode;
        showCandidateDetails();

      } else {
        log.info("CID or passcode missing in URL; not setting local storage");
      }
    } catch (e) {
      log.error("Error parsing URL params for CID/passcode", e);
    }
  }

  // Clear UI elements depending on target
  if (target === "all") {
    $("#packet-list").empty();
    $("#exam-list").empty();
    $("#cache-details summary").empty();
    $("#cache-details ul").empty();
  } else if (target === "exams") {
    $("#exam-list").empty();
  } else if (target === "packets") {
    $("#packet-list").empty();
  } else if (["anatomy", "rapid", "short", "long"].includes(target)) {
    $(`.exam-list.${target}`).find(".packet-button").remove();
    $(`.packet-list.${target}`).find(".packet-button").remove();
  }

  let promises = [];

  // 1. Fetch packets if target is "all" or "packets"
  if (target === "all" || target === "packets") {
    let packetsUrl = "packets/packets.json";
    let p = $.ajax({
      dataType: "json",
      cache: false,
      url: packetsUrl,
      success: function(data) {
        if (!data.hasOwnProperty("exams")) {
          loadPacketList(data);
        }
      },
      error: function(jqXHR, textStatus, errorThrown) {
        log.info("No static packets.json found, checking legacy '/packets' endpoint");
        $.getJSON("packets", function(data) {
          if (!data.hasOwnProperty("exams")) {
            loadPacketList(data);
          }
        }).fail(function() {
          log.info("No static local packets available, using remote exam list");
        });
      }
    }).catch(() => null);
    promises.push(p);
  }


  // 2. Fetch exams if target is "all" or "exams" or one of the types
  if (target === "all" || target === "exams" || ["anatomy", "rapid", "short", "long"].includes(target)) {
    let examUrl = null;
    try {
      if (URLS.exam_query_url != undefined) {
        if (global_cid == null || String(global_cid).startsWith("u-")) {
          examUrl = URLS.exam_query_url;
        } else {
          examUrl = `${URLS.exam_query_url}/${global_cid}/${global_passcode}`;
        }
      }
    } catch (e) {
      log.warn("Unable to set exam query url", e);
    }

    if (examUrl) {
      if (examUrl.includes("exam/json") || examUrl.endsWith("exam/json")) {
        const types = ["anatomy", "rapid", "short", "long"];
        const typesToFetch = types.includes(target) ? [target] : types;
        
        typesToFetch.forEach(type => {
          let typeUrl = examUrl;
          if (examUrl.includes("exam/json/unbased")) {
            typeUrl = examUrl.replace("exam/json/unbased", `exam/json/${type}/unbased`);
          } else {
            typeUrl = examUrl.replace("exam/json", `exam/json/${type}`);
          }

          let p = $.ajax({
            dataType: "json",
            cache: false,
            url: typeUrl,
            success: function(data) {
              if (data.hasOwnProperty("exams")) {
                setUserInfo(data);
                loadExamList(data, false, target);
              }
            },
            error: function(httpObj) {
              console.debug(httpObj);
              if ((httpObj.status == 401 || httpObj.status == 404) && global_cid !== null && !String(global_cid).startsWith("u-")) {
                localStorage.removeItem("cid.cid");
                localStorage.removeItem("cid.passcode");
                $.notify("Unable to login", "error");
                $.notify("This page will now reload", "error");
                setTimeout(() => {
                  window.location.reload();
                }, 3000);
                $("#options-panel").show();
                $("#candidate-details").addClass("invalid-login");
              }
            }
          });
          promises.push(p);
        });
      } else {
        let p = $.ajax({
          dataType: "json",
          cache: false,
          url: examUrl,
          success: function(data) {
            if (data.hasOwnProperty("exams")) {
              loadExamList(data, true, target);
            }
          },
          error: function(httpObj, textStatus) {
            console.debug(httpObj);
            if ((httpObj.status == 401 || httpObj.status == 404) && global_cid !== null && !String(global_cid).startsWith("u-")) {
              localStorage.removeItem("cid.cid");
              localStorage.removeItem("cid.passcode");
              $.notify("Unable to login", "error");
              $.notify("This page will now reload", "error");
              setTimeout(() => {
                window.location.reload();
              }, 3000);
              $("#options-panel").show();
              $("#candidate-details").addClass("invalid-login");
            }
          }
        });
        promises.push(p);
      }
    }
  }

  if (promises.length) {
    Promise.all(promises)
      .then(() => {
        if (onComplete) onComplete(true);
      })
      .catch((err) => {
        log.info("Exam or packet loading completed with fallback", err);
        if (onComplete) onComplete(false);
      });

  } else {
    if (onComplete) onComplete(true);
  }
}

/**
 * Generate a list of exams that are available to be loaded
 * this is based on the subsequent function but gives less options
 *
 * @param {JSON} data - json containing available exams
 */
async function loadExamList(data, clearExistingList = true, target = "all") {
  // If exam mode was enabled via URL param, hide packets by default
  if (typeof url_exam_mode !== "undefined" && url_exam_mode) {
    log.info("URL exam mode active - hiding packets list");
    try {
      $(".packet-wrapper").hide();
    } catch (e) {
      log.warn("Unable to hide packet UI elements", e);
    }
  }
  log.info(`Load exam list: ${data}`)
  log.info("Loading saved sessions")
  let sessions = await db.session.toArray().catch(function(error) {
    log.error("Error loading session", error);
    $("#database-error").text(
      "Error loading the database, schema has probably changed and needs updating. You will probably need to delete the local database."
    );
    let delete_button = $("<button>Delete local database</button>").click(
      () => {
        window.indexedDB.deleteDatabase("answers_database");
        location.reload();
      }
    );
    $("#database-error").append(delete_button);
    $("#database-error").show();
  });
  log.debug(sessions)

  //Display user info if it exists
  // If a user is loggged into the server it any exam responses
  // should have the details embedded
  setUserInfo(data);


  const exams_started_eids = new Set();
  const exams_completed_eids = new Set();
  log.info("Check status of saved exams");
  for (const s of sessions) {
    log.debug(`checking status of`, s);
    const targetSet = s.status === "active" ? exams_started_eids : exams_completed_eids;
    if (s.eid) {
      getEidVariants(s.eid).forEach((v) => targetSet.add(v));
    }
    if (s.packet) {
      targetSet.add(s.packet);
    }
  }

  // Also query db.answers so any exam that has saved answers is identified
  const exams_with_answers = new Set();
  try {
    const allAnswers = await db.answers.toArray();
    for (const a of allAnswers) {
      if (!a.archived && a.eid) {
        getEidVariants(a.eid).forEach((v) => exams_with_answers.add(v));
      }
    }
  } catch (e) {
    console.debug("Error querying answers for exam list identification:", e);
  }

  // Wouldn't we be better terminating earlier in this situation
  let exam_list = [];
  if (data != null) {
    exam_list = data.exams;
  }

  // exam_generated_map stores the exam and its json ID to
  // enable invalidation when the question is updated on the server
  let exam_generated_map = {};
  if (clearExistingList) {
    if (target === "all" || target === "packets") {
      $("#packet-list").empty();
    }
    if (target === "all" || target === "exams") {
      $("#exam-list").empty();
    }
    $("#cache-details summary").empty();
    $("#cache-details ul").empty();
  }

  log.info("Loop available exams");
  for (const exam of exam_list) {
    log.debug(exam);
    const name = exam["name"];
    const url = exam["url"];
    const eid = exam["eid"];
    const exam_json_id = exam["exam_json_id"];
    const exam_type = exam["type"];

    // Store friendly name for overlay display
    try {
      examNameMap[eid] = name;
    } catch (e) {}

    let question_json_id_hash = {};

    // In the case of multiquestion exams (longs) we 
    // check each question json_id in addition
    if (exam.hasOwnProperty("multi_question_json")) {
      question_json_id_hash = exam["multi_question_json"];
    }

    const eidVariants = getEidVariants(eid, exam_type);
    for (const v of eidVariants) {
      exam_generated_map[v] = [exam_json_id, question_json_id_hash];
    }

    // Match against stored session data and local answers
    const hasCompletedSession = eidVariants.some((v) => exams_completed_eids.has(v)) || exams_completed_eids.has(name);
    const hasStartedSession = eidVariants.some((v) => exams_started_eids.has(v)) || exams_started_eids.has(name);
    const hasAnswers = eidVariants.some((v) => exams_with_answers.has(v));

    let item_class = "";
    if (hasCompletedSession) {
      item_class = " session-completed";
    } else if (hasStartedSession || hasAnswers) {
      item_class = " session-started";
    }

    if (!exam.exam_active) {
      item_class = item_class + " inactive";
    }

    // Place the exam under the relavant subheading
    // by defailt they will be under the packet section
    let target_list = "packet-list";
    // if in exam mode we place them under the exam section
    if (exam.exam_mode) {
      target_list = "exam-list";
    }

    let list;
    if (exam.type != undefined) {
      // If the relevant subheading exists target_it it
      if ($(`.${target_list}.${exam.type}`).length) {
        list = $(`.${target_list}.${exam.type}`);
      // or create and add it
      } else {
        let refreshBtnHtml = "";
        if (target_list === "exam-list") {
          refreshBtnHtml = ` <button class="refresh-button type-refresh-button" data-type="${exam.type}" title="Refresh ${exam.type} exams">Refresh</button>`;
        }
        list = $(`<div class='${target_list} ${exam.type}'><span class='packet-list-title'>${exam.type}${refreshBtnHtml}</span><br/></div>`);
        $(`#${target_list}`).append(list);

      }
    // if the packet / exam type is not defined just add it at the bottom
    // TODO: do we actually want this?
    } else {
      list = $("#packet-list");
    }

    // Add the button that is used to load the packet/exam
    $(list).append(
      $(
        `<div class='packet-button${item_class}' data-eid='${eid}' title='Load packet'></div>`
      )
        .text(name)
        .click(function() {
          loadPacketFromAjax(url, eid, exam_json_id);
        })
    );
  }


  // Check the database for exams that have been saved
  // Sanitize legacy bloated saved_exams directly on disk before reading into memory
  question_db.saved_exams
    .toCollection()
    .modify((exam) => {
      if (exam.questions && typeof exam.questions === "object") {
        exam.questions = "cached";
      }
      for (const key of Object.keys(exam)) {
        if (![
          "eid", "name", "exam_name", "type", "exam_type",
          "exam_json_id", "exam_mode", "order", "exam_order",
          "time", "exam_time", "questions", "question_requests",
          "multi_question_json"
        ].includes(key)) {
          delete exam[key];
        }
      }
    })
    .catch((err) => {
      console.debug("Error pre-sanitizing saved_exams:", err);
    })
    .then(() => question_db.saved_exams.toArray())
    .then((saved_exams) => {
    if (saved_exams.length < 1) {
      if ($("#cache-details summary span").length === 0) {
        $("#cache-details summary").append("<span>No cached exams / questions</span>");
      }
    } else {
      if ($("#cache-details summary span").length === 0 || $("#cache-details summary span").text().includes("No cached")) {
        $("#cache-details summary").empty().append("<span>Cached exams / questions:</span>");
      }
    }
    console.debug("Loop through saved exams");
    saved_exams.forEach(async (saved_exam, n) => {
      console.debug("Check", saved_exam);
      const savedEidVariants = getEidVariants(saved_exam.eid, saved_exam.exam_type || saved_exam.type);
      let matchingEid = savedEidVariants.find((v) => exam_generated_map.hasOwnProperty(v));

      if (matchingEid != null) {
        $("#cache-details ul").append(
          `<li class="cache-item" data-eid=${saved_exam.eid}>Exam: ${saved_exam.exam_name} [${saved_exam.eid}]: ${saved_exam.exam_json_id}`
        );
        // If the json_id s differ delete and force a refresh
        const exam_json_id = exam_generated_map[matchingEid][0];
        const question_json_id_hash = exam_generated_map[matchingEid][1];

        if (saved_exam.exam_json_id != exam_json_id) {
          console.debug("id mismatch", saved_exam.exam_json_id, exam_json_id);

          // 1. Delete outdated exam metadata from saved_exams
          for (const v of savedEidVariants) {
            question_db.saved_exams.where("eid").equals(v).delete();
          }

          // 2. Invalidate and delete outdated questions from question_data so new ones download
          await invalidateExamQuestions(saved_exam);

          // 3. Archive answers instead of hard-deleting them!
          await archiveExamAnswers(saved_exam.eid, saved_exam.exam_json_id, exam_json_id);

          // 4. Mark active sessions as archived
          for (const v of savedEidVariants) {
            try {
              db.session.where("eid").equals(v).modify((s) => {
                if (s.status === "active") s.status = "archived";
              });
            } catch (e) {}
          }

          $(`li.cache-item[data-eid="${saved_exam.eid}"]`)
            .addClass("cache-out-of-date")
            .append(` [out of date (latest: ${exam_json_id})]`);
          for (const v of savedEidVariants) {
            $(`.packet-button[data-eid="${v}"]`).addClass("out-of-date");
          }
        } else {
          console.debug("id match", saved_exam.exam_json_id, exam_json_id);
          for (const v of savedEidVariants) {
            $(`.packet-button[data-eid="${v}"]`).addClass("cached");
          }
        }

        console.debug("Check question ids");
        for (let q in question_json_id_hash) {
          let new_question_json_id = question_json_id_hash[q];
          console.debug("new question json id", new_question_json_id);
          $("#cache-details ul").append(
            `<li class="cache-item" data-qid=${q}>Question (${saved_exam.exam_type}): ${q} [New JSON id: ${new_question_json_id}]`
          );

          // Fast index-only existence check without pulling multi-megabyte base64 question data into RAM
          const q_type = saved_exam.exam_type || saved_exam.type;
          let count = 0;
          try {
            count = await question_db.question_data
              .where(["qid", "type"])
              .equals([String(q), q_type])
              .count();

            if (count === 0) {
              count = await question_db.question_data
                .where("qid")
                .equals(String(q))
                .count();
            }
          } catch (e) {
            console.debug("Error checking question in cache", q, e);
          }

          if (count === 0) {
            console.debug(`Question missing in cache: eid: ${saved_exam.eid}, q ${q}`);
            $(`li.cache-item[data-eid="${saved_exam.eid}"]`).addClass("cache-out-of-date");
            $(`li.cache-item[data-qid="${q}"]`).addClass("cache-out-of-date").append(" [Not found]");
            for (const v of savedEidVariants) {
              $(`.packet-button[data-eid="${v}"]`).addClass("out-of-date");
              question_db.saved_exams.where("eid").equals(v).delete();
            }
            await archiveExamAnswers(saved_exam.eid, saved_exam.exam_json_id, exam_json_id);
          }
        }
      }
    });
  });

  // Sort different lists
  $(".packet-list.short div")
    .sort(function(a, b) {
      return a.dataset.eid > b.dataset.eid ?
        1 :
        a.dataset.eid < b.dataset.eid ?
          -1 :
          0;
    })
    .appendTo(".packet-list.short");
  $(".packet-list.rapid div")
    .sort(function(a, b) {
      return a.dataset.eid > b.dataset.eid ?
        1 :
        a.dataset.eid < b.dataset.eid ?
          -1 :
          0;
    })
    .appendTo(".packet-list.rapid");
  $(".packet-list.anatomy div")
    .sort(function(a, b) {
      return a.dataset.eid > b.dataset.eid ?
        1 :
        a.dataset.eid < b.dataset.eid ?
          -1 :
          0;
    })
    .appendTo(".packet-list.anatomy");
  $(".packet-list.long div")
    .sort(function(a, b) {
      return a.dataset.eid > b.dataset.eid ?
        1 :
        a.dataset.eid < b.dataset.eid ?
          -1 :
          0;
    })
    .appendTo(".packet-list.long");

  $("#options-panel").show();
}

/**
 * Generate a list of the packets that are available to be loaded
 *
 * @param {JSON} data - json containing available packets
 */
// TODO: remove (data formats should be switched to the exam format)
async function loadPacketList(data) {
  // NOTE: currently the packet id is not available prior ot downloading the packet
  // this severly limits what we can do with it (but to require would limit the utility)
  log.info(`loadPacketList`);
  log.info("Loading saved sessions")
  let sessions = await db.session.toArray().catch(function(error) {
    log.error(`Error loading session ${error}`);
    $("#database-error").text(
      "Error loading the database, schema has probably changed and needs updating. You will probably need to delete the local database."
    );
    let delete_button = $("<button>Delete local database</button>").click(
      () => {
        window.indexedDB.deleteDatabase("answers_database");
        location.reload();
      }
    );
    $("#database-error").append(delete_button);
    $("#database-error").show();
  });
  log.debug(sessions)
  // db.session
  //   .where("packet")
  //   .equals()
  let packets_started = [];
  let packets_completed = [];
  log.info("Check status of saved packets")
  sessions.forEach((s) => {
    log.debug(`checking status of`, s)
    if (s.status == "active") {
      packets_started.push(s.packet);
    } else {
      packets_completed.push(s.packet);
    }
  });

  log.info("Packets started")
  log.debug(packets_started)
  log.info("Packets completed")
  log.debug(packets_completed)

  let packet_list = [];
  if (data != null) {
    packet_list = data.packets;
  } else {
    log.warn("data == null")
  }

  log.debug(packet_list)
  $("#packet-list").empty();

  //if (packet_json_id == undefined) {
  //  $("#options-panel").show();
  //  return
  //}




  packet_list.forEach(function(packet) {
    // Seperate packet types
    let list;
    if (packet.type != undefined) {
      if ($(`#packet-list .${packet.type}`)) {
        list = $(`#packet-list .${packet.type}`);
      } else {
        list = $(
          `<div class='packet-list ${packet.type}'>${packet.type}<br/></div>`
        );
        $("#packet-list").append(list);
      }
    } else {
      list = $("#packet-list");
    }

    let c = "";
    if (packets_started.indexOf(packet) > -1) {
      c = " session-started";
    }
    if (packets_completed.indexOf(packet) > -1) {
      c = " session-completed";
    }
    list.append(
      $(`<div class='packet-button${c}' title='Load packet'></div>`)
        .text(packet)
        .click(function() {
          loadPacketFromAjax("packets/" + packet, packet);
        })
        .append(
          $(
            `<div class='save-button' title='Download packet for offline use (or to save bandwidth)'><a href='packets/${packet}' download='${packet}'>💾</a></div>`
          ).click(function(evt) {
            //console.debug("packets/" + packet);
            evt.stopPropagation();
          })
        )
    );
  });
  $("#options-panel").show();
}

/**
 * Loads the requisite packet into the quiz system
 * @param {string} path - relative path to the packet json file
 */
function loadPacketFromAjax(path, eid, exam_json_id) {
  if (eid != undefined) {
    // try and load the exam from the local indexedDB
    question_db.saved_exams
      .get(eid)
      .then((exam) => {
        if (exam == undefined || (exam["exam_json_id"] != exam_json_id)) {
          console.debug("AjaxRequestPacket:", eid);
          ajaxRequestionPacket(true);
        } else {
          // We have an up to date exam in the database
          // TODO: check the questions are valid
          console.debug("LoadLocalPacket:", eid);
          use_local_question_cache = true;
          setUpPacket(exam, path);
          $("#options-panel").hide();
        }
      })
      .catch(function(error) {
        // Will be triggered if eid does not exist in database
        console.debug("Unable to load exam:", eid);
        console.debug("error-", error);
        console.debug("Exam will be downloaded");
        ajaxRequestionPacket();
      });

    return;
  }

  function ajaxRequestionPacket(force_refresh) {
    $("#progress").html(`Requesting packet: ${path}`);

    let browser_cache = true;
    if (force_refresh) {
      browser_cache = false;
    }

    let requestUrl = path;
    if (exam_json_id != null) {
      requestUrl += (requestUrl.includes("?") ? "&" : "?") + `v=${exam_json_id}`;
    }

    $.ajax({
      dataType: "json",
      url: requestUrl,
      cache: browser_cache,
      progress: function(e) {
        if (e.lengthComputable) {
          var completedPercentage = Math.round((e.loaded * 100) / e.total);

          $("#progress").html(
            `${completedPercentage}%<br/>${helper.formatBytes(e.total)}`
          );
        }
      },
    })
      .done(function(data) {
        setUpPacket(data, path, exam_json_id, eid);
        $("#options-panel").hide();
      })
      .fail(function() {
        console.debug("Unable to load packet at: " + path);
      });
  }
}

/**
 * Parse the packet and extract metadata (if it exists)
 * Will then call setUpQuestions() to load the packet
 * @param {JSON} data
 */
function setUpPacket(data, path, expected_exam_json_id, expected_eid) {
  session_questions_fallback = null;
  packet_name = path;
  // Load the exam name from the json packet (if it exists)
  if (data.hasOwnProperty("exam_name")) {
    packet_name = data.exam_name;
  }
  $(".exam-name").text("Exam: " + packet_name);

  if (data.hasOwnProperty("eid")) {
    exam_details.eid = data.eid;
  } else if (expected_eid) {
    exam_details.eid = expected_eid;
  } else {
    exam_details.eid = packet_name;
  }

  if (data.hasOwnProperty("exam_type")) {
    question_type = data.exam_type;
  } else if (data.hasOwnProperty("type")) {
    question_type = data.type;
  }

  if (data.hasOwnProperty("exam_json_id") && data.exam_json_id != null) {
    packet_json_id = data.exam_json_id;
  } else if (expected_exam_json_id != null) {
    packet_json_id = expected_exam_json_id;
  }

  if (data.hasOwnProperty("exam_mode")) {
    exam_details.exam_mode = data.exam_mode;
  }

  if (data.hasOwnProperty("questions")) {
    questions = data.questions;
  } else {
    questions = data;
  }

  // Infer question_type if missing from root data
  if (!question_type && typeof questions === "object" && questions !== null) {
    const firstKey = Object.keys(questions)[0];
    if (firstKey && questions[firstKey] && questions[firstKey].type) {
      question_type = questions[firstKey].type;
    }
  }
  if (!question_type && packet_name) {
    const lowerName = String(packet_name).toLowerCase();
    if (lowerName.includes("long")) question_type = "long";
    else if (lowerName.includes("rapid")) question_type = "rapid";
    else if (lowerName.includes("short")) question_type = "short";
    else if (lowerName.includes("anatomy")) question_type = "anatomy";
  }

  if (data.hasOwnProperty("exam_order")) {
    exam_details.question_order = data.exam_order;
  } else {
    exam_details.question_order = [];
    if (typeof questions === "object" && questions !== null) {
      Object.keys(questions).forEach(function(e) {
        if (questions[e] && typeof questions[e] === "object") {
          exam_details.question_order.push(String(e));

          // Make sure answers are arrays
          if (questions[e].hasOwnProperty("answers") && !Array.isArray(questions[e]["answers"])) {
            questions[e]["answers"] = [questions[e]["answers"]];
          }
        }
      });
    }

    let randomise_order = true;
    if (config.randomise_order != undefined) {
      randomise_order = config.randomise_order;
    }
    if (randomise_order) {
      exam_details.question_order = helper.shuffleArray(
        exam_details.question_order
      );
    }
    // We add this here so the question order is maintained
    // when loading from cache
    data["exam_order"] = exam_details.question_order;
  }

  if (data.hasOwnProperty("exam_time")) {
    exam_time = data.exam_time;
    // packet time is the time specificed by the packet
    packet_time = data.exam_time;
  }

  //if (use_local_question_cache && force_question_refresh.length < 1) {
  //  // If loading form cache nothing else to do here
  //  loadSession();
  //  return;
  //}

  if (!use_local_question_cache) {
    // Save only lightweight exam metadata to saved_exams to prevent DataCloneError out of memory
    var saved_exam_record = {
      eid: exam_details.eid,
      name: packet_name,
      exam_name: packet_name,
      type: question_type,
      exam_type: question_type,
      exam_json_id: packet_json_id || data.exam_json_id || expected_exam_json_id || null,
      exam_mode: exam_details.exam_mode || false,
      order: exam_details.question_order,
      exam_order: exam_details.question_order,
      time: exam_time,
      exam_time: exam_time,
      questions: "cached"
    };
    if (data.question_requests) {
      saved_exam_record.question_requests = data.question_requests;
    }
    if (data.multi_question_json) {
      saved_exam_record.multi_question_json = data.multi_question_json;
    }
    question_db.saved_exams.put(saved_exam_record).catch((err) => {
      console.warn("Failed to cache exam metadata in saved_exams:", err);
    });
  }

  // If question_requests is set we need to do a request for each question
  if (
    data.hasOwnProperty("question_requests") &&
    Object.keys(data["question_requests"]).length > 0
  ) {
    // Will happen if loading from cache
    //if (data["questions"] == "cached") {
    //  let a = {};
    //  data["cached_questions"].forEach((q, n) => {
    //    let s = JSON.stringify()
    //    if (force_question_refresh.includes(s)) {
    //    a[q] = 1;
    //    }
    //  });
    //  data["questions"] = a;
    //}
    let question_total = Object.keys(data["question_requests"]).length;
    let question_number = 0;

    var requests = [];
    var request_numbers = [];

    // For loop to generate requests
    (async () => {
      for (let n in data["question_requests"]) {
        question_number++;
        n = String(n);

        // Fast index count check without pulling multi-megabyte question data into RAM
        let count = 0;
        try {
          count = await question_db.question_data
            .where(["qid", "type"])
            .equals([n, question_type])
            .count();

          if (count === 0) {
            count = await question_db.question_data
              .where("qid")
              .equals(n)
              .count();
          }
        } catch (e) {
          console.debug("Error checking question existence:", e);
        }

        // If the question is in the db we can skip downloading it
        if (count > 0) {
          continue;
        }

        const question_url = `${path}/question/${n}`;

        //console.debug("Creating ", question_url, question_number, question_total);
        //$("#progress").html(`Downloading [${question_number}/${question_total}]`);
        let question_json = {};
        question_json = await interact
          .getQuestion(question_url, question_number, question_total)
          .fail((jqXHR, textStatus, errorThrown) => {
            //console.debug(jqXHR, textStatus, errorThrown);
            console.debug(`error loading question: ${n}`);
            //data["questions"][n] = {};
          });

        if (question_json.hasOwnProperty("cached") && question_json["cached"]) {
          console.debug("loading cached packet");
        }

        if (
          question_json.hasOwnProperty("images_json") &&
          question_json["images_json"]
        ) {}

        //requests.push(request)
        //request_numbers.push(n)

        // Using indexed db means that we can avoid loading all data into memory
        //data["questions"][n] = question_json;

        // Store question data into dexie
        let qType = question_json.type || question_type || "unknown";
        let d = {
          //eid: exam_details.eid,
          qid: n,
          data: question_json,
          type: qType,
        };

        try {
          await question_db.question_data.put(d);
        } catch (putErr) {
          console.warn(`Failed to put question ${n} into question_data:`, putErr);
          if (!session_questions_fallback) {
            session_questions_fallback = {};
          }
          session_questions_fallback[n] = question_json;
        }
        question_json = null;
        d = null;
      }
      // Once all questions have been downloaded we carry on loading
      use_local_question_cache = true;
      loadSession();
    })().catch((error) => {
      alert("Error downloading, try refreshing");
      console.debug(error);
    });
  } else {
    // Just carry on loading
    loadSession();
  }
}

function loadSession() {
  log.info("load session", exam_details, db.session);
  // Either continue session or create a new one
  db.session
    .where("[eid+aid]")
    .between([exam_details.eid, Dexie.minKey], [exam_details.eid, Dexie.maxKey])
    .toArray()
    .then((sessions) => {
      if (sessions.length < 1) {
        exam_details.aid = uuidv4();
        date_started = Date.now();
        exam_details.start_time = date_started / 1000;
        setUpQuestions(false);
        if (!review_mode) {
          initSync(exam_details, URLS);
        }
      } else {
        // Show resume dialog
        $("#resume-sessions-list").empty();
        
        let textPrompt = "Select a session to continue:";
        if (exam_details.exam_mode) {
          textPrompt = "An exam session is already in progress. You must continue the existing session:";
          $("#btn-resume-start-new").hide();
        } else {
          $("#btn-resume-start-new").show();
        }
        
        $("#resume-text").text(textPrompt);

        // Populate session items
        sessions.forEach((session, i) => {
          let d = new Date(session.date);
          let formatted_date =
            d.getFullYear() +
            "-" +
            (d.getMonth() + 1) +
            "-" +
            d.getDate() +
            " " +
            d.getHours() +
            ":" +
            d.getMinutes() +
            ":" +
            d.getSeconds();

          let label = `${formatted_date}`;
          if (session.status == "active") {
            label += " [In progress]";
          } else {
            if (!exam_details.exam_mode) {
              label += ` [Complete - score ${session.score}/${session.max_score}]`;
            } else {
              label += " [Complete]";
            }
          }

          let $item = $(`
            <div class="resume-session-item" data-index="${i}">
              <input type="radio" name="resume-session-select" id="session-opt-${i}" value="${i}" style="cursor: pointer; margin: 0;">
              <label for="session-opt-${i}" style="cursor: pointer; display: inline; font-size: 13px; margin: 0; flex: 1;">${label}</label>
              <span class="resume-session-check" style="display: none; font-size: 13px; font-weight: bold; color: #5cdb7a;">✓ Selected</span>
            </div>
          `);
          
          $item.on("click", function() {
            $(".resume-session-item").removeClass("selected");
            $(".resume-session-item .resume-session-check").hide();
            $(this).addClass("selected");
            $(this).find("input[type=radio]").prop("checked", true);
            $(this).find(".resume-session-check").show();
            $("#btn-resume-continue").prop("disabled", false);
          });

          $("#resume-sessions-list").append($item);
        });

        // Auto-select the first one by default if exam_mode is active
        if (exam_details.exam_mode) {
          $(".resume-session-item").first().click();
        } else {
          $("#btn-resume-continue").prop("disabled", true);
        }

        // Open the dialog
        $("#resume-dialog").modal({
          escapeClose: false,
          clickClose: false,
          showClose: false
        });

        // Unbind previous click events to prevent duplicates
        $("#btn-resume-start-new").off("click").on("click", function() {
          $.modal.close();
          exam_details.aid = uuidv4();
          date_started = Date.now();
          exam_details.start_time = date_started / 1000;
          if (exam_details.exam_mode) {
            sendExamStatus("restarted", "Started new attempt from resume dialog");
          }
          setUpQuestions(false);
          if (!review_mode) {
            initSync(exam_details, URLS);
          }
        });

        $("#btn-resume-continue").off("click").on("click", function() {
          let selectedIdx = parseInt($("input[name=resume-session-select]:checked").val());
          if (isNaN(selectedIdx)) return;
          
          $.modal.close();
          let selectedSession = sessions[selectedIdx];
          
          exam_details.aid = selectedSession.aid;
          exam_details.cid = selectedSession.cid != null ? String(selectedSession.cid) : selectedSession.cid;
          date_started = selectedSession.date;
          exam_time = selectedSession.time_left;
          exam_details.question_order = selectedSession.question_order;

          if (selectedSession.status == "complete") {
            review_mode = true;
          }
          
          exam_details.start_time = date_started / 1000;
          if (exam_details.exam_mode && !review_mode) {
            sendExamStatus("resumed", "Resumed attempt from resume dialog");
          }
          setUpQuestions(true);
          if (!review_mode) {
            initSync(exam_details, URLS);
          }
        });
      }
    });
}

/**
 * Build the currently loaded quiz
 */
async function setUpQuestions(load_previous) {
  if (typeof questions === "object" && questions !== null) {
    if (!use_local_question_cache) {
      const targetKeys = (exam_details.question_order && exam_details.question_order.length > 0)
        ? exam_details.question_order
        : Object.keys(questions);
      for (const e of targetKeys) {
        if (!questions[e] || typeof questions[e] !== "object") continue;
        const qType = questions[e].type || question_type || "unknown";
        questions[e].type = qType;
        const d = {
          qid: String(e),
          type: qType,
          data: questions[e],
        };
        try {
          await question_db.question_data.put(d);
        } catch (err) {
          console.warn(`Failed to put question ${e} into question_data:`, err);
          if (!session_questions_fallback) {
            session_questions_fallback = {};
          }
          session_questions_fallback[String(e)] = questions[e];
        }
        delete questions[e];
      }
    }

    // Set an order for the questions
    if (!load_previous) {}
  }
  exam_details.number_of_questions = exam_details.question_order.length;
  review_mode = false;

  // Horrible way to get type of questions
  // We assume they are all of the same type....
  //question_type = questions[Object.keys(questions)[0]].type;

  if (exam_details.exam_mode) {
    $("#options-button, #btn-review-overlay").hide();
  } else {
    $(".submit-button").hide();
  }

  questions = null;

  // exam_time can be defined in packets
  if (!load_previous && exam_time == null) {
    if (question_type == "rapid") {
      exam_time = 35 * 60;
    } else if (question_type == "short") {
      exam_time = 120 * 60;
    } else if (question_type == "anatomy") {
      exam_time = 90 * 60;
    } else if (question_type == "long") {
      exam_time = 75 * 60;
    }
  }

  $(".exam-time")
    .val(exam_time / 60)
    .change(() => {
      exam_time = $(".exam-time").val() * 60;
    });

  if (exam_details.exam_mode) {
    // NOTE: changing the CID when restoring a session will not affect the time left
    //$("#candidate-number2")
    //  .val(exam_details.cid)
    //  .change(() => {
    //    exam_details.cid = parseInt($("#candidate-number2").val());
    //  });
    console.debug("OTNUHOTNU", global_cid)
    exam_details.cid = global_cid != null ? String(global_cid) : global_cid;
    $("#candidate-number2").val(global_cid)
    exam_details.passcode = global_passcode;

    if (global_uid != null) {
      $("#exam-candidate-number").append(`<div>User: ${global_username} / ${global_uid}</div>`);
      $("#candidate-number2").hide();
    }
    $("#exam-candidate-number").show();

    $("#start-dialog").addClass("no-close");
    $("#start-dialog .exam-time").prop("disabled", "true");
    $("#exam-candidate-number").show();
    $(".packet-database-options").hide();
    $("#start-dialog").modal({
      closeExisting: false, // Close existing modals. Set this to false if you need to stack multiple modal instances.
      escapeClose: false, // Allows the user to close the modal by pressing `ESC`
      clickClose: false, // Allows the user to close the modal by clicking the overlay
      showClose: false,
    });
  } else {
    $("#start-dialog").modal();
  }

  loadQuestion(0, 1, true);
  createQuestionListPanel();
}

/**
 * Loads a specific question
 * @param {number} n - Question number to load
 * @param {number} section - Question section to focus
 * @param {boolean} force_reload - Force question to be reloaded if already loaded
 */
async function loadQuestion(n, section = 1, force_reload = false) {
  $("#question-loading").show();
  const aid = exam_details.aid;
  const cid = exam_details.cid;
  const eid = exam_details.eid;
  const passcode = exam_details.passcode;

  n = parseInt(n);
  //console.debug("loading question (n)", n);

  if (n == loaded_question && force_reload == false) {
    // Question already loaded
    setFocus(section);
    $("#question-loading").hide();
    return;
  }

  console.debug(exam_details, n);
  const qid = exam_details.question_order[n];

  console.debug("qid", qid);
  let q = {
    qid: String(qid),
    type: question_type
  };
  console.debug(q);
  console.debug(question_db.question_data);

  let return_data = null;
  try {
    return_data = await question_db.question_data.get(q);
  } catch (err) {
    console.warn(`Error getting question ${qid} with type ${question_type}:`, err);
  }

  // Fallback 1: If not found, try matching by qid alone (resolves compound key type mismatch)
  if (!return_data) {
    try {
      return_data = await question_db.question_data.where("qid").equals(String(qid)).first();
    } catch (err) {
      console.warn(`Error getting question ${qid} by qid:`, err);
    }
  }

  let question_data = return_data ? return_data.data : null;

  // Fallback 2: Check session fallback if IndexedDB failed to save or retrieve
  if (!question_data && session_questions_fallback && session_questions_fallback[String(qid)]) {
    console.warn(`Using session fallback for question ${qid}`);
    question_data = session_questions_fallback[String(qid)];
  }

  // Guard against undefined question_data
  if (!question_data) {
    console.error(`Question data for qid=${qid} (index=${n}) could not be loaded.`);
    $("#question-loading").hide();
    $.notify(`Could not load question ${n + 1}. Please try refreshing.`, "error");
    return;
  }
  return_data = null;

  loaded_question = n;

  $(".question-list-item").attr("aria-selected", "false");
  $(`.question-list-item[data-qid='${n}']`).attr("aria-selected", "true");

  // Set up question navigation
  $(".navigation[data-nav='next']").off();
  $(".navigation[data-nav='previous']").off();
  if (n == 0) {
    $(".navigation[data-nav='previous']").attr("disabled", "disabled");
  } else {
    $(".navigation[data-nav='previous']")
      .removeAttr("disabled")
      .click(function() {
        loadQuestion(n - 1);
      });
  }

  if (n == exam_details.number_of_questions - 1) {
    $(".navigation[data-nav='next']").attr("disabled", "disabled");
  } else {
    $(".navigation[data-nav='next']")
      .removeAttr("disabled")
      .click(function() {
        loadQuestion(n + 1);
      });
  }

  const display_n = n + 1;

  if (question_type === "long") {
    $(".question .title").get(0).innerHTML =
      '<span style="font-weight:700;">' + display_n + "</span>";
    let stemContent = "";
    if (question_data.title && question_data.history) {
      stemContent = question_data.title + " - " + question_data.history;
    } else if (question_data.history) {
      stemContent = question_data.history;
    } else if (question_data.title) {
      stemContent = question_data.title;
    }
    $(".question .stem").text(stemContent);
  } else {
    if (question_data.title) {
      $(".question .title").get(0).innerHTML =
        '<span style="font-weight:700;">' +
        display_n +
        "</span> " +
        question_data.title;
    } else {
      $(".question .title").get(0).innerHTML =
        '<span style="font-weight:700;">' + display_n + "</span>";
    }
    if (question_data.history) {
      $(".question .stem").text(question_data.history);
    } else {
      $(".question .stem").empty();
    }
  }

  // Close any open figures
  //let el = document.getElementById("dicom-image");
  //if (el != undefined) {
  //  cornerstone.disable(el);
  //}

  // disable any further enabled elements
  let enabled_elements = cornerstone.getEnabledElements();
  for (var i = enabled_elements.length - 1; i >= 0; i--) {
    try {
      cornerstone.removeElementData(enabled_elements[i].element);
    } catch (e) {}
    try {
      cornerstone.disable(enabled_elements[i].element);
    } catch (e) {}
  }
  $(".canvas-panel").remove();

  safeCleanupViewerMemory();

  // Remove feedback images
  $(".feedback-image").remove();

  // Set up thumbnails
  const thumbnails = $(".thumbs");
  // Why are we checking this?
  thumbnails.empty();

  // TODO: figure captions (need to extend base json)
  function createThumbnail(image, id, caption, thumbnails) {
    //console.debug("create thumb", image);
    // For thumbnails we only want a single image

    thumbnails.append(
      `<div class="figure" id="figure-${id}"><div class="figcaption">${caption}</div></div>`
    );

    // const thumbnail = $(".figure .thumbnail").get(id);
    // cornerstone.enable(thumbnail)
    // based_img = current_question.images[id];
    const based_img = image;

    // based (image) data url, just load the image directly
    if (based_img.startsWith("data:image/")) {
      const img = $("<img />", {
        src: based_img,
        id: "thumb-" + id,
        class: "thumbnail",
        title: "Click on the thumbnail to view and manipulate the image.",
        draggable: "false",
        style: "height: 100px;",
      });

      $("#figure-" + id).append(img);

      // otherwise try to load it as a dicom (if it starts with data)
      // or ends with dcm
    } else if (based_img.startsWith("data:") || based_img.endsWith(".dcm") || /(?:\/|^)[^.\/]+$/.test(based_img)) {
      // convert the data url to a file
      viewer
        .urltoFile(based_img, "dicom", "application/dicom")
        .then(function(dfile) {
          // load the file using cornerstoneWADO file loader
          const imageId = cornerstoneWADOImageLoader.wadouri.fileManager.add(
            dfile
          );
          const img = $("<div></div>").get(0);
          img.id = "thumb-" + id;
          img.class = "thumbnail";
          img.title = "Click on the thumbnail to view and manipulate the image.";
          img.draggable = "false";
          img.style = "height: 100px; width: 100px";
          $("#figure-" + id).append(img);
          const element = document.getElementById("thumb-" + id);
          cornerstone.enable(element);
          //cornerstone.loadImage(imageId).then(function (image) {
          cornerstone.loadAndCacheImage(imageId).then(function(image) {
            cornerstone.displayImage(element, image);
            cornerstone.resize(element);
          }); // .catch( function(error) {
        });
    } else {
      const img = $("<img />", {
        src: based_img,
        id: "thumb-" + id,
        class: "thumbnail",
        title: "Click on the thumbnail to view and manipulate the image.",
        draggable: "false",
        style: "height: 100px;",
      });

      $("#figure-" + id).append(img);
    }
  }

  question_data.images.forEach((images, n) => {
    let image;
    if (Array.isArray(images)) {
      image = images[0]; // Do we want the middle image?
    } else {
      image = images;
    }
    let caption = "...";
    if (question_data.image_titles != undefined) {
      caption = question_data.image_titles[n];
    }

    createThumbnail(image, n, caption, thumbnails);
  });

  function handleThumbnailClicks(id, thumbnail) {
    $(thumbnail).click(function(event) {
      viewer.openMainImage(question_data, event, this);
    });
  }

  $(".thumbs .figure").each((id, thumbnail) => {
    handleThumbnailClicks(id, thumbnail);
  });

  // Answer setup
  const ap = $(".answer-panel");
  ap.empty();

  switch (question_data.type) {
    case "short": {
      ap.append(
        `<div>
          <div style="display: flex; align-items: center;">
        <p style="flex:1; margin:0;">Please provide a short report for this patient and include your recommended next step for onward management</p>
        <button class="flag" data-qid="${n}" data-qidn="1" style="margin-left:auto;">⚐</button>
          </div>
          <div style="display: flex; align-items: flex-start;">
        <textarea class="long-answer" name="Reason" data-answer-section-qidn="1" style="overflow-wrap: break-word; resize: vertical; min-height: 160px; flex:1;"></textarea>
          </div>
          <div class="word-count" style="font-size: 0.9em; color: #666; margin-left: auto; text-align: right;"><span id="word-count-${n}">0</span> words</div>
        </div>`
      );

      // Update word count on input
      $(".long-answer").on("input", function() {
        this.style.height = "auto";
        this.style.height = (this.scrollHeight) + "px";
        const wordCount = this.value.trim().length > 0 ? this.value.trim().split(/\s+/).length : 0;
        $(this).siblings(".word-count").find("span").text(wordCount);
      });

      // Auto-expand textarea as user types
      $(".long-answer").on("input", function() {
        this.style.height = "auto";
        this.style.height = (this.scrollHeight) + "px";
      });

      $(".long-answer").change(function(evt) {
        // ignore blank text and delete any stored value
        if (evt.target.value.length < 1) {
          db.answers.delete([aid, cid, eid, qid, "1"]);
          $(
            "#question-list-item-" +
            exam_details.question_order.indexOf(qid) +
            "-1"
          ).removeClass("question-saved-localdb");
          return;
        }

        let answer = {
          aid: aid,
          cid: cid,
          eid: eid,
          qid: qid,
          qidn: "1",
          passcode: passcode,
          ans: evt.target.value,
        };
        putAnswer(answer);

        $(
          "#question-list-item-" +
          exam_details.question_order.indexOf(qid) +
          "-1"
        ).addClass("question-saved-localdb");
        saveSession();
        updateQuestionListPanel(answer);
      });

      db.answers
        .get({
          aid: aid,
          cid: cid,
          eid: eid,
          qid: qid,
          qidn: "1"
        })
        .then(function(answer) {
          if (answer != undefined) {
            document.querySelector(".long-answer").value = answer.ans;
            // Auto-expand textarea to fit content
            //$(".long-answer").each(function() {
            //  this.style.height = "auto";
            //  this.style.height = (this.scrollHeight) + "px";
            //});
          }
          markAnswer(qid, question_data, n);
        })
        .catch(function(error) {
          console.debug(error);
        });

      addFlagEvents();
      loadFlagsFromDb(qid, "1");

      break;
    }
    case "rapid": {
      ap.append(
        '<div class="answer-item"><div class="answer-label-outer"><p class="answer-label-inner"><span class="answer-label-number">' +
        display_n +
        '.1</span><span style="flex:1">Case normal/abnormal</span><button class="flag" data-qid="' +
        n +
        '" data-qidn=1 style="margin-right:0">⚐</button></p></div><select class="rapid-option-answer" id="rapid-option" data-answer-section-qidn=1><option selected="selected" disabled="disabled" id="rapid-option-not-answered">--- Not Answered ---</option><option>Abnormal</option><option>Normal</option></select></div>'
      );
      ap.append(
        '<div class="answer-item" id="rapid-text" style="display: none;"><div class="answer-label-outer"><p class="answer-label-inner"><span class="answer-label-number">' +
        display_n +
        '.2</span><span style="flex:1">Reason</span><button class="flag" data-qid="' +
        n +
        '" data-qidn=2 style="margin-right:0">⚐</button></p></div><textarea class="long-answer" name="Reason" data-answer-section-qidn=2 style="overflow: hidden scroll; overflow-wrap: break-word;"></textarea></div>'
      );
      // Handle changing display of optional answer fields and saving of data
      $("#rapid-option").change(function(evt) {
        if (evt.target.value == "Abnormal") {
          $("#rapid-text").css("display", "block");
        } else {
          $("#rapid-text").css("display", "none");
        }

        let answer = {
          aid: aid,
          cid: cid,
          eid: eid,
          qid: qid,
          qidn: "1",
          passcode: passcode,
          ans: evt.target.value,
        };

        putAnswer(answer);
        console.debug("Save ", answer)
        saveSession();
        updateQuestionListPanel(answer);
      });

      // Save long answers on textchange
      $(".long-answer").change(function(evt) {
        // ignore blank text and delete any stored value
        if (evt.target.value.length < 1) {
          db.answers.delete([aid, cid, eid, qid, "2"]);
          $(
            "#question-list-item-" +
            exam_details.question_order.indexOf(qid) +
            "-2"
          ).removeClass("question-saved-localdb");
          return;
        }

        let answer = {
          aid: aid,
          cid: cid,
          eid: eid,
          qid: qid,
          qidn: "2",
          passcode: passcode,
          ans: evt.target.value,
        };
        // db.answers.put({aid: [cid, eid, qidn], ans: evt.target.value});
        console.debug("Save ", answer)
        putAnswer(answer);

        $(
          "#question-list-item-" +
          exam_details.question_order.indexOf(qid) +
          "-2"
        ).addClass("question-saved-localdb");

        saveSession();
        updateQuestionListPanel(answer);
      });

      // We chain our db requests as we can only check answers once
      // they have been loaded (should probably use then or after)

      console.debug("Load rapid answers")
      db.answers
        .get({
          aid: aid,
          cid: cid,
          eid: eid,
          qid: qid,
          passcode: passcode,
          qidn: "1"
        })
        .then(function(answer) {
          if (answer != undefined) {
            $("#rapid-option option:contains(" + answer.ans + ")").prop(
              "selected",
              true
            );
            // For some reason a change event is not fired...
            if (answer.ans == "Abnormal") {
              $("#rapid-text").css("display", "block");
            }
            $("#rapid-option-not-answered").remove();
          }
        })
        .catch(function(error) {
          console.debug("DB", cid, eid, qid);
          console.debug("error-", error);
        })
      //.then(function() {
      db.answers
        .get({
          aid: aid,
          cid: cid,
          eid: eid,
          qid: qid,
          qidn: "2",
          passcode: passcode,
        })
        .then(function(answer) {
          if (answer != undefined) {
            $(".long-answer").text(answer.ans);
          }
          markAnswer(qid, question_data, n);
        })
        .catch(function(error) {
          console.debug("error-", error);
        })
      //});

      addFlagEvents();
      loadFlagsFromDb(qid, "1");
      loadFlagsFromDb(qid, "2");

      break;
    }
    case "anatomy": {
      ap.append(
        '<div class="answer-item" id="anatomy-text"><div class="answer-label-outer"><p class="answer-label-inner"><span class="answer-label-number">' +
        display_n +
        '.1</span><span style="flex:1">' +
        question_data.question +
        '</span><button class="flag" data-qid="' +
        n +
        '" data-qidn=1 style="margin-right:0">⚐</button></p></div><textarea class="long-answer" name="Reason" data-answer-section-qidn=1 style="overflow: hidden scroll; overflow-wrap: break-word;"></textarea></div>'
      );

      $(".long-answer").change(function(evt) {
        // ignore blank text and delete any stored value
        if (evt.target.value.length < 1) {
          db.answers.delete([aid, cid, eid, qid, "1"]);
          $(
            "#question-list-item-" +
            exam_details.question_order.indexOf(qid) +
            "-1"
          ).removeClass("question-saved-localdb");
          return;
        }

        let answer = {
          aid: aid,
          cid: cid,
          eid: eid,
          qid: qid,
          qidn: "1",
          passcode: passcode,
          ans: evt.target.value,
        };
        putAnswer(answer);

        $(
          "#question-list-item-" +
          exam_details.question_order.indexOf(qid) +
          "-1"
        ).addClass("question-saved-localdb");
        saveSession();
        updateQuestionListPanel(answer);
      });

      db.answers
        .get({
          aid: aid,
          cid: cid,
          eid: eid,
          qid: qid,
          qidn: "1"
        })
        .then(function(answer) {
          if (answer != undefined) {
            $(".long-answer").text(answer.ans);
          }
          markAnswer(qid, question_data, n);
        })
        .catch(function(error) {
          console.debug(error);
        });

      addFlagEvents();
      loadFlagsFromDb(qid, "1");

      break;
    }

    case "long": {
      const sections = [
        { did: "a)", name: "Observations", title: "Observations" },
        { did: "b)", name: "Interpretation", title: "Interpretation" },
        { did: "c)", name: "Principal Diagnosis", title: "Principal Diagnosis" },
        { did: "d)", name: "Differential Diagnosis", title: "Differential Diagnosis" },
        { did: "e)", name: "Management (if appropriate)", title: "Management (if appropriate)" },
      ];

      function calculateWordCount(text) {
        if (!text || !text.trim()) return 0;
        return text.trim().split(/\s+/).filter(Boolean).length;
      }

      function updateWordCountDisplay(textarea) {
        const qidn = $(textarea).attr("data-qidn");
        const count = calculateWordCount($(textarea).val());
        const countText = count === 1 ? "1 word" : count + " words";
        $(`#wordcount-${n}-${qidn}`).text(countText);
      }

      sections.forEach((sec, idx) => {
        const qidn = (idx + 1).toString();
        const bgClass = idx % 2 === 0 ? "config-user000-bg" : "config-user100-bg";
        ap.append(
          `<div class="answer-label-row ${bgClass}" data-did="${sec.did}" data-qid="${n}" data-qidn="${qidn}">` +
            `<div class="answer-label-id">${sec.did}</div>` +
            `<div class="answer-label-col">` +
              `<div class="answer-label-panel">` +
                `<button class="flag" data-qid="${n}" data-qidn="${qidn}" title="Flag this question">⚑</button>` +
                `<span class="answer-label-text">${sec.title}</span>` +
              `</div>` +
              `<div class="answer-item">` +
                `<textarea class="long-answer" rows="1" data-qidn="${qidn}" data-answer-section-qidn="${qidn}" name="${sec.name}" autocorrect="off" autocapitalize="off" spellcheck="false" style="overflow-x: hidden; overflow-wrap: break-word;"></textarea>` +
                `<div class="wordcount" id="wordcount-${n}-${qidn}">0 words</div>` +
              `</div>` +
            `</div>` +
          `</div>`
        );
      });

      // Update word count on typing
      $(".long-answer").on("input", function() {
        updateWordCountDisplay(this);
      });

      // Save long answers on textchange
      $(".long-answer").change(function(evt) {
        const qidn = evt.target.dataset.qidn.toString();

        // ignore blank text and delete any stored value
        if (evt.target.value.length < 1) {
          db.answers.delete([aid, cid, eid, qid, qidn]);
          $(
            "#question-list-item-" +
            exam_details.question_order.indexOf(qid) +
            "-" +
            qidn
          ).removeClass("question-saved-localdb");
          return;
        }
        const answer = {
          aid: aid,
          cid: cid,
          eid: eid,
          qid: qid,
          qidn: qidn,
          passcode: passcode,
          ans: evt.target.value,
        };

        putAnswer(answer);

        $(
          "#question-list-item-" +
          exam_details.question_order.indexOf(qid) +
          "-" +
          qidn
        ).addClass("question-saved-localdb");
        saveSession();
        updateQuestionListPanel(answer);
      });

      // Loop through the 5 text areas and retrieve from db
      // could all be retrieved at once with an addition key index
      for (let qidn_count = 1; qidn_count < 6; qidn_count++) {
        let obj = {
          aid: aid,
          cid: cid,
          eid: eid,
          qid: qid,
          qidn: qidn_count.toString(),
        };
        db.answers
          .get(obj)
          .then(function(answer) {
            if (answer != undefined && answer.ans != undefined) {
              const textarea = $(".long-answer").eq(parseInt(answer.qidn) - 1);
              textarea.val(answer.ans);
              updateWordCountDisplay(textarea);
            }
            // We only want to mark once...
            if (qidn_count == 5) {
              markAnswer(qid, question_data, n);
            }
          })
          .catch(function(error) {
            console.debug(error);
          });
      }

      addFlagEvents();
      loadFlagsFromDb(qid, "1");
      loadFlagsFromDb(qid, "2");
      loadFlagsFromDb(qid, "3");
      loadFlagsFromDb(qid, "4");
      loadFlagsFromDb(qid, "5");

      break;
    }
  }

  //rebuildQuestionListPanel();
  setTimeout(() => {
    setFocus(section);
  }, 200);
  $("#question-loading").hide();
}

/**
 * Sets the focus to the required question answer section
 * @param {number} section - section to focus
 */
function setFocus(section) {
  // Horrible (but it works)
  //setTimeout(function () {
  // In pratique it selects the end of a textarea but I'm not sure if I can be bothered...
  // Apparently I can...
  const el = $("*[data-answer-section-qidn=" + section + "]");
  // If the target is a textarea we move focus and reapply the value
  // to move the cursor to the end
  if (el.length < 1) {
    return;
  }

  if (el.get(0).type == "textarea") {
    const val = el.val();
    el.focus().val("").val(val);
    // else we just focus
  } else {
    el.focus();
  }
  //}, 200);
}

function updateQuestionListPanel(answer) {
  $(
    "#question-list-item-" +
    exam_details.question_order.indexOf(answer.qid) +
    "-" +
    answer.qidn
  ).addClass("question-saved-localdb");

  if ((question_type == "rapid" || question_type == "short") && answer.qidn == "1") {
    if (answer.ans == "Abnormal") {
      $(
        "#question-list-item-" +
        exam_details.question_order.indexOf(answer.qid) +
        "-2"
      ).css("display", "block");
    } else {
      $(
        "#question-list-item-" +
        exam_details.question_order.indexOf(answer.qid) +
        "-2"
      ).css("display", "none");
    }
  }
}

function deleteQuestionListPanelFlags(answer) {
  $(
    "#question-list-item-" +
    exam_details.question_order.indexOf(answer.qid) +
    "-" +
    answer.qidn +
    " .question-list-flag"
  ).css("visibility", "hidden");
}

function updateQuestionListPanelFlags(answer) {
  $(
    "#question-list-item-" +
    exam_details.question_order.indexOf(answer.qid) +
    "-" +
    answer.qidn +
    " .question-list-flag"
  ).css("visibility", "visible");
}
/**
 * Updates the question list panel
 * Test with just a global update (may need to do these individually
 * if it gets slow...)
 */
function rebuildQuestionListPanel() {
  const aid = exam_details.aid;
  const cid = exam_details.cid;
  const eid = exam_details.eid;

  db.answers
    .where({
      aid: aid,
      cid: cid,
      eid: eid
    })
    .toArray()
    .then(function(answers) {
      // Reset all classes (of question-list-item s)
      $(".question-list-panel > div, .question-list-panel > button")
        .slice(1)
        .each(function() {
          if (question_type === "long") {
            $(this).attr("class", "question-list-item question-review config-user000-bg");
          } else {
            $(this).attr("class", "question-list-item");
          }
        });

      // Loop through each saved answer
      answers.forEach(function(answer, n) {
        updateQuestionListPanel(answer);
      });
      // $(".long-answer").text(answer.ans);
    })
    .catch(function(error) {
      console.debug("error - ", error);
    });

  db.flags
    .where({
      aid: aid,
      cid: cid,
      eid: eid
    })
    .toArray()
    .then(function(answers) {
      answers.forEach(function(answer, n) {
        updateQuestionListPanelFlags(answer);
      });
      // $(".long-answer").text(answer.ans);
    })
    .catch(function(error) {
      console.debug("error - ", error);
    });

  if (review_mode == true) {
    $(".question-panel-ans").remove();
    for (const qid in questions_correct) {
      let q_no = exam_details.question_order.indexOf(qid);
      //console.debug("q", q_no, qid, questions_correct[qid]);
      let question_list_elements = $(`.question-list-item[data-qid='${q_no}']`);
      //console.debug(question_list_elements, questions_correct[qid]);
      if (questions_correct[qid]) {
        $(`.question-list-item[data-qid='${q_no}']`).append(
          "<span class='question-panel-ans question-panel-correct'>✓</span>"
        );
      } else {
        $(`.question-list-item[data-qid='${q_no}']`).append(
          "<span class='question-panel-ans question-panel-incorrect'>✘</span>"
        );
      }
    }
  }
}

/**
 * Builds the QuestionListPanel
 */
function createQuestionListPanel() {
  $(".question-list-panel").empty();
  const headingText = question_type === "long" ? "Overview" : "Questions";
  $(".question-list-panel").append(
    `<div class="review-heading">${headingText}</div>`
  );

  /**
   * Appends QuestionList item
   * @param {number} n - question number
   * @param {number} qidn - question section number
   * @return {*} el - element that has been created
   */
  function appendQuestionListItem(n, qidn) {
    const qn = n - 1;
    let labelHtml = `<span>${n}.${qidn}</span>`;
    let extraClass = "";
    const letterMap = { "1": "a)", "2": "b)", "3": "c)", "4": "d)", "5": "e)" };
    if (question_type === "long") {
      const letter = letterMap[qidn] || (qidn + ")");
      labelHtml = `<span>${n}&nbsp;&nbsp;${letter}</span>`;
      extraClass = " question-review config-user000-bg";
    }
    const isCurrent = (qn === loaded_question);
    const el = $(
      '<button id="question-list-item-' +
      qn +
      "-" +
      qidn +
      '" data-qid=' +
      qn +
      ' data-qidn="' +
      qidn +
      '" class="question-list-item' +
      extraClass +
      '" aria-selected="' + (isCurrent ? 'true' : 'false') + '">' +
      labelHtml +
      '<span class="question-list-flag" style="visibility: hidden;">⚑</span></button>'
    );
    $(".question-list-panel").append(el);
    // return the new element so it can be hidden if necessary
    return el;
  }

  if (question_type == "rapid") {
    // Loop through all questions and append list items
    for (let n = 1; n < exam_details.number_of_questions + 1; n++) {
      appendQuestionListItem(n, "1");
      appendQuestionListItem(n, "2").hide();
    }
  } else if (question_type == "short") {
    // Loop through all questions and append list items
    for (let n = 1; n < exam_details.number_of_questions + 1; n++) {
      appendQuestionListItem(n, "1");
    }
  } else if (question_type == "anatomy") {
    for (let n = 1; n < exam_details.number_of_questions + 1; n++) {
      appendQuestionListItem(n, "1");
    }
  } else if (question_type == "long") {
    for (let n = 1; n < exam_details.number_of_questions + 1; n++) {
      appendQuestionListItem(n, "1");
      appendQuestionListItem(n, "2");
      appendQuestionListItem(n, "3");
      appendQuestionListItem(n, "4");
      appendQuestionListItem(n, "5");
    }
  }

  $(".question-list-item").click(function(evt) {
    loadQuestion($(this).attr("data-qid"), $(this).attr("data-qidn"));
  });

  rebuildQuestionListPanel();
}

$("#btn-local-file-load").click(function(evt) {
  loadLocalQuestionSet();
});

$(".submit-button").click(function(evt) {
  // Show a finish dialog similar to the app style
  // Compute unanswered count from the answers DB and show the dialog
  interact
    .getJsonAnswers(exam_details, db)
    .then((answers) => {
      // Count unique question ids answered
      const qids = new Set();
      answers.forEach((a) => {
        if (a && a.qid) qids.add(a.qid.toString());
      });

      const totalQuestions =
        exam_details.number_of_questions || (exam_details.question_order && exam_details.question_order.length) || 0;
      const answeredCount = qids.size;
      const unanswered = Math.max(0, totalQuestions - answeredCount);

      $("#unanswered-count").text(unanswered);

      // Update messaging for clarity
      if (unanswered === 0) {
        $(".logout-error.info p.unanswered-line").text("All questions have answers.");
      } else if (totalQuestions === 0) {
        $(".logout-error.info p.unanswered-line").text(`You have ${unanswered} unanswered question(s)`);
      } else {
        $(".logout-error.info p.unanswered-line").text(`You have ${unanswered} unanswered question(s)`);
      }

      // Show dialog overlay
      $(".logout-background").fadeIn(150);

      // Wire dialog buttons
      $("#button-logout").off("click").on("click", function() {
        interact.submitAnswers(exam_details, db, URLS);
        $(".logout-background").fadeOut(150);
      });

      $("#button-continue").off("click").on("click", function() {
        $(".logout-background").fadeOut(150);
      });
    })
    .catch((e) => {
      console.debug("Error computing unanswered count", e);
      $("#unanswered-count").text("?");
      $(".logout-background").fadeIn(150);
    });
});

$("#btn-review").click(function(evt) {
  $(".question-list-panel").toggle();
});

$("#options-button").click(function(evt) {
  loadPacketList(null);
  $("#options-panel").toggle();
});

$("#btn-review-overlay").click(function(evt) {
  if (review_mode == true) {
    reviewQuestions();
  } else {
    $("#finish-dialog").modal();
  }
});

$("#btn-fullscreen-overlay").click(function(evt) {
  if (document.fullscreen == false) {
    document.documentElement.requestFullscreen();
  } else {
    document.exitFullscreen();
  }
});

$("#finish-exam, #btn-time-up-review").click(async function(evt) {
  review_mode = true;
  reviewQuestions();
  $.modal.close();
  await saveSession(true);
  retrievePacketList("all");
});

$("#btn-time-up-continue").click(function(evt) {
  $.modal.close();
});

$("#finish-cancel").click(function(evt) {
  $.modal.close();
});

$("#overlay-close").click(function(evt) {
  $("#options-panel").hide();
});

$("#review-overlay-close").click(function(evt) {
  $("#review-overlay").hide();
});

/**
 * Loads a local question set (from a file)
 * This is call in index.html
 */
function loadLocalQuestionSet() {
  let input;
  let file;
  let fr;

  if (typeof window.FileReader !== "function") {
    alert("The file API isn't supported on this browser yet.");
    return;
  }

  input = document.getElementById("fileinput");
  if (!input) {
    alert("No fileinput element.");
  } else if (!input.files) {
    alert(
      "This browser doesn't seem to support the `files` property of file inputs."
    );
  } else if (!input.files[0]) {
    alert("Please select a file before clicking 'Load'");
  } else {
    file = input.files[0];
    fr = new FileReader();
    fr.onload = receivedText;
    fr.readAsText(file);
  }

  /**
   * Reads text from event and loads the packet
   * @param {*} e - event
   */
  function receivedText(e) {
    const lines = e.target.result;
    let j = JSON.parse(lines);
    setUpPacket(j, file.name);
    $("#options-panel").hide();
  }
}

/**
 * Displays the review question panel with a summary of marks
 */
function reviewQuestions() {
  // Stop timer (if it's running)
  if (timer != null) {
    timer.stop();
  }

  const aid = exam_details.aid;
  const cid = exam_details.cid;
  const eid = exam_details.eid;
  $("#review-overlay").show();
  $("#review-answer-list").empty();
  $("#review-answer-table").empty();
  $("#review-score").empty();
  $("#exam-stats").hide();

  loadQuestion(0, 0, true);

  db.answers
    .where({
      aid: aid,
      cid: cid,
      eid: eid
    })
    .toArray()
    .then(function(answers) {
      let current_answers = {};
      answers.forEach(function(arr, n) {
        let answer = arr["ans"];
        if (answer == undefined) {
          answer = "Not answered";
        }

        current_answers[[arr["qid"], arr["qidn"]]] = answer;
      });

      let correct_count = 0;
      let not_answered = 0;
      let answered_normal = 0;
      let answered_abnormal = 0;
      let undercall_number = 0;
      let overcall_number = 0;
      let incorrectcall_number = 0;
      exam_details.question_order.forEach(async function(qid, n) {
        const q_object = {
          qid: String(qid),
          type: question_type
        };
        let question = await question_db.question_data.get(q_object);
        question = question.data;
        if (question_type == "long") {
          $("#review-answer-table").append(
            $(
              `<tr class='review-table-heading' data-qid=${n + 1
              } title='Click to load question ${n + 1
              }'><td colspan=2>Question ${n + 1}</td></tr>`
            ).click(() => {
              loadQuestion(n);
              $("#review-overlay").hide();
            })
          );
          // $("#review-answer-table").append(`<tr id='review-answer-${qid}'><td class='review-user-answer-cell'></td><td class='review-model-answer-cell'></td></tr>`);
          $("#review-answer-table").append(
            `<tr class='answer-sub' data-qid=${n + 1
            }><td>Your answers</td><td>Model answers</td></tr>`
          );

          let model_answers = question.answers;

          // TODO: FIX
          if (model_answers[0] != undefined) {
            model_answers = model_answers[0];
          }

          const titles = [
            "Observations",
            "Interpretation",
            "Principal Diagnosis",
            "Differential Diagnosis",
            "Management",
          ];

          // let user_td = $(
          //   `#review-answer-${qid} td .review-user-answer-cell`
          // );
          // let model_td = $(
          //   `#review-answer-${qid} td .review-model-answer-cell`
          // );

          titles.forEach((title, x) => {
            let user_answer = current_answers[`${qid},${+1}`];
            //console.debug(`${qid},${n}`, user_answer);
            if (user_answer == undefined) {
              user_answer = "Not answered";
            }
            let user_ans =
              "<h4 class='review-list-header'>" + title + "</h4>" + user_answer;
            let model_ans =
              `<h4 class="review-list-header" name=${+1}>` +
              title +
              "</h4>" +
              model_answers[title.toLowerCase()];

            $("#review-answer-table").append(
              `<tr class='' data-qid=${n + 1
              }><td>${user_ans}</td><td>${model_ans}</td></tr>`
            );
          });

          // TOOD fix
          $("#review-answer-table tr")
            .sort(function(a, b) {
              return a.dataset.qid > b.dataset.qid ?
                1 :
                a.dataset.qid < b.dataset.qid ?
                  -1 :
                  0;
            })
            .appendTo("#review-answer-table");
          return;
        }

        $("#review-answer-list").append(
          "<li id='review-answer-" +
          qid +
          "' data-qid=" +
          n.toString().padStart(2, "0") +
          "'><a href='#' data-qid=" +
          n +
          ">Question " +
          (n + 1) +
          ":</a> <span>Not answered</span></li>"
        );
        $(`#review-answer-list a[data-qid=${n}]`).click(function(evt) {
          loadQuestion(this.dataset.qid);
          $("#review-overlay").hide();
        });

        console.debug(db.user_answers)
        console.debug({
          type: question_type,
          qid: qid
        })
        db.user_answers
          .where({
            type: question_type,
            qid: qid
          })
          .toArray()
          .then(function(answers) {
            // Merge the question answers with the user saved answers
            let question_answers = question["answers"];
            if (answers != undefined) {
              for (let i = 0; i < answers.length; i++) {
                question_answers = question_answers.concat(answers[i].ans);
              }
            }

            let section_1_answer = current_answers[[qid, "1"]];
            let section_2_answer = current_answers[[qid, "2"]];

            if (section_1_answer == undefined) {
              section_1_answer = "Not Answered";
              not_answered++;
            }
            if (section_2_answer == undefined) {
              if (section_1_answer == "Normal") {
                section_2_answer = "Normal";
                answered_normal++;
              } else {
                section_2_answer = "Not Answered";
              }
            } else {
              answered_abnormal++;
            }

            let el = $(`#review-answer-${qid} span`);

            /**
             * Helper function to define how review items are displayed
             * Yes it is a bit shit
             * @param {*} el - element
             * @param {*} c - class
             * @param {*} user_answer -
             * @param {*} normal -
             * @param {*} question_answers -
             */
            function setReviewAnswer(
              el,
              c,
              user_answer,
              normal,
              question_answers
            ) {
              if (normal) {
                el.html(
                  `<span class='${c}'>Answer: ${user_answer} (Normal)</span>`
                );
              } else {
                el.html(
                  `<span class='${c}'>Answer: ${user_answer} (Abnormal: ${question_answers.join(', ')})</span>`
                );
              }
            }

            function setAnatomyReviewAnswer(
              el,
              c,
              user_answer,
              question_answers
            ) {
              el.html(
                `<span class='${c}'>Answer: ${user_answer} (Correct answers: ${question_answers.join(', ')})</span>`
              )
            }

            if (question_type == "rapid") {
              // First check normal vs abnormal
              if (question["normal"] == true) {
                if (section_1_answer == "Normal") {
                  setReviewAnswer(
                    el,
                    "correct",
                    section_1_answer,
                    true,
                    question_answers
                  );
                  correct_count++;
                  questions_correct[qid] = true;
                } else {
                  if (section_1_answer != "Not Answered") {
                    overcall_number++;
                  }
                  setReviewAnswer(
                    el,
                    "incorrect",
                    section_1_answer,
                    true,
                    question_answers
                  );
                  questions_correct[qid] = false;
                }
              } else {
                if (answerInArray(question_answers, section_2_answer)) {
                  correct_count++;
                  setReviewAnswer(
                    el,
                    "correct",
                    section_2_answer,
                    false,
                    question_answers
                  );
                  questions_correct[qid] = true;
                } else {
                  setReviewAnswer(
                    el,
                    "incorrect",
                    section_2_answer,
                    false,
                    question_answers
                  );
                  questions_correct[qid] = false;

                  if (section_1_answer == "Not Answered") {} else if (section_1_answer == "Normal") {
                    undercall_number++;
                  } else {
                    // Incorrect calls could be correct if
                    // the answer is not in the database
                    incorrectcall_number++;

                    el.append(
                      "<span class='mark-correct'>[Mark correct]</span>"
                    ).click(() => {
                      markCorrect(qid, section_2_answer, question_type);
                      reviewQuestions();
                    });
                  }
                }
              }
            } else if (question_type == "short") {
              // Short answers are either correct or incorrect
              // TOOD: this just dups the anatomy marking
              if (answerInArray(question_answers, section_1_answer)) {
                correct_count++;
                setAnatomyReviewAnswer(
                  el,
                  "correct",
                  section_1_answer,
                  question_answers
                );
                questions_correct[qid] = true;
              } else {
                setAnatomyReviewAnswer(
                  el,
                  "incorrect",
                  section_1_answer,
                  question_answers
                );
                questions_correct[qid] = false;
              }
            } else if (question_type == "anatomy") {
              // Anatomy answers are either correct or incorrect
              if (answerInArray(question_answers, section_1_answer)) {
                correct_count++;
                setAnatomyReviewAnswer(
                  el,
                  "correct",
                  section_1_answer,
                  question_answers
                );
                questions_correct[qid] = true;
              } else {
                setAnatomyReviewAnswer(
                  el,
                  "incorrect",
                  section_1_answer,
                  question_answers
                );
                questions_correct[qid] = false;
              }
            }

            score = correct_count;

            $("#review-score").text(
              "Score: " +
              correct_count +
              " out of " +
              exam_details.question_order.length
            );

            if (question_type == "rapid") {
              $("#exam-stats").show();
              $("#unanswered-number").html(not_answered);
              $("#normal-number").html(answered_normal);
              $("#abnormal-number").html(answered_abnormal);
              $("#undercall-number").html(undercall_number);
              $("#overcall-number").html(overcall_number);
              $("#incorrectcall-number").html(incorrectcall_number);
            } else {
              $("#exam-stats").show();
            }
          })
          .catch(function(error) {
            console.debug("error-", error);
          })
          .finally(() => {
            // This will lead to saveSession being called after each question is marked
            saveSession();
            rebuildQuestionListPanel();

            $("#review-answer-list li")
              .sort(function(a, b) {
                return a.dataset.qid > b.dataset.qid ?
                  1 :
                  a.dataset.qid < b.dataset.qid ?
                    -1 :
                    0;
              })
              .appendTo("#review-answer-list");
          });
      });
    })
    .catch(function(error) {
      console.debug("error - ", error);
    });
}

/**
 * Marks the loaded question and updates display
 * @param {*} qid -
 * @param {*} current_question -
 */
function markAnswer(qid, current_question, n) {
  const type = current_question.type;
  console.debug("Mark", current_question);

  let option = null;
  if (review_mode == true) {
    // Disable all possible answer elements
    $("#rapid-option").attr("disabled", "true");
    $(".long-answer").attr("readonly", "true");
    $(".long-answer").addClass("long-answer-marked");

    if (type == "rapid") {
      option = document.getElementById("rapid-option");
      // If the current question is normal
      if (current_question.normal == true) {
        $(".answer-panel").append(
          "<div id='correct-answer-block'>This is normal</div>"
        );
        if (option.value == "Normal") {
          option.classList.add("correct");
        } else {
          option.classList.add("incorrect");
        }
        // If answer is normal we have nothing else to add.
        addFeedback(current_question);
        return;
      }
    }

    if (type == "long") {
      // For long cases we simple disable the texareas and append the
      // model answers
      let model_answers = current_question.answers[0];

      // TODO: FIX THIS
      if (model_answers == undefined) {
        model_answers = current_question.answers;
      }
      for (let key of Object.keys(model_answers)) {
        $("textarea[name*='" + key + "' i]").after(model_answers[key]);
      }
      return;
    }

    $(".answer-panel").append(
      "<div id='correct-answer-block'>Correct answer(s):<ul id='answer-list'></ul></div>"
    );
    let ul = $("#answer-list");

    let textarea = $(".long-answer");
    textarea.addClass("incorrect");

    let user_answer = textarea.val();

    // Load user saved answers
    db.user_answers
      .where({
        type: type,
        qid: qid
      })
      .toArray()
      .then(function(saved_user_answers) {
        //console.debug("saved user answers", saved_user_answers)
        // check if given answer matches a user saved answer
        if (saved_user_answers != undefined) {
          //console.debug(saved_user_answers);
          saved_user_answers.forEach(function(saved_answer_object, n) {
            let saved_answer = saved_answer_object.ans;
            //console.debug("ua", user_answer, saved_answer);
            ul.append("<li>" + saved_answer + "</li>");
            if (compareString(saved_answer, user_answer)) {
              textarea.removeClass("incorrect").addClass("correct");
            }
            if (
              saved_answer_object.submitted == undefined ||
              saved_answer_object.submitted != true
            ) {
              ul.append(
                $("<button>Submit Answer</button>").click((e) => {
                  interact.postSavedAnswer(
                    type,
                    qid,
                    saved_answer,
                    e,
                    saved_answer_object,
                    db,
                    URLS.question_answer_submit_url
                  );
                })
              );
            }
          });
        }

        // check if given answer matches an answer from the question
        current_question.answers.forEach(function(answer, n) {
          ul.append("<li>" + answer + "</li>");
          if (compareString(answer, user_answer)) {
            textarea.removeClass("incorrect").addClass("correct");
          }
        });

        // If the given answer is not abnormal it must be incorrect
        if (type == "rapid" && option.value != "Abnormal") {
          option.classList.add("incorrect");
        } else {
          // If it is blank it must also be incorrect
          if (
            textarea.hasClass("incorrect") == true &&
            user_answer.replace(/\s/g, "") != ""
          ) {
            // Otherwise there is a chance that it may be correct
            // so we give the option to mark it correct
            if (allow_self_marking) {
              $(".answer-panel").append(
                $("<button id='mark-correct'>Mark Correct</button>").click(
                  function() {
                    markCorrect(qid, user_answer, type);
                    loadQuestion(n, 0, true);
                  }
                )
              );
            }
          }
        }
      })
      .catch(function(error) {
        console.debug("error-", error);
      });
    addFeedback(current_question, qid);
    rebuildQuestionListPanel();
  }
}

function addFeedback(current_question, qid) {
  console.debug(current_question);
  if (
    current_question.hasOwnProperty("feedback") &&
    current_question.feedback.length > 0
  ) {
    $(".answer-panel").append(
      $(
        "<div class='feedback'><h4>Feedback</h4>" +
        current_question.feedback +
        "</div>"
      )
    );
  }
  // TODO: render in dicom viewer
  if (
    current_question.hasOwnProperty("feedback_images") &&
    current_question.feedback_images.length > 0
  ) {
    // TODO: finish (load in dicom viewer)
    current_question.feedback_images.forEach((img) => {
      $(".question").append($(`<img class="feedback-image" src="${img}" />`));
    });
  }

  // Add link to submit question feedback

  $(".answer-panel").append(
    $(
      `<div class='feedback-link'><a href=${URLS.question_feedback_url}${current_question.type}/${qid} target=”_blank”>Submit question feedback</a></div>`
    )
  );
}

function markCorrect(qid, user_answer, type) {
  if (user_answer == "") {
    return;
  }

  db.user_answers.put({
    type: type,
    qid: qid,
    ans: user_answer,
    submitted: false,
  });
  //db.user_answers
  //  .get({ type: type, qid: qid })
  //  .then(function (answers) {
  //    let new_answers = [];
  //    if (answers != undefined) {
  //      new_answers = answers.ans;
  //    }

  //    new_answers.push(user_answer);
  //    db.user_answers.put({ type: type, qid: qid, ans: new_answers });
  //  })
  //  .catch(function (error) {
  //    console.debug("error-", error);
  //  });

  if (allow_self_marking) {
    $("#mark-correct").remove();
  }

  let textarea = $(".long-answer").attr("class", "correct");
}

function compareString(a, b) {
  return (
    a.toLowerCase().replace(/\s/g, "") == b.toLowerCase().replace(/\s/g, "")
  );
}

function answerInArray(arr, ans) {
  return (
    arr
      .map((v) => v.toLowerCase().replace(/\s/g, ""))
      .includes(ans.toLowerCase().replace(/\s/g, "")) == true
  );
}

function addFlagEvents() {
  const aid = exam_details.aid;
  const cid = exam_details.cid;
  const eid = exam_details.eid;

  // Bind flag change events
  $("button.flag").click(function(event) {
    const el = $(this);
    const nqid = el.attr("data-qid");
    const qid = exam_details.question_order[nqid];
    const qidn = el.attr("data-qidn");

    el.toggleClass("flag flag-selected");

    const flag_db_data = {
      aid: aid,
      cid: cid,
      eid: eid,
      qid: qid,
      qidn: qidn
    };

    if (el.hasClass("flag")) {
      $("#question-list-item-" + nqid + "-" + qidn + " span").css(
        "visibility",
        "hidden"
      );
      db.flags.delete([aid, cid, eid, qid, qidn]);
      deleteQuestionListPanelFlags(flag_db_data);
    } else {
      $("#question-list-item-" + nqid + "-" + qidn + " span").css(
        "visibility",
        "visible"
      );
      db.flags.put(flag_db_data);
      updateQuestionListPanelFlags(flag_db_data);
    }
  });
}

// Loads the current question flag status and updates display
function loadFlagsFromDb(qid, n) {
  const aid = exam_details.aid;
  const cid = exam_details.cid;
  const eid = exam_details.eid;
  db.flags
    .get({
      aid: aid,
      cid: cid,
      eid: eid,
      qid: qid,
      qidn: n
    })
    .then(function(answer) {
      if (answer != undefined) {
        $("button.flag, button.flag-selected")
          .eq(parseInt(answer.qidn) - 1)
          .toggleClass("flag flag-selected");
      }
    })
    .catch(function(error) {
      console.debug(error);
    });
}

function showLoginDialog() {
  $("#login-dialog").modal();
}


$("#btn-candidate-login").click(function(evt) {
  $("#candidate-number").val(global_cid && !String(global_cid).startsWith("u-") ? global_cid : "");
  $("#passcode").val(global_passcode || "");
  $("#login-dialog").modal({
    escapeClose: true,
    clickClose: true,
    showClose: true
  });
});

$("#btn-login-cancel").click(function(evt) {
  $.modal.close();
});

$("#link-main-site-login").on("click", function(e) {
  e.preventDefault();
  $.modal.close();
  window.location = URLS.login_url;
});

$("#btn-user-login").click(function(evt) {
  window.location = URLS.login_url;
});

$("#btn-user-logout").click(function(evt) {
  handleUserLogout();
});

$("#btn-refresh-all").on("click", function(e) {
  e.stopPropagation();
  let restore = showLoadingState($(this), $("#packets"));
  retrievePacketList("all", restore);
});

$("#btn-refresh-packets").on("click", function(e) {
  e.stopPropagation();
  let restore = showLoadingState($(this), $("#packet-list"));
  retrievePacketList("packets", restore);
});

// Delegate click handlers for the dynamic per-exam-type refresh buttons
$("#exam-list").on("click", ".type-refresh-button", function(e) {
  e.stopPropagation();
  let type = $(this).data("type");
  let $categoryContainers = $(`.exam-list.${type}, .packet-list.${type}`);
  let restore = showLoadingState($(this), $categoryContainers);
  retrievePacketList(type, restore);
});

$("#btn-login").click(function(evt) {
  const cidVal = $("#candidate-number").val().trim();
  const passVal = $("#passcode").val().trim();

  if (!cidVal || !passVal) {
    alert("Please enter both candidate number and passcode.");
    return;
  }

  global_cid = cidVal;
  global_passcode = passVal;

  localStorage.setItem("cid.cid", global_cid);
  localStorage.setItem("cid.passcode", global_passcode);
  $.modal.close();
  updateLoginUI();
  retrievePacketList("all");
});

$(".start-packet-button").click(function(evt) {

  exam_details.start_time = new Date().getTime() / 1000;
  if (exam_details.exam_mode) {
    sendExamStatus("started", "Candidate clicked Start Exam");
  }
  initSync(exam_details, URLS);

  if (timer != null) {
    timer.stop();
  }
  timer = null;

  timer = new easytimer.Timer();
  //exam_time = 2;
  timer.start({
    countdown: true,
    startValues: {
      seconds: exam_time
    }
  });
  timer.addEventListener("secondsUpdated", function(e) {
    $("#timer").html("Time left: " + timer.getTimeValues().toString());
  });
  timer.addEventListener("targetAchieved", function(e) {
    if (exam_details.exam_mode == true) {
      $(
        "#btn-dialog-submit, #btn-time-up-review, #btn-time-up-continue"
      ).toggle();
      $("#time-up-dialog .dialog-text").text(
        "Allocated time has ended. Click to submit answers."
      );
    }
    $("#time-up-dialog").modal();
  });

  // If we are not in an exam we can pause the session
  if (!exam_details.exam_mode) {
    $("#timer").click(() => {
      timer.pause();

      let time_remaining = timer.getTimeValues().toString();

      $("#pause").empty();
      $("#pause").append(
        $(
          `<div id="pause-text">Session paused<div id="pause-time-remaining">You have ${time_remaining} remaining.</div></div><button id="resume-exam-button" class="navigation dialog-yes">Click to resume</button>`
        ).click(() => {
          $("#pause").hide();
          timer.start();
        })
      );
      $("#pause").show();
    });
  }

  // //const t = 2;
  // let display = document.querySelector("#timer");
  // let timer = new helper.CountDownTimer(exam_time);
  // let timeObj = helper.CountDownTimer.parse(exam_time);

  // format(timeObj.minutes, timeObj.seconds);

  // timer.onTick(format);

  // timer.start();

  // function format(minutes, seconds) {
  //   minutes = minutes < 10 ? "0" + minutes : minutes;
  //   seconds = seconds < 10 ? "0" + seconds : seconds;
  //   display.textContent = "Time left: " + minutes + ":" + seconds;

  //   if (minutes == 0 && seconds == 0) {
  //     $("#time-up-dialog").modal();
  //   }
  // }

  loadQuestion(0, 0, true);

  $.modal.close();
});

function delete_answer_db() {
  db.delete()
    .then(() => {
      $.notify("Database successfully deleted", "success");
      $.notify("The page will now reload", "warn");
      setTimeout(() => {
        location.reload();
      }, 2000);
      console.debug("Database successfully deleted");
    })
    .catch((err) => {
      $.notify("Error deleting databases", "error");
      console.error("Could not delete database");
    })
    .finally(() => {
      // Do what should be done next...
    });
}

function delete_question_db() {
  question_db
    .delete()
    .then(() => {
      $.notify("Database successfully deleted", "success");
      $.notify("The page will now reload", "warn");
      setTimeout(() => {
        location.reload();
      }, 2000);
      console.debug("Database successfully deleted");
    })
    .catch((err) => {
      $.notify("Error deleting databases", "error");
      console.error("Could not delete database");
    })
    .finally(() => {
      // Do what should be done next...
    });
}

function delete_user_db() {
  user_db
    .delete()
    .then(() => {
      $.notify("User successfully deleted", "success");
      $.notify("The page will now reload", "warn");
      setTimeout(() => {
        location.reload();
      }, 2000);
      console.debug("Database successfully deleted");
    })
    .catch((err) => {
      $.notify("Error deleting databases", "error");
      console.error("Could not delete database");
    })
    .finally(() => {
      // Do what should be done next...
    });
}

$("#btn-view-local-answers").click(async function(evt) {


  var docHeight = $(document).height();

  let answer_json = await db.answers.toArray();

  if ($("#view-answers-overlay").length < 1) {
    // Build a nicer overlay: filter by exam (eid), formatted table, and a collapsible raw JSON + save link
    // Collect unique eids and a mapping
    const examsMap = {};
    for (const a of answer_json) {
      const eid = a.eid || "unknown";
      if (!examsMap[eid]) examsMap[eid] = [];
      examsMap[eid].push(a);
    }

    let examOptions = "<option value='all'>All exams</option>";
    for (const eid of Object.keys(examsMap)) {
      examOptions += `<option value='${eid}'>Exam ${eid} (${examsMap[eid].length} answers)</option>`;
    }

    $("body").append(
      `<div id='view-answers-overlay'>
          <button id='close-view-answers' class='navigation' style='position: absolute; top: 8px; right: 8px; z-index: 60;'>Close</button>
          <div style='padding: 16px; padding-right: 72px; color: white; overflow:auto; max-height:90vh;'>
            <div style='display:flex; gap:12px; align-items:center; margin-bottom:12px;'>
              <label style='font-weight:600;'>Filter:</label>
              <select id='view-answers-filter'>${examOptions}</select>
              <button id='view-answers-refresh' class='navigation'>Refresh</button>
              <a id='save-failed-answers' class='navigation' style='margin-left:auto;'>Save JSON</a>
            </div>
            <div id='view-answers-formatted' style='margin-bottom:12px;'></div>
            <details style='background:#222; padding:12px; border-radius:6px;'>
              <summary style='cursor:pointer; color:#fff'>Raw JSON</summary>
              <pre id='view-answers-raw' style='white-space:pre-wrap; word-break:break-word; color: #ddd; margin-top:8px;'>${JSON.stringify(answer_json, null, 2)}</pre>
            </details>
          </div>
       </div>`
    );

    $("#view-answers-overlay").height(docHeight);

    // Close handler
    $("#close-view-answers").on("click", function() {
      $("#view-answers-overlay").remove();
    });

    // Save link (raw JSON) - keep existing behaviour
    let file = new Blob([JSON.stringify(answer_json)], {type: "application/json"});
    let link = document.getElementById("save-failed-answers");
    link.href = URL.createObjectURL(file);
    link.download = "answers.json";

    // Render formatted view initially (all exams)
    function renderFormatted(filterEid) {
      const container = $("#view-answers-formatted");
      container.empty();
      const rows = [];
      const source = (filterEid && filterEid !== 'all') ? (examsMap[filterEid] || []) : answer_json;
      if (source.length === 0) {
        container.append("<div>No answers available for selection.</div>");
        return;
      }

      // Group by eid then by cid (candidate)
      const byEid = {};
      for (const a of source) {
        const eid = a.eid || 'unknown';
        const cid = a.cid || 'unknown';
        if (!byEid[eid]) byEid[eid] = {};
        if (!byEid[eid][cid]) byEid[eid][cid] = [];
        byEid[eid][cid].push(a);
      }

      for (const eidKey of Object.keys(byEid)) {
        const friendlyName = (typeof examNameMap[eidKey] !== 'undefined' && examNameMap[eidKey]) ? examNameMap[eidKey] : `Exam ${eidKey}`;
        const eidSection = $(`<div style='margin-bottom:12px;'><h3>${friendlyName} <small style='color:#888; font-weight:400' >[${eidKey}]</small></h3></div>`);
        for (const cidKey of Object.keys(byEid[eidKey])) {
          const answers = byEid[eidKey][cidKey];
          const table = $("<table style='width:100%; border-collapse:collapse; margin-bottom:8px; background:#111; color:#fff;'></table>");
          table.append("<thead><tr><th style='text-align:left; padding:6px; border-bottom:1px solid #333;'>CID</th><th style='text-align:left; padding:6px; border-bottom:1px solid #333;'>QID</th><th style='text-align:left; padding:6px; border-bottom:1px solid #333;'>Section</th><th style='text-align:left; padding:6px; border-bottom:1px solid #333;'>Answer</th><th style='text-align:left; padding:6px; border-bottom:1px solid #333;'>Status</th></tr></thead>");
          const tbody = $("<tbody></tbody>");
          for (const ans of answers) {
            const qid = ans.qid || '';
            const qidn = ans.qidn || '';
            const text = (typeof ans.ans === 'object') ? JSON.stringify(ans.ans) : String(ans.ans);
            const statusBadge = ans.archived
              ? `<span style='background:#721c24; color:#f8d7da; padding:2px 6px; border-radius:3px; font-size:11px;'>Archived${ans.archived_exam_json_id ? ' (Rev ' + ans.archived_exam_json_id + ')' : ''}</span>`
              : `<span style='background:#155724; color:#d4edda; padding:2px 6px; border-radius:3px; font-size:11px;'>Active</span>`;
            const row = $(`<tr><td style='padding:6px; border-top:1px solid #222;'>${cidKey}</td><td style='padding:6px; border-top:1px solid #222;'>${qid}</td><td style='padding:6px; border-top:1px solid #222;'>${qidn}</td><td style='padding:6px; border-top:1px solid #222;'>${$('<div>').text(text).html()}</td><td style='padding:6px; border-top:1px solid #222;'>${statusBadge}</td></tr>`);
            tbody.append(row);
          }
          table.append(tbody);
          eidSection.append($(`<div style='font-weight:600; margin-top:6px;'>Candidate ${cidKey} (${answers.length} answers)</div>`));
          eidSection.append(table);
        }
        container.append(eidSection);
      }
    }

    // Wire up filter and refresh
    $("#view-answers-filter").on("change", function() {
      renderFormatted($(this).val());
    });
    $("#view-answers-refresh").on("click", function() {
      renderFormatted($("#view-answers-filter").val());
    });

    renderFormatted('all');
  }
});

$("#btn-delete-answer-databases").click(function(evt) {
  var r = confirm(
    "This will delete ALL saved answers (including saved correct answers)!"
  );
  if (r == true) {
    delete_answer_db();
  } else {}
});
$("#btn-delete-cached-questions").click(function(evt) {
  var r = confirm("Delete cached questions?");
  if (r == true) {
    delete_question_db();
  } else {}
});
$("#btn-reset-local").click(function(evt) {
  var r = confirm("Clear all local data");
  if (r == true) {
    delete_answer_db();
    delete_question_db();
    localStorage.removeItem("cid.cid")
    localStorage.removeItem("cid.passcode")
  } else {}
});
// Initialize logging controls
$("#select-log-level").val(localStorage.getItem("rts.logLevel") || "warn");
$("#select-log-level").on("change", function() {
  let level = $(this).val();
  log.setLevel(level);
  localStorage.setItem("rts.logLevel", level);
  log.info(`Log level changed to: ${level}`);
});


$("#btn-delete-current").click(function(evt) {
  if (exam_details.question_order.length < 1) {
    $.notify("No packet is currently loaded", "warn");
    return;
  }

  db.flags
    .where("qid")
    .anyOf(exam_details.question_order)
    .delete()
    .then(function(deleteCount) {
      $.notify("Packet flags deleted", "success");
    })
    .catch((err) => {
      $.notify("Error deleting packet flags", "error");
      $.notify("You may have to delete all answers this time", "info");
    });

  db.answers
    .where("qid")
    .anyOf(exam_details.question_order)
    .delete()
    .then(function(deleteCount) {
      if (exam_details.exam_mode) {
        sendExamStatus("restarted", "Candidate reset packet answers");
      }
      $.notify("Packet successfully reset", "success");
      loadQuestion(0, 0, true);
      // $.notify("The page will now reload", "warn");
      // setTimeout(() => {
      //   location.reload();
      // }, 2000);
      console.debug("Deleted " + deleteCount + " objects");
    })
    .catch((err) => {
      $.notify("Error reseting packet", "error");
      $.notify("You may have to delete all answers this time", "info");
      console.debug(err);
    });
});

$("#btn-delete-current-saved-answers").click(function(evt) {
  if (exam_details.question_order.length < 1) {
    $.notify("No packet is currently loaded", "warn");
    return;
  }

  // TODO: fix, needs type
  db.user_answers
    .where("qid")
    .anyOf(exam_details.question_order)
    .delete()
    .then(function(deleteCount) {
      $.notify("Packet answers deleted", "success");
    })
    .catch((err) => {
      $.notify("Error deleting saved answers", "error");
      $.notify("You may have to delete all answers this time", "info");
    });
});

$(document).ajaxStart(function() {
  $("#loading").show();
});

$(document).ajaxStop(function() {
  $("#loading").hide();
});

function saveSession(start_review) {
  if (start_review == true) {
    review_mode = true;
  }

  let status = "active";
  if (review_mode == true) {
    status = "complete";
  }

  //console.debug("save session", score);

  let time_remaining = 0;
  if (timer != null && typeof timer.getTimeValues === "function") {
    let time_values = timer.getTimeValues();
    time_remaining =
      time_values.hours * 60 * 60 +
      time_values.minutes * 60 +
      time_values.seconds;
  }
  return db.session.put({
    packet: packet_name,
    eid: exam_details.eid,
    aid: exam_details.aid,
    cid: exam_details.cid != null ? String(exam_details.cid) : exam_details.cid,
    passcode: exam_details.passcode,
    status: status,
    date: date_started,
    score: score,
    max_score: exam_details.number_of_questions,
    exam_time: exam_time,
    time_left: time_remaining,
    question_order: exam_details.question_order,
    questions_answered: 0, // TODO
    total_questions: exam_details.number_of_questions,
  });
}

function refreshDatabaseSettings() {
  if ("storage" in navigator && navigator.storage != undefined) {
    navigator.storage.estimate().then((value) => {
      $("#storage-details").empty();
      $("#storage-details").append(
        `Local space used: ${helper.humanFileSize(
          value.usage
        )}, available: ${helper.humanFileSize(value.quota)}`
      );
    });
  } else {
    $("#storage-details").append(
      `Local storage information not available (are you connecting over http rather than https?).`
    );
  }
}

$(document).on("saveSessionEvent", {}, async (evt, review) => {
  await saveSession(review);
  retrievePacketList("all");
});

$(document).on("refreshExamListEvent", () => {
  retrievePacketList("all");
});

// Disable right click
$(document).contextmenu(() => {
  return false;
})

// Helper to compare dates
function compareDates(d1, d2) {
  console.debug("compare", d1, d2);
  console.debug("compare striped", Date.parse(d1.split("+")[0]), Date.parse(d2.split("+")[0]));
  console.debug("compare striped", Date.parse(d1.split("+")[0]), Date.parse(d2.split("+")[0]));
  return Date.parse(d1.split("+")[0]) != Date.parse(d2.split("+")[0]);
}