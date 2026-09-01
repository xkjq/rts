/* global Dexie */

// Set up database
export const db = new Dexie("answers_database");
db.version(1).stores({
  answers: "[aid+cid+eid+qid+qidn], [aid+cid+eid], qid, ans, eid",
  flags: "[aid+cid+eid+qid+qidn], [aid+cid+eid], qid",
  user_answers: "[qid+type+ans], [qid+type]",
  session: "[eid+aid], eid, packet, aid, status, date, score, max_score, exam_time, time_left, question_order, questions_answered, total_questions",
});

export const question_db = new Dexie("question_database");
question_db.version(1).stores({
  question_data: "&[qid+type], qid, type",
  saved_exams: "&eid, type, exam_mode, name, order, time, exam_json_id",
});

// When another tab deletes or upgrades one of these databases, IndexedDB
// closes this tab's connection. Rather than leaving the tab running on a
// closed connection (spamming DatabaseClosedError), reload the page so it
// reopens/recreates the database cleanly.
function reloadOnDatabaseVersionChange() {
  if (typeof location !== "undefined" && typeof location.reload === "function") {
    location.reload();
  }
}

if (typeof db.on === "function") {
  db.on("versionchange", reloadOnDatabaseVersionChange);
}
if (typeof question_db.on === "function") {
  question_db.on("versionchange", reloadOnDatabaseVersionChange);
}
