/**
 * Submits answers
 */
export function submitAnswers(window, db) {
  console.log(
    getJsonAnswers(window, db).then((a) => {
      postAnswers(a);
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
  $("#progress").html(`Submitting answers...`);
  // ans = {"test" : 1}
  $.post(window.config.exam_submit_url, JSON.stringify(ans)).done((data) => {
    console.log(data);
    if (data.success) {
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
      alert(`Error submitting answers: ${data.error}`);
  var docHeight = $(document).height();

    $("body").append(`<div id='overlay'><span style='color: yellow'><p>A copy of your answers are displayed below. Please refresh this page to continue.</p>${JSON.stringify(ans)}</span></div>`);

    $("#overlay")
        .height(docHeight)
        .css({
          'opacity' : 0.4,
          'position': 'absolute',
          'top': 0,
          'left': 0,
          'background-color': 'black',
          'width': '100%',
          'z-index': 5000
        });
      }
    });
    // $.post( "http://localhost:8000/submit_answers", JSON.stringify(ans));
}
