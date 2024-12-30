/* global Dexie, cornerstone, cornerstoneTools, cornerstoneBase64ImageLoader, cornerstoneWebImageLoader, cornerstoneWADOImageLoader */
import * as helper from "./helpers.js";
import * as viewer from "./viewer.js";
import * as interact from "./interact.js";
import * as config from "./config.js";
// const { v4: uuidv4 } = require('uuid');

log.setDefaultLevel("warn")
log.setDefaultLevel("debug")


let URLS = {};

let standalone = false;

if (config.standalone != "" && config.standalone != undefined) {
  standalone = config.standalone
}

let allow_users = false;

if (config.allow_users != "" && config.allow_users != undefined) {
  allow_users = config.allow_users
}



// Generate urls base on base_url
if (config.base_url != "" && config.base_url != undefined) {
  URLS.base_url = config.base_url;
  URLS.exam_query_url = config.base_url + "exam/json";
  URLS.exam_submit_url = config.base_url + "exam/submit";
  URLS.exam_results_url = config.base_url + "cid/";
  URLS.exam_user_results_url = config.base_url + "user/scores";
  URLS.question_feedback_url = config.base_url + "feedback/";
  URLS.question_answer_submit_url = config.base_url + "feedback/answer";
  URLS.login_url = config.base_url + "accounts/login/?next=/rts";
  URLS.logout_url = config.base_url + "accounts/logout/?next=/rts";
}

// Override individual urls
let urls_to_check = ["exam_query_url",  "exam_submit_url", 
  "exam_results_url", "question_feedback_url", 
  "question_answer_submit_url", "login_url", "logout_url"]

for (let url of urls_to_check) {
  if (config[url] != "" && config[url] != undefined) {
    URLS[url] = config[url];
  }
}

log.debug("URLS")
log.debug(URLS)


let exam_details = {
  aid: null,
  cid: "",
  eid: 5678,
  passcode: "abc",
  exam_mode: false,
  number_of_questions: null,
  question_order: [],
  start_time: null,
};

//let packet_list = [];
let packet_name = null;
let questions = null;
let questions_correct = {};
let question_type = null;
let loaded_question = null;
let review_mode = false;
let exam_time = null;
let packet_time = null;
let date_started = null;
let score = 0;
let packet_json_id = null;

let global_cid = null;
let global_passcode = null;
let global_uid = null;
let global_username = null;

let allow_self_marking = true;

let timer = null;

let use_local_question_cache = false;



cornerstone.imageCache.setMaximumSizeBytes(5128800);

// Set up cornerstone (the dicom viewer)
cornerstoneBase64ImageLoader.external.cornerstone = cornerstone;
cornerstoneWebImageLoader.external.cornerstone = cornerstone;
// cornerstoneWebImageLoader.configure({
//  beforeSend: function(xhr) {
//    // Add custom headers here (e.g. auth tokens)
//    //xhr.setRequestHeader('x-auth-token', 'my auth token');
//  }
// });

cornerstoneWADOImageLoader.external.cornerstone = cornerstone;

// cornerstoneWADOImageLoader.configure({
//  beforeSend: function(xhr) {
//    // Add custom headers here (e.g. auth tokens)
//    //xhr.setRequestHeader('APIKEY', 'my auth token');
//  }
// });

cornerstoneTools.init();

// Set up database
const db = new Dexie("answers_database");
db.version(1).stores({
  answers: "[aid+cid+eid+qid+qidn], [aid+cid+eid], qid, ans, eid",
  flags: "[aid+cid+eid+qid+qidn], [aid+cid+eid], qid",
  user_answers: "[qid+type+ans], [qid+type]",
  session: "[eid+aid], eid, packet, aid, status, date, score, max_score, exam_time, time_left, question_order, questions_answered, total_questions",
});

const question_db = new Dexie("question_database");
question_db.version(1).stores({
  question_data: "&[qid+type], qid, type",
  saved_exams: "&eid, type, exam_mode, name, order, time, exam_json_id",
});

retrievePacketList();

if (!allow_users) {
  $("#user-details").hide()
}

try {
  refreshDatabaseSettings();
}
catch {
  log.warn("unable to check database settings")
}

/**
 * Retrieves a list of available packets via JSON ajax requests
 * Will initially try /packets/ (for example if index.php generates the list)
 * and then fallback to packets.json
 *
 * if exam_query_url is defined in config.js this will be used in preference
 */
async function retrievePacketList() {
  let url = "packets/packets.json";

  log.debug(`Load users from database...`)
  //let users = await user_db.user.toArray();
  //log.debug(`available users "${users}"`)
  let cid = localStorage.getItem("cid.cid")
  let passcode = localStorage.getItem("cid.passcode")

  if (cid != null && passcode != null) {
    global_cid = cid;
    global_passcode = passcode;

    let logout = $("<span>[x]</span>")
    logout.click(() => {
      localStorage.removeItem("cid.cid");
      localStorage.removeItem("cid.passcode");
      window.location = window.location.pathname;
    })

    console.debug("global_cid", global_cid)
    console.debug("cid", cid)

    if (URLS.exam_results_url != "" && URLS.exam_results_url != undefined) {
      let url = `${URLS.exam_results_url}${global_cid}/${global_passcode}`;
      log.debug(`Setting exam results url to ${url}`);

      $("#options-link")
        .empty()
        .append(
          `<a href="${url}" target="_blank"><div class="packet-button">Results and answers</div></a>`
        );
    } else {
      log.debug("No exams results url set in config.");
    }

    $("#candidate-details").append(`Current: CID ${global_cid} / Passcode ${global_passcode} `).append(logout);
  } else {

    log.debug("Try and set CID / Passcode from current URL")
    let items = window.location.search.substr(1).split("&");
    if (items.length == 2) {
      for (let index = 0; index < items.length; index++) {
        const item = items[index];
        let s = item.split("=");

        if (s[0] == "cid") {
          cid = s[1];
        }
        if (s[0] == "passcode") {
          passcode = s[1];
        }

      };
      log.debug("CID and passcode extracted from URL", cid, passcode)
      log.debug("adding to local db")
      localStorage.setItem("cid.cid", cid)
      localStorage.setItem("cid.passcode", passcode)
      log.debug("reload page")
      location.reload();
    }

  }

  try {
    log.debug("Try to set exam query url")
    if (URLS.exam_query_url != undefined) {

      if (global_cid == null) {
        url = URLS.exam_query_url;
      } else {
        url = `${URLS.exam_query_url}/${global_cid}/${global_passcode}`;
      }
    }
    log.debug(`url: ${url}`)
  } catch (e) {
    log.debug("Unable to set exam query url", e)
    log.debug("this will default to packets/packets.json")
  }

  $.ajax({
    dataType: "json",
    cache: false,
    url: url,
    success: function(data) {
      if (data.hasOwnProperty("exams")) {
        loadExamList(data);
      } else {
        loadPacketList(data);
      }
    },
    error: function(httpObj, textStatus) {
      console.debug(httpObj);
      if (httpObj.status == 401 || httpObj.status == 404) {
        $.notify("Unable to login", "error");
        $("#options-panel").show();
        $("#candidate-details").addClass("invalid-login");
      }
    },
  })
    .done(function() {})
    .fail(function() {
      log.debug("Unable to load packets / exams, try loading '/packets' (legacy)")
      $.getJSON("packets", function(data) {
        if (data.hasOwnProperty("exams")) {
          loadExamList(data);
        } else {
          loadPacketList(data);
        }
      }).fail(function(jqXHR, textStatus, errorThrown) {
        console.warn("No packet list available");
      });
    })
    .always(function() {});
}

/**
 * Generate a list of exams that are available to be loaded
 * this is based on the subsequent function but gives less options
 *
 * @param {JSON} data - json containing available exams
 */
async function loadExamList(data) {
  log.debug(`Load exam list: ${data}`)
  log.debug("Loading saved sessions")
  let sessions = await db.session.toArray().catch(function(error) {
    log.debug("Error loading session", error);
    $("#database-error").text(
      "Error loading the database, schema has probably changed and needs updating. You will probably need to delete the local database."
    );
    let delete_button = $("<button>Delete local database</button>").click(
      () => {
        window.indexedDB.deleteDatabase("answers_database");
        location.reload();
      }
    );
    $("#database-error").append(delete_button);
    $("#database-error").show();
  });
  log.debug(sessions)

  //Display user info if it exists
  // If a user is loggged into the server it any exam responses
  // should have the details embedded
  if (data.hasOwnProperty("user") && data.user) {
    $("#user").append(`User: ${data.user}`);
    //$(".exam-wrapper").show();
    global_uid = data.user_id;
    global_username = data.user;


    if (global_cid == null) {
      global_cid = "u-" + global_uid;
    }

    $("#btn-user-login").hide();

    let logout = $("<span>[x]</span>")
    logout.click(() => {
      localStorage.removeItem("cid.cid");
      localStorage.removeItem("cid.passcode");
      window.location = URLS.logout_url;
    })
    $("#user").append(logout);
  }


  let exams_started = [];
  let exams_completed = [];
  log.debug("Check status of saved exams")
  for (const s of sessions) {
    log.debug(`checking status of`, s)
    if (s.status == "active") {
      exams_started.push(s.packet);
    } else {
      exams_completed.push(s.packet);
    }
  };

  // Wouldn't we be better terminating ealier in this situation
  let exam_list = [];
  if (data != null) {
    exam_list = data.exams;
  }

  // exam_generated_map stores the exam and its json ID to
  // enable invalidation when the question is updated on the server
  let exam_generated_map = {};
  $("#packet-list").empty();
  
  log.debug("Loop available exams")
  for (const exam of exam_list) {
    log.debug(exam)
    const name = exam["name"];
    const url = exam["url"];
    const eid = exam["eid"];
    const exam_json_id = exam["exam_json_id"];

    let question_json_id_hash = {};

    // In the case of multiquestion exams (longs) we 
    // check each question json_id in addition
    if (exam.hasOwnProperty("multi_question_json")) {
      question_json_id_hash = exam["multi_question_json"];
    }
    exam_generated_map[eid] = [exam_json_id, question_json_id_hash];

    // The exam against stored session data
    let item_class = "";
    if (exams_started.indexOf(name) > -1) {
      item_class = " session-started";
    }
    if (exams_completed.indexOf(name) > -1) {
      item_class = " session-completed";
    }

    if (!exam.exam_active) {
      item_class = item_class + " inactive";
    }

    // Place the exam under the relavant subheading
    // by defailt they will be under the packet section
    let target_list = "packet-list";
    // if in exam mode we place them under the exam section
    if (exam.exam_mode) {
      target_list = "exam-list";
    }

    let list;
    if (exam.type != undefined) {
      // If the relevant subheading exists target_it it
      if ($(`.${target_list}.${exam.type}`).length) {
        list = $(`.${target_list}.${exam.type}`);
      // or create and add it
      } else {
        list = $(`<div class='${target_list} ${exam.type}'><span class='packet-list-title'>${exam.type}</span><br/></div>`);
        $(`#${target_list}`).append(list);

      }
    // if the packet / exam type is not defined just add it at the bottom
    // TODO: do we actually want this?
    } else {
      list = $("#packet-list");
    }

    // Add the button that is used to load the packet/exam
    $(list).append(
      $(
        `<div class='packet-button${item_class}' data-eid='${eid}' title='Load packet'></div>`
      )
        .text(name)
        .click(function() {
          loadPacketFromAjax(url, eid, exam_json_id);
        })
    );
  }


  // Check the database for exams that have been saved
  question_db.saved_exams.toArray().then((saved_exams) => {
    if (saved_exams.length < 1) {
      $("#cache-details summary").append("<span>No cached exams / questions</span>");
    } else {
      $("#cache-details summary").append("<span>Cached exams / questions:</span>");
    }
    console.debug("Loop through saved exams");
    saved_exams.forEach(async (saved_exam, n) => {
      console.debug("Check", saved_exam);
      $("#cache-details ul").append(
        `<li class="cache-item" data-eid=${saved_exam.eid}>Exam: ${saved_exam.exam_name} [${saved_exam.eid}]: ${saved_exam.exam_json_id}`
      );
      //Compared saved exams to those available
      if (exam_generated_map.hasOwnProperty(saved_exam.eid)) {
        // If the json_id s differ delete and force a refresh
        const exam_json_id = exam_generated_map[saved_exam.eid][0];
        const question_json_id_hash = exam_generated_map[saved_exam.eid][1];

        if (saved_exam.exam_json_id != exam_json_id) {
          console.debug("id mismath", saved_exam.exam_json_id, exam_json_id);
          question_db.saved_exams.where("eid").equals(saved_exam.eid).delete();
          db.answers.where("eid").equals(saved_exam.eid).delete();

          console.debug("HOL");
          $(`li.cache-item[data-eid="${saved_exam.eid}"]`)
            .addClass("cache-out-of-date")
            .append(` [out of date (latest: ${exam_json_id})]`);
        } else {
          console.debug("id match", saved_exam.exam_json_id, exam_json_id);
          $(`.packet-button[data-eid="${saved_exam.eid}"]`).addClass("cached");
        }

        console.debug("Check question ids")
        for (let q in question_json_id_hash) {
          let new_question_json_id = question_json_id_hash[q];
          console.debug("new question json id", new_question_json_id)
          //q = q.toString();
          $("#cache-details ul").append(
            `<li class="cache-item" data-qid=${q}>Question (${saved_exam.exam_type}): ${q} [New JSON id: ${new_question_json_id}]`
          );
          // If a single question is out of date we invalidate the lot...
          const q_object = {
            qid: String(q),
            type: saved_exam.exam_type
          };
          console.debug(q_object);

          let save_question_data = await question_db.question_data.get(q_object);

          try {
            console.debug("saved question data", save_question_data, new_question_json_id)
            // saved_question_data is undefined if the question is not saved
            // we should really just requeue the required question for dowload...
            if (save_question_data == undefined || save_question_data.data.question_json_id != new_question_json_id) {
              console.debug(`INVALIDATE eid: ${saved_exam.eid}, q ${q}`);
              $(`li.cache-item[data-eid="${saved_exam.eid}"]`).addClass(
                "cache-out-of-date"
              );
              $(`li.cache-item[data-qid="${q}"]`).addClass(
                "cache-out-of-date"
              );
              $(`.packet-button[data-eid="${saved_exam.eid}"]`).addClass(
                "out-of-date"
              );
              // Invalidate associated exam
              question_db.saved_exams.where("eid").equals(saved_exam.eid).delete();

              // Invalidate and any associated answers

              db.answers.where("eid").equals(saved_exam.eid).delete();

              //question_db.saved_exams.where("eid").equals(saved_exam.eid).delete();
              question_db.question_data
                .where(["qid", "type"])
                .equals([String(q), saved_exam.exam_type])
                .delete();
            }
          } catch (e) {
            console.debug("Error loading qusetion data", q_object);
            console.debug(e);
            console.debug("1234", saved_exam.eid);
            // If the question isn't found in the cache...
            $(`li.cache-item[data-eid="${saved_exam.eid}"]`).addClass(
              "cache-out-of-date"
            );
            $(`li.cache-item[data-qid="${q}"]`)
              .addClass("cache-out-of-date")
              .append("[Not found]");
            $(`.packet-button[data-eid="${saved_exam.eid}"]`).addClass(
              "out-of-date"
            );

            //question_db.saved_exams.where("eid").equals(saved_exam.eid).delete();
            question_db.question_data
              .where(["qid", "type"])
              .equals([String(q), saved_exam.exam_type])
              .delete();
          }
        }
      }
    });
  });

  // Sort different lists
  $(".packet-list.rapid div")
    .sort(function(a, b) {
      return a.dataset.eid > b.dataset.eid ?
        1 :
        a.dataset.eid < b.dataset.eid ?
          -1 :
          0;
    })
    .appendTo(".packet-list.rapid");
  $(".packet-list.anatomy div")
    .sort(function(a, b) {
      return a.dataset.eid > b.dataset.eid ?
        1 :
        a.dataset.eid < b.dataset.eid ?
          -1 :
          0;
    })
    .appendTo(".packet-list.anatomy");
  $(".packet-list.long div")
    .sort(function(a, b) {
      return a.dataset.eid > b.dataset.eid ?
        1 :
        a.dataset.eid < b.dataset.eid ?
          -1 :
          0;
    })
    .appendTo(".packet-list.long");

  $("#options-panel").show();
}

/**
 * Generate a list of the packets that are available to be loaded
 *
 * @param {JSON} data - json containing available packets
 */
// TODO: remove (data formats should be switched to the exam format)
async function loadPacketList(data) {
  // NOTE: currently the packet id is not available prior ot downloading the packet
  // this severly limits what we can do with it (but to require would limit the utility)
  log.debug(`loadPacketList`);
  log.debug("Loading saved sessions")
  let sessions = await db.session.toArray().catch(function(error) {
    log.debug(`Error loading session ${error}`);
    $("#database-error").text(
      "Error loading the database, schema has probably changed and needs updating. You will probably need to delete the local database."
    );
    let delete_button = $("<button>Delete local database</button>").click(
      () => {
        window.indexedDB.deleteDatabase("answers_database");
        location.reload();
      }
    );
    $("#database-error").append(delete_button);
    $("#database-error").show();
  });
  log.debug(sessions)
  // db.session
  //   .where("packet")
  //   .equals()
  let packets_started = [];
  let packets_completed = [];
  log.debug("Check status of saved packets")
  sessions.forEach((s) => {
    log.debug(`checking status of`, s)
    if (s.status == "active") {
      packets_started.push(s.packet);
    } else {
      packets_completed.push(s.packet);
    }
  });

  log.debug("Packets started")
  log.debug(packets_started)
  log.debug("Packets completed")
  log.debug(packets_completed)

  let packet_list = [];
  if (data != null) {
    packet_list = data.packets;
  } else {
    log.debug("data == null")
  }

  log.debug(packet_list)
  $("#packet-list").empty();

  //if (packet_json_id == undefined) {
  //  $("#options-panel").show();
  //  return
  //}




  packet_list.forEach(function(packet) {
    // Seperate packet types
    let list;
    if (packet.type != undefined) {
      if ($(`#packet-list .${packet.type}`)) {
        list = $(`#packet-list .${packet.type}`);
      } else {
        list = $(
          `<div class='packet-list ${packet.type}'>${packet.type}<br/></div>`
        );
        $("#packet-list").append(list);
      }
    } else {
      list = $("#packet-list");
    }

    let c = "";
    if (packets_started.indexOf(packet) > -1) {
      c = " session-started";
    }
    if (packets_completed.indexOf(packet) > -1) {
      c = " session-completed";
    }
    list.append(
      $(`<div class='packet-button${c}' title='Load packet'></div>`)
        .text(packet)
        .click(function() {
          loadPacketFromAjax("packets/" + packet, packet);
        })
        .append(
          $(
            `<div class='save-button' title='Download packet for offline use (or to save bandwidth)'><a href='packets/${packet}' download='${packet}'>💾</a></div>`
          ).click(function(evt) {
            //console.debug("packets/" + packet);
            evt.stopPropagation();
          })
        )
    );
  });
  $("#options-panel").show();
}

/**
 * Loads the requisite packet into the quiz system
 * @param {string} path - relative path to the packet json file
 */
function loadPacketFromAjax(path, eid, exam_json_id) {
  if (eid != undefined) {
    // try and load the exam from the local indexedDB
    question_db.saved_exams
      .get(eid)
      .then((exam) => {
        if (exam == undefined || (exam["exam_json_id"] != exam_json_id)) {
          console.debug("AjaxRequestPacket:", eid);
          ajaxRequestionPacket(true);
        } else {
          // We have an up to date exam in the database
          // TODO: check the questions are valid
          console.debug("LoadLocalPacket:", eid);
          use_local_question_cache = true;
          setUpPacket(exam, path);
          $("#options-panel").hide();
        }
      })
      .catch(function(error) {
        // Will be triggered if eid does not exist in database
        console.debug("Unable to load exam:", eid);
        console.debug("error-", error);
        console.debug("Exam will be downloaded");
        ajaxRequestionPacket();
      });

    return;
  }

  function ajaxRequestionPacket(force_refresh) {
    //console.debug("loading packet from " + path);
    // TODO: check where path comes from ??????
    $("#progress").html(`Requesting packet: ${path}`);

    let browser_cache = true;
    if (force_refresh) {
      browser_cache = false;
    }

    $.ajax({
      dataType: "json",
      url: path,
      cache: browser_cache,
      progress: function(e) {
        if (e.lengthComputable) {
          var completedPercentage = Math.round((e.loaded * 100) / e.total);

          $("#progress").html(
            `${completedPercentage}%<br/>${helper.formatBytes(e.total)}`
          );
        }
      },
    })
      .done(function(data) {
        setUpPacket(data, path);
        $("#options-panel").hide();
      })
      .fail(function() {
        console.debug("Unable to load packet at: " + path);
      });
  }
}

/**
 * Parse the packet and extract metadata (if it exists)
 * Will then call setUpQuestions() to load the packet
 * @param {JSON} data
 */
function setUpPacket(data, path) {
  packet_name = path;
  // Load the exam name from the json packet (if it exists)
  if (data.hasOwnProperty("exam_name")) {
    packet_name = data.exam_name;
  }
  $(".exam-name").text("Exam: " + packet_name);

  if (data.hasOwnProperty("eid")) {
    exam_details.eid = data.eid;
  } else {
    exam_details.eid = packet_name
  }

  if (data.hasOwnProperty("exam_type")) {
    question_type = data.exam_type;
  }

  if (data.hasOwnProperty("exam_json_id")) {
    packet_json_id = data.exam_json_id;
  }

  if (data.hasOwnProperty("exam_mode")) {
    exam_details.exam_mode = data.exam_mode;
  }

  if (data.hasOwnProperty("questions")) {
    questions = data.questions;
  } else {
    questions = data;
  }

  if (data.hasOwnProperty("exam_order")) {
    exam_details.question_order = data.exam_order;
  } else {
    exam_details.question_order = [];
    Object.keys(questions).forEach(function(e) {
      exam_details.question_order.push(e);

      // Make sure answers are arrays
      if (!Array.isArray(questions[e]["answers"])) {
        questions[e]["answers"] = [questions[e]["answers"]];
      }
    });

    let randomise_order = true;
    if (config.randomise_order != undefined) {
      randomise_order = config.randomise_order;
    }
    if (randomise_order) {
      exam_details.question_order = helper.shuffleArray(
        exam_details.question_order
      );
    }
    // We add this here so the question order is maintained
    // when loading from cache
    data["exam_order"] = exam_details.question_order;
  }

  if (data.hasOwnProperty("exam_time")) {
    exam_time = data.exam_time;
    // packet time is the time specificed by the packet
    packet_time = data.exam_time;
  }

  //if (use_local_question_cache && force_question_refresh.length < 1) {
  //  // If loading form cache nothing else to do here
  //  loadSession();
  //  return;
  //}

  if (!use_local_question_cache) {
    // Save the details to the question database
    var clone_data = Object.assign({}, data, {
      questions: "cached"
    });
    console.debug(clone_data)
    //clone_data["cached_questions"] = Object.keys(data["questions"]);
    question_db.saved_exams.put(clone_data);
  }

  // If question_requests is set we need to do a request for each question
  if (
    data.hasOwnProperty("question_requests") &&
    Object.keys(data["question_requests"]).length > 0
  ) {
    // Will happen if loading from cache
    //if (data["questions"] == "cached") {
    //  let a = {};
    //  data["cached_questions"].forEach((q, n) => {
    //    let s = JSON.stringify()
    //    if (force_question_refresh.includes(s)) {
    //    a[q] = 1;
    //    }
    //  });
    //  data["questions"] = a;
    //}
    let question_total = Object.keys(data["question_requests"]).length;
    let question_number = 0;

    var requests = [];
    var request_numbers = [];

    // For loop to generate requests
    (async () => {
      for (let n in data["question_requests"]) {
        question_number++;
        n = String(n);

        let obj = {
          qid: n,
          type: question_type
        };
        let question_in_db = await question_db.question_data.get(obj);

        // If the question is in the db we can load
        // invalid questions should have already been removed
        if (question_in_db != undefined) {
          continue;
        }

        const question_url = `${path}/question/${n}`;

        //console.debug("Creating ", question_url, question_number, question_total);
        //$("#progress").html(`Downloading [${question_number}/${question_total}]`);
        let question_json = {};
        question_json = await interact
          .getQuestion(question_url, question_number, question_total)
          .fail((jqXHR, textStatus, errorThrown) => {
            //console.debug(jqXHR, textStatus, errorThrown);
            console.debug(`error loading question: ${n}`);
            //data["questions"][n] = {};
          });

        if (question_json.hasOwnProperty("cached") && question_json["cached"]) {
          console.debug("loading cached packet");
        }

        if (
          question_json.hasOwnProperty("images_json") &&
          question_json["images_json"]
        ) {}

        //requests.push(request)
        //request_numbers.push(n)

        // Using indexed db means that we can avoid loading all data into memory
        //data["questions"][n] = question_json;

        // Store question data into dexie
        let d = {
          //eid: exam_details.eid,
          qid: n,
          data: question_json,
          type: question_json.type,
        };

        question_db.question_data.put(d);
      }
      // Once all questions have been downloaded we carry on loading
      use_local_question_cache = true;
      loadSession();
    })().catch((error) => {
      alert("Error downloading, try refreshing");
      console.debug(error);
    });
  } else {
    // Just carry on loading
    loadSession();
  }
}

function loadSession() {
  console.debug("load session", exam_details, db.session);
  // Either continue session or create a new one
  db.session
    // .where("status")
    // .equals("active")
    .where("[eid+aid]")
    .between([exam_details.eid, Dexie.minKey], [exam_details.eid, Dexie.maxKey])
    .toArray()
    .then((sessions) => {
      //console.debug("sessions", sessions);

      // let active_sessions = [];

      // sessions.forEach((s) => {
      //   if (s.status == "active") {
      //     active_sessions.push(s);
      //   }
      // });

      let load_previous = false;

      // Start new session if no session found
      if (sessions.length < 1) {
        exam_details.aid = uuidv4();
        date_started = Date.now();
      } else {
        let text = "Select session to continue (leave blank to create new):";
        if (exam_details.exam_mode) {
          text = "Session will be continued";
        }
        //console.debug(sessions.date);

        for (let i = 0; i < sessions.length; i++) {
          let d = new Date(sessions[i].date);
          let formatted_date =
            d.getFullYear() +
            "-" +
            (d.getMonth() + 1) +
            "-" +
            d.getDate() +
            " " +
            d.getHours() +
            ":" +
            d.getMinutes() +
            ":" +
            d.getSeconds();

          if (sessions[i].status == "active") {
            text = text + `\r${i}: ${formatted_date} [In progress]`;
          } else {
            if (!exam_details.exam_mode) {
              text =
                text +
                `\r${i}: ${formatted_date} [Complete - score ${sessions[i].score}/${sessions[i].max_score}]`;
            } else {
              text =
                text +
                `\r${i}: ${formatted_date} [Complete]`;
            }
          }
        }

        // If in exam mode we don't want to allow multiple sessions
        let s;
        if (exam_details.exam_mode) {
          s = "0";
          alert(text);
        } else {
          s = prompt(text, "0");
        }

        if (s != null && s != "") {
          load_previous = true;

          exam_details.aid = sessions[parseInt(s)].aid;
          exam_details.cid = sessions[parseInt(s)].cid;
          date_started = sessions[parseInt(s)].date;

          let time_left = sessions[parseInt(s)].time_left;

          exam_time = time_left;

          exam_details.question_order = sessions[parseInt(s)].question_order;

          if (sessions[parseInt(s)].status == "complete") {
            review_mode = true;
          }
        } else {
          // If cancel is pressed or input is blank
          exam_details.aid = uuidv4();
          date_started = Date.now();
          //console.debug("new date", date_started);
        }
      }

      setUpQuestions(load_previous);
    });
}

/**
 * Build the currently loaded quiz
 */
function setUpQuestions(load_previous) {
  if (questions == undefined) {
    //return;
  } else {
    if (!use_local_question_cache) {
      Object.keys(questions).forEach(function(e) {
        // Store question data into dexie
        let d = {
          //eid: exam_details.eid,
          qid: String(e),
          type: questions[e].type,
          data: questions[e],
          //timestamp: questions[e]["exam_json_id"],
        };

        question_db.question_data.put(d);
      });
    }

    // Set an order for the questions
    if (!load_previous) {}
  }
  exam_details.number_of_questions = exam_details.question_order.length;
  review_mode = false;

  // Horrible way to get type of questions
  // We assume they are all of the same type....
  //question_type = questions[Object.keys(questions)[0]].type;

  if (exam_details.exam_mode) {
    $("#options-button, #btn-review-overlay").hide();
  } else {
    $(".submit-button").hide();
  }

  questions = null;

  // exam_time can be defined in packets
  if (!load_previous && exam_time == null) {
    if (question_type == "rapid") {
      exam_time = 35 * 60;
    } else if (question_type == "anatomy") {
      exam_time = 90 * 60;
    } else if (question_type == "long") {
      exam_time = 75 * 60;
    }
  }

  $(".exam-time")
    .val(exam_time / 60)
    .change(() => {
      exam_time = $(".exam-time").val() * 60;
    });

  if (exam_details.exam_mode) {
    // NOTE: changing the CID when restoring a session will not affect the time left
    //$("#candidate-number2")
    //  .val(exam_details.cid)
    //  .change(() => {
    //    exam_details.cid = parseInt($("#candidate-number2").val());
    //  });
    console.debug("OTNUHOTNU", global_cid)
    exam_details.cid = global_cid;
    $("#candidate-number2").val(global_cid)
    exam_details.passcode = global_passcode;

    if (global_uid != null) {
      $("#exam-candidate-number").append(`User: ${global_username} / ${global_uid}`);
    }
    $("#exam-candidate-number").show();

    $("#start-dialog").addClass("no-close");
    $("#start-dialog .exam-time").prop("disabled", "true");
    $("#exam-candidate-number").show();
    $(".packet-database-options").hide();
    $("#start-dialog").modal({
      closeExisting: false, // Close existing modals. Set this to false if you need to stack multiple modal instances.
      escapeClose: false, // Allows the user to close the modal by pressing `ESC`
      clickClose: false, // Allows the user to close the modal by clicking the overlay
      showClose: false,
    });
  } else {
    $("#start-dialog").modal();
  }

  loadQuestion(0, 1, true);
  createQuestionListPanel();
}

/**
 * Loads a specific question
 * @param {number} n - Question number to load
 * @param {number} section - Question section to focus
 * @param {boolean} force_reload - Force question to be reloaded if already loaded
 */
async function loadQuestion(n, section = 1, force_reload = false) {
  $("#question-loading").show();
  const aid = exam_details.aid;
  const cid = exam_details.cid;
  const eid = exam_details.eid;
  const passcode = exam_details.passcode;

  n = parseInt(n);
  //console.debug("loading question (n)", n);

  if (n == loaded_question && force_reload == false) {
    // Question already loaded
    setFocus(section);
    $("#question-loading").hide();
    return;
  }

  console.debug(exam_details, n);
  const qid = exam_details.question_order[n];

  console.debug("qid", qid)
  let q = {
    qid: String(qid),
    type: question_type
  };
  console.debug(q)
  console.debug(question_db.question_data)

  let return_data = await question_db.question_data.get(q);
  const question_data = return_data.data;
  return_data = null;

  loaded_question = n;

  // Set up question navigation
  $(".navigation[value='next']").off();
  $(".navigation[value='previous']").off();
  if (n == 0) {
    $(".navigation[value='previous']").attr("disabled", "disabled");
  } else {
    $(".navigation[value='previous']")
      .removeAttr("disabled")
      .click(function() {
        loadQuestion(n - 1);
      });
  }

  if (n == exam_details.number_of_questions - 1) {
    $(".navigation[value='next']").attr("disabled", "disabled");
  } else {
    $(".navigation[value='next']")
      .removeAttr("disabled")
      .click(function() {
        loadQuestion(n + 1);
      });
  }

  const display_n = n + 1;

  if (question_data.title) {
    $(".question .title").get(0).innerHTML =
      '<span style="font-weight:700;">' +
      display_n +
      "</span> " +
      question_data.title;
  } else {
    $(".question .title").get(0).innerHTML =
      '<span style="font-weight:700;">' + display_n + "</span>";
  }
  if (question_data.history) {
    $(".question .stem").text(question_data.history);
  } else {
    $(".question .stem").empty();
  }

  // Close any open figures
  //let el = document.getElementById("dicom-image");
  //if (el != undefined) {
  //  cornerstone.disable(el);
  //}

  // disable any further enabled elements
  let enabled_elements = cornerstone.getEnabledElements();
  for (var i = enabled_elements.length - 1; i >= 0; i--) {
    //console.debug("disable, ", enabled_elements[i]);
    cornerstone.disable(enabled_elements[i].element);
  }
  $(".canvas-panel").remove();

  cornerstone.imageCache.purgeCache();
  cornerstoneWADOImageLoader.default.wadouri.dataSetCacheManager.purge();

  // Remove feedback images
  $(".feedback-image").remove();

  // Set up thumbnails
  const thumbnails = $(".thumbs");
  // Why are we checking this?
  thumbnails.empty();

  // TODO: figure captions (need to extend base json)
  function createThumbnail(image, id, caption, thumbnails) {
    //console.debug("create thumb", image);
    // For thumbnails we only want a single image

    thumbnails.append(
      `<div class="figure" id="figure-${id}"><div class="figcaption">${caption}</div></div>`
    );

    // const thumbnail = $(".figure .thumbnail").get(id);
    // cornerstone.enable(thumbnail)
    // based_img = current_question.images[id];
    const based_img = image;

    // based (image) data url, just load the image directly
    if (based_img.startsWith("data:image/")) {
      const img = $("<img />", {
        src: based_img,
        id: "thumb-" + id,
        class: "thumbnail",
        title: "Click on the thumbnail to view and manipulate the image.",
        draggable: "false",
        style: "height: 100px;",
      });

      $("#figure-" + id).append(img);

      // otherwise try to load it as a dicom (if it starts with data)
      // or ends with dcm
    } else if (based_img.startsWith("data:") || based_img.endsWith(".dcm") || /(?:\/|^)[^.\/]+$/.test(based_img)) {
      // convert the data url to a file
      viewer
        .urltoFile(based_img, "dicom", "application/dicom")
        .then(function(dfile) {
          // load the file using cornerstoneWADO file loader
          const imageId = cornerstoneWADOImageLoader.wadouri.fileManager.add(
            dfile
          );
          const img = $("<div></div>").get(0);
          img.id = "thumb-" + id;
          img.class = "thumbnail";
          img.title = "Click on the thumbnail to view and manipulate the image.";
          img.draggable = "false";
          img.style = "height: 100px; width: 100px";
          $("#figure-" + id).append(img);
          const element = document.getElementById("thumb-" + id);
          cornerstone.enable(element);
          //cornerstone.loadImage(imageId).then(function (image) {
          cornerstone.loadAndCacheImage(imageId).then(function(image) {
            cornerstone.displayImage(element, image);
            cornerstone.resize(element);
          }); // .catch( function(error) {
        });
    } else {
      const img = $("<img />", {
        src: based_img,
        id: "thumb-" + id,
        class: "thumbnail",
        title: "Click on the thumbnail to view and manipulate the image.",
        draggable: "false",
        style: "height: 100px;",
      });

      $("#figure-" + id).append(img);
    }
  }

  question_data.images.forEach((images, n) => {
    let image;
    if (Array.isArray(images)) {
      image = images[0]; // Do we want the middle image?
    } else {
      image = images;
    }
    let caption = "...";
    if (question_data.image_titles != undefined) {
      caption = question_data.image_titles[n];
    }

    createThumbnail(image, n, caption, thumbnails);
  });

  function handleThumbnailClicks(id, thumbnail) {
    $(thumbnail).click(function(event) {
      viewer.openMainImage(question_data, event, this);
    });
  }

  $(".thumbs .figure").each((id, thumbnail) => {
    handleThumbnailClicks(id, thumbnail);
  });

  // Answer setup
  const ap = $(".answer-panel");
  ap.empty();

  switch (question_data.type) {
    case "rapid": {
      ap.append(
        '<div class="answer-item"><div class="answer-label-outer"><p class="answer-label-inner"><span class="answer-label-number">' +
        display_n +
        '.1</span><span style="flex:1">Case normal/abnormal</span><button class="flag" data-qid="' +
        n +
        '" data-qidn=1 style="margin-right:0">⚐</button></p></div><select class="rapid-option-answer" id="rapid-option" data-answer-section-qidn=1><option selected="selected" disabled="disabled" id="rapid-option-not-answered">--- Not Answered ---</option><option>Abnormal</option><option>Normal</option></select></div>'
      );
      ap.append(
        '<div class="answer-item" id="rapid-text" style="display: none;"><div class="answer-label-outer"><p class="answer-label-inner"><span class="answer-label-number">' +
        display_n +
        '.2</span><span style="flex:1">Reason</span><button class="flag" data-qid="' +
        n +
        '" data-qidn=2 style="margin-right:0">⚐</button></p></div><textarea class="long-answer" name="Reason" data-answer-section-qidn=2 style="overflow: hidden scroll; overflow-wrap: break-word;"></textarea></div>'
      );
      // Handle changing display of optional answer fields and saving of data
      $("#rapid-option").change(function(evt) {
        if (evt.target.value == "Abnormal") {
          $("#rapid-text").css("display", "block");
        } else {
          $("#rapid-text").css("display", "none");
        }

        let answer = {
          aid: aid,
          cid: cid,
          eid: eid,
          qid: qid,
          qidn: "1",
          passcode: passcode,
          ans: evt.target.value,
        };

        db.answers.put(answer);
        console.debug("Save ", answer)
        saveSession();
        updateQuestionListPanel(answer);
      });

      // Save long answers on textchange
      $(".long-answer").change(function(evt) {
        // ignore blank text and delete any stored value
        if (evt.target.value.length < 1) {
          db.answers.delete([aid, cid, eid, qid, "2"]);
          $(
            "#question-list-item-" +
            exam_details.question_order.indexOf(qid) +
            "-2"
          ).removeClass("question-saved-localdb");
          return;
        }

        let answer = {
          aid: aid,
          cid: cid,
          eid: eid,
          qid: qid,
          qidn: "2",
          passcode: passcode,
          ans: evt.target.value,
        };
        // db.answers.put({aid: [cid, eid, qidn], ans: evt.target.value});
        console.debug("Save ", answer)
        db.answers.put(answer);

        $(
          "#question-list-item-" +
          exam_details.question_order.indexOf(qid) +
          "-2"
        ).addClass("question-saved-localdb");

        saveSession();
        updateQuestionListPanel(answer);
      });

      // We chain our db requests as we can only check answers once
      // they have been loaded (should probably use then or after)

      console.debug("Load rapid answers")
      db.answers
        .get({
          aid: aid,
          cid: cid,
          eid: eid,
          qid: qid,
          passcode: passcode,
          qidn: "1"
        })
        .then(function(answer) {
          if (answer != undefined) {
            $("#rapid-option option:contains(" + answer.ans + ")").prop(
              "selected",
              true
            );
            // For some reason a change event is not fired...
            if (answer.ans == "Abnormal") {
              $("#rapid-text").css("display", "block");
            }
            $("#rapid-option-not-answered").remove();
          }
        })
        .catch(function(error) {
          console.debug("DB", cid, eid, qid);
          console.debug("error-", error);
        })
      //.then(function() {
      db.answers
        .get({
          aid: aid,
          cid: cid,
          eid: eid,
          qid: qid,
          qidn: "2",
          passcode: passcode,
        })
        .then(function(answer) {
          if (answer != undefined) {
            $(".long-answer").text(answer.ans);
          }
          markAnswer(qid, question_data, n);
        })
        .catch(function(error) {
          console.debug("error-", error);
        })
      //});

      addFlagEvents();
      loadFlagsFromDb(qid, "1");
      loadFlagsFromDb(qid, "2");

      break;
    }
    case "anatomy": {
      ap.append(
        '<div class="answer-item" id="anatomy-text"><div class="answer-label-outer"><p class="answer-label-inner"><span class="answer-label-number">' +
        display_n +
        '.1</span><span style="flex:1">' +
        question_data.question +
        '</span><button class="flag" data-qid="' +
        n +
        '" data-qidn=1 style="margin-right:0">⚐</button></p></div><textarea class="long-answer" name="Reason" data-answer-section-qidn=1 style="overflow: hidden scroll; overflow-wrap: break-word;"></textarea></div>'
      );

      $(".long-answer").change(function(evt) {
        // ignore blank text and delete any stored value
        if (evt.target.value.length < 1) {
          db.answers.delete([aid, cid, eid, qid, "1"]);
          $(
            "#question-list-item-" +
            exam_details.question_order.indexOf(qid) +
            "-1"
          ).removeClass("question-saved-localdb");
          return;
        }

        let answer = {
          aid: aid,
          cid: cid,
          eid: eid,
          qid: qid,
          qidn: "1",
          passcode: passcode,
          ans: evt.target.value,
        };
        db.answers.put(answer);

        $(
          "#question-list-item-" +
          exam_details.question_order.indexOf(qid) +
          "-1"
        ).addClass("question-saved-localdb");
        saveSession();
        updateQuestionListPanel(answer);
      });

      db.answers
        .get({
          aid: aid,
          cid: cid,
          eid: eid,
          qid: qid,
          qidn: "1"
        })
        .then(function(answer) {
          if (answer != undefined) {
            $(".long-answer").text(answer.ans);
          }
          markAnswer(qid, question_data, n);
        })
        .catch(function(error) {
          console.debug(error);
        });

      addFlagEvents();
      loadFlagsFromDb(qid, "1");

      break;
    }

    case "long": {
      ap.append(
        '<div class="answer-item"><div class="answer-label-outer"><p class="answer-label-inner"><span class="answer-label-number">' +
        display_n +
        '.1</span><span style="flex:1">Observations</span><button class="flag" data-qid="' +
        n +
        '" data-qidn=1 style="margin-right:0">⚐</button></p></div><textarea class="long-answer" data-qidn=1 data-answer-section-qidn=1 name="Observations" style="overflow-x: hidden; overflow-wrap: break-word; height: 80px;"></textarea></div>'
      );
      ap.append(
        '<div class="answer-item"><div class="answer-label-outer"><p class="answer-label-inner"><span class="answer-label-number">' +
        display_n +
        '.2</span><span style="flex:1">Interpretation</span><button class="flag" data-qid="' +
        n +
        '" data-qidn=2 style="margin-right:0">⚐</button></p></div><textarea class="long-answer" data-qidn=2 data-answer-section-qidn=2 name="Interpretation" style="overflow-x: hidden; overflow-wrap: break-word; , trueheight: 80px;"></textarea></div>'
      );
      ap.append(
        '<div class="answer-item"><div class="answer-label-outer"><p class="answer-label-inner"><span class="answer-label-number">' +
        display_n +
        '.3</span><span style="flex:1">Principal Diagnosis</span><button class="flag" data-qid="' +
        n +
        '" data-qidn=3 style="margin-right:0">⚐</button></p></div><textarea class="long-answer" data-qidn=3 data-answer-section-qidn=3 name="Principal Diagnosis" style="overflow-x: hidden; overflow-wrap: break-word; height: 80px;"></textarea></div>'
      );
      ap.append(
        '<div class="answer-item"><div class="answer-label-outer"><p class="answer-label-inner"><span class="answer-label-number">' +
        display_n +
        '.4</span><span style="flex:1">Differential Diagnosis</span><button class="flag" data-qid="' +
        n +
        '" data-qidn=4 style="margin-right:0">⚐</button></p></div><textarea class="long-answer" data-qidn=4 data-answer-section-qidn=4 name="Differential Diagnosis" style="overflow-x: hidden; overflow-wrap: break-word; height: 80px;"></textarea></div>'
      );
      ap.append(
        '<div class="answer-item"><div class="answer-label-outer"><p class="answer-label-inner"><span class="answer-label-number">' +
        display_n +
        '.5</span><span style="flex:1">Management (if appropriate)</span><button class="flag" data-qid="' +
        n +
        '" data-qidn=5 style="margin-right:0">⚐</button></p></div><textarea class="long-answer" data-qidn=5 data-answer-section-qidn=5 name="Management (if appropriate)" style="overflow-x: hidden; overflow-wrap: break-word; height: 80px;"></textarea></div>'
      );

      // Save long answers on textchange
      $(".long-answer").change(function(evt) {
        const qidn = evt.target.dataset.qidn.toString();

        // ignore blank text and delete any stored value
        if (evt.target.value.length < 1) {
          db.answers.delete([aid, cid, eid, qid, qidn]);
          $(
            "#question-list-item-" +
            exam_details.question_order.indexOf(qid) +
            "-" +
            qidn
          ).removeClass("question-saved-localdb");
          return;
        }
        const answer = {
          aid: aid,
          cid: cid,
          eid: eid,
          qid: qid,
          qidn: qidn,
          passcode: passcode,
          ans: evt.target.value,
        };

        db.answers.put(answer);

        $(
          "#question-list-item-" +
          exam_details.question_order.indexOf(qid) +
          "-" +
          qidn
        ).addClass("question-saved-localdb");
        saveSession();
        updateQuestionListPanel(answer);
      });

      // Loop through the 5 text areas and retrieve from db
      // could all be retrieved at once with an addition key index
      //

      for (let qidn_count = 1; qidn_count < 6; qidn_count++) {
        let obj = {
          aid: aid,
          cid: cid,
          eid: eid,
          qid: qid,
          qidn: qidn_count.toString(),
        };
        db.answers
          .get(obj)
          .then(function(answer) {
            if (answer != undefined) {
              $(".long-answer")
                .eq(parseInt(answer.qidn) - 1)
                .text(answer.ans);
            }
            // We only want to mark once...
            if (qidn_count == 5) {
              markAnswer(qid, question_data, n);
            }
          })
          .catch(function(error) {
            console.debug(error);
          });
      }

      addFlagEvents();
      loadFlagsFromDb(qid, "1");
      loadFlagsFromDb(qid, "2");
      loadFlagsFromDb(qid, "3");
      loadFlagsFromDb(qid, "4");
      loadFlagsFromDb(qid, "5");

      break;
    }
  }

  //rebuildQuestionListPanel();
  setTimeout(() => {
    setFocus(section);
  }, 200);
  $("#question-loading").hide();
}

/**
 * Sets the focus to the required question answer section
 * @param {number} section - section to focus
 */
function setFocus(section) {
  // Horrible (but it works)
  //setTimeout(function () {
  // In pratique it selects the end of a textarea but I'm not sure if I can be bothered...
  // Apparently I can...
  const el = $("*[data-answer-section-qidn=" + section + "]");
  // If the target is a textarea we move focus and reapply the value
  // to move the cursor to the end
  if (el.length < 1) {
    return;
  }

  if (el.get(0).type == "textarea") {
    const val = el.val();
    el.focus().val("").val(val);
    // else we just focus
  } else {
    el.focus();
  }
  //}, 200);
}

function updateQuestionListPanel(answer) {
  $(
    "#question-list-item-" +
    exam_details.question_order.indexOf(answer.qid) +
    "-" +
    answer.qidn
  ).addClass("question-saved-localdb");

  if (question_type == "rapid" && answer.qidn == "1") {
    if (answer.ans == "Abnormal") {
      $(
        "#question-list-item-" +
        exam_details.question_order.indexOf(answer.qid) +
        "-2"
      ).css("display", "block");
    } else {
      $(
        "#question-list-item-" +
        exam_details.question_order.indexOf(answer.qid) +
        "-2"
      ).css("display", "none");
    }
  }
}

function deleteQuestionListPanelFlags(answer) {
  $(
    "#question-list-item-" +
    exam_details.question_order.indexOf(answer.qid) +
    "-" +
    answer.qidn +
    " span"
  ).css("visibility", "hidden");
}

function updateQuestionListPanelFlags(answer) {
  $(
    "#question-list-item-" +
    exam_details.question_order.indexOf(answer.qid) +
    "-" +
    answer.qidn +
    " span"
  ).css("visibility", "visible");
}
/**
 * Updates the question list panel
 * Test with just a global update (may need to do these individually
 * if it gets slow...)
 */
function rebuildQuestionListPanel() {
  const aid = exam_details.aid;
  const cid = exam_details.cid;
  const eid = exam_details.eid;

  db.answers
    .where({
      aid: aid,
      cid: cid,
      eid: eid
    })
    .toArray()
    .then(function(answers) {
      // Reset all classes (of question-list-item s)
      $(".question-list-panel div")
        .slice(1)
        .attr("class", "question-list-item");

      // Loop through each saved answer
      answers.forEach(function(answer, n) {
        updateQuestionListPanel(answer);
      });
      // $(".long-answer").text(answer.ans);
    })
    .catch(function(error) {
      console.debug("error - ", error);
    });

  db.flags
    .where({
      aid: aid,
      cid: cid,
      eid: eid
    })
    .toArray()
    .then(function(answers) {
      answers.forEach(function(answer, n) {
        updateQuestionListPanelFlags(answer);
      });
      // $(".long-answer").text(answer.ans);
    })
    .catch(function(error) {
      console.debug("error - ", error);
    });

  if (review_mode == true) {
    $(".question-panel-ans").remove();
    for (const qid in questions_correct) {
      let q_no = exam_details.question_order.indexOf(qid);
      //console.debug("q", q_no, qid, questions_correct[qid]);
      let question_list_elements = $(`.question-list-item[data-qid='${q_no}']`);
      //console.debug(question_list_elements, questions_correct[qid]);
      if (questions_correct[qid]) {
        $(`.question-list-item[data-qid='${q_no}']`).append(
          "<span class='question-panel-ans question-panel-correct'>✓</span>"
        );
      } else {
        $(`.question-list-item[data-qid='${q_no}']`).append(
          "<span class='question-panel-ans question-panel-incorrect'>✘</span>"
        );
      }
    }
  }
}

/**
 * Builds the QuestionListPanel
 */
function createQuestionListPanel() {
  $(".question-list-panel").empty();
  $(".question-list-panel").append(
    '<div class="review-heading">Questions</div>'
  );

  /**
   * Appends QuestionList item
   * @param {number} n - question number
   * @param {number} qidn - question section number
   * @return {*} el - element that has been created
   */
  function appendQuestionListItem(n, qidn) {
    const qn = n - 1;
    const el = $(
      '<div id="question-list-item-' +
      qn +
      "-" +
      qidn +
      '" data-qid=' +
      qn +
      ' data-qidn="' +
      qidn +
      '" class="question-list-item">' +
      n +
      "." +
      qidn +
      '<span class="question-list-flag">⚑</span></div>'
    );
    $(".question-list-panel").append(el);
    // return the new element so it can be hidden if necessary
    return el;
  }

  if (question_type == "rapid") {
    // Loop through all questions and append list items
    for (let n = 1; n < exam_details.number_of_questions + 1; n++) {
      appendQuestionListItem(n, "1");
      appendQuestionListItem(n, "2").hide();
    }
  } else if (question_type == "anatomy") {
    for (let n = 1; n < exam_details.number_of_questions + 1; n++) {
      appendQuestionListItem(n, "1");
    }
  } else if (question_type == "long") {
    for (let n = 1; n < exam_details.number_of_questions + 1; n++) {
      appendQuestionListItem(n, "1");
      appendQuestionListItem(n, "2");
      appendQuestionListItem(n, "3");
      appendQuestionListItem(n, "4");
      appendQuestionListItem(n, "5");
    }
  }

  $(".question-list-item").click(function(evt) {
    loadQuestion($(this).attr("data-qid"), $(this).attr("data-qidn"));
  });

  rebuildQuestionListPanel();
}

$("#btn-local-file-load").click(function(evt) {
  loadLocalQuestionSet();
});

$(".submit-button").click(function(evt) {
  interact.submitAnswers(exam_details, db, URLS);
});

$("#btn-review").click(function(evt) {
  $(".question-list-panel").toggle();
});

$("#options-button").click(function(evt) {
  loadPacketList(null);
  $("#options-panel").toggle();
});

$("#btn-review-overlay").click(function(evt) {
  if (review_mode == true) {
    reviewQuestions();
  } else {
    $("#finish-dialog").modal();
  }
});

$("#btn-fullscreen-overlay").click(function(evt) {
  if (document.fullscreen == false) {
    document.documentElement.requestFullscreen();
  } else {
    document.exitFullscreen();
  }
});

$("#finish-exam, #btn-time-up-review").click(function(evt) {
  review_mode = true;
  reviewQuestions();
  $.modal.close();
});

$("#btn-time-up-continue").click(function(evt) {
  $.modal.close();
});

$("#finish-cancel").click(function(evt) {
  $.modal.close();
});

$("#overlay-close").click(function(evt) {
  $("#options-panel").hide();
});

$("#review-overlay-close").click(function(evt) {
  $("#review-overlay").hide();
});

/**
 * Loads a local question set (from a file)
 * This is call in index.html
 */
function loadLocalQuestionSet() {
  let input;
  let file;
  let fr;

  if (typeof window.FileReader !== "function") {
    alert("The file API isn't supported on this browser yet.");
    return;
  }

  input = document.getElementById("fileinput");
  if (!input) {
    alert("No fileinput element.");
  } else if (!input.files) {
    alert(
      "This browser doesn't seem to support the `files` property of file inputs."
    );
  } else if (!input.files[0]) {
    alert("Please select a file before clicking 'Load'");
  } else {
    file = input.files[0];
    fr = new FileReader();
    fr.onload = receivedText;
    fr.readAsText(file);
  }

  /**
   * Reads text from event and loads the packet
   * @param {*} e - event
   */
  function receivedText(e) {
    const lines = e.target.result;
    let j = JSON.parse(lines);
    setUpPacket(j, file.name);
    $("#options-panel").hide();
  }
}

/**
 * Displays the review question panel with a summary of marks
 */
function reviewQuestions() {
  // Stop timer (if it's running)
  if (timer != null) {
    timer.stop();
  }

  const aid = exam_details.aid;
  const cid = exam_details.cid;
  const eid = exam_details.eid;
  $("#review-overlay").show();
  $("#review-answer-list").empty();
  $("#review-answer-table").empty();
  $("#review-score").empty();
  $("#exam-stats").hide();

  loadQuestion(0, 0, true);

  db.answers
    .where({
      aid: aid,
      cid: cid,
      eid: eid
    })
    .toArray()
    .then(function(answers) {
      let current_answers = {};
      answers.forEach(function(arr, n) {
        let answer = arr["ans"];
        if (answer == undefined) {
          answer = "Not answered";
        }

        current_answers[[arr["qid"], arr["qidn"]]] = answer;
      });

      let correct_count = 0;
      let not_answered = 0;
      let answered_normal = 0;
      let answered_abnormal = 0;
      let undercall_number = 0;
      let overcall_number = 0;
      let incorrectcall_number = 0;
      exam_details.question_order.forEach(async function(qid, n) {
        const q_object = {
          qid: String(qid),
          type: question_type
        };
        let question = await question_db.question_data.get(q_object);
        question = question.data;
        if (question_type == "long") {
          $("#review-answer-table").append(
            $(
              `<tr class='review-table-heading' data-qid=${n + 1
              } title='Click to load question ${n + 1
              }'><td colspan=2>Question ${n + 1}</td></tr>`
            ).click(() => {
              loadQuestion(n);
              $("#review-overlay").hide();
            })
          );
          // $("#review-answer-table").append(`<tr id='review-answer-${qid}'><td class='review-user-answer-cell'></td><td class='review-model-answer-cell'></td></tr>`);
          $("#review-answer-table").append(
            `<tr class='answer-sub' data-qid=${n + 1
            }><td>Your answers</td><td>Model answers</td></tr>`
          );

          let model_answers = question.answers;

          // TODO: FIX
          if (model_answers[0] != undefined) {
            model_answers = model_answers[0];
          }

          const titles = [
            "Observations",
            "Interpretation",
            "Principal Diagnosis",
            "Differential Diagnosis",
            "Management",
          ];

          // let user_td = $(
          //   `#review-answer-${qid} td .review-user-answer-cell`
          // );
          // let model_td = $(
          //   `#review-answer-${qid} td .review-model-answer-cell`
          // );

          titles.forEach((title, x) => {
            let user_answer = current_answers[`${qid},${+1}`];
            //console.debug(`${qid},${n}`, user_answer);
            if (user_answer == undefined) {
              user_answer = "Not answered";
            }
            let user_ans =
              "<h4 class='review-list-header'>" + title + "</h4>" + user_answer;
            let model_ans =
              `<h4 class="review-list-header" name=${+1}>` +
              title +
              "</h4>" +
              model_answers[title.toLowerCase()];

            $("#review-answer-table").append(
              `<tr class='' data-qid=${n + 1
              }><td>${user_ans}</td><td>${model_ans}</td></tr>`
            );
          });

          // TOOD fix
          $("#review-answer-table tr")
            .sort(function(a, b) {
              return a.dataset.qid > b.dataset.qid ?
                1 :
                a.dataset.qid < b.dataset.qid ?
                  -1 :
                  0;
            })
            .appendTo("#review-answer-table");
          return;
        }

        $("#review-answer-list").append(
          "<li id='review-answer-" +
          qid +
          "' data-qid=" +
          n.toString().padStart(2, "0") +
          "'><a href='#' data-qid=" +
          n +
          ">Question " +
          (n + 1) +
          ":</a> <span>Not answered</span></li>"
        );
        $(`#review-answer-list a[data-qid=${n}]`).click(function(evt) {
          loadQuestion(this.dataset.qid);
          $("#review-overlay").hide();
        });

        console.debug(db.user_answers)
        console.debug({
          type: question_type,
          qid: qid
        })
        db.user_answers
          .where({
            type: question_type,
            qid: qid
          })
          .toArray()
          .then(function(answers) {
            // Merge the question answers with the user saved answers
            let question_answers = question["answers"];
            if (answers != undefined) {
              for (let i = 0; i < answers.length; i++) {
                question_answers = question_answers.concat(answers[i].ans);
              }
            }

            let section_1_answer = current_answers[[qid, "1"]];
            let section_2_answer = current_answers[[qid, "2"]];

            if (section_1_answer == undefined) {
              section_1_answer = "Not Answered";
              not_answered++;
            }
            if (section_2_answer == undefined) {
              if (section_1_answer == "Normal") {
                section_2_answer = "Normal";
                answered_normal++;
              } else {
                section_2_answer = "Not Answered";
              }
            } else {
              answered_abnormal++;
            }

            let el = $(`#review-answer-${qid} span`);

            /**
             * Helper function to define how review items are displayed
             * Yes it is a bit shit
             * @param {*} el - element
             * @param {*} c - class
             * @param {*} user_answer -
             * @param {*} normal -
             * @param {*} question_answers -
             */
            function setReviewAnswer(
              el,
              c,
              user_answer,
              normal,
              question_answers
            ) {
              if (normal) {
                el.html(
                  `<span class='${c}'>Answer: ${user_answer} (Normal)</span>`
                );
              } else {
                el.html(
                  `<span class='${c}'>Answer: ${user_answer} (Abnormal: ${question_answers.join(', ')})</span>`
                );
              }
            }

            function setAnatomyReviewAnswer(
              el,
              c,
              user_answer,
              question_answers
            ) {
              el.html(
                `<span class='${c}'>Answer: ${user_answer} (Correct answers: ${question_answers.join(', ')})</span>`
              )
            }

            if (question_type == "rapid") {
              // First check normal vs abnormal
              if (question["normal"] == true) {
                if (section_1_answer == "Normal") {
                  setReviewAnswer(
                    el,
                    "correct",
                    section_1_answer,
                    true,
                    question_answers
                  );
                  correct_count++;
                  questions_correct[qid] = true;
                } else {
                  if (section_1_answer != "Not Answered") {
                    overcall_number++;
                  }
                  setReviewAnswer(
                    el,
                    "incorrect",
                    section_1_answer,
                    true,
                    question_answers
                  );
                  questions_correct[qid] = false;
                }
              } else {
                if (answerInArray(question_answers, section_2_answer)) {
                  correct_count++;
                  setReviewAnswer(
                    el,
                    "correct",
                    section_2_answer,
                    false,
                    question_answers
                  );
                  questions_correct[qid] = true;
                } else {
                  setReviewAnswer(
                    el,
                    "incorrect",
                    section_2_answer,
                    false,
                    question_answers
                  );
                  questions_correct[qid] = false;

                  if (section_1_answer == "Not Answered") {} else if (section_1_answer == "Normal") {
                    undercall_number++;
                  } else {
                    // Incorrect calls could be correct if
                    // the answer is not in the database
                    incorrectcall_number++;

                    el.append(
                      "<span class='mark-correct'>[Mark correct]</span>"
                    ).click(() => {
                      markCorrect(qid, section_2_answer, question_type);
                      reviewQuestions();
                    });
                  }
                }
              }
            } else if (question_type == "anatomy") {
              // Anatomy answers are either correct or incorrect
              if (answerInArray(question_answers, section_1_answer)) {
                correct_count++;
                setAnatomyReviewAnswer(
                  el,
                  "correct",
                  section_1_answer,
                  question_answers
                );
                questions_correct[qid] = true;
              } else {
                setAnatomyReviewAnswer(
                  el,
                  "incorrect",
                  section_1_answer,
                  question_answers
                );
                questions_correct[qid] = false;
              }
            }

            score = correct_count;

            $("#review-score").text(
              "Score: " +
              correct_count +
              " out of " +
              exam_details.question_order.length
            );

            if (question_type == "rapid") {
              $("#exam-stats").show();
              $("#unanswered-number").html(not_answered);
              $("#normal-number").html(answered_normal);
              $("#abnormal-number").html(answered_abnormal);
              $("#undercall-number").html(undercall_number);
              $("#overcall-number").html(overcall_number);
              $("#incorrectcall-number").html(incorrectcall_number);
            } else {
              $("#exam-stats").show();
            }
          })
          .catch(function(error) {
            console.debug("error-", error);
          })
          .finally(() => {
            // This will lead to saveSession being called after each question is marked
            saveSession();
            rebuildQuestionListPanel();

            $("#review-answer-list li")
              .sort(function(a, b) {
                return a.dataset.qid > b.dataset.qid ?
                  1 :
                  a.dataset.qid < b.dataset.qid ?
                    -1 :
                    0;
              })
              .appendTo("#review-answer-list");
          });
      });
    })
    .catch(function(error) {
      console.debug("error - ", error);
    });
}

/**
 * Marks the loaded question and updates display
 * @param {*} qid -
 * @param {*} current_question -
 */
function markAnswer(qid, current_question, n) {
  const type = current_question.type;
  console.debug("Mark", current_question);

  let option = null;
  if (review_mode == true) {
    // Disable all possible answer elements
    $("#rapid-option").attr("disabled", "true");
    $(".long-answer").attr("readonly", "true");
    $(".long-answer").addClass("long-answer-marked");

    if (type == "rapid") {
      option = document.getElementById("rapid-option");
      // If the current question is normal
      if (current_question.normal == true) {
        $(".answer-panel").append(
          "<div id='correct-answer-block'>This is normal</div>"
        );
        if (option.value == "Normal") {
          option.classList.add("correct");
        } else {
          option.classList.add("incorrect");
        }
        // If answer is normal we have nothing else to add.
        addFeedback(current_question);
        return;
      }
    }

    if (type == "long") {
      // For long cases we simple disable the texareas and append the
      // model answers
      let model_answers = current_question.answers[0];

      // TODO: FIX THIS
      if (model_answers == undefined) {
        model_answers = current_question.answers;
      }
      for (let key of Object.keys(model_answers)) {
        $("textarea[name*='" + key + "' i]").after(model_answers[key]);
      }
      return;
    }

    $(".answer-panel").append(
      "<div id='correct-answer-block'>Correct answer(s):<ul id='answer-list'></ul></div>"
    );
    let ul = $("#answer-list");

    let textarea = $(".long-answer");
    textarea.addClass("incorrect");

    let user_answer = textarea.val();

    // Load user saved answers
    db.user_answers
      .where({
        type: type,
        qid: qid
      })
      .toArray()
      .then(function(saved_user_answers) {
        //console.debug("saved user answers", saved_user_answers)
        // check if given answer matches a user saved answer
        if (saved_user_answers != undefined) {
          //console.debug(saved_user_answers);
          saved_user_answers.forEach(function(saved_answer_object, n) {
            let saved_answer = saved_answer_object.ans;
            //console.debug("ua", user_answer, saved_answer);
            ul.append("<li>" + saved_answer + "</li>");
            if (compareString(saved_answer, user_answer)) {
              textarea.removeClass("incorrect").addClass("correct");
            }
            if (
              saved_answer_object.submitted == undefined ||
              saved_answer_object.submitted != true
            ) {
              ul.append(
                $("<button>Submit Answer</button>").click((e) => {
                  interact.postSavedAnswer(
                    type,
                    qid,
                    saved_answer,
                    e,
                    saved_answer_object,
                    db,
                    URLS.question_answer_submit_url
                  );
                })
              );
            }
          });
        }

        // check if given answer matches an answer from the question
        current_question.answers.forEach(function(answer, n) {
          ul.append("<li>" + answer + "</li>");
          if (compareString(answer, user_answer)) {
            textarea.removeClass("incorrect").addClass("correct");
          }
        });

        // If the given answer is not abnormal it must be incorrect
        if (type == "rapid" && option.value != "Abnormal") {
          option.classList.add("incorrect");
        } else {
          // If it is blank it must also be incorrect
          if (
            textarea.hasClass("incorrect") == true &&
            user_answer.replace(/\s/g, "") != ""
          ) {
            // Otherwise there is a chance that it may be correct
            // so we give the option to mark it correct
            if (allow_self_marking) {
              $(".answer-panel").append(
                $("<button id='mark-correct'>Mark Correct</button>").click(
                  function() {
                    markCorrect(qid, user_answer, type);
                    loadQuestion(n, 0, true);
                  }
                )
              );
            }
          }
        }
      })
      .catch(function(error) {
        console.debug("error-", error);
      });
    addFeedback(current_question, qid);
    rebuildQuestionListPanel();
  }
}

function addFeedback(current_question, qid) {
  console.debug(current_question);
  if (
    current_question.hasOwnProperty("feedback") &&
    current_question.feedback.length > 0
  ) {
    $(".answer-panel").append(
      $(
        "<div class='feedback'><h4>Feedback</h4>" +
        current_question.feedback +
        "</div>"
      )
    );
  }
  // TODO: render in dicom viewer
  if (
    current_question.hasOwnProperty("feedback_images") &&
    current_question.feedback_images.length > 0
  ) {
    // TODO: finish (load in dicom viewer)
    current_question.feedback_images.forEach((img) => {
      $(".question").append($(`<img class="feedback-image" src="${img}" />`));
    });
  }

  // Add link to submit question feedback

  $(".answer-panel").append(
    $(
      `<div class='feedback-link'><a href=${URLS.question_feedback_url}${current_question.type}/${qid} target=”_blank”>Submit question feedback</a></div>`
    )
  );
}

function markCorrect(qid, user_answer, type) {
  if (user_answer == "") {
    return;
  }

  db.user_answers.put({
    type: type,
    qid: qid,
    ans: user_answer,
    submitted: false,
  });
  //db.user_answers
  //  .get({ type: type, qid: qid })
  //  .then(function (answers) {
  //    let new_answers = [];
  //    if (answers != undefined) {
  //      new_answers = answers.ans;
  //    }

  //    new_answers.push(user_answer);
  //    db.user_answers.put({ type: type, qid: qid, ans: new_answers });
  //  })
  //  .catch(function (error) {
  //    console.debug("error-", error);
  //  });

  if (allow_self_marking) {
    $("#mark-correct").remove();
  }

  let textarea = $(".long-answer").attr("class", "correct");
}

function compareString(a, b) {
  return (
    a.toLowerCase().replace(/\s/g, "") == b.toLowerCase().replace(/\s/g, "")
  );
}

function answerInArray(arr, ans) {
  return (
    arr
      .map((v) => v.toLowerCase().replace(/\s/g, ""))
      .includes(ans.toLowerCase().replace(/\s/g, "")) == true
  );
}

function addFlagEvents() {
  const aid = exam_details.aid;
  const cid = exam_details.cid;
  const eid = exam_details.eid;

  // Bind flag change events
  $("button.flag").click(function(event) {
    const el = $(this);
    const nqid = el.attr("data-qid");
    const qid = exam_details.question_order[nqid];
    const qidn = el.attr("data-qidn");

    el.toggleClass("flag flag-selected");

    const flag_db_data = {
      aid: aid,
      cid: cid,
      eid: eid,
      qid: qid,
      qidn: qidn
    };

    if (el.hasClass("flag")) {
      $("#question-list-item-" + nqid + "-" + qidn + " span").css(
        "visibility",
        "hidden"
      );
      db.flags.delete([aid, cid, eid, qid, qidn]);
      deleteQuestionListPanelFlags(flag_db_data);
    } else {
      $("#question-list-item-" + nqid + "-" + qidn + " span").css(
        "visibility",
        "visible"
      );
      db.flags.put(flag_db_data);
      updateQuestionListPanelFlags(flag_db_data);
    }
  });
}

// Loads the current question flag status and updates display
function loadFlagsFromDb(qid, n) {
  const aid = exam_details.aid;
  const cid = exam_details.cid;
  const eid = exam_details.eid;
  db.flags
    .get({
      aid: aid,
      cid: cid,
      eid: eid,
      qid: qid,
      qidn: n
    })
    .then(function(answer) {
      if (answer != undefined) {
        $("button.flag, button.flag-selected")
          .eq(parseInt(answer.qidn) - 1)
          .toggleClass("flag flag-selected");
      }
    })
    .catch(function(error) {
      console.debug(error);
    });
}

function showLoginDialog() {
  $("#login-dialog").modal();
}


$("#btn-candidate-login").click(function(evt) {
  $("#login-dialog").modal({
    escapeClose: false,
    clickClose: false,
    showClose: false
  });
  $("#options-panel").toggle();
  //$(".exam-wrapper").toggle();
});

$("#btn-user-login").click(function(evt) {
  window.location = URLS.login_url;
  //$(".exam-wrapper").toggle();
});



$("#btn-login").click(function(evt) {
  global_cid = parseInt($("#candidate-number").val());
  global_passcode = $("#passcode").val();

  localStorage.setItem("cid.cid", global_cid)
  localStorage.setItem("cid.passcode", global_passcode)
  location.reload();
  $.modal.close();
});

$(".start-packet-button").click(function(evt) {

  // TODO: send packet to server to indicated that we have started the exam
  // if in exam mode

  exam_details.start_time = new Date().getTime() / 1000;

  if (timer != null) {
    timer.stop();
  }
  timer = null;

  timer = new easytimer.Timer();
  //exam_time = 2;
  timer.start({
    countdown: true,
    startValues: {
      seconds: exam_time
    }
  });
  timer.addEventListener("secondsUpdated", function(e) {
    $("#timer").html("Time left: " + timer.getTimeValues().toString());
  });
  timer.addEventListener("targetAchieved", function(e) {
    if (exam_details.exam_mode == true) {
      $(
        "#btn-dialog-submit, #btn-time-up-review, #btn-time-up-continue"
      ).toggle();
      $("#time-up-dialog .dialog-text").text(
        "Allocated time has ended. Click to submit answers."
      );
    }
    $("#time-up-dialog").modal();
  });

  // If we are not in an exam we can pause the session
  if (!exam_details.exam_mode) {
    $("#timer").click(() => {
      timer.pause();

      let time_remaining = timer.getTimeValues().toString();

      $("#pause").empty();
      $("#pause").append(
        $(
          `<div id="pause-text">Session paused<div id="pause-time-remaining">You have ${time_remaining} remaining.</div></div><button id="resume-exam-button" class="navigation dialog-yes">Click to resume</button>`
        ).click(() => {
          $("#pause").hide();
          timer.start();
        })
      );
      $("#pause").show();
    });
  }

  // //const t = 2;
  // let display = document.querySelector("#timer");
  // let timer = new helper.CountDownTimer(exam_time);
  // let timeObj = helper.CountDownTimer.parse(exam_time);

  // format(timeObj.minutes, timeObj.seconds);

  // timer.onTick(format);

  // timer.start();

  // function format(minutes, seconds) {
  //   minutes = minutes < 10 ? "0" + minutes : minutes;
  //   seconds = seconds < 10 ? "0" + seconds : seconds;
  //   display.textContent = "Time left: " + minutes + ":" + seconds;

  //   if (minutes == 0 && seconds == 0) {
  //     $("#time-up-dialog").modal();
  //   }
  // }

  loadQuestion(0, 0, true);

  $.modal.close();
});

function delete_answer_db() {
  db.delete()
    .then(() => {
      $.notify("Database successfully deleted", "success");
      $.notify("The page will now reload", "warn");
      setTimeout(() => {
        location.reload();
      }, 2000);
      console.debug("Database successfully deleted");
    })
    .catch((err) => {
      $.notify("Error deleting databases", "error");
      console.error("Could not delete database");
    })
    .finally(() => {
      // Do what should be done next...
    });
}

function delete_question_db() {
  question_db
    .delete()
    .then(() => {
      $.notify("Database successfully deleted", "success");
      $.notify("The page will now reload", "warn");
      setTimeout(() => {
        location.reload();
      }, 2000);
      console.debug("Database successfully deleted");
    })
    .catch((err) => {
      $.notify("Error deleting databases", "error");
      console.error("Could not delete database");
    })
    .finally(() => {
      // Do what should be done next...
    });
}

function delete_user_db() {
  user_db
    .delete()
    .then(() => {
      $.notify("User successfully deleted", "success");
      $.notify("The page will now reload", "warn");
      setTimeout(() => {
        location.reload();
      }, 2000);
      console.debug("Database successfully deleted");
    })
    .catch((err) => {
      $.notify("Error deleting databases", "error");
      console.error("Could not delete database");
    })
    .finally(() => {
      // Do what should be done next...
    });
}

$("#btn-view-local-answers").click(async function(evt) {


  var docHeight = $(document).height();

  let answer_json = await db.answers.toArray();

  if ($("#view-answers-overlay").length < 1) {
    $("body").append(
      `<div id='view-answers-overlay'><span style='color: white'><p>${JSON.stringify(
        answer_json
      )}</p></span></div>`
    );

    $("#view-answers-overlay").height(docHeight);
    $("#view-answers-overlay").append("<a id='save-failed-answers'>Save</a>")

    let file = new Blob([JSON.stringify(answer_json)], {type: "application/json"})

    let link = document.getElementById("save-failed-answers");
    link.href = URL.createObjectURL(file);
    link.download = "answers.json";
  }
});

$("#btn-delete-answer-databases").click(function(evt) {
  var r = confirm(
    "This will delete ALL saved answers (including saved correct answers)!"
  );
  if (r == true) {
    delete_answer_db();
  } else {}
});
$("#btn-delete-cached-questions").click(function(evt) {
  var r = confirm("Delete cached questions?");
  if (r == true) {
    delete_question_db();
  } else {}
});
$("#btn-reset-local").click(function(evt) {
  var r = confirm("Clear all local data");
  if (r == true) {
    delete_answer_db();
    delete_question_db();
    localStorage.removeItem("cid.cid")
    localStorage.removeItem("cid.passcode")
  } else {}
});

$("#btn-delete-current").click(function(evt) {
  if (exam_details.question_order.length < 1) {
    $.notify("No packet is currently loaded", "warn");
    return;
  }

  db.flags
    .where("qid")
    .anyOf(exam_details.question_order)
    .delete()
    .then(function(deleteCount) {
      $.notify("Packet flags deleted", "success");
    })
    .catch((err) => {
      $.notify("Error deleting packet flags", "error");
      $.notify("You may have to delete all answers this time", "info");
    });

  db.answers
    .where("qid")
    .anyOf(exam_details.question_order)
    .delete()
    .then(function(deleteCount) {
      $.notify("Packet successfully reset", "success");
      loadQuestion(0, 0, true);
      // $.notify("The page will now reload", "warn");
      // setTimeout(() => {
      //   location.reload();
      // }, 2000);
      console.debug("Deleted " + deleteCount + " objects");
    })
    .catch((err) => {
      $.notify("Error reseting packet", "error");
      $.notify("You may have to delete all answers this time", "info");
      console.debug(err);
    });
});

$("#btn-delete-current-saved-answers").click(function(evt) {
  if (exam_details.question_order.length < 1) {
    $.notify("No packet is currently loaded", "warn");
    return;
  }

  // TODO: fix, needs type
  db.user_answers
    .where("qid")
    .anyOf(exam_details.question_order)
    .delete()
    .then(function(deleteCount) {
      $.notify("Packet answers deleted", "success");
    })
    .catch((err) => {
      $.notify("Error deleting saved answers", "error");
      $.notify("You may have to delete all answers this time", "info");
    });
});

$(document).ajaxStart(function() {
  $("#loading").show();
});

$(document).ajaxStop(function() {
  $("#loading").hide();
});

function saveSession(start_review) {
  if (start_review == true) {
    review_mode = true;
  }

  let status = "active";
  if (review_mode == true) {
    status = "complete";
  }

  //console.debug("save session", score);

  let time_values = timer.getTimeValues();
  let time_remaining =
    time_values.hours * 60 * 60 +
    time_values.minutes * 60 +
    time_values.seconds;
  db.session.put({
    packet: packet_name,
    eid: exam_details.eid,
    aid: exam_details.aid,
    cid: exam_details.cid,
    passcode: exam_details.passcode,
    status: status,
    date: date_started,
    score: score,
    max_score: exam_details.number_of_questions,
    exam_time: exam_time,
    time_left: time_remaining,
    question_order: exam_details.question_order,
    questions_answered: 0, // TODO
    total_questions: exam_details.number_of_questions,
  });
}

function refreshDatabaseSettings() {
  if ("storage" in navigator && navigator.storage != undefined) {
    navigator.storage.estimate().then((value) => {
      $("#storage-details").empty();
      $("#storage-details").append(
        `Local space used: ${helper.humanFileSize(
          value.usage
        )}, available: ${helper.humanFileSize(value.quota)}`
      );
    });
  } else {
    $("#storage-details").append(
      `Local storage information not available (are you connecting over http rather than https?).`
    );
  }
}

$(document).on("saveSessionEvent", {}, (evt, review) => {
  saveSession(review);
});

// Disable right click
$(document).contextmenu(() => {
  return false;
})

// Helper to compare dates
function compareDates(d1, d2) {
  console.debug("compare", d1, d2);
  console.debug("compare striped", Date.parse(d1.split("+")[0]), Date.parse(d2.split("+")[0]));
  console.debug("compare striped", Date.parse(d1.split("+")[0]), Date.parse(d2.split("+")[0]));
  return Date.parse(d1.split("+")[0]) != Date.parse(d2.split("+")[0]);
}