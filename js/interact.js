import * as helper from "./helpers.js";
import * as config from "./config.js";
/**
 * Submits answers
 */
export function submitAnswers(exam_details, db, URLS) {
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
        if (data.question_count == exam_details.number_of_questions) {
          let ret = confirm(
            // `${data.question_count} answers successfully submitted. Click OK to finish the exam.`
            `Answers successfully submitted. Click OK to finish the exam.`
          );

          if (ret) {
            $(document).trigger("saveSessionEvent", [true]);
            if (URLS.exam_results_url != "") {
              let url = URLS.exam_results_url;

              if (exam_details.cid != "") {
                url = `${url}${exam_details.cid}`;
                if (localStorage.getItem("cid.passcode") != null) {
                  url = `${url}/${localStorage.getItem("cid.passcode")}`;
                }
              }
              $("#options-link")
                .empty()
                .append(
                  `<a href="${url}" target="_blank"><div class="packet-button">Results and answers</div></a>`
                );
            }
            $("#options-panel").show();
          } else {}
        } else {
          //alert(`${data.question_count} answers sucessfully submitted.`);
          alert(`Answers sucessfully submitted.`);
        }
      } else {
        submissionError(data, ans, exam_details);
      }
    })
    .fail((e) => {
      // Will occur with server error such as 500
      console.debug("error", e);
      submissionError(e, ans, exam_details);
    });
  // $.post( "http://localhost:8000/submit_answers", JSON.stringify(ans));
}

export function submissionError(data, answer_json, exam_details) {
  // error will not be defined with server errors
  if (data.error != undefined) {
    alert(`Error submitting answers: ${data.error}`);
  } else {
    alert(`Error submitting answers`);
  }
  var docHeight = $(document).height();

  let answers = JSON.parse(answer_json.answers)

  let answer_map = {}

  answers.forEach((ans, n) => {
    if (!answer_map.hasOwnProperty(ans.qid)) {
      answer_map[ans.qid] = [];
    }

    answer_map[ans.qid].push(ans);

  });

  let html = $("<ul></ul>");

  exam_details.question_order.forEach((i, j) => {
    console.debug(i, answer_map)
    if (i in answer_map) {
      console.debug("YES", i, answer_map)
      let ans_array = answer_map[i];
      ans_array.forEach((x, y) => {
        $(html).append(`<li><b>Question ${j+1}.${y}:</b> ${x.ans}</li>`);
      });
    }

  })

  console.debug(exam_details.question_order);
  console.debug(answer_map);
  console.debug(html);

  if ($("#submit-error-overlay").length < 1) {
    $("body").append(
      `<div id='submit-error-overlay'><span style='color: white'><p>An error has occurred when submitting your answers. A copy of your answers are displayed below, you may wish to <a id="save-failed-answers" href="#">save a copy</a>. Please try submitting again or refresh this page to continue (answers will be saved locally in the browser unless you clear local storage).</p><p>${html.get(0).innerHTML}</p><p>${JSON.stringify(
        answer_json
      )}</p></span></div>`
    );

    $("#btn-submit-nav").prependTo("#submit-error-overlay");

    $("#submit-error-overlay").height(docHeight);

    let file = new Blob([JSON.stringify(answer_json)], {type: "application/json"})

    let link = document.getElementById("save-failed-answers");
    link.href = URL.createObjectURL(file);
    link.download = "answers.json";
  }
}

export function getQuestion(url, question_number, question_total) {
  console.debug("Downloading question ", url, question_number, question_total);
  return $.ajax({
    dataType: "json",
    url: url,
    progress: function(e) {
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
      console.debug("error downlading", jqXHR, textStatus, errorThrown);
    },
    //success: function (data) {
    //  strReturn = data;
    //},
    //async: false,
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