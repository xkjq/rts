
/**
 * Submits answers
 */
function submitAnswers() {
  console.log(
    getJsonAnswers().then((a) => {
      postAnswers(a);
    })
  );
}

/**
 * Posts answers to url
 * @param {*} ans - json representation of answers
 */
function postAnswers(ans) {
  $("#progress").html(`Submitting answers...`);
  // ans = {"test" : 1}
  $.post(window.config.exam_submit_url, JSON.stringify(ans)).done(
    (data) => {
    console.log(data)
    if (data.success) {
      alert("Answers sucessfully submitted.");
    } else {
      alert(`Error submitting answers: ${data.error}`);
    }
    });
  // $.post( "http://localhost:8000/submit_answers", JSON.stringify(ans));
}