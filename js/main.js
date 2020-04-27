//cid = null;
var cid = 1234;
var eid = 5678;

var exam_mode = false;

var packet_list = [];

//var questions = null
var question_order = [];
var number_of_questions = null;
var question_type = null;
var loaded_question = null;
var review = false;

var allow_self_marking = true;

var dfile = null;

var a = null;
var b = null;

loadPacketList();

function loadPacketList() {
  var jqxhr = $.getJSON("packets/packets.json", function (data) {
    packet_list = data.packets;
    packet_list.forEach(function (packet) {
      $("#packet-list").append($("<div class='packet-button'>" + packet + "</div>").click(function () {
        loadPacketFromAjax("packets/" + packet);
      }));
    })
    $("#options-panel").show();
  })
    .done(function () {
    })
    .fail(function () {
      console.log("No packet list available");
      showLoginDialog();
    })
    .always(function () {
    });

  //setUpPacket(questions);

}

function loadPacketFromAjax(path) {
  console.log("loading packet from " + path)
  var jqxhr = $.getJSON(path, function (data) {
    setUpPacket(data);
    $("#options-panel").hide();
  })
    .done(function () {
    })
    .fail(function () {
      console.log("Unable to load packet at: " + path);
    })
}

function setUpQuestions() {

  if (questions == undefined) { return }
  // Set an order for the questions
  question_order = [];
  Object.keys(questions).forEach(function (e) {
    question_order.push(e);

    // Make sure answers are arrays
    if (!Array.isArray(questions[e]["answers"])) {
      questions[e]["answers"] = [questions[e]["answers"]];
    }
  });

  question_order = shuffleArray(question_order);
  number_of_questions = Object.keys(questions).length;
  review = false;
  console.log(question_order)

  // Horrible way to get type of questions
  // We assume they are all of the same type....
  if (question_type == null) {
    question_type = questions[Object.keys(questions)[0]].type;
  }

  if (window.exam_mode) {
    $("#options-button, #review-overlay-button").hide();
  } else {
    $("#submit-button").hide();
  }

  loadQuestion(0, 1, true);
  createReviewPanel();
}

// randomise order
function shuffleArray(array) {
  var currentIndex = array.length,
    temporaryValue,
    randomIndex;

  // While there remain elements to shuffle...
  while (0 !== currentIndex) {
    // Pick a remaining element...
    randomIndex = Math.floor(Math.random() * currentIndex);
    currentIndex -= 1;

    // And swap it with the current element.
    temporaryValue = array[currentIndex];
    array[currentIndex] = array[randomIndex];
    array[randomIndex] = temporaryValue;
  }

  return array;
}

// Set up cornerstone (the dicom viewer)
cornerstoneBase64ImageLoader.external.cornerstone = cornerstone;
cornerstoneWebImageLoader.external.cornerstone = cornerstone;
//cornerstoneWebImageLoader.configure({
//  beforeSend: function(xhr) {
//    // Add custom headers here (e.g. auth tokens)
//    //xhr.setRequestHeader('x-auth-token', 'my auth token');
//  }
//});

cornerstoneWADOImageLoader.external.cornerstone = cornerstone;

//cornerstoneWADOImageLoader.configure({
//  beforeSend: function(xhr) {
//    // Add custom headers here (e.g. auth tokens)
//    //xhr.setRequestHeader('APIKEY', 'my auth token');
//  }
//});

cornerstoneTools.init();

//Set up database
var db = new Dexie("answers_database");
db.version(1).stores({
  answers: "[cid+eid+qid+qidn], [cid+eid], ans",
  flags: "[cid+eid+qid+qidn], [cid+eid]",
  user_answers: "qid, ans"
});

function setUpPacket(data) {
  if (data.hasOwnProperty("exam_name")) {
    $(".exam-name").text("Exam: " + data.exam_name);
  }

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

  setUpQuestions();
}


function loadQuestion(n, section = 1, force_reload = false) {
  // Make sure we have an integer
  n = parseInt(n);

  qid = question_order[n];
  current_question = questions[qid];

  console.log("N=", n, section, current_question);

  if (n == loaded_question && force_reload == false) {
    // Question already loaded
    setFocus(section);
    return;
  }

  loaded_question = n;

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

  if (n == number_of_questions - 1) {
    $(".navigation[value='next']").attr("disabled", "disabled");
  } else {
    $(".navigation[value='next']")
      .removeAttr("disabled")
      .click(function () {
        loadQuestion(n + 1);
      });
  }

  display_n = n + 1;

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
  el = document.getElementById("dicom-image");
  if (el != undefined) {
    cornerstone.disable(el);
    $(".canvas-panel").remove();
  }

  // Set up thumbnails
  thumbnails = $(".thumbs");
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

      thumbnail = $(".figure .thumbnail").get(id);
      //cornerstone.enable(thumbnail)
      //based_img = current_question.images[id];
      based_img = image;

      // based (image) data url, just load the image directly
      if (based_img.startsWith("data:image/")) {
        img = $("<img />", {
          src: based_img,
          id: "thumb-" + id,
          class: "thumbnail",
          title: "Click on the thumbnail to view and manipulate the image.",
          draggable: "false",
          style: "height: 100px;"
        });

        $("#figure-" + id).append(img);

        // otherwise try to load it as a dicom
      } else {
        // convert the data url to a file
        urltoFile(based_img, "dicom", "application/dicom").then(function (
          dfile
        ) {
          // load the file using cornerstoneWADO file loader
          const imageId = cornerstoneWADOImageLoader.wadouri.fileManager.add(
            dfile
          );
          cornerstone.loadAndCacheImage(imageId).then(function (image) {
            img = $("<div></div>").get(0);
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
          }); //.catch( function(error) {
        });
      }
    });
  }

  $(".thumbs .figure").each(function handleThumbnailClicks(id, thumbnail) {
    thumbnail.onclick = function (event) {
      view(event, this);
    };
  });

  function view(t, source) {
    if (current_question) {
      // Check if the figure is already loaded (or if another one is)
      open_figure = $("#dicom-image").data("figure");
      figure_to_load = source.id;

      if (open_figure != undefined) {
        // No full size figure / dicom loaded yet
        if (figure_to_load == open_figure) {
          return;
        } else {
          el = document.getElementById("dicom-image");
          if (el != undefined) {
            cornerstone.disable(el);
            $(".canvas-panel").remove();
          }
        }
      }

      $(".figure-open")
        .removeClass("figure-open")
        .addClass("figure");

      source.className = "figure-open";

      $(".question").append(
        '<div class= "canvas-panel"><div id="dicom-image" data-figure="' +
        figure_to_load +
        '"></div></div>'
      );

      images = current_question.images[figure_to_load.split("-")[1]];
      //images = current_question.images

      // Make sure we have an array
      if (!Array.isArray(images)) {
        images = [images];
      }

      load(images);

      async function load(images) {
        imageIds = [];
        for (i = 0; i < images.length; i++) {
          data_url = images[i];
          // check stack type
          if (data_url.startsWith("data:image")) {
            imageId = "base64://" + data_url.split(",")[1];

            imageIds.push(imageId);
          } else if (data_url.startsWith("data:application/dicom")) {
            //stack = stack.split(";")[1];

            dfile = await urltoFile(data_url, "dicom", "application/dicom");

            const imageId = cornerstoneWADOImageLoader.wadouri.fileManager.add(
              dfile
            );
            imageIds.push(imageId);
            //cornerstone.loadImage(imageId).then(function(image) {
            //    tempFunction(image);
            //});
          }
        }
        const stack = {
          currentImageIdIndex: 0,
          imageIds
        };
        //cornerstone.loadAndCacheImage(imageIds[0]).then(function(image) {
        cornerstone.loadAndCacheImage(imageIds[0]).then(function (image) {
          loadMainImage(image, stack);
        });
      }
    }
  }

  //Answer setup
  ap = $(".answer-panel");
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
          cid,
          eid: eid,
          qid: qid,
          qidn: "1",
          ans: evt.target.value
        });
        updateReviewPanel();
      });

      // Save long answers on textchange
      $(".long-answer").change(function (evt) {
        // ignore blank text and delete any stored value
        if (evt.target.value.length < 1) {
          db.answers.delete([cid, eid, qid, "2"]);
          $(
            "#question-list-item-" + question_order.indexOf(qid) + "-2"
          ).removeClass("question-saved-localdb");
          return;
        }
        //db.answers.put({aid: [cid, eid, qidn], ans: evt.target.value});
        db.answers.put({
          cid: cid,
          eid: eid,
          qid: qid,
          qidn: "2",
          ans: evt.target.value
        });

        $("#question-list-item-" + question_order.indexOf(qid) + "-2").addClass(
          "question-saved-localdb"
        );

        updateReviewPanel();
      });

      // We chain our db requests as we can only check answers once
      // they have been loaded (should probably use then or after)

      db.answers
        .get({ cid: cid, eid: eid, qid: qid, qidn: "1" })
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
          console.log("error-", error);
        })
        .then(
          db.answers
            .get({ cid: cid, eid: eid, qid: qid, qidn: "2" })
            .then(function (answer) {
              if (answer != undefined) {
                console.log(answer);
                $(".long-answer").text(answer.ans);
              }
              markAnswer(qid, "rapid");
            })
            .catch(function (error) {
              console.log("error-", error);
            })
        );

      addFlagEvents();
      loadFlagsFromDb("1");
      loadFlagsFromDb("2");

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
          db.answers.delete([cid, eid, qid, "1"]);
          $(
            "#question-list-item-" + question_order.indexOf(qid) + "-1"
          ).removeClass("question-saved-localdb");
          return;
        }
        //db.answers.put({aid: [cid, eid, qidn], ans: evt.target.value});
        db.answers.put({
          cid: cid,
          eid: eid,
          qid: qid,
          qidn: "1",
          ans: evt.target.value
        });

        $("#question-list-item-" + question_order.indexOf(qid) + "-1").addClass(
          "question-saved-localdb"
        );
        updateReviewPanel();
      });

      db.answers
        .get({ cid: cid, eid: eid, qid: qid, qidn: "1" })
        .then(function (answer) {
          if (answer != undefined) {
            $(".long-answer").text(answer.ans);
          }
          markAnswer(qid, "anatomy");
        })
        .catch(function (error) {
          console.log(error);
        });

      addFlagEvents();
      loadFlagsFromDb("1");

      break;
    }

    case "long": {
      ap.append(
        '<div class="answer-item"><div class="answer-label-outer"><p class="answer-label-inner"><span class="answer-label-number">' +
        display_n +
        '.1</span><span style="flex:1">Observations</span><button class="flag" data-qid="' +
        n +
        '" data-qidn=1 style="margin-right:0">⚐</button></p></div><textarea class="long-answer" data-qidn=1 name="Observations" style="overflow-x: hidden; overflow-wrap: break-word; height: 80px;"></textarea></div>'
      );
      ap.append(
        '<div class="answer-item"><div class="answer-label-outer"><p class="answer-label-inner"><span class="answer-label-number">' +
        display_n +
        '.2</span><span style="flex:1">Interpretation</span><button class="flag" data-qid="' +
        n +
        '" data-qidn=2 style="margin-right:0">⚐</button></p></div><textarea class="long-answer" data-qidn=2 name="Interpretation" style="overflow-x: hidden; overflow-wrap: break-word; , trueheight: 80px;"></textarea></div>'
      );
      ap.append(
        '<div class="answer-item"><div class="answer-label-outer"><p class="answer-label-inner"><span class="answer-label-number">' +
        display_n +
        '.3</span><span style="flex:1">Principle Diagnosis</span><button class="flag" data-qid="' +
        n +
        '" data-qidn=3 style="margin-right:0">⚐</button></p></div><textarea class="long-answer" data-qidn=3 name="Principle Diagnosis" style="overflow-x: hidden; overflow-wrap: break-word; height: 80px;"></textarea></div>'
      );
      ap.append(
        '<div class="answer-item"><div class="answer-label-outer"><p class="answer-label-inner"><span class="answer-label-number">' +
        display_n +
        '.4</span><span style="flex:1">Differential Diagnosis</span><button class="flag" data-qid="' +
        n +
        '" data-qidn=4 style="margin-right:0">⚐</button></p></div><textarea class="long-answer" data-qidn=4 name="Differential Diagnosis" style="overflow-x: hidden; overflow-wrap: break-word; height: 80px;"></textarea></div>'
      );
      ap.append(
        '<div class="answer-item"><div class="answer-label-outer"><p class="answer-label-inner"><span class="answer-label-number">' +
        display_n +
        '.5</span><span style="flex:1">Management (if appropriate)</span><button class="flag" data-qid="' +
        n +
        '" data-qidn=5 style="margin-right:0">⚐</button></p></div><textarea class="long-answer" data-qidn=5 name="Management (if appropriate)" style="overflow-x: hidden; overflow-wrap: break-word; height: 80px;"></textarea></div>'
      );

      // Save long answers on textchange
      $(".long-answer").change(function (evt) {
        qidn = evt.target.dataset.qidn.toString();

        // ignore blank text and delete any stored value
        if (evt.target.value.length < 1) {
          db.answers.delete([cid, eid, qid, qidn]);
          $(
            "#question-list-item-" + question_order.indexOf(qid) + "-" + qidn
          ).removeClass("question-saved-localdb");
          return;
        }
        //db.answers.put({aid: [cid, eid, qidn], ans: evt.target.value});
        db.answers.put({
          cid: cid,
          eid: eid,
          qid: qid,
          qidn: qidn,
          ans: evt.target.value
        });
        console.log("SAVE", qid, qidn, evt.target.value);

        $(
          "#question-list-item-" + question_order.indexOf(qid) + "-" + qidn
        ).addClass("question-saved-localdb");

        updateReviewPanel();
      });

      // Loop through the 5 text areas and retrieve from db
      // could all be retrieved at once with an addition key index
      //

      for (var qidn_count = 1; qidn_count < 6; qidn_count++) {
        db.answers
          .get({ cid: cid, eid: eid, qid: qid, qidn: qidn_count.toString() })
          .then(function (answer) {
            if (answer != undefined) {
              $(".long-answer")
                .eq(parseInt(answer.qidn) - 1)
                .text(answer.ans);
            }
            //markAnswer(qid, "anatomy");
          })
          .catch(function (error) {
            console.log(error);
          });
      }

      addFlagEvents();
      loadFlagsFromDb("1");
      loadFlagsFromDb("2");
      loadFlagsFromDb("3");
      loadFlagsFromDb("4");
      loadFlagsFromDb("5");

      break;
    }
  }

  updateReviewPanel();
  setFocus(section);
}

function setFocus(section) {
  // Horrible (but it works)
  setTimeout(function () {
    // In pratique it selects the end of a textarea but I'm not sure if I can be bothered...
    $("*[data-answer-section-qidn=" + section + "]").focus();
  }, 200);
}

// Test with just a global update (may need to do these individually if it gets slow...)
function updateReviewPanel() {
  console.log("UP");
  // Reset all classes
  db.answers
    .where({ cid: cid, eid: eid })
    .toArray()
    .then(function (answers) {
      $(".question-list-panel div")
        .slice(1)
        .attr("class", "question-list-item");
      answers.forEach(function (answer, n) {
        $(
          "#question-list-item-" +
          question_order.indexOf(answer.qid) +
          "-" +
          answer.qidn
        ).addClass("question-saved-localdb");

        if (question_type == "rapid" && answer.qidn == "1") {
          if (answer.ans == "Abnormal") {
            $(
              "#question-list-item-" + question_order.indexOf(answer.qid) + "-2"
            ).css("display", "block");
          } else {
            $(
              "#question-list-item-" + question_order.indexOf(answer.qid) + "-2"
            ).css("display", "none");
          }
        }
      });
      //$(".long-answer").text(answer.ans);
    })
    .catch(function (error) {
      console.log("error - ", error);
    });

  db.flags
    .where({ cid: cid, eid: eid })
    .toArray()
    .then(function (answers) {
      answers.forEach(function (answer, n) {
        $(
          "#question-list-item-" +
          question_order.indexOf(answer.qid) +
          "-" +
          answer.qidn +
          " span"
        ).css("visibility", "visible");
      });
      //$(".long-answer").text(answer.ans);
    })
    .catch(function (error) {
      console.log("error - ", error);
    });
}

function createReviewPanel() {
  $(".question-list-panel").empty();
  $(".question-list-panel").append(
    '<div class="review-heading">Questions</div>'
  );

  function appendReviewItem(n, qidn) {
    qn = n - 1;
    el = $(
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
    for (let n = 1; n < number_of_questions + 1; n++) {
      appendReviewItem(n, "1");
      appendReviewItem(n, "2").hide();
    }
  } else if (question_type == "anatomy") {
    for (let n = 1; n < number_of_questions + 1; n++) {
      appendReviewItem(n, "1");
    }
  } else if (question_type == "long") {
    for (let n = 1; n < number_of_questions + 1; n++) {
      appendReviewItem(n, "1");
      appendReviewItem(n, "2");
      appendReviewItem(n, "3");
      appendReviewItem(n, "4");
      appendReviewItem(n, "5");
    }
  }

  $(".question-list-item").click(function (evt) {
    loadQuestion($(this).attr("data-qid"), $(this).attr("data-qidn"));
  });
}

function find_option(select, text) {
  for (var i = 0; i < select.length; ++i) {
    if (select.options[i].value == text) {
      return i;
    }
  }
  return undefined;
}

// We use the same key bindings
function keydown_handler(event) {
  var target_element = event.target.tagName;

  // Catch all keypresses unless user is typing
  if (target_element == "INPUT" || target_element == "TEXTAREA") {
    return;
  }
  var sel = $(".control-overlay").get(0);
  switch (event.code) {
    case "KeyP":
      sel.selectedIndex = find_option(sel, "pan");
      changeControlSelection();
      break;
    case "KeyZ":
      sel.selectedIndex = find_option(sel, "zoom");
      changeControlSelection();
      break;
    case "KeyR":
      sel.selectedIndex = find_option(sel, "rotate");
      changeControlSelection();
      break;
    case "KeyS":
      sel.selectedIndex = find_option(sel, "scroll");
      changeControlSelection();
      break;
    case "KeyW":
      sel.selectedIndex = find_option(sel, "window");
      changeControlSelection();
      break;
    case "KeyA":
      sel.selectedIndex = find_option(sel, "abdomen");
      changeControlSelection();
      break;
    case "KeyU":
      sel.selectedIndex = find_option(sel, "pulmonary");
      changeControlSelection();
      break;
    case "KeyB":
      sel.selectedIndex = find_option(sel, "brain");
      changeControlSelection();
      break;
    case "KeyO":
      sel.selectedIndex = find_option(sel, "bone");
      changeControlSelection();
      break;
    case "KeyE":
      sel.selectedIndex = find_option(sel, "reset");
      //$("#dicom-image").get(0).scrollIntoView(false);
      changeControlSelection();
      break;
    // Escape and C do the same
    case "KeyC":
    case "Escape":
      sel.selectedIndex = find_option(sel, "close");
      changeControlSelection();
      break;
    case "Enter":
      t.focus();
      break;
    // TODO: implement arrow stuff
    //
    case "ArrowUp": {
      // Arrow function depends on the currently selected option
      switch (sel.options[sel.selectedIndex].value) {
        case "pan":
          manualPanDicom(0, -1);
          break;
        case "zoom":
          //_this.current_dicom.current_view.pre_scale_at(1.01, 1.01, _this.current_dicom.cols / 2, _this.current_dicom.rows / 2);
          manualZoomDicom(1);
          break;
        case "rotate":
          manualRotateDicom(-1);
          break;
        case "scroll":
          manualScrollDicom(-1);
          break;
        case "window":
          manualWindowDicom(1, 0);
          break;
      }
      break;
    }
    case "ArrowDown": {
      switch (sel.options[sel.selectedIndex].value) {
        case "pan":
          manualPanDicom(0, 1);
          break;
        case "zoom":
          manualZoomDicom(-1);
          break;
        case "rotate":
          manualRotateDicom(1);
          break;
        case "scroll":
          manualScrollDicom(1);
          break;
        case "window":
          manualWindowDicom(-1, 0);
          break;
      }
      break;
    }
    case "ArrowLeft": {
      switch (sel.options[sel.selectedIndex].value) {
        case "pan":
          manualPanDicom(-1, 0);
          break;
        case "zoom":
          manualZoomDicom(-1);
          break;
        case "rotate":
          manualRotateDicom(1);
          break;
        case "scroll":
          manualScrollDicom(1);
          break;
        case "window":
          manualWindowDicom(0, -1);
          break;
      }
      break;
    }
    case "ArrowRight": {
      switch (sel.options[sel.selectedIndex].value) {
        case "pan":
          manualPanDicom(1, 0);
          break;
        case "zoom":
          manualZoomDicom(1);
          break;
        case "rotate":
          manualRotateDicom(-1);
          break;
        case "scroll":
          manualScrollDicom(-1);
          break;
        case "window":
          manualWindowDicom(0, 1);
          break;
      }
      break;
    }
  }
  event.preventDefault();
}

function changeControlSelection(event) {
  //We also duplicate the sel that are available
  var sel = $(".control-overlay").get(0);

  old = sel.oldSelectedIndex;
  sel.oldSelectedIndex = sel.selectedIndex;

  console.log(event);

  dicom_element = document.getElementById("dicom-image");
  switch (sel.options[sel.selectedIndex].value) {
    case "pan": {
      cornerstoneTools.setToolActive("Pan", { mouseButtonMask: 1 });
      break;
    }
    case "zoom": {
      cornerstoneTools.setToolActive("Zoom", { mouseButtonMask: 1 });
      break;
    }
    case "rotate": {
      cornerstoneTools.setToolActive("Rotate", { mouseButtonMask: 1 });
      break;
    }
    case "scroll": {
      cornerstoneTools.setToolActive("StackScroll", { mouseButtonMask: 1 });
      //_this.left.onstart = _this.scroll_start;
      //_this.selected_control = t.selectedIndex;
      break;
    }
    case "window": {
      cornerstoneTools.setToolActive("Wwwc", { mouseButtonMask: 1 });
      break;
    }
    case "abdomen": {
      let viewport = cornerstone.getViewport(dicom_element);
      viewport.voi.windowCenter = 150;
      viewport.voi.windowWidth = 500;
      cornerstone.setViewport(dicom_element, viewport);
      sel.selectedIndex = find_option(sel, "window");
      changeControlSelection();
      break;
    }
    case "pulmonary": {
      let viewport = cornerstone.getViewport(dicom_element);
      viewport.voi.windowCenter = -500;
      viewport.voi.windowWidth = 1500;
      cornerstone.setViewport(dicom_element, viewport);
      sel.selectedIndex = find_option(sel, "window");
      changeControlSelection();
      break;
    }
    case "brain": {
      let viewport = cornerstone.getViewport(dicom_element);
      viewport.voi.windowCenter = 50;
      viewport.voi.windowWidth = 80;
      cornerstone.setViewport(dicom_element, viewport);
      sel.selectedIndex = find_option(sel, "window");
      changeControlSelection();
      break;
    }
    case "bone": {
      let viewport = cornerstone.getViewport(dicom_element);
      viewport.voi.windowCenter = 570;
      viewport.voi.windowWidth = 3000;
      cornerstone.setViewport(dicom_element, viewport);
      sel.selectedIndex = find_option(sel, "window");
      changeControlSelection();
      break;
    }
    case "reset": {
      cornerstone.reset(dicom_element);
      sel.selectedIndex = old;
      sel.oldSelectedIndex = old;
      break;
    }
    case "close": {
      // disable fullscreen if required
      if ($(".canvas-panel").length == 0) {
        disableFullscreen(dicom_element);
      }
      if (dicom_element != undefined) {
        cornerstone.removeElementData(dicom_element);
        cornerstone.disable(dicom_element);
        $(".canvas-panel").remove();
        $(".figure-open")
          .removeClass("figure-open")
          .addClass("figure");
        $(dicom_element).remove();
      }
      break;
    }
  }
  sel.blur();
  if (event) {
    event.preventDefault();
  }
}

function onImageRendered(e) {
  const eventData = e.detail;

  // Update ww/wl
  sel = $(".control-overlay").get(0);
  sel.options[find_option(sel, "window")].firstChild.textContent =
    "window (" +
    Math.round(eventData.viewport.voi.windowCenter) +
    " \u00b1 " +
    Math.round(eventData.viewport.voi.windowWidth) +
    ")";

  // update stack data
  stack = eventData.enabledElement.toolStateManager.toolState.stack.data[0];
  if (stack.imageIds.length > 1) {
    $("option[value=scroll").prop("disabled", false);
    $("option[value=scroll").prop("hidden", false);
    $("option[value=scroll").text(
      "scroll (" +
      (stack.currentImageIdIndex + 1) +
      "/" +
      stack.imageIds.length +
      ")"
    );

    // Temp way to enable CT window presets
    // Enable for all stacked images...
    $("option[value=abdomen").prop("hidden", false);
    $("option[value=pulmonary").prop("hidden", false);
    $("option[value=brain").prop("hidden", false);
    $("option[value=bone").prop("hidden", false);
    $("option[value=abdomen").prop("disabled", false);
    $("option[value=pulmonary").prop("disabled", false);
    $("option[value=brain").prop("disabled", false);
    $("option[value=bone").prop("disabled", false);
  }
}

function disableFullscreen(dicom_element) {
  // TODO: rescale the image to stop it getting zoomed in
  $(".canvas-panel-fullscreen").toggleClass(
    "canvas-panel canvas-panel-fullscreen"
  );
  $(".question").append($(".canvas-panel"));
  $(".canvas-panel")
    .get(0)
    .scrollIntoView();

  setDicomCanvasNonFullscreen(dicom_element);
}

// Register Key Event Listener
window.addEventListener("keydown", keydown_handler);

$("#submit-button").click(function (evt) {
  submitAnswers();
});

$("#review-button").click(function (evt) {
  $(".question-list-panel").toggle();
});

$("#options-button").click(function (evt) {
  $("#options-panel").toggle();
});

$("#review-overlay-button").click(function (evt) {
  if (review == true) {
    reviewQuestions();
  } else {
    $("#finish-dialog").modal();
  }
});

$("#finish-exam").click(function (evt) {
  review = true;
  reviewQuestions();
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

function getJsonAnswers() {
  return db.answers.where({ cid: cid, eid: eid }).toArray();
  // .then(function(ans) {
  // console.log(ans);
  // submitAnswers(ans);
  // });
}

function postAnswers(ans) {
  console.log(ans);
  //ans = {"test" : 1}
  $.post("http://localhost:8000/submit_answers", JSON.stringify(ans)).done(
    data => {
      console.log(data);
    }
  );
  //$.post( "http://localhost:8000/submit_answers", JSON.stringify(ans));
}

function loadLocalQuestionSet() {
  var input, file, fr;

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

  function receivedText(e) {
    let lines = e.target.result;
    j = JSON.parse(lines);
    setUpPacket(j);
  }
}

function submitAnswers() {
  console.log(
    getJsonAnswers().then(a => {
      postAnswers(a);
    })
  );
}

// Displays the review question panel with a summary of marks
function reviewQuestions() {
  $("#review-overlay").show();
  $("#review-answer-list").empty();

  loadQuestion(0);

  db.answers
    .where({ cid: cid, eid: eid })
    .toArray()
    .then(function (answers) {
      current_answers = {};
      answers.forEach(function (arr, n) {
        answer = arr["ans"];
        if (answer == undefined) {
          answer = "Not answered";
        }

        current_answers[[arr["qid"], arr["qidn"]]] = answer;
      });

      correct_count = 0;
      question_order.forEach(function (qid, n) {
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
            question_answers = questions[qid]["answers"];
            if (answers == undefined) {
            } else {
              question_answers = question_answers.concat(answers.ans);
            }

            section_1_answer = current_answers[[qid, "1"]];
            section_2_answer = current_answers[[qid, "2"]];

            if (section_1_answer == undefined) {
              section_1_answer = "Not Answered";
            }
            if (section_2_answer == undefined) {
              if (section_1_answer == "Normal") {
                section_2_answer = "Normal";
              } else {
                section_2_answer = "Not Answered";
              }
            }

            el = $("#review-answer-" + qid + " span");

            // Helper function to define how review items are displayed
            // Yes it is a bit shit
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

            if (question_type == "rapid") {
              // First check normal vs abnormal
              if (questions[qid]["normal"] == true) {
                if (section_1_answer == "Normal") {
                  setReviewAnswer(
                    el,
                    "correct",
                    section_1_answer,
                    true,
                    question_answers
                  );
                  correct_count++;
                } else {
                  setReviewAnswer(
                    el,
                    "incorrect",
                    section_1_answer,
                    true,
                    question_answers
                  );
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
                } else {
                  setReviewAnswer(
                    el,
                    "incorrect",
                    section_2_answer,
                    false,
                    question_answers
                  );
                }
              }
            } else if (question_type == "anatomy") {
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
              } else {
                setReviewAnswer(
                  el,
                  "incorrect",
                  section_1_answer,
                  false,
                  question_answers
                );
              }
            }

            $("#review-score").text(
              "Score: " + correct_count + " out of " + question_order.length
            );
          })
          .catch(function (error) {
            console.log("error-", error);
          });
      });
    })
    .catch(function (error) {
      console.log("error - ", error);
    });
}

// Marks the loaded question and updates display
function markAnswer(qid, type) {
  console.log("mark", qid);

  if (review == true) {
    // Disable all possible answer elements
    $("#rapid-option,.long-answer").attr("disabled", "true");

    if (type == "rapid") {
      option = document.getElementById("rapid-option");
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
        return addFeedback();
      }
    }

    $(".answer-panel").append(
      "<div id='correct-answer-block'>Correct answer(s):<ul id='answer-list'></ul></div>"
    );
    ul = $("#answer-list");

    textarea = $(".long-answer");
    textarea.addClass("incorrect");

    user_answer = textarea.val();

    db.user_answers
      .get({ qid: qid })
      .then(function (answers) {
        if (answers != undefined) {
          answers.ans.forEach(function (answer, n) {
            ul.append("<li>" + answer + "</li>");
            if (compareString(answer, user_answer)) {
              textarea.removeClass("incorrect").addClass("correct");
            }
          });
        }

        current_question.answers.forEach(function (answer, n) {
          ul.append("<li>" + answer + "</li>");
          if (compareString(answer, user_answer)) {
            textarea.removeClass("incorrect").addClass("correct");
          }
        });

        if (type == "rapid" && option.value != "Abnormal") {
          option.classList.add("incorrect");
        } else {
          if (
            textarea.hasClass("incorrect") == true &&
            user_answer.replace(/\s/g, "") != ""
          ) {
            if (allow_self_marking) {
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
    addFeedback();
  }
}

function addFeedback() {
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
}

function markCorrect(qid, user_answer) {
  if (user_answer == "") {
    return;
  }

  db.user_answers
    .get({ qid: qid })
    .then(function (answers) {
      if (answers == undefined) {
        new_answers = [];
      } else {
        new_answers = answers.ans;
      }

      new_answers.push(user_answer);
      db.user_answers.put({ qid: qid, ans: new_answers });
    })
    .catch(function (error) {
      console.log("error-", error);
    });

  if (allow_self_marking) {
    $("#mark-correct").remove();
  }

  textarea = $(".long-answer").attr("class", "correct");
}

function compareString(a, b) {
  return (
    a.toLowerCase().replace(/\s/g, "") == b.toLowerCase().replace(/\s/g, "")
  );
}

function answerInArray(arr, ans) {
  return (
    arr
      .map(v => v.toLowerCase().replace(/\s/g, ""))
      .includes(ans.toLowerCase().replace(/\s/g, "")) == true
  );
}

function addFlagEvents() {
  // Bind flag change events
  $("button.flag").click(function (event) {
    el = $(this);
    nqid = el.attr("data-qid");
    qid = question_order[nqid];
    qidn = el.attr("data-qidn");

    el.toggleClass("flag flag-selected");

    if (el.hasClass("flag")) {
      $("#question-list-item-" + nqid + "-" + qidn + " span").css(
        "visibility",
        "hidden"
      );
      db.flags.delete([cid, eid, qid, qidn]);
    } else {
      $("#question-list-item-" + nqid + "-" + qidn + " span").css(
        "visibility",
        "visible"
      );
      db.flags.put({ cid: cid, eid: eid, qid: qid, qidn: qidn });
    }
    updateReviewPanel();
  });
}

function loadFlagsFromDb(n) {
  db.flags
    .get({ cid: cid, eid: eid, qid: qid, qidn: n })
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

function urltoFile(url, filename, mimeType) {
  return fetch(url)
    .then(function (res) {
      return res.arrayBuffer();
    })
    .then(function (buf) {
      return new File([buf], filename, { type: mimeType });
    });
}

function loadMainImage(image, stack) {
  const PanTool = cornerstoneTools.PanTool;
  const ZoomTool = cornerstoneTools.ZoomTool;
  const WwwcTool = cornerstoneTools.WwwcTool;
  const RotateTool = cornerstoneTools.RotateTool;
  const StackScrollTool = cornerstoneTools.StackScrollTool;

  const element = document.getElementById("dicom-image");
  cornerstone.enable(element);

  cornerstone.displayImage(element, image);

  cornerstoneTools.addStackStateManager(element, ["stack"]);
  cornerstoneTools.addToolState(element, "stack", stack);

  cornerstoneTools.addTool(PanTool);
  cornerstoneTools.addTool(ZoomTool);
  cornerstoneTools.addTool(WwwcTool);
  cornerstoneTools.addTool(RotateTool);
  cornerstoneTools.addTool(StackScrollTool);

  cornerstoneTools.setToolActive("Pan", { mouseButtonMask: 1 });

  element.addEventListener("cornerstoneimagerendered", onImageRendered);

  setDicomCanvasNonFullscreen(element);
  cornerstone.reset(element);
  element.scrollIntoView(false);
  //element.scrollTo(0);

  $(element).dblclick(function () {
    if ($(".canvas-panel").length == 0) {
      // already fullscreen (disable it)
      disableFullscreen(this);
    } else {
      $(".content-panel").append($(".canvas-panel"));
      $(".canvas-panel").toggleClass("canvas-panel canvas-panel-fullscreen");
      $("#dicom-image").attr("height", "100%");
      $("#dicom-image").height("100%");
      //$(".cornerstone-canvas").attr("height", "100%");
      //$(".cornerstone-canvas").height("100%");
      cornerstone.resize(this, true);
    }
  });

  element.removeEventListener("wheel", element.wheelEventHandler);

  // Add tool selector
  $(".canvas-panel").append(
    '<select class="control-overlay"><option value="pan">pan [p]</option><option value="zoom">zoom [z]</option><option value="rotate">rotate [r]</option><option value="scroll" hidden="" disabled="">scroll (1/1)</option><option value="window">window ()</option><option value="abdomen" hidden="" disabled="">window = abdomen [a]</option><option value="pulmonary" hidden="" disabled="">window = pulmonary [u]</option><option value="brain" hidden="" disabled="">window = brain [b]</option><option value="bone" hidden="" disabled="">window = bone [o]</option><option value="reset">reset [e]</option><option value="close">close [c]</option><option disabled="true" value="notes">[modality = CR][size = 9.8]</option></select>'
  );

  $(".control-overlay")
    .get(0)
    .addEventListener("change", changeControlSelection);
}

function setDicomCanvasNonFullscreen(element) {
  h = window.innerHeight - $(".nav-bar").height() - 4;
  $("#dicom-image").attr("height", h);
  $("#dicom-image").height(h);
  //$("#dicom-image.cornerstone-canvas").attr("height", h);
  //$("#dicom-image.cornerstone-canvas").height(h);

  $("#dicom-image .cornerstone-canvas").attr("width", "100%");

  cornerstone.resize(element, true);
}

function showLoginDialog() {
  $("#login-dialog").modal();
}

$("#start-exam-button").click(function (evt) {
  cid = parseInt($("#candidate-number").val());
  $.modal.close();
});


function manualPanDicom(x, y) {
  dicom_element = document.getElementById("dicom-image");
  let viewport = cornerstone.getViewport(dicom_element);

  viewport.translation.x += x;
  viewport.translation.y += y;

  cornerstone.setViewport(dicom_element, viewport);
}

function manualZoomDicom(delta) {
  dicom_element = document.getElementById("dicom-image");
  let viewport = cornerstone.getViewport(dicom_element);

  viewport.scale += delta / 100;

  cornerstone.setViewport(dicom_element, viewport);
}

function manualRotateDicom(delta) {
  dicom_element = document.getElementById("dicom-image");
  let viewport = cornerstone.getViewport(dicom_element);

  viewport.rotation += delta;

  cornerstone.setViewport(dicom_element, viewport);
}

function manualScrollDicom(n) {
  // There must be a better way to do this...
  dicom_element = document.getElementById("dicom-image");
  c = cornerstone.getEnabledElement(dicom_element);
  max = c.toolStateManager.toolState.stack.data[0].imageIds.length;

  if (max < 2) {
    return;
  }

  current_index =
    c.toolStateManager.toolState.stack.data[0].currentImageIdIndex;

  // Loop through stack if out of bounds
  // Yes it is annoying but it's the way it is done...
  new_index = current_index + n;
  if (new_index >= max) {
    new_index = new_index - max;
  } else if (new_index < 0) {
    new_index = new_index + max;
  }

  c.toolStateManager.toolState.stack.data[0].currentImageIdIndex = new_index;
  id = c.toolStateManager.toolState.stack.data[0].imageIds[new_index];
  cornerstone.loadImage(id).then(b => {
    cornerstone.displayImage(dicom_element, b);
  });
  //c = cornerstone.getEnabledElement(dicom_element)
}

function manualWindowDicom(wl, ww) {
  dicom_element = document.getElementById("dicom-image");
  let viewport = cornerstone.getViewport(dicom_element);

  // For reference
  // brightness ~= wl
  // contrast ~= ww

  viewport.voi.windowCenter += wl;
  viewport.voi.windowWidth += ww;

  cornerstone.setViewport(dicom_element, viewport);
}

function debugCornerstone() {
  dicom_element = document.getElementById("dicom-image");
  viewport = cornerstone.getViewport(dicom_element);
  c = cornerstone.getEnabledElement(dicom_element);
}
