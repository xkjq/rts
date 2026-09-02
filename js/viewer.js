/* global cornerstone, cornerstoneTools, cornerstoneBase64ImageLoader, cornerstoneWebImageLoader, cornerstoneWADOImageLoader */
/**
 * Load the main image
 * @param {*} image -
 * @param {*} stack -
 */
let isMouseScrolling = false;
let staticBarTop = 0;
let staticBarLeft = 0;
let staticBarHeight = 420;

export function updateScrollIndicator(current, total, fraction) {
  const indicator = document.getElementById("dicom-scroll-indicator");
  if (!indicator) return;

  if (total <= 1) {
    indicator.style.display = "none";
    return;
  }

  const topLabel = indicator.querySelector(".dicom-scroll-top");
  const bottomLabel = indicator.querySelector(".dicom-scroll-bottom");
  const currentLabel = indicator.querySelector(".dicom-scroll-current");
  const currentWrap = indicator.querySelector(".dicom-scroll-current-wrap");

  if (topLabel) topLabel.textContent = "1";
  if (bottomLabel) bottomLabel.textContent = total.toString();
  if (currentLabel) currentLabel.textContent = current.toString();

  const percent = fraction !== undefined ? fraction * 100 : (total > 1 ? ((current - 1) / (total - 1)) * 100 : 0);
  if (currentWrap) {
    currentWrap.style.top = `${percent}%`;
  }
}

export function positionScrollIndicator(left, top, height) {
  const indicator = document.getElementById("dicom-scroll-indicator");
  if (!indicator) return;
  indicator.style.left = `${left}px`;
  indicator.style.top = `${top}px`;
  if (height) {
    indicator.style.height = `${height}px`;
  }
}

export function showScrollIndicator() {
  const indicator = document.getElementById("dicom-scroll-indicator");
  if (indicator) {
    indicator.style.display = "block";
  }
}

export function hideScrollIndicator() {
  const indicator = document.getElementById("dicom-scroll-indicator");
  if (indicator) {
    indicator.style.display = "none";
  }
}

export function loadMainImage(image, stack) {
  const PanTool = cornerstoneTools.PanTool;
  const ZoomTool = cornerstoneTools.ZoomTool;
  const WwwcTool = cornerstoneTools.WwwcTool;
  const RotateTool = cornerstoneTools.RotateTool;
  const StackScrollTool = cornerstoneTools.StackScrollTool;
  const StackScrollMouseWheelTool = cornerstoneTools.StackScrollMouseWheelTool;
  const ArrowAnnotateTool = cornerstoneTools.ArrowAnnotateTool;
  const LengthTool = cornerstoneTools.LengthTool;
  const RectangleRoiTool = cornerstoneTools.RectangleRoiTool;
  const EllipseRoiTool = cornerstoneTools.EllipseRoiTool;
  const AngleTool = cornerstoneTools.AngleTool;
  const CobbAngleTool = cornerstoneTools.CobbAngleTool;
  const EraserTool = cornerstoneTools.EraserTool;

  const element = document.getElementById("dicom-image");
  cornerstone.enable(element);

  cornerstone.displayImage(element, image);

  cornerstoneTools.addStackStateManager(element, ["stack"]);
  cornerstoneTools.addToolState(element, "stack", stack);

  cornerstoneTools.addToolForElement(element, PanTool);
  cornerstoneTools.addToolForElement(element, ZoomTool, {
    configuration: {
      invert: true,
    },
  });
  cornerstoneTools.addToolForElement(element, WwwcTool);
  cornerstoneTools.addToolForElement(element, RotateTool);
  cornerstoneTools.addToolForElement(element, AngleTool);
  cornerstoneTools.addToolForElement(element, CobbAngleTool);
  const isStack = stack && stack.imageIds && stack.imageIds.length > 1;
  const defaultTool = isStack ? "StackScroll" : "Pan";
  const scrollSpeed = isStack ? (staticBarHeight / stack.imageIds.length) : undefined;

  cornerstoneTools.addToolForElement(element, StackScrollTool, {
    configuration: {
      loop: true,
      allowSkipping: true,
      stackScrollSpeed: scrollSpeed,
    },
  });
  if (StackScrollMouseWheelTool) {
    cornerstoneTools.addToolForElement(element, StackScrollMouseWheelTool, {
      configuration: {
        loop: true,
        allowSkipping: true,
      },
    });
    cornerstoneTools.setToolActiveForElement(element, "StackScrollMouseWheel", {});
  }
  cornerstoneTools.addToolForElement(element, EraserTool);
  cornerstoneTools.addToolForElement(element, LengthTool);
  cornerstoneTools.addToolForElement(element, RectangleRoiTool);
  //cornerstoneTools.addToolForElement(element, EllipseRoiTool);

  cornerstoneTools.addToolForElement(element, ArrowAnnotateTool, {
    configuration: {
      getTextCallback: () => {},
      changeTextCallback: () => {},
      allowEmptyLabel: true,
      renderDashed: false,
      drawHandles: false,
      drawHandlesOnHover: true,
    },
  });

  cornerstoneTools.setToolActiveForElement(element, defaultTool, {
    mouseButtonMask: 1,
    configuration: {
      loop: true,
      allowSkipping: true,
      stackScrollSpeed: scrollSpeed,
    },
  });
  cornerstoneTools.setToolEnabledForElement(element, "ArrowAnnotate");

  // Sync select control with default tool
  const sel = $(".dicom-select-control").get(0);
  if (sel) {
    const optValue = isStack ? "scroll" : "pan";
    const optIdx = find_option(sel, optValue);
    if (optIdx !== undefined) {
      sel.selectedIndex = optIdx;
    }
  }

  if (isStack && cornerstoneTools.stackPrefetch) {
    if (typeof cornerstoneTools.stackPrefetch.setConfiguration === "function") {
      cornerstoneTools.stackPrefetch.setConfiguration({
        maxImagesToPrefetch: 3,
        maxSimultaneousRequests: 1,
      });
    }
    cornerstoneTools.stackPrefetch.enable(element);
  }

  //cornerstoneTools.keyboardInput.enable(element);

  element.addEventListener("cornerstoneimagerendered", onImageRendered);

  setDicomCanvasNonFullscreen(element);
  cornerstone.reset(element);
  let viewerTitleBar = document.getElementById("viewer-title-bar");
  viewerTitleBar.scrollIntoView();
  //element.scrollIntoView(false);
  //element.scrollTo(0);

  $(element).dblclick(function() {
    if ($(".canvas-panel").length == 0) {
      // already fullscreen (disable it)
      disableFullscreen(this);
    } else {
      enableFullscreen(this);
    }
  });

  element.removeEventListener("wheel", element.wheelEventHandler);

  // Mouse event listeners for scroll indicator
  $(element).off("mousedown.scroll wheel.scroll");
  $(document).off("mouseup.scroll");

  $(element).on("mousedown.scroll", function(evt) {
    if (evt.button !== 0) return; // Only primary left-click
    const selControl = $(".dicom-select-control").get(0);
    const isScrollActive = selControl && selControl.options[selControl.selectedIndex] && selControl.options[selControl.selectedIndex].value === "scroll";
    if (isScrollActive && stack && stack.imageIds && stack.imageIds.length > 1) {
      isMouseScrolling = true;
      const rect = element.getBoundingClientRect();
      const mouseX = evt.clientX - rect.left;
      const mouseY = evt.clientY - rect.top;
      const total = stack.imageIds.length;
      const current = stack.currentImageIdIndex + 1;
      const percent = total > 1 ? (current - 1) / (total - 1) : 0;

      staticBarHeight = 420;
      staticBarTop = mouseY - percent * staticBarHeight;
      staticBarLeft = mouseX - 20;

      positionScrollIndicator(staticBarLeft, staticBarTop, staticBarHeight);
      updateScrollIndicator(current, total);
      showScrollIndicator();
    }
  });

  $(document).on("mouseup.scroll", function() {
    if (isMouseScrolling) {
      isMouseScrolling = false;
      hideScrollIndicator();
    }
  });

  $(".dicom-select-control")
    .get(0)
    .addEventListener("change", function() {
      changeControlSelection();
    });

  // Register Key Event Listener
  document.addEventListener("keydown", keydown_handler);
}

/**
 * Called when a dicom image is rendered
 * @param {*} e - Event
 */
function onImageRendered(e) {
  const eventData = e.detail;

  // Update ww/wl
  const sel = $(".dicom-select-control").get(0);
  if (sel) {
    const windowOpt = find_option(sel, "window");
    if (windowOpt !== undefined && sel.options[windowOpt]) {
      sel.options[windowOpt].firstChild.textContent =
        "window (" +
        Math.round(eventData.viewport.voi.windowCenter) +
        " \u00b1 " +
        Math.round(eventData.viewport.voi.windowWidth) +
        ")";
    }
  }

  // update stack data
  const stack =
    eventData.enabledElement.toolStateManager.toolState.stack.data[0];
  if (stack && stack.imageIds.length > 1) {
    $("option[value=scroll").prop("disabled", false);
    $("option[value=scroll").prop("hidden", false);
    $("option[value=scroll").text(
      "scroll (" +
      (stack.currentImageIdIndex + 1) +
      "/" +
      stack.imageIds.length +
      ")"
    );

    if (isMouseScrolling) {
      updateScrollIndicator(stack.currentImageIdIndex + 1, stack.imageIds.length);
    }

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

  $("#disable-fullscreen-viewer-button").hide();
  $("#fullscreen-viewer-button").show();
  $(".question").prepend($(".canvas-panel"));
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

  const scrollToIndex = cornerstoneTools.importInternal ? cornerstoneTools.importInternal('util/scrollToIndex') : null;
  if (scrollToIndex) {
    scrollToIndex(dicom_element, new_index);
  } else {
    c.toolStateManager.toolState.stack.data[0].currentImageIdIndex = new_index;
    let id = c.toolStateManager.toolState.stack.data[0].imageIds[new_index];
    cornerstone.loadAndCacheImage(id).then((b) => {
      if (c.toolStateManager.toolState.stack.data[0].currentImageIdIndex === new_index) {
        cornerstone.displayImage(dicom_element, b);
      }
    });
  }
  updateScrollIndicator(new_index + 1, max);
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
 * 
 * This also allows selecting of window levels
 */
export function changeControlSelection() {
  // We also duplicate the sel that are available
  const sel = $(".dicom-select-control").get(0);

  const old = sel.oldSelectedIndex;
  sel.oldSelectedIndex = sel.selectedIndex;

  const dicom_element = document.getElementById("dicom-image");
  switch (sel.options[sel.selectedIndex].value) {
    case "pan": {
      cornerstoneTools.setToolActiveForElement(dicom_element, "Pan", {
        mouseButtonMask: 1,
      });
      break;
    }
    case "zoom": {
      cornerstoneTools.setToolActiveForElement(dicom_element, "Zoom", {
        mouseButtonMask: 1,
      });
      break;
    }
    case "rotate": {
      cornerstoneTools.setToolActiveForElement(dicom_element, "Rotate", {
        mouseButtonMask: 1,
      });
      break;
    }
    case "measure": {
      cornerstoneTools.setToolActiveForElement(dicom_element, "Length", {
        mouseButtonMask: 1,
      });
      break;
    }
    case "rectangle": {
      cornerstoneTools.setToolActiveForElement(dicom_element, "RectangleRoi", {
        mouseButtonMask: 1,
      });
      break;
    }
    case "ellipse": {
      cornerstoneTools.setToolActiveForElement(dicom_element, "EllipseRoi", {
        mouseButtonMask: 1,
      });
      break;
    }

    case "angle": {
      cornerstoneTools.setToolActiveForElement(dicom_element, "Angle", {
        mouseButtonMask: 1,
      });
      break;
    }
    case "cobbangle": {
      cornerstoneTools.setToolActiveForElement(dicom_element, "CobbAngle", {
        mouseButtonMask: 1,
      });
      break;
    }
    case "eraser": {
      cornerstoneTools.setToolActiveForElement(dicom_element, "Eraser", {
        mouseButtonMask: 1,
      });
      break;
    }
    case "scroll": {
      let speed = undefined;
      try {
        const c = cornerstone.getEnabledElement(dicom_element);
        if (c && c.toolStateManager && c.toolStateManager.toolState && c.toolStateManager.toolState.stack) {
          const stackData = c.toolStateManager.toolState.stack.data[0];
          if (stackData && stackData.imageIds && stackData.imageIds.length > 1) {
            speed = staticBarHeight / stackData.imageIds.length;
          }
        }
      } catch (err) {}
      cornerstoneTools.setToolActiveForElement(dicom_element, "StackScroll", {
        mouseButtonMask: 1,
        configuration: {
          loop: true,
          allowSkipping: true,
          stackScrollSpeed: speed,
        },
      });
      break;
    }
    case "window": {
      cornerstoneTools.setToolActiveForElement(dicom_element, "Wwwc", {
        mouseButtonMask: 1,
      });
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
      resetViewer(dicom_element);
      sel.selectedIndex = old;
      sel.oldSelectedIndex = old;
      break;
    }
    case "close": {
      closeViewer(dicom_element);
      break;
    }
  }
  sel.blur();
  if (event) {
    event.preventDefault();
  }
}

function resetViewer(dicom_element) {
  cornerstoneTools.clearToolState(dicom_element, "RectangleRoi");
  cornerstoneTools.clearToolState(dicom_element, "Length");
  cornerstone.reset(dicom_element);
}

/**
 * Handle key button events
 * These are the same as in the RCR pratique implementation
 * @param {*} event - KeyEvent
 */
export function keydown_handler(event) {
  //console.debug(event);
  const target_element = event.target.tagName;

  // Cancel if no active element
  let dicom_element = document.getElementById("dicom-image");
  if (dicom_element == undefined) {
    return;
  }

  // Catch all keypresses unless user is typing
  if (target_element == "INPUT" || target_element == "TEXTAREA") {
    return;
  }
  const sel = $(".dicom-select-control").get(0);
  switch (event.code) {
    case "KeyP":
      sel.selectedIndex = find_option(sel, "pan");
      changeControlSelection();
      break;
    case "KeyC":
      sel.selectedIndex = find_option(sel, "rectangle");
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
    //case "KeyC":
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
          manualRotateDicom(-1);
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
          manualRotateDicom(1);
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

function loadAnnotation(imageId, annotation) {
  const toolStateManager =
    cornerstoneTools.globalImageIdSpecificToolStateManager;

  if (annotation == undefined || annotation.length < 1) {
    return;
  }

  let tool_state_no_id = JSON.parse(annotation);

  let tool_state = {};
  tool_state[imageId] = tool_state_no_id;

  toolStateManager.restoreToolState(tool_state);
}
let activeStackData = null;
const activeStackFileIds = new Map();
const activeStackMetadata = new Map();
const activeSliceLRU = [];
const MAX_ACTIVE_SLICES = 12;
let rtsDicomLoaderRegistered = false;
let rtsMetaDataProviderRegistered = false;

function touchSlice(index) {
  const qIdx = activeSliceLRU.indexOf(index);
  if (qIdx >= 0) activeSliceLRU.splice(qIdx, 1);
  activeSliceLRU.push(index);

  while (activeSliceLRU.length > MAX_ACTIVE_SLICES) {
    const oldestIndex = activeSliceLRU.shift();
    evictSlice(oldestIndex);
  }
}

function evictSlice(index) {
  if (activeStackFileIds.has(index)) {
    const dicomFileId = activeStackFileIds.get(index);
    activeStackFileIds.delete(index);
    const fileIndex = parseInt(dicomFileId.replace("dicomfile:", ""), 10);

    try {
      const loader = typeof cornerstoneWADOImageLoader !== "undefined"
        ? (cornerstoneWADOImageLoader.wadouri || (cornerstoneWADOImageLoader.default && cornerstoneWADOImageLoader.default.wadouri))
        : null;
      if (loader) {
        if (loader.fileManager && typeof loader.fileManager.remove === "function") {
          loader.fileManager.remove(fileIndex);
        }
        if (loader.dataSetCacheManager && typeof loader.dataSetCacheManager.unload === "function") {
          loader.dataSetCacheManager.unload(String(fileIndex));
        }
      }
    } catch (e) {
      console.debug("Error in evictSlice fileManager/dataSetCacheManager:", e);
    }
  }

  try {
    const cs = typeof cornerstone !== "undefined" ? cornerstone : (typeof window !== "undefined" ? window.cornerstone : null);
    if (cs && cs.imageCache && typeof cs.imageCache.removeImageLoadObject === "function") {
      cs.imageCache.removeImageLoadObject("rtsdicom:" + index);
    }
  } catch (e) {
    // not in imageCache, ignore
  }
}

export function cleanupViewerMemory() {
  activeStackData = null;
  activeStackFileIds.clear();
  activeStackMetadata.clear();
  activeSliceLRU.length = 0;

  try {
    if (typeof cornerstone !== "undefined" && cornerstone.imageCache) {
      cornerstone.imageCache.purgeCache();
    }
  } catch (e) {
    console.debug("Error purging cornerstone imageCache", e);
  }

  try {
    const loader = typeof cornerstoneWADOImageLoader !== "undefined"
      ? (cornerstoneWADOImageLoader.wadouri || (cornerstoneWADOImageLoader.default && cornerstoneWADOImageLoader.default.wadouri))
      : null;
    if (loader) {
      if (loader.fileManager && loader.fileManager.purge) {
        loader.fileManager.purge();
      }
      if (loader.dataSetCacheManager && loader.dataSetCacheManager.purge) {
        loader.dataSetCacheManager.purge();
      }
    }
  } catch (e) {
    console.debug("Error purging wadouri fileManager/dataSetCacheManager", e);
  }
}

export function base64ToBlob(dataUrl, mimeType = "application/dicom") {
  const commaIdx = dataUrl.indexOf(",");
  let base64Str = commaIdx >= 0 ? dataUrl.slice(commaIdx + 1) : dataUrl;
  if (base64Str.indexOf("\n") >= 0 || base64Str.indexOf("\r") >= 0 || base64Str.indexOf(" ") >= 0) {
    base64Str = base64Str.replace(/\s+/g, "");
  }
  const binaryStr = atob(base64Str);
  const len = binaryStr.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryStr.charCodeAt(i);
  }
  return new Blob([bytes], { type: mimeType });
}

export function initRtsDicomLoader() {
  if (rtsDicomLoaderRegistered) return;
  const cs = typeof cornerstone !== "undefined" ? cornerstone : (typeof window !== "undefined" ? window.cornerstone : null);
  if (!cs || typeof cs.registerImageLoader !== "function") return;

  cs.registerImageLoader("rtsdicom", function(imageId) {
    const indexStr = imageId.replace("rtsdicom:", "");
    const index = parseInt(indexStr, 10);

    let innerLoadObj = null;

    const promise = new Promise(async (resolve, reject) => {
      try {
        if (!activeStackData || !activeStackData[index]) {
          return reject(new Error(`No image data for slice index ${index}`));
        }

        const loader = typeof cornerstoneWADOImageLoader !== "undefined"
          ? (cornerstoneWADOImageLoader.wadouri || (cornerstoneWADOImageLoader.default && cornerstoneWADOImageLoader.default.wadouri))
          : null;

        if (!loader || !loader.fileManager || !loader.loadImage) {
          return reject(new Error("cornerstoneWADOImageLoader wadouri not available"));
        }

        let dicomFileId;
        if (activeStackFileIds.has(index)) {
          dicomFileId = activeStackFileIds.get(index);
        } else {
          const item = activeStackData[index];
          let blob;
          if (item instanceof Blob) {
            blob = item;
          } else if (typeof item === "string" && item.startsWith("data:")) {
            blob = base64ToBlob(item, "application/dicom");
            // Replace bulky base64 string in array with lightweight Blob to free V8 string heap
            activeStackData[index] = blob;
          } else if (typeof item === "string") {
            const wadouriId = item.startsWith("wadouri:") ? item : `wadouri:${item}`;
            const imgLoad = await loader.loadImage(wadouriId);
            innerLoadObj = imgLoad;
            const img = await (imgLoad.promise || imgLoad);
            img.imageId = imageId;
            touchSlice(index);
            return resolve(img);
          } else {
            return reject(new Error(`Invalid image data at slice index ${index}`));
          }

          dicomFileId = loader.fileManager.add(blob);
          activeStackFileIds.set(index, dicomFileId);
        }

        const imgLoad = loader.loadImage(dicomFileId);
        innerLoadObj = imgLoad;
        const image = await (imgLoad.promise || imgLoad);
        image.imageId = imageId;

        // Cache critical metadata tags before potential dataset eviction
        if (cs && cs.metaData && typeof cs.metaData.get === "function") {
          try {
            const voi = cs.metaData.get("voiLutModule", dicomFileId);
            if (voi) activeStackMetadata.set(`${index}_voiLutModule`, voi);
            const plane = cs.metaData.get("imagePlaneModule", dicomFileId);
            if (plane) activeStackMetadata.set(`${index}_imagePlaneModule`, plane);
          } catch (e) {}
        }

        touchSlice(index);
        resolve(image);
      } catch (err) {
        console.error(`Error loading rtsdicom slice ${index}:`, err);
        reject(err);
      }
    });

    return {
      promise: promise,
      cancelFn: function() {
        if (innerLoadObj && typeof innerLoadObj.cancelFn === "function") {
          innerLoadObj.cancelFn();
        }
      },
      decache: function() {
        evictSlice(index);
      }
    };
  });

  if (cs.metaData && typeof cs.metaData.addProvider === "function" && !rtsMetaDataProviderRegistered) {
    cs.metaData.addProvider(function(type, imageId) {
      if (typeof imageId === "string" && imageId.startsWith("rtsdicom:")) {
        const idx = parseInt(imageId.replace("rtsdicom:", ""), 10);
        const metaKey = `${idx}_${type}`;
        if (activeStackMetadata.has(metaKey)) {
          return activeStackMetadata.get(metaKey);
        }
        if (activeStackFileIds.has(idx)) {
          const dicomFileId = activeStackFileIds.get(idx);
          const meta = cs.metaData.get(type, dicomFileId);
          if (meta) {
            activeStackMetadata.set(metaKey, meta);
          }
          return meta;
        }
      }
    });
    rtsMetaDataProviderRegistered = true;
  }

  rtsDicomLoaderRegistered = true;
}

async function load(images, annotations) {
  initRtsDicomLoader();

  // Reset active stack for on-demand decoding and clear prior stack memory
  cleanupViewerMemory();
  activeStackData = images;

  // Build imageIds immediately without converting any slice up front
  const imageIds = images.map((data_url, i) => {
    if (data_url instanceof Blob) {
      return "rtsdicom:" + i;
    } else if (typeof data_url === "string") {
      if (data_url.startsWith("data:image")) {
        return "base64://" + data_url.split(",")[1];
      } else if (data_url.startsWith("data:")) {
        return "rtsdicom:" + i;
      } else {
        let url = data_url;
        if (url.endsWith("dcm") || /(?:\/|^)[^.\/]+$/.test(url)) {
          url = "wadouri:" + url;
        }
        return url;
      }
    } else {
      return "rtsdicom:" + i;
    }
  });

  // Display the first image as soon as possible
  cornerstone.loadAndCacheImage(imageIds[0]).then(function(image) {
    const stack = {
      currentImageIdIndex: 0,
      imageIds,
    };
    loadMainImage(image, stack);
    // Restore annotations for all images after display
    if (annotations && annotations.length > 0) {
      imageIds.forEach((imageId, idx) => {
        const annotation = annotations[idx];
        if (annotation) {
          loadAnnotation(imageId, annotation);
        }
      });
    }
  }).catch(function(err) {
    console.error("Error loading initial image in stack:", err);
  });
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


  if (current_question) {
    // Check if the figure is already loaded (or if another one is)
    const open_figure = $("#dicom-image").data("figure");
    const figure_to_load = source.id;

    if (open_figure != undefined) {
      // No full size figure / dicom loaded yet
      if (figure_to_load == open_figure) {
        // Scroll to the image if it is already open
        document.getElementById("viewer-title-bar").scrollIntoView();
        return;
      } else {
        let el;
        el = document.getElementById("dicom-image");
        if (el != undefined) {
          if (typeof cornerstoneTools !== "undefined" && cornerstoneTools.stackPrefetch) {
            try {
              cornerstoneTools.stackPrefetch.disable(el);
            } catch (e) {}
          }
          try {
            cornerstone.removeElementData(el);
          } catch (e) {}
          try {
            cornerstone.disable(el);
          } catch (e) {}
          // Explicitly remove the dicom-image element
          el.remove();
          $(".canvas-panel").remove();
        }
        // Purge previous figure's memory when switching figures
        cleanupViewerMemory();
      }
    } else {
      cleanupViewerMemory();
    }

    $(".figure-open").removeClass("figure-open").addClass("figure");

    source.className = "figure-open";

    let image_title = source.getElementsByClassName("figcaption")[0].textContent;

    // Native DOM creation for performance
    const questionElem = document.querySelector('.question');
    const canvasPanel = document.createElement('div');
    canvasPanel.className = 'canvas-panel';

    const viewerTitleBar = document.createElement('div');
    viewerTitleBar.id = 'viewer-title-bar';

    const flexDiv = document.createElement('div');
    flexDiv.style.flex = '1 1 auto';

    const viewerTitle = document.createElement('div');
    viewerTitle.id = 'viewer-title';
    viewerTitle.style.color = 'white';
    viewerTitle.textContent = image_title;
    flexDiv.appendChild(viewerTitle);
    viewerTitleBar.appendChild(flexDiv);

    // Select control
    const select = document.createElement('select');
    select.title = 'SELECT CLICK ACTION';
    select.className = 'dicom-select-control title-bar-button';
    select.style.marginRight = '8px';
    const options = [
      { value: 'pan', text: 'pan [p]' },
      { value: 'zoom', text: 'zoom [z]' },
      { value: 'rotate', text: 'rotate [r]' },
      { value: 'scroll', text: 'scroll [s]' },
      { value: 'window', text: 'window (128 ± 127.5) [w]' },
      { value: 'abdomen', text: 'window = abdomen [a]', hidden: true, disabled: true },
      { value: 'pulmonary', text: 'window = pulmonary [u]', hidden: true, disabled: true },
      { value: 'brain', text: 'window = brain [b]', hidden: true, disabled: true },
      { value: 'bone', text: 'window = bone [o]', hidden: true, disabled: true },
      { value: 'measure', text: 'measure [m]' },
      { value: 'ellipse', text: 'ellipse [l]' },
      { value: 'rectangle', text: 'rectangle [c]' },
      { value: 'reset', text: 'reset [e]' },
      { value: 'notes', text: '[modality = SC]', disabled: true }
    ];
    options.forEach(opt => {
      const o = document.createElement('option');
      o.value = opt.value;
      o.textContent = opt.text;
      if (opt.disabled) o.disabled = true;
      if (opt.hidden) o.hidden = true;
      select.appendChild(o);
    });
    viewerTitleBar.appendChild(select);

    // Buttons
    function createButton(id, title, svg, style = '') {
      const btn = document.createElement('button');
      btn.id = id;
      btn.className = 'title-bar-button';
      btn.title = title;
      btn.style.marginRight = '8px';
      if (style) btn.style.display = style;
      const span = document.createElement('span');
      span.className = 'viewer-icon';
      span.innerHTML = svg;
      btn.appendChild(span);
      return btn;
    }

    // SVG Icons
    const svgReset = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-arrow-counterclockwise" viewBox="0 0 16 16"><path fill-rule="evenodd" d="M8 3a5 5 0 1 1-4.546 2.914.5.5 0 0 1 .908-.417A6 6 0 1 0 8 2z"/><path d="M8 4.466V.534a.25.25 0 0 1 .41-.192l2.36 1.966c.12.1.12.284 0 .384L8.41 4.658A.25.25 0 0 1 8 4.466"/></svg>`;
    const svgFullscreen = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-fullscreen" viewBox="0 0 16 16"><path d="M1.5 1a.5.5 0 0 0-.5.5v4a.5.5 0 0 1-1 0v-4A1.5 1.5 0 0 1 1.5 0h4a.5.5 0 0 1 0 1zM10 .5a.5.5 0 0 1 .5-.5h4A1.5 1.5 0 0 1 16 1.5v4a.5.5 0 0 1-1 0v-4a.5.5 0 0 0-.5-.5h-4a.5.5 0 0 1-.5-.5M.5 10a.5.5 0 0 1 .5.5v4a.5.5 0 0 0 .5.5h4a.5.5 0 0 1 0 1h-4A1.5 1.5 0 0 1 0 14.5v-4a.5.5 0 0 1 .5-.5m15 0a.5.5 0 0 1 .5.5v4a1.5 1.5 0 0 1-1.5 1.5h-4a.5.5 0 0 1 0-1h4a.5.5 0 0 0 .5-.5v-4a.5.5 0 0 1 .5-.5"/></svg>`;
    const svgFullscreenExit = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-fullscreen-exit" viewBox="0 0 16 16"><path d="M5.5 0a.5.5 0 0 1 .5.5v4A1.5 1.5 0 0 1 4.5 6h-4a.5.5 0 0 1 0-1h4a.5.5 0 0 0 .5-.5v-4a.5.5 0 0 1 .5-.5m5 0a.5.5 0 0 1 .5.5v4a.5.5 0 0 0 .5.5h4a.5.5 0 0 1 0 1h-4A1.5 1.5 0 0 1 10 4.5v-4a.5.5 0 0 1 .5-.5M0 10.5a.5.5 0 0 1 .5-.5h4A1.5 1.5 0 0 1 6 11.5v4a.5.5 0 0 1-1 0v-4a.5.5 0 0 0-.5-.5h-4a.5.5 0 0 1-.5-.5m10 1a1.5 1.5 0 0 1 1.5-1.5h4a.5.5 0 0 1 0 1h-4a.5.5 0 0 0-.5.5v4a.5.5 0 0 1-1 0z"/></svg>`;
    const svgClose = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-x-lg" viewBox="0 0 16 16"><path d="M2.146 2.854a.5.5 0 1 1 .708-.708L8 7.293l5.146-5.147a.5.5 0 0 1 .708.708L8.707 8l5.147 5.146a.5.5 0 0 1-.708.708L8 8.707l-5.146 5.147a.5.5 0 0 1-.708-.708L7.293 8z"/></svg>`;

    const btnReset = createButton('reset-viewer-button', 'RESET VIEW', svgReset);
    const btnFullscreen = createButton('fullscreen-viewer-button', 'TOGGLE FULLSCREEN', svgFullscreen);
    const btnFullscreenExit = createButton('disable-fullscreen-viewer-button', 'TOGGLE FULLSCREEN', svgFullscreenExit, 'none');
    const btnClose = createButton('close-viewer-button', 'CLOSE VIEWER', svgClose);

    viewerTitleBar.appendChild(btnReset);
    viewerTitleBar.appendChild(btnFullscreen);
    viewerTitleBar.appendChild(btnFullscreenExit);
    viewerTitleBar.appendChild(btnClose);

    canvasPanel.appendChild(viewerTitleBar);

    // DICOM image container
    const dicomImageDiv = document.createElement('div');
    dicomImageDiv.id = 'dicom-image';
    dicomImageDiv.setAttribute('data-figure', figure_to_load);
    canvasPanel.appendChild(dicomImageDiv);

    // Scroll indicator element inside canvasPanel
    const scrollIndicator = document.createElement('div');
    scrollIndicator.id = 'dicom-scroll-indicator';
    scrollIndicator.className = 'dicom-scroll-indicator';
    scrollIndicator.innerHTML = `
      <div class="dicom-scroll-line">
        <span class="dicom-scroll-num dicom-scroll-top">1</span>
        <div class="dicom-scroll-current-wrap">
          <div class="dicom-scroll-tick"></div>
          <span class="dicom-scroll-num dicom-scroll-current">1</span>
        </div>
        <span class="dicom-scroll-num dicom-scroll-bottom">1</span>
      </div>
    `;
    canvasPanel.appendChild(scrollIndicator);

    // Prepend to question
    questionElem.insertBefore(canvasPanel, questionElem.firstChild);

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

    const dicom_element = document.getElementById("dicom-image");
    // Bind button actions
    $("#close-viewer-button").click(function() {
      closeViewer(dicom_element);
    });
    $("#reset-viewer-button").click(function() {
      resetViewer(dicom_element);
    });
    $("#fullscreen-viewer-button").click(function() {
      enableFullscreen(dicom_element);
    });
    $("#disable-fullscreen-viewer-button").click(function() {
      disableFullscreen(dicom_element);
    });

    // Load annotations into the dicom_element
    load(images, annotations);
  }
}

export function closeViewer(dicom_element) {
  // disable fullscreen if required
  if ($(".canvas-panel").length == 0) {
    disableFullscreen(dicom_element);
  }
  if (dicom_element != undefined) {
    if (typeof cornerstoneTools !== "undefined" && cornerstoneTools.stackPrefetch) {
      try {
        cornerstoneTools.stackPrefetch.disable(dicom_element);
      } catch (e) {}
    }
    // See https://github.com/cornerstonejs/cornerstoneTools/issues/1337
    try {
      cornerstone.removeElementData(dicom_element);
    } catch (e) {}
    try {
      cornerstone.disable(dicom_element);
    } catch (e) {}
    $(".canvas-panel").remove();
    $(".figure-open").removeClass("figure-open").addClass("figure");
    $(dicom_element).remove();
  }
  cleanupViewerMemory();
}

export function urltoFile(url, filename, mimeType) {
  if (typeof url === "string" && url.startsWith("data:")) {
    try {
      const blob = base64ToBlob(url, mimeType);
      return Promise.resolve(new File([blob], filename, { type: mimeType }));
    } catch (e) {
      console.warn("base64ToBlob failed, falling back to fetch", e);
    }
  }
  return fetch(url)
    .then(function(res) {
      return res.arrayBuffer();
    })
    .then(function(buf) {
      return new File([buf], filename, { type: mimeType });
    });
}


function enableFullscreen(dicom_element) {
  $(".content-panel").prepend($(".canvas-panel"));
  $(".canvas-panel").toggleClass("canvas-panel canvas-panel-fullscreen");
  $("#dicom-image").attr("height", "100%");
  $("#dicom-image").height("100%");
  $("#disable-fullscreen-viewer-button").show();
  $("#fullscreen-viewer-button").hide();
  // $(".cornerstone-canvas").attr("height", "100%");
  // $(".cornerstone-canvas").height("100%");
  cornerstone.resize(dicom_element, true);
}