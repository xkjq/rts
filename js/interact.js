import * as helper from "./helpers.js";
/**
 * Submits answers
 */
export function submitAnswers(window, db) {
  console.log(
    getJsonAnswers(window, db).then((a) => {
      let json = {
        eid: window.eid,
        answers: JSON.stringify(a),
      };
      postAnswers(json);
    })
  );
}

/**
 * Gets a json representation of answers
 * @return {JSON} - answers
 */
export function getJsonAnswers(window, db) {
  const cid = window.cid;
  const eid = window.eid;
  return db.answers.where({ aid: aid, cid: cid, eid: eid }).toArray();
  // .then(function(ans) {
  // console.log(ans);
  // submitAnswers(ans);
  // });
}

/**
 * Posts answers to url
 * @param {*} ans - json representation of answers
 */
export function postAnswers(ans) {
  $("#progress").html("Submitting answers...");
  // ans = {"test" : 1}
  console.log(ans);
  $.post(window.config.exam_submit_url, ans, null, "json")
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

              if (window.cid != "") {
                url = url + window.cid;
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

// TODO: async request
export function getQuestion(url, question_number, question_total) {
  console.log("Downloading ", url, question_number, question_total);
  return $.ajax({
    dataType: "json",
    url: url,
    progress: function (e) {
      console.log(e);
      if (e.lengthComputable) {
        var completedPercentage = Math.round((e.loaded * 100) / e.total);

        $("#progress").html(
          `Downloading [${question_number}/${question_total}]${completedPercentage}%<br/>${helper.formatBytes(
            e.total
          )}`
        );
      }
    },
    //success: function (data) {
    //  strReturn = data;
    //},
    //async: false,
  });

}
