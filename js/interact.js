
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
  console.log(ans);
  // ans = {"test" : 1}
  $.post("http://localhost:8000/submit_answers", JSON.stringify(ans)).done(
    (data) => {
      console.log(data);
    }
  );
  // $.post( "http://localhost:8000/submit_answers", JSON.stringify(ans));
}