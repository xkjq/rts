/* global Dexie, cornerstone, cornerstoneTools, cornerstoneBase64ImageLoader, cornerstoneWebImageLoader, cornerstoneWADOImageLoader */
import * as helper from "./helpers.js";
import * as viewer from "./viewer.js";
import * as interact from "./viewer.js";
// const { v4: uuidv4 } = require('uuid');

// cid = null;
window.aid = null;
window.cid = 1234;
window.eid = 5678;

window.exam_mode = false;

window.packet_list = [];

window.packet_name = null;
window.questions = null;
window.question_order = [];
window.questions_correct = {};
window.number_of_questions = null;
window.question_type = null;
window.loaded_question = null;
window.review = false;
window.exam_time = 60;
window.date_started = null;
window.score = 0;

window.allow_self_marking = true;

window.timer = null;

//window.dfile = null;

retrievePacketList();

/**
 * Retrieves a list of available packets via JSON ajax requests
 * Will initially try /packets/ (for example if index.php generates the list)
 * and then fallback to packets.json
 */
function retrievePacketList() {
  $.getJSON("packets/", function (data) {
    loadPacketList(data);
  })
    .done(function () {})
    .fail(function () {
      $.getJSON("packets/packets.json", function (data) {
        loadPacketList(data);
      }).fail(function (jqXHR, textStatus, errorThrown) {
        console.log(jqXHR);
        console.log(textStatus);
        console.log(errorThrown);
        console.log("No packet list available");
        showLoginDialog();
      });
    })
    .always(function () {});
}

/**
 * Generate a list of the packets that are available to be loaded
 *
 * @param {JSON} data - json containing available packets
 */
async function loadPacketList(data) {
  let sessions = await window.db.session.toArray().catch(function (error) {
    console.log("Error loading session", error);
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
  // db.session
  //   .where("packet")
  //   .equals()
  let packets_started = [];
  let packets_completed = [];
  sessions.forEach((s) => {
    if (s.status == "active") {
      packets_started.push(s.packet);
    } else {
      packets_completed.push(s.packet);
    }
  });

  if (data != null) {
    window.packet_list = data.packets;
  }

  $("#packet-list").empty();
  window.packet_list.forEach(function (packet) {
    let c = "";
    if (packets_started.indexOf(packet) > -1) {
      c = " session-started";
    }
    if (packets_completed.indexOf(packet) > -1) {
      c = " session-completed";
    }
    $("#packet-list").append(
      $(`<div class='packet-button${c}' title='Load packet'></div>`)
        .text(packet)
        .click(function () {
          loadPacketFromAjax("packets/" + packet);
        })
        .append(
          $(
            `<div class='save-button' title='Download packet for offline use (or to save bandwidth)'><a href='packets/${packet}' download='${packet}'>💾</a></div>`
          ).click(function () {
            console.log("packets/" + packet);
            event.stopPropagation();
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
function loadPacketFromAjax(path) {
  console.log("loading packet from " + path);
  $("#progress").html(`Requesting packet: ${path}`);

  $.ajax({
    dataType: "json",
    url: path,
    progress: function (e) {
      if (e.lengthComputable) {
        var completedPercentage = Math.round((e.loaded * 100) / e.total);

        $("#progress").html(
          `${completedPercentage}%<br/>${helper.formatBytes(e.total)}`
        );
      }
    },
  })
    .done(function (data) {
      setUpPacket(data, path.split("/").pop());
      $("#options-panel").hide();
    })
    .fail(function () {
      console.log("Unable to load packet at: " + path);
    });
}

/**
 * Build the currently loaded quiz
 */
function setUpQuestions(load_previous) {
  if (window.questions == undefined) {
    return;
  }
  // Set an order for the questions
  if (!load_previous) {
    window.question_order = [];
    Object.keys(window.questions).forEach(function (e) {
      window.question_order.push(e);

      // Make sure answers are arrays
      if (!Array.isArray(window.questions[e]["answers"])) {
        window.questions[e]["answers"] = [window.questions[e]["answers"]];
      }
    });

    window.question_order = helper.shuffleArray(window.question_order);
  }
  window.number_of_questions = Object.keys(window.questions).length;
  window.review = false;

  // Horrible way to get type of questions
  // We assume they are all of the same type....
  window.question_type =
    window.questions[Object.keys(window.questions)[0]].type;

  if (window.exam_mode) {
    $("#options-button, #review-overlay-button").hide();
  } else {
    $("#submit-button").hide();
  }

  loadQuestion(0, 1, true);
  createQuestionListPanel();

  console.log(window.question_type);

  if (!load_previous) {
    if (window.question_type == "rapid") {
      window.exam_time = 35 * 60;
    } else if (window.question_type == "anatomy") {
      window.exam_time = 90 * 60;
    } else if (window.question_type == "long") {
      window.exam_time = 75 * 60;
    }
  }

  $("#exam-time")
    .val(window.exam_time / 60)
    .change(() => {
      window.exam_time = $("#exam-time").val() * 60;
    });

  $("#start-dialog").modal();
}

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
  answers: "[aid+cid+eid+qid+qidn], [aid+cid+eid], qid, ans",
  flags: "[aid+cid+eid+qid+qidn], [aid+cid+eid], qid",
  user_answers: "qid, ans",
  session:
    "[packet+aid], packet, aid, status, date, score, max_score, exam_time, time_left, question_order, questions_answered, total_questions",
});

window.db = db;

/**
 * Parse the packet and extract metadata (if it exists)
 * Will then call setUpQuestions() to load the packet
 * @param {JSON} data
 */
function setUpPacket(data, packet_name) {
  // Load the exam name from the json packet (if it exists)
  if (data.hasOwnProperty("exam_name")) {
    packet_name = data.exam_name;
  }
  $(".exam-name").text("Exam: " + packet_name);
  window.packet_name = packet_name;

  if (data.hasOwnProperty("eid")) {
    window.eid = data.eid;
  }

  if (data.hasOwnProperty("type")) {
    window.question_type = data.type;
  }

  if (data.hasOwnProperty("exam_mode")) {
    window.exam_mode = data.exam_mode;
  }

  if (data.hasOwnProperty("questions")) {
    window.questions = data.questions;
  } else {
    window.questions = data;
  }

  // Either continue session or create a new one
  db.session
    // .where("status")
    // .equals("active")
    .where("[packet+aid]")
    .between(
      [window.packet_name, Dexie.minKey],
      [window.packet_name, Dexie.maxKey]
    )
    .toArray()
    .then((sessions) => {
      console.log("sessions", sessions);

      // let active_sessions = [];

      // sessions.forEach((s) => {
      //   if (s.status == "active") {
      //     active_sessions.push(s);
      //   }
      // });

      let load_previous = false;

      // Start new session
      if (sessions.length < 1) {
        window.aid = uuidv4();
        window.date_started = Date.now();
      } else {
        let text = "Select session to continue (leave blank to create new):";
        console.log(sessions.date);

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
            text =
              text +
              `\r${i}: ${formatted_date} [Complete - score ${sessions[i].score}/${sessions[i].max_score}]`;
          }
        }

        let s = prompt(text, "0");

        if (s != null && s != "") {
          load_previous = true;

          window.aid = sessions[parseInt(s)].aid;
          window.date_started = sessions[parseInt(s)].date;

          let time_left = sessions[parseInt(s)].time_left;

          window.exam_time = time_left;

          window.question_order = sessions[parseInt(s)].question_order;

          if (sessions[parseInt(s)].status == "complete") {
            window.review = true;
          }
        } else {
          // If cancel is pressed or input is blank
          window.aid = uuidv4();
          window.date_started = Date.now();
          console.log("new date", window.date_started);
        }
      }

      setUpQuestions(load_previous);
    });
}

/**
 * Loads a specific question
 * @param {number} n - Question number to load
 * @param {number} section - Question section to focus
 * @param {boolean} force_reload - Force question to be reloaded if already loaded
 */
function loadQuestion(n, section = 1, force_reload = false) {
  const aid = window.aid;
  const cid = window.cid;
  const eid = window.eid;

  // Make sure we have an integer
  n = parseInt(n);
  console.log(n);

  const qid = window.question_order[n];
  console.log("qid", qid);
  const current_question = window.questions[qid];

  console.log("N=", n, section, current_question);

  if (n == window.loaded_question && force_reload == false) {
    // Question already loaded
    setFocus(section);
    return;
  }

  window.loaded_question = n;

  // Set up question navigation
  $(".navigation[value='next']").off();
  $(".navigation[value='previous']").off();
  if (n == 0) {
    $(".navigation[value='previous']").attr("disabled", "disabled");
  } else {
    $(".navigation[value='previous']")
      .removeAttr("disabled")
      .click(function () {
        loadQuestion(n - 1);
      });
  }

  if (n == window.number_of_questions - 1) {
    $(".navigation[value='next']").attr("disabled", "disabled");
  } else {
    $(".navigation[value='next']")
      .removeAttr("disabled")
      .click(function () {
        loadQuestion(n + 1);
      });
  }

  const display_n = n + 1;

  if (current_question.title) {
    $(".question .title").get(0).innerHTML =
      '<span style="font-weight:700;">' +
      display_n +
      "</span> " +
      current_question.title;
  } else {
    $(".question .title").get(0).innerHTML =
      '<span style="font-weight:700;">' + display_n + "</span>";
  }

  // Close any open figures
  let el = document.getElementById("dicom-image");
  if (el != undefined) {
    cornerstone.disable(el);
    $(".canvas-panel").remove();
  }

  // Remove feedback images
  $(".feedback-image").remove();

  // Set up thumbnails
  const thumbnails = $(".thumbs");
  // Why are we checking this?
  if (thumbnails) {
    thumbnails.empty();

    // TODO: figure captions (need to extend base json)

    current_question.images.forEach(function createThumbnail(image, id) {
      // For thumbnails we only want a single image
      if (Array.isArray(image)) {
        image = image[0]; // Do we want the middle image?
      }

      thumbnails.append(
        '<div class="figure" id="figure-' +
          id +
          '"><div class="figcaption">...</div></div>'
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

        // otherwise try to load it as a dicom
      } else {
        // convert the data url to a file
        viewer
          .urltoFile(based_img, "dicom", "application/dicom")
          .then(function (dfile) {
            // load the file using cornerstoneWADO file loader
            const imageId = cornerstoneWADOImageLoader.wadouri.fileManager.add(
              dfile
            );
            cornerstone.loadAndCacheImage(imageId).then(function (image) {
              const img = $("<div></div>").get(0);
              img.id = "thumb-" + id;
              img.class = "thumbnail";
              img.title =
                "Click on the thumbnail to view and manipulate the image.";
              img.draggable = "false";
              img.style = "height: 100px; width: 100px";
              $("#figure-" + id).append(img);

              const element = document.getElementById("thumb-" + id);
              cornerstone.enable(element);
              cornerstone.displayImage(element, image);
              cornerstone.resize(element);
            }); // .catch( function(error) {
          });
      }
    });
  }

  $(".thumbs .figure").each(function handleThumbnailClicks(id, thumbnail) {
    thumbnail.onclick = function (event) {
      viewer.openMainImage(current_question, event, this);
    };
  });

  // Answer setup
  const ap = $(".answer-panel");
  ap.empty();

  switch (current_question.type) {
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
      $("#rapid-option").change(function (evt) {
        if (evt.target.value == "Abnormal") {
          $("#rapid-text").css("display", "block");
        } else {
          $("#rapid-text").css("display", "none");
        }
        db.answers.put({
          aid: aid,
          cid: cid,
          eid: eid,
          qid: qid,
          qidn: "1",
          ans: evt.target.value,
        });
        saveSession();
        updateQuestionListPanel();
      });

      // Save long answers on textchange
      $(".long-answer").change(function (evt) {
        // ignore blank text and delete any stored value
        if (evt.target.value.length < 1) {
          db.answers.delete([aid, cid, eid, qid, "2"]);
          $(
            "#question-list-item-" + window.question_order.indexOf(qid) + "-2"
          ).removeClass("question-saved-localdb");
          return;
        }
        // db.answers.put({aid: [cid, eid, qidn], ans: evt.target.value});
        db.answers.put({
          aid: aid,
          cid: cid,
          eid: eid,
          qid: qid,
          qidn: "2",
          ans: evt.target.value,
        });

        $(
          "#question-list-item-" + window.question_order.indexOf(qid) + "-2"
        ).addClass("question-saved-localdb");

        saveSession();
        updateQuestionListPanel();
      });

      // We chain our db requests as we can only check answers once
      // they have been loaded (should probably use then or after)

      db.answers
        .get({ aid: aid, cid: cid, eid: eid, qid: qid, qidn: "1" })
        .then(function (answer) {
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
        .catch(function (error) {
          console.log("DB", cid, eid, qid);
          console.log("error-", error);
        })
        .then(
          db.answers
            .get({ aid: aid, cid: cid, eid: eid, qid: qid, qidn: "2" })
            .then(function (answer) {
              if (answer != undefined) {
                console.log(answer);
                $(".long-answer").text(answer.ans);
              }
              markAnswer(qid, current_question);
            })
            .catch(function (error) {
              console.log("error-", error);
            })
        );

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
          current_question.question +
          '</span><button class="flag" data-qid="' +
          n +
          '" data-qidn=1 style="margin-right:0">⚐</button></p></div><textarea class="long-answer" name="Reason" data-answer-section-qidn=1 style="overflow: hidden scroll; overflow-wrap: break-word;"></textarea></div>'
      );

      $(".long-answer").change(function (evt) {
        // ignore blank text and delete any stored value
        if (evt.target.value.length < 1) {
          db.answers.delete([aid, cid, eid, qid, "1"]);
          $(
            "#question-list-item-" + window.question_order.indexOf(qid) + "-1"
          ).removeClass("question-saved-localdb");
          return;
        }
        // db.answers.put({aid: [cid, eid, qidn], ans: evt.target.value});
        db.answers.put({
          aid: aid,
          cid: cid,
          eid: eid,
          qid: qid,
          qidn: "1",
          ans: evt.target.value,
        });

        $(
          "#question-list-item-" + window.question_order.indexOf(qid) + "-1"
        ).addClass("question-saved-localdb");
        saveSession();
        updateQuestionListPanel();
      });

      db.answers
        .get({ aid: aid, cid: cid, eid: eid, qid: qid, qidn: "1" })
        .then(function (answer) {
          if (answer != undefined) {
            $(".long-answer").text(answer.ans);
          }
          markAnswer(qid, current_question);
        })
        .catch(function (error) {
          console.log(error);
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
      $(".long-answer").change(function (evt) {
        const qidn = evt.target.dataset.qidn.toString();

        // ignore blank text and delete any stored value
        if (evt.target.value.length < 1) {
          db.answers.delete([aid, cid, eid, qid, qidn]);
          $(
            "#question-list-item-" +
              window.question_order.indexOf(qid) +
              "-" +
              qidn
          ).removeClass("question-saved-localdb");
          return;
        }
        // db.answers.put({aid: [cid, eid, qidn], ans: evt.target.value});
        db.answers.put({
          aid: aid,
          cid: cid,
          eid: eid,
          qid: qid,
          qidn: qidn,
          ans: evt.target.value,
        });
        console.log("SAVE", qid, qidn, evt.target.value);

        $(
          "#question-list-item-" +
            window.question_order.indexOf(qid) +
            "-" +
            qidn
        ).addClass("question-saved-localdb");
        saveSession();
        updateQuestionListPanel();
      });

      // Loop through the 5 text areas and retrieve from db
      // could all be retrieved at once with an addition key index
      //

      for (let qidn_count = 1; qidn_count < 6; qidn_count++) {
        db.answers
          .get({
            aid: aid,
            cid: cid,
            eid: eid,
            qid: qid,
            qidn: qidn_count.toString(),
          })
          .then(function (answer) {
            if (answer != undefined) {
              $(".long-answer")
                .eq(parseInt(answer.qidn) - 1)
                .text(answer.ans);
            }
            // We only want to mark once...
            if (qidn_count == 5) {
              markAnswer(qid, current_question);
            }
          })
          .catch(function (error) {
            console.log(error);
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

  updateQuestionListPanel();
  setFocus(section);
}

/**
 * Sets the focus to the required question answer section
 * @param {number} section - section to focus
 */
function setFocus(section) {
  // Horrible (but it works)
  setTimeout(function () {
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
  }, 200);
}

/**
 * Updates the question list panel
 * Test with just a global update (may need to do these individually
 * if it gets slow...)
 */
function updateQuestionListPanel() {
  const cid = window.cid;
  const eid = window.eid;

  console.log("UP");
  // Reset all classes
  db.answers
    .where({ aid: aid, cid: cid, eid: eid })
    .toArray()
    .then(function (answers) {
      $(".question-list-panel div")
        .slice(1)
        .attr("class", "question-list-item");
      answers.forEach(function (answer, n) {
        $(
          "#question-list-item-" +
            window.question_order.indexOf(answer.qid) +
            "-" +
            answer.qidn
        ).addClass("question-saved-localdb");

        if (window.question_type == "rapid" && answer.qidn == "1") {
          if (answer.ans == "Abnormal") {
            $(
              "#question-list-item-" +
                window.question_order.indexOf(answer.qid) +
                "-2"
            ).css("display", "block");
          } else {
            $(
              "#question-list-item-" +
                window.question_order.indexOf(answer.qid) +
                "-2"
            ).css("display", "none");
          }
        }
      });
      // $(".long-answer").text(answer.ans);
    })
    .catch(function (error) {
      console.log("error - ", error);
    });

  db.flags
    .where({ aid: aid, cid: cid, eid: eid })
    .toArray()
    .then(function (answers) {
      answers.forEach(function (answer, n) {
        $(
          "#question-list-item-" +
            window.question_order.indexOf(answer.qid) +
            "-" +
            answer.qidn +
            " span"
        ).css("visibility", "visible");
      });
      // $(".long-answer").text(answer.ans);
    })
    .catch(function (error) {
      console.log("error - ", error);
    });

  if (window.review == true) {
    $(".question-panel-ans").remove();
    for (const qid in window.questions_correct) {
      let q_no = window.question_order.indexOf(qid);
      //console.log("q", q_no, qid, window.questions_correct[qid]);
      let question_list_elements = $(`.question-list-item[data-qid='${q_no}']`);
      //console.log(question_list_elements, window.questions_correct[qid]);
      if (window.questions_correct[qid]) {
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

  if (window.question_type == "rapid") {
    // Loop through all questions and append list items
    for (let n = 1; n < window.number_of_questions + 1; n++) {
      appendQuestionListItem(n, "1");
      appendQuestionListItem(n, "2").hide();
    }
  } else if (window.question_type == "anatomy") {
    for (let n = 1; n < window.number_of_questions + 1; n++) {
      appendQuestionListItem(n, "1");
    }
  } else if (window.question_type == "long") {
    for (let n = 1; n < window.number_of_questions + 1; n++) {
      appendQuestionListItem(n, "1");
      appendQuestionListItem(n, "2");
      appendQuestionListItem(n, "3");
      appendQuestionListItem(n, "4");
      appendQuestionListItem(n, "5");
    }
  }

  $(".question-list-item").click(function (evt) {
    loadQuestion($(this).attr("data-qid"), $(this).attr("data-qidn"));
  });
}

$("#btn-local-file-load").click(function (evt) {
  loadLocalQuestionSet();
});

$("#submit-button").click(function (evt) {
  interact.submitAnswers();
});

$("#review-button").click(function (evt) {
  $(".question-list-panel").toggle();
});

$("#options-button").click(function (evt) {
  loadPacketList(null);
  $("#options-panel").toggle();
});

$("#review-overlay-button").click(function (evt) {
  if (window.review == true) {
    reviewQuestions();
  } else {
    $("#finish-dialog").modal();
  }
});

$("#fullscreen-overlay-button").click(function (evt) {
  if (document.fullscreen == false) {
    document.documentElement.requestFullscreen();
  } else {
    document.exitFullscreen();
  }
});

$("#finish-exam, #time-up-review-button").click(function (evt) {
  window.review = true;
  reviewQuestions();
  $.modal.close();
});

$("#time-up-continue-button").click(function (evt) {
  $.modal.close();
});

$("#finish-cancel").click(function (evt) {
  $.modal.close();
});

$("#overlay-close").click(function (evt) {
  $("#options-panel").hide();
});

$("#review-overlay-close").click(function (evt) {
  $("#review-overlay").hide();
});

/**
 * Gets a json representation of answers
 * @return {JSON} - answers
 */
function getJsonAnswers() {
  const cid = window.cid;
  const eid = window.eid;
  return db.answers.where({ aid: aid, cid: cid, eid: eid }).toArray();
  // .then(function(ans) {
  // console.log(ans);
  // submitAnswers(ans);
  // });
}

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
  if (window.timer != null) {
    window.timer.stop();
  }

  const cid = window.cid;
  const eid = window.eid;
  $("#review-overlay").show();
  $("#review-answer-list").empty();
  $("#review-answer-table").empty();
  $("#review-score").empty();
  $("#exam-stats").hide();

  loadQuestion(0, 0, true);

  db.answers
    .where({ aid: aid, cid: cid, eid: eid })
    .toArray()
    .then(function (answers) {
      let current_answers = {};
      answers.forEach(function (arr, n) {
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
      window.question_order.forEach(function (qid, n) {
        if (window.question_type == "long") {
          $("#review-answer-table").append(
            $(
              `<tr class='review-table-heading' title='Click to load question ${
                n + 1
              }'><td colspan=2>Question ${n + 1}</td></tr>`
            ).click(() => {
              loadQuestion(n);
              $("#review-overlay").hide();
            })
          );
          // $("#review-answer-table").append(`<tr id='review-answer-${qid}'><td class='review-user-answer-cell'></td><td class='review-model-answer-cell'></td></tr>`);
          $("#review-answer-table").append(
            `<tr class='answer-sub'><td>Your answers</td><td>Model answers</td></tr>`
          );

          let model_answers = window.questions[qid].answers;

          // TODO: FIX
          if (model_answers[0] != undefined) {
            model_answers = model_answers[0];
          }
          console.log("test", window.questions[qid], model_answers)

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

          titles.forEach((title, n) => {
            let user_answer = current_answers[`${qid},${n+1}`];
            console.log(`${qid},${n}`, user_answer)
            if (user_answer == undefined) {
              user_answer = "Not answered";
            }
            let user_ans =
              "<h4 class='review-list-header'>" + title + "</h4>" + user_answer;
            let model_ans =
              `<h4 class="review-list-header" name=${n+1}>` +
              title +
              "</h4>" +
              model_answers[title.toLowerCase()];

            $("#review-answer-table").append(
              `<tr class=''><td>${user_ans}</td><td>${model_ans}</td></tr>`
            );
          });

          return;
        }

        $("#review-answer-list").append(
          "<li id='review-answer-" +
            qid +
            "'><a href='#' data-qid=" +
            n +
            ">Question " +
            (n + 1) +
            ":</a> <span>Not answered</span></li>"
        );
        $("#review-answer-list a").click(function (evt) {
          loadQuestion(this.dataset.qid);
          $("#review-overlay").hide();
        });

        db.user_answers
          .get({ qid: qid })
          .then(function (answers) {
            // Merge the question answers with the user saved answers
            let question_answers = window.questions[qid]["answers"];
            if (answers != undefined) {
              question_answers = question_answers.concat(answers.ans);
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
                  "<span class='" +
                    c +
                    "'>Answer: " +
                    user_answer +
                    " (Normal)</span>"
                );
              } else {
                el.html(
                  "<span class='" +
                    c +
                    "'>Answer: " +
                    user_answer +
                    " (Abnormal: " +
                    question_answers.join(", ") +
                    ")</span>"
                );
              }
            }

            if (window.question_type == "rapid") {
              // First check normal vs abnormal
              if (window.questions[qid]["normal"] == true) {
                if (section_1_answer == "Normal") {
                  setReviewAnswer(
                    el,
                    "correct",
                    section_1_answer,
                    true,
                    question_answers
                  );
                  correct_count++;
                  window.questions_correct[qid] = true;
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
                  window.questions_correct[qid] = false;
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
                  window.questions_correct[qid] = true;
                } else {
                  setReviewAnswer(
                    el,
                    "incorrect",
                    section_2_answer,
                    false,
                    question_answers
                  );
                  window.questions_correct[qid] = false;

                  if (section_1_answer == "Not Answered") {
                  } else if (section_1_answer == "Normal") {
                    undercall_number++;
                  } else {
                    // Incorrect calls could be correct if
                    // the answer is not in the database
                    incorrectcall_number++;

                    el.append(
                      "<span class='mark-correct'>[Mark correct]</span>"
                    ).click(() => {
                      markCorrect(qid, section_2_answer);
                      reviewQuestions();
                    });
                  }
                }
              }
            } else if (window.question_type == "anatomy") {
              // Anatomy answers are either correct or incorrect
              if (answerInArray(question_answers, section_1_answer)) {
                correct_count++;
                setReviewAnswer(
                  el,
                  "correct",
                  section_1_answer,
                  false,
                  question_answers
                );
                window.questions_correct[qid] = true;
              } else {
                setReviewAnswer(
                  el,
                  "incorrect",
                  section_1_answer,
                  false,
                  question_answers
                );
                window.questions_correct[qid] = false;
              }
            }

            window.score = correct_count;

            $("#review-score").text(
              "Score: " +
                correct_count +
                " out of " +
                window.question_order.length
            );

            if (window.question_type == "rapid") {
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
          .catch(function (error) {
            console.log("error-", error);
          })
          .finally(() => {
            // This will lead to saveSession being called after each question is marked
            saveSession();
            updateQuestionListPanel();
          });
      });
    })
    .catch(function (error) {
      console.log("error - ", error);
    });
}

/**
 * Marks the loaded question and updates display
 * @param {*} qid -
 * @param {*} current_question -
 */
function markAnswer(qid, current_question) {
  const type = current_question.type;

  let option = null;
  if (window.review == true) {
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
      console.log(current_question);
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
      .get({ qid: qid })
      .then(function (saved_user_answers) {
        // check if given answer matches a user saved answer
        if (saved_user_answers != undefined) {
          saved_user_answers.ans.forEach(function (saved_answer, n) {
            ul.append("<li>" + saved_answer + "</li>");
            if (compareString(saved_answer, user_answer)) {
              textarea.removeClass("incorrect").addClass("correct");
            }
          });
        }

        // check if given answer matches an answer from the question
        current_question.answers.forEach(function (answer, n) {
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
            if (window.allow_self_marking) {
              $(".answer-panel").append(
                $("<button id='mark-correct'>Mark Correct</button>").click(
                  function () {
                    markCorrect(qid, user_answer);
                  }
                )
              );
            }
          }
        }
      })
      .catch(function (error) {
        console.log("error-", error);
      });
    addFeedback(current_question);
    updateQuestionListPanel();
  }
}

function addFeedback(current_question) {
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
  if (
    current_question.hasOwnProperty("feedback_image") &&
    current_question.feedback_image.length > 0
  ) {
    // TODO: finish (load in dicom viewer)
    current_question.feedback_image.forEach((img) => {
      $(".question").append($(`<img class="feedback-image" src="${img}" />`));
    });
  }
}

function markCorrect(qid, user_answer) {
  if (user_answer == "") {
    return;
  }

  db.user_answers
    .get({ qid: qid })
    .then(function (answers) {
      let new_answers = [];
      if (answers != undefined) {
        new_answers = answers.ans;
      }

      new_answers.push(user_answer);
      db.user_answers.put({ qid: qid, ans: new_answers });
    })
    .catch(function (error) {
      console.log("error-", error);
    });

  if (window.allow_self_marking) {
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
  const aid = window.aid;
  const cid = window.cid;
  const eid = window.eid;

  // Bind flag change events
  $("button.flag").click(function (event) {
    const el = $(this);
    const nqid = el.attr("data-qid");
    const qid = window.question_order[nqid];
    const qidn = el.attr("data-qidn");

    el.toggleClass("flag flag-selected");

    if (el.hasClass("flag")) {
      $("#question-list-item-" + nqid + "-" + qidn + " span").css(
        "visibility",
        "hidden"
      );
      db.flags.delete([aid, cid, eid, qid, qidn]);
    } else {
      $("#question-list-item-" + nqid + "-" + qidn + " span").css(
        "visibility",
        "visible"
      );
      db.flags.put({ aid: aid, cid: cid, eid: eid, qid: qid, qidn: qidn });
    }
    updateQuestionListPanel();
  });
}

function loadFlagsFromDb(qid, n) {
  const cid = window.cid;
  const eid = window.eid;
  db.flags
    .get({ aid: aid, cid: cid, eid: eid, qid: qid, qidn: n })
    .then(function (answer) {
      if (answer != undefined) {
        $("button.flag, button.flag-selected")
          .eq(parseInt(answer.qidn) - 1)
          .toggleClass("flag flag-selected");
      }
    })
    .catch(function (error) {
      console.log(error);
    });
}

function showLoginDialog() {
  $("#login-dialog").modal();
}

$("#start-exam-button").click(function (evt) {
  window.cid = parseInt($("#candidate-number").val());
  $.modal.close();
});

$("#start-packet-button").click(function (evt) {
  if (window.timer != null) {
    window.timer.stop();
  }
  window.timer = null;

  let timer = new easytimer.Timer();
  //window.exam_time = 2;
  timer.start({ countdown: true, startValues: { seconds: window.exam_time } });
  timer.addEventListener("secondsUpdated", function (e) {
    $('#timer').html("Time left: " + timer.getTimeValues().toString());
  });
  timer.addEventListener("targetAchieved", function (e) {
    $("#time-up-dialog").modal();
  });

  window.timer = timer;

  $("#timer").click(() => {
    window.timer.pause();

    let time_remaining = window.timer.getTimeValues().toString();

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

  // //const t = 2;
  // let display = document.querySelector("#timer");
  // let timer = new helper.CountDownTimer(window.exam_time);
  // let timeObj = helper.CountDownTimer.parse(window.exam_time);

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

  $.modal.close();
});

$("#btn-delete-databases").click(function (evt) {
  var r = confirm(
    "This will delete ALL saved answers (including saved correct answers)!"
  );
  if (r == true) {
    db.delete()
      .then(() => {
        $.notify("Database successfully deleted", "success");
        $.notify("The page will now reload", "warn");
        setTimeout(() => {
          location.reload();
        }, 2000);
        console.log("Database successfully deleted");
      })
      .catch((err) => {
        $.notify("Error deleting databases", "error");
        console.error("Could not delete database");
      })
      .finally(() => {
        // Do what should be done next...
      });
  } else {
  }
});

$("#btn-delete-current").click(function (evt) {
  if (window.question_order.length < 1) {
    $.notify("No packet is currently loaded", "warn");
    return;
  }

  db.flags
    .where("qid")
    .anyOf(window.question_order)
    .delete()
    .then(function (deleteCount) {
      $.notify("Packet flags deleted", "success");
    })
    .catch((err) => {
      $.notify("Error deleting packet flags", "error");
      $.notify("You may have to delete all answers this time", "info");
    });

  db.answers
    .where("qid")
    .anyOf(window.question_order)
    .delete()
    .then(function (deleteCount) {
      $.notify("Packet successfully reset", "success");
      loadQuestion(0, 0, true);
      // $.notify("The page will now reload", "warn");
      // setTimeout(() => {
      //   location.reload();
      // }, 2000);
      console.log("Deleted " + deleteCount + " objects");
    })
    .catch((err) => {
      $.notify("Error reseting packet", "error");
      $.notify("You may have to delete all answers this time", "info");
      console.log(err);
    });
});

$("#btn-delete-current-saved-answers").click(function (evt) {
  if (window.question_order.length < 1) {
    $.notify("No packet is currently loaded", "warn");
    return;
  }

  db.user_answers
    .where("qid")
    .anyOf(window.question_order)
    .delete()
    .then(function (deleteCount) {
      $.notify("Packet flags deleted", "success");
    })
    .catch((err) => {
      $.notify("Error deleting saved answers", "error");
      $.notify("You may have to delete all answers this time", "info");
    });
});

$(document).ajaxStart(function () {
  $("#loading").show();
});

$(document).ajaxComplete(function () {
  $("#loading").hide();
});

function saveSession() {
  let status = "active";
  if (window.review == true) {
    status = "complete";
  }

  console.log("save session", window.score);

  let time_values = window.timer.getTimeValues();
  let time_remaining =
    time_values.hours * 60 * 60 +
    time_values.minutes * 60 +
    time_values.seconds;
  db.session.put({
    packet: window.packet_name,
    aid: window.aid,
    status: status,
    date: window.date_started,
    score: window.score,
    max_score: window.number_of_questions,
    exam_time: window.exam_time,
    time_left: time_remaining,
    question_order: window.question_order,
    questions_answered: 0, // TODO
    total_questions: window.number_of_questions,
  });
}

// Register Key Event Listener
window.addEventListener("keydown", viewer.keydown_handler);