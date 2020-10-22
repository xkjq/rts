
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