import * as helper from "./helpers.js";
/**
 * Submits answers
 */
export function submitAnswers(exam_details, db, config) {
  getJsonAnswers(exam_details, db)
    .then((a) => {
      let json = {
        eid: exam_details.eid,
        answers: JSON.stringify(a),
      };
      postAnswers(json, config, exam_details);
    })
    .catch((e) => {
      alert("No answers to submit");
    });
}

/**
 * Gets a json representation of answers
 * @return {JSON} - answers
 */
export function getJsonAnswers(exam_details, db) {
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
export function postAnswers(ans, config, exam_details) {
  $("#progress").html("Submitting answers...");

  $.post(config.exam_submit_url, ans, null, "json")
    .done((data) => {
      console.log("returned data", data);
      if (data.success) {
        $("#submit-error-overlay").remove();
        if (data.question_count == window.number_of_questions) {
          let ret = confirm(
            `${data.question_count} answers sucessfully submitted. Click OK to finish the exam.`
          );

          if (ret) {
            window.review = true;
            window.saveSession();
            if (config.exam_results_url != "") {
              let url = config.exam_results_url;

              if (exam_details.cid != "") {
                url = url + exam_details.cid;
              }
              $("#options-link")
                .empty()
                .append(
                  `<a href="${url}" target="_blank"><div class="packet-button">Results and answers</div></a>`
                );
            }
            $("#options-panel").show();
          } else {
          }
        } else {
          alert(`${data.question_count} answers sucessfully submitted.`);
        }
      } else {
        submissionError(data, ans);
      }
    })
    .fail((e) => {
      // Will occur with server error such as 500
      console.log("error", e);
      submissionError(e, ans);
    });
  // $.post( "http://localhost:8000/submit_answers", JSON.stringify(ans));
}

function submissionError(data, ans) {
  // error will not be defined with server errors
  if (data.error != undefined) {
    alert(`Error submitting answers: ${data.error}`);
  } else {
    alert(`Error submitting answers`);
  }
  var docHeight = $(document).height();

  $("body").append(
    `<div id='submit-error-overlay'><span style='color: white'><p>An error has occured when submit your answers. A copy of your answers are displayed below, you may wish to save a copy. Please try submitting again or refresh this page to continue.</p>${JSON.stringify(
      ans
    )}</span></div>`
  );

  $("#nav-submit-button").prependTo("#submit-error-overlay");

  $("#submit-error-overlay").height(docHeight).css({
    opacity: 0.9,
    position: "absolute",
    top: 0,
    left: 0,
    "background-color": "black",
    width: "100%",
    "user-select": "text",
    "-moz-user-select": "text",
    "-webkit-user-select": "text",
    "z-index": 5000,
  });
}

export function getQuestion(url, question_number, question_total) {
  console.log("Downloading question ", url, question_number, question_total);
  return $.ajax({
    dataType: "json",
    url: url,
    progress: function (e) {
      $("#progress").html(
        `Downloading question [${question_number}/${question_total}]<br/>This file is compressed (no size available)`
      );
      if (e.lengthComputable) {
        var completedPercentage = Math.round((e.loaded * 100) / e.total);

        $("#progress").html(
          `Downloading question [${question_number}/${question_total}]<br/>${completedPercentage}%<br/>${helper.formatBytes(
            e.total
          )}`
        );
      }
    },
    error: (jqXHR, textStatus, errorThrown) => {
      console.log("error downlading", jqXHR, textStatus, errorThrown);
    },
    //success: function (data) {
    //  strReturn = data;
    //},
    //async: false,
  });
}
