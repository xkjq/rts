/* global cornerstone, cornerstoneTools, cornerstoneBase64ImageLoader, cornerstoneWebImageLoader, cornerstoneWADOImageLoader */
/**
 * Load the main image
 * @param {*} image -
 * @param {*} stack -
 */
export function loadMainImage(image, stack) {
  const PanTool = cornerstoneTools.PanTool;
  const ZoomTool = cornerstoneTools.ZoomTool;
  const WwwcTool = cornerstoneTools.WwwcTool;
  const RotateTool = cornerstoneTools.RotateTool;
  const StackScrollTool = cornerstoneTools.StackScrollTool;
  const ArrowAnnotateTool = cornerstoneTools.ArrowAnnotateTool;

  const element = document.getElementById("dicom-image");
  cornerstone.enable(element);

  cornerstone.displayImage(element, image);

  cornerstoneTools.addStackStateManager(element, ["stack"]);
  cornerstoneTools.addToolState(element, "stack", stack);

  cornerstoneTools.addTool(PanTool);
  cornerstoneTools.addTool(ZoomTool, {
    configuration: {
      invert: true,
    },
  });
  cornerstoneTools.addTool(WwwcTool);
  cornerstoneTools.addTool(RotateTool);
  cornerstoneTools.addTool(StackScrollTool);

  cornerstoneTools.addTool(ArrowAnnotateTool, {
    configuration: {
        getTextCallback: () => {},
        changeTextCallback: () => {},
        allowEmptyLabel: true,
        renderDashed: false,
        drawHandles: false,
        drawHandlesOnHover: true,
    },
  });

  cornerstoneTools.setToolActive("Pan", { mouseButtonMask: 1 });
  cornerstoneTools.setToolEnabled("ArrowAnnotate");

  element.addEventListener("cornerstoneimagerendered", onImageRendered);

  setDicomCanvasNonFullscreen(element);
  cornerstone.reset(element);
  element.scrollIntoView(false);
  // element.scrollTo(0);

  $(element).dblclick(function () {
    if ($(".canvas-panel").length == 0) {
      // already fullscreen (disable it)
      disableFullscreen(this);
    } else {
      $(".content-panel").append($(".canvas-panel"));
      $(".canvas-panel").toggleClass("canvas-panel canvas-panel-fullscreen");
      $("#dicom-image").attr("height", "100%");
      $("#dicom-image").height("100%");
      // $(".cornerstone-canvas").attr("height", "100%");
      // $(".cornerstone-canvas").height("100%");
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
    .addEventListener("change", function () {
      changeControlSelection();
    });
}

/**
 * Called when a dicom image is rendered
 * @param {*} e - Event
 */
function onImageRendered(e) {
  const eventData = e.detail;

  // Update ww/wl
  const sel = $(".control-overlay").get(0);
  sel.options[find_option(sel, "window")].firstChild.textContent =
    "window (" +
    Math.round(eventData.viewport.voi.windowCenter) +
    " \u00b1 " +
    Math.round(eventData.viewport.voi.windowWidth) +
    ")";

  // update stack data
  const stack =
    eventData.enabledElement.toolStateManager.toolState.stack.data[0];
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

/**
 * Finds a select options but its text value
 * @param {*} select - select element
 * @param {*} text - text value
 * @return {number} - number of found option or 'undefined'
 */
export function find_option(select, text) {
  for (let i = 0; i < select.length; ++i) {
    if (select.options[i].value == text) {
      return i;
    }
  }
  return undefined;
}

/**
 * Disables fullscreen mode
 * @param {*} dicom_element -
 */
export function disableFullscreen(dicom_element) {
  // TODO: rescale the image to stop it getting zoomed in
  $(".canvas-panel-fullscreen").toggleClass(
    "canvas-panel canvas-panel-fullscreen"
  );
  $(".question").append($(".canvas-panel"));
  $(".canvas-panel").get(0).scrollIntoView();

  setDicomCanvasNonFullscreen(dicom_element);
}

/**
 * Enable fullscreen
 * @param {*} element -
 */
export function setDicomCanvasNonFullscreen(element) {
  const h = window.innerHeight - $(".nav-bar").height() - 4;
  $("#dicom-image").attr("height", h);
  $("#dicom-image").height(h);
  // $("#dicom-image.cornerstone-canvas").attr("height", h);
  // $("#dicom-image.cornerstone-canvas").height(h);

  $("#dicom-image .cornerstone-canvas").attr("width", "100%");

  cornerstone.resize(element, true);
}

export function manualPanDicom(x, y) {
  let dicom_element = document.getElementById("dicom-image");
  const viewport = cornerstone.getViewport(dicom_element);

  viewport.translation.x += x;
  viewport.translation.y += y;

  cornerstone.setViewport(dicom_element, viewport);
}

export function manualZoomDicom(delta) {
  let dicom_element = document.getElementById("dicom-image");
  const viewport = cornerstone.getViewport(dicom_element);

  viewport.scale += delta / 100;

  cornerstone.setViewport(dicom_element, viewport);
}

export function manualRotateDicom(delta) {
  let dicom_element = document.getElementById("dicom-image");
  const viewport = cornerstone.getViewport(dicom_element);

  viewport.rotation += delta;

  cornerstone.setViewport(dicom_element, viewport);
}

export function manualScrollDicom(n) {
  // There must be a better way to do this...
  let dicom_element = document.getElementById("dicom-image");
  let c = cornerstone.getEnabledElement(dicom_element);
  let max = c.toolStateManager.toolState.stack.data[0].imageIds.length;

  if (max < 2) {
    return;
  }

  let current_index =
    c.toolStateManager.toolState.stack.data[0].currentImageIdIndex;

  // Loop through stack if out of bounds
  // Yes it is annoying but it's the way it is done...
  let new_index = current_index + n;
  if (new_index >= max) {
    new_index = new_index - max;
  } else if (new_index < 0) {
    new_index = new_index + max;
  }

  c.toolStateManager.toolState.stack.data[0].currentImageIdIndex = new_index;
  let id = c.toolStateManager.toolState.stack.data[0].imageIds[new_index];
  cornerstone.loadImage(id).then((b) => {
    cornerstone.displayImage(dicom_element, b);
  });
  // c = cornerstone.getEnabledElement(dicom_element)
}

export function manualWindowDicom(wl, ww) {
  let dicom_element = document.getElementById("dicom-image");
  const viewport = cornerstone.getViewport(dicom_element);

  // For reference
  // brightness ~= wl
  // contrast ~= ww

  viewport.voi.windowCenter += wl;
  viewport.voi.windowWidth += ww;

  cornerstone.setViewport(dicom_element, viewport);
}

export function debugCornerstone() {
  let dicom_element = document.getElementById("dicom-image");
  let viewport = cornerstone.getViewport(dicom_element);
  let c = cornerstone.getEnabledElement(dicom_element);
}

/**
 * Registers the selected dicom tool
 */
export function changeControlSelection() {
  // We also duplicate the sel that are available
  const sel = $(".control-overlay").get(0);

  const old = sel.oldSelectedIndex;
  sel.oldSelectedIndex = sel.selectedIndex;

  console.log(event);

  const dicom_element = document.getElementById("dicom-image");
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
      // _this.left.onstart = _this.scroll_start;
      // _this.selected_control = t.selectedIndex;
      break;
    }
    case "window": {
      cornerstoneTools.setToolActive("Wwwc", { mouseButtonMask: 1 });
      break;
    }
    case "abdomen": {
      const viewport = cornerstone.getViewport(dicom_element);
      viewport.voi.windowCenter = 150;
      viewport.voi.windowWidth = 500;
      cornerstone.setViewport(dicom_element, viewport);
      sel.selectedIndex = find_option(sel, "window");
      changeControlSelection();
      break;
    }
    case "pulmonary": {
      const viewport = cornerstone.getViewport(dicom_element);
      viewport.voi.windowCenter = -500;
      viewport.voi.windowWidth = 1500;
      cornerstone.setViewport(dicom_element, viewport);
      sel.selectedIndex = find_option(sel, "window");
      changeControlSelection();
      break;
    }
    case "brain": {
      const viewport = cornerstone.getViewport(dicom_element);
      viewport.voi.windowCenter = 50;
      viewport.voi.windowWidth = 80;
      cornerstone.setViewport(dicom_element, viewport);
      sel.selectedIndex = find_option(sel, "window");
      changeControlSelection();
      break;
    }
    case "bone": {
      const viewport = cornerstone.getViewport(dicom_element);
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
        $(".figure-open").removeClass("figure-open").addClass("figure");
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

/**
 * Handle key button events
 * These are the same as in the RCR pratique implementation
 * @param {*} event - KeyEvent
 */
export function keydown_handler(event) {
  const target_element = event.target.tagName;

  // Catch all keypresses unless user is typing
  if (target_element == "INPUT" || target_element == "TEXTAREA") {
    return;
  }
  const sel = $(".control-overlay").get(0);
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
      // $("#dicom-image").get(0).scrollIntoView(false);
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
          // _this.current_dicom.current_view.pre_scale_at(1.01, 1.01, _this.current_dicom.cols / 2, _this.current_dicom.rows / 2);
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

/**
 * View cornstone image
 * @param {*} t
 * @param {*} source
 */
export function openMainImage(current_question, t, source) {
  /**
   * Load image
   * @param {*} images - list of images
   */
  function loadAnnotation(imageId, annotation) {
    const toolStateManager = cornerstoneTools.globalImageIdSpecificToolStateManager;

    if (annotation == undefined || annotation.length < 1) { return }

    let tool_state_no_id = JSON.parse(annotation);

    let tool_state = {};
    tool_state[imageId] = tool_state_no_id;

    toolStateManager.restoreToolState(tool_state);
  }
  async function load(images, annotations) {
    const imageIds = [];
    for (let i = 0; i < images.length; i++) {
      const data_url = images[i];
      const annotation = annotations[i];

      // check stack type
      if (data_url.startsWith("data:image")) {
        const imageId = "base64://" + data_url.split(",")[1];

        loadAnnotation(imageId, annotation);

        imageIds.push(imageId);
      } else if (data_url.startsWith("data:application/dicom")) {
        // stack = stack.split(";")[1];

        const dfile = await urltoFile(data_url, "dicom", "application/dicom");

        const imageId = cornerstoneWADOImageLoader.wadouri.fileManager.add(
          dfile
        );

        loadAnnotation(imageId, annotation);

        imageIds.push(imageId);
        // cornerstone.loadImage(imageId).then(function(image) {
        //    tempFunction(image);
        // });
      }
    }
    const stack = {
      currentImageIdIndex: 0,
      imageIds,
    };
    cornerstone.loadAndCacheImage(imageIds[0]).then(function (image) {
      loadMainImage(image, stack);
    });
  }

  if (current_question) {
    // Check if the figure is already loaded (or if another one is)
    const open_figure = $("#dicom-image").data("figure");
    const figure_to_load = source.id;

    if (open_figure != undefined) {
      // No full size figure / dicom loaded yet
      if (figure_to_load == open_figure) {
        // Scroll to the image if it is already open
        document.getElementById("dicom-image").scrollIntoView();
        return;
      } else {
        let el;
        el = document.getElementById("dicom-image");
        if (el != undefined) {
          cornerstone.disable(el);
          $(".canvas-panel").remove();
        }
      }
    }

    $(".figure-open").removeClass("figure-open").addClass("figure");

    source.className = "figure-open";

    $(".question").append(
      '<div class= "canvas-panel"><div id="dicom-image" data-figure="' +
        figure_to_load +
        '"></div></div>'
    );

    let images = current_question.images[figure_to_load.split("-")[1]];
    // images = current_question.images


    // Make sure we have an array
    if (!Array.isArray(images)) {
      images = [images];
    }

    let annotations = [];
    if (current_question.annotations) { 
      annotations = current_question.annotations[figure_to_load.split("-")[1]];
      if (!Array.isArray(annotations)) {
        annotations = [annotations];
      }
    }

    load(images, annotations);
  }
}

export function urltoFile(url, filename, mimeType) {
  return fetch(url)
    .then(function (res) {
      return res.arrayBuffer();
    })
    .then(function (buf) {
      return new File([buf], filename, { type: mimeType });
    });
}
