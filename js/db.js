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
