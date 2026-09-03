import * as helper from "./helpers.js?v=1.0.20";
import * as config from "./config.js?v=1.0.20";
/**
 * Submits answers
 */
export function submitAnswers(exam_details, db, URLS) {
  if (!exam_details || !exam_details.exam_mode) {
    alert("Answers can only be submitted when the exam is in exam mode.");
    return;
  }
  getJsonAnswers(exam_details, db)
    .then((a) => {
      let json = {
        eid: exam_details.eid,
        cid: exam_details.cid,
        start_time: exam_details.start_time,
        answers: JSON.stringify(a),
      };
      postAnswers(json, URLS, exam_details);
    })
    .catch((e) => {
      console.debug(e)
      alert("No answers to submit");
    });
}

/**
 * Gets a json representation of answers
 * @return {JSON} - answers
 */
export function getJsonAnswers(exam_details, db) {
  console.debug(exam_details)
  console.debug({
    aid: exam_details.aid,
    cid: exam_details.cid,
    eid: exam_details.eid,
  })
  return db.answers
    .where({
      aid: exam_details.aid,
      cid: exam_details.cid,
      eid: exam_details.eid,
    })
    .toArray();
}

/**
 * Posts answers to url
 * @param {*} ans - json representation of answers
 */
export function postAnswers(ans, URLS, exam_details) {
  $("#progress").html("Submitting answers...");
  console.debug("postAnswers", ans, URLS, exam_details)
  console.debug("posturl", URLS.exam_submit_url)

  $.post(URLS.exam_submit_url, ans, null, "json")
    .done((data) => {
      console.debug("returned data", data);
      if (data.success) {
        $("#submit-error-overlay").remove();
        $(document).trigger("saveSessionEvent", [true]);

        let url = "";
        if (URLS.exam_results_url != "" && URLS.exam_results_url != undefined) {
          url = URLS.exam_results_url;
          if (exam_details && exam_details.cid != "" && exam_details.cid != undefined) {
            url = `${url}${exam_details.cid}`;
            if (localStorage.getItem("cid.passcode") != null) {
              url = `${url}/${localStorage.getItem("cid.passcode")}`;
            }
            if (exam_details.cid.startsWith("u-")) {
              url = URLS.exam_user_results_url || url;
            }
          }
          $("#options-link")
            .empty()
            .append(
              `<a href="${url}" target="_blank"><div class="packet-button">Results and answers</div></a>`
            );
        }

        if (url) {
          $("#finished-modal-results-link")
            .attr("href", url)
            .off("click")
            .on("click", function(e) {
              e.preventDefault();
              window.open(url, "_blank", "width=1024,height=768,scrollbars=yes,resizable=yes");
            });
          $("#finished-modal-results-container").show();
        } else {
          $("#finished-modal-results-container").hide();
        }

        $("#btn-finished-modal-close")
          .off("click")
          .on("click", function() {
            $.modal.close();
            $("#options-panel").show();
            $(document).trigger("refreshExamListEvent");
          });

        if (typeof $.fn.modal === "function") {
          $("#exam-finished-modal").modal();
        } else {
          $("#options-panel").show();
        }
      } else {
        submissionError(data, ans, exam_details, URLS);
      }
    })
    .fail((e) => {
      // Will occur with server error such as 500
      console.debug("error", e);
      submissionError(e, ans, exam_details, URLS);
    });
  // $.post( "http://localhost:8000/submit_answers", JSON.stringify(ans));
}

export function submissionError(data, answer_json, exam_details, URLS) {
  // Clear any existing overlay
  $("#submit-error-overlay").remove();

  let answers = JSON.parse(answer_json.answers);
  let answer_map = {};

  answers.forEach((ans) => {
    if (!answer_map.hasOwnProperty(ans.qid)) {
      answer_map[ans.qid] = [];
    }
    answer_map[ans.qid].push(ans);
  });

  let $list = $("<ol style='margin-left: 20px; font-size: 13px; max-height: 150px; overflow-y: auto; color: #ccc;'></ol>");
  exam_details.question_order.forEach((qid, idx) => {
    if (qid in answer_map) {
      let ans_array = answer_map[qid];
      ans_array.forEach((ans_obj, sub_idx) => {
        $list.append(`<li><strong>Question ${idx + 1}.${sub_idx + 1}:</strong> ${ans_obj.ans}</li>`);
      });
    }
  });

  let rawJsonStr = JSON.stringify(answer_json, null, 2);

  let errorMsg = "An error occurred while submitting your answers.";
  if (data && data.error) {
    errorMsg = `Server returned error: ${data.error}`;
  } else if (data && data.statusText) {
    errorMsg = `Network error: ${data.statusText} (${data.status})`;
  }

  let $overlay = $(`
    <div id="submit-error-overlay">
      <div class="error-card">
        <h3>Submission Failed</h3>
        <p style="margin-bottom: 15px; color: #ef5350; font-weight: bold;">${errorMsg}</p>
        <p style="font-size: 13px; color: #bbb; line-height: 1.4;">
          Your answers are saved locally in the browser's database and will not be lost unless you clear your local data.
          Please try to submit again, or save a backup file of your answers and contact support.
        </p>
        
        <div style="margin: 15px 0;">
          <h4 style="margin: 0 0 5px 0; font-size: 14px; color: #eee;">Submitted Answers:</h4>
          <div style="background: #111; border: 1px solid #333; padding: 10px; border-radius: 4px;">
            ${$list.prop("outerHTML")}
          </div>
        </div>

        <details style="margin: 15px 0; font-size: 12px; cursor: pointer; color: #aaa;">
          <summary style="font-weight: bold; margin-bottom: 5px;">View Raw Submission JSON</summary>
          <pre style="background: #111; border: 1px solid #333; padding: 10px; overflow: auto; max-height: 150px; text-align: left; font-family: monospace; white-space: pre-wrap; margin: 0; color: #a5d6a7;">${rawJsonStr}</pre>
        </details>

        <div style="display: flex; justify-content: flex-end; gap: 10px; margin-top: 20px;">
          <button id="btn-err-close" class="btn-secondary">Close</button>
          <a id="btn-err-backup" class="button" style="text-decoration: none;"><button class="btn-secondary">Save Backup</button></a>
          <button id="btn-err-retry">Retry Submit</button>
        </div>
      </div>
    </div>
  `);

  $("body").append($overlay);

  // Setup download backup link
  let fileBlob = new Blob([JSON.stringify(answer_json)], {type: "application/json"});
  let backupUrl = URL.createObjectURL(fileBlob);
  $overlay.find("#btn-err-backup").attr("href", backupUrl).attr("download", `answers_backup_${exam_details.eid.replace(/\//g, "_")}.json`);

  // Close handler
  $overlay.find("#btn-err-close").on("click", function() {
    $("#submit-error-overlay").remove();
  });

  // Retry handler
  $overlay.find("#btn-err-retry").on("click", function() {
    postAnswers(answer_json, URLS, exam_details);
  });
}

export function getQuestion(url, question_number, question_total) {
  console.debug("Downloading question ", url, question_number, question_total);

  // Stall detection: abort if no bytes are received for 60 seconds.
  // This covers both the server-side generation delay and mid-download pauses.
  const STALL_MS = 180000;
  let lastActivity = Date.now();
  let xhrInstance = null;

  const stallTimer = setInterval(() => {
    if (Date.now() - lastActivity > STALL_MS) {
      clearInterval(stallTimer);
      console.warn("Question download stalled, aborting:", url);
      if (xhrInstance) xhrInstance.abort();
    }
  }, 5000);

  return $.ajax({
    dataType: "json",
    url: url,
    xhr: function() {
      xhrInstance = new XMLHttpRequest();
      return xhrInstance;
    },
    progress: function(e) {
      lastActivity = Date.now(); // reset stall timer on every incoming chunk
      if (e.lengthComputable) {
        var completedPercentage = Math.round((e.loaded * 100) / e.total);
        $("#progress").html(
          `Downloading question [${question_number}/${question_total}]<br/>${completedPercentage}%<br/>${helper.formatBytes(
            e.total
          )}`
        );
      } else {
        $("#progress").html(
          `Downloading question [${question_number}/${question_total}]<br/>This file is compressed (downloaded ${helper.humanFileSize(e.loaded)})`
        );
      }
    },
    error: (jqXHR, textStatus, errorThrown) => {
      console.debug("error downloading", jqXHR, textStatus, errorThrown);
    },
  }).always(() => {
    clearInterval(stallTimer);
  });
}

export function postSavedAnswer(type, qid, answer, e, db_object, db, submit_url) {
  console.debug("post", type, qid, answer, e)
  return $.ajax({
    type: "POST",
    url: submit_url,
    data: JSON.stringify({
      qid: `${type}/${qid}`,
      answer: answer,
      status: 2
    }),
    contentType: "application/json; charset=utf-8",
    dataType: "json",
    success: function(data) {
      db_object.submitted = true;
      db.user_answers.put(db_object);
      e.target.remove()
      console.debug(data);

    },
    error: function(errMsg) {
      alert(errMsg);
    }
  });
}