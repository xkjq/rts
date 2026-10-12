/* global window, document, $, event */
/**
 * viewer.js — the RTS image viewer (UI, toolbar, controls).
 *
 * The viewer keeps the exact RTS flow and chrome it has always had; only the
 * rendering engine changed: it now drives cornerstone3D through `viewer3d.js`
 * (which consumes the cornerstone3D build exposed by the dv3d bundle on
 * `window.dv3dEngine`). Nothing here is cornerstones-2D specific any more.
 */
import {
  ensureEngine,
  createViewport,
  destroyViewport,
  setStack,
  setActiveTool,
  importAnnotations,
  manualPan,
  manualZoom,
  manualRotate,
  manualWindow,
  setWindowLevel,
  manualScroll,
  resetView,
  resize as resizeEngine,
  purgeCaches,
  getCurrentIndex,
  getImageCount,
  getWindowLevel,
  base64ToBlob,
  renderThumbnail,
  addImageRenderedListener,
} from "./viewer3d.js?v=1.3.0";
import * as helper from "./helpers.js?v=1.3.0";
import { getCachedImage } from "./precache.js?v=1.3.0";

export { base64ToBlob, renderThumbnail };

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

/** Select value -> cornerstone3D tool name. */
const TOOL_BY_SELECT = {
  pan: "Pan",
  zoom: "Zoom",
  rotate: "PlanarRotate",
  scroll: "StackScroll",
  window: "WindowLevel",
  measure: "Length",
  rectangle: "RectangleROI",
  ellipse: "EllipticalROI",
  angle: "Angle",
  cobbangle: "CobbAngle",
  eraser: "Eraser",
};

/**
 * Wire up the RTS chrome for a freshly loaded stack: default tool, scroll
 * indicator, keyboard handling, fullscreen dblclick. The engine/viewport has
 * already been created and the stack set by `load()`.
 * @param {*} image - unused (kept for API compatibility)
 * @param {*} stack - { imageIds, currentImageIdIndex }
 */
export function loadMainImage(image, stack) {
  const element = document.getElementById("dicom-image");
  const isStack = stack && stack.imageIds && stack.imageIds.length > 1;
  const defaultTool = isStack ? "StackScroll" : "Pan";

  setActiveTool(defaultTool);

  // Sync select control with default tool
  const sel = $(".dicom-select-control").get(0);
  if (sel) {
    const optValue = isStack ? "scroll" : "pan";
    const optIdx = find_option(sel, optValue);
    if (optIdx !== undefined) {
      sel.selectedIndex = optIdx;
    }
  }

  addImageRenderedListener(element, onImageRendered);

  setDicomCanvasNonFullscreen(element);
  const viewerTitleBar = document.getElementById("viewer-title-bar");
  if (viewerTitleBar) viewerTitleBar.scrollIntoView();

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
      const current = getCurrentIndex() + 1;
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

  const selControl = $(".dicom-select-control").get(0);
  if (selControl) {
    selControl.addEventListener("change", function() {
      changeControlSelection();
    });
  }

  // Register Key Event Listener
  document.addEventListener("keydown", keydown_handler);
}

/**
 * Called when a dicom image is rendered
 * @param {*} e - Event
 */
function onImageRendered(e) {
  // Update ww/wl
  const sel = $(".dicom-select-control").get(0);
  const wl = getWindowLevel();
  if (sel && wl) {
    const windowOpt = find_option(sel, "window");
    if (windowOpt !== undefined && sel.options[windowOpt]) {
      sel.options[windowOpt].firstChild.textContent =
        "window (" + Math.round(wl.windowCenter) + " \u00b1 " + Math.round(wl.windowWidth) + ")";
    }
  }

  // update stack data
  const total = getImageCount();
  if (total > 1) {
    $("option[value=scroll").prop("disabled", false);
    $("option[value=scroll").prop("hidden", false);
    $("option[value=scroll").text("scroll (" + (getCurrentIndex() + 1) + "/" + total + ")");

    if (isMouseScrolling) {
      updateScrollIndicator(getCurrentIndex() + 1, total);
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

  resizeEngine();
}

export function manualPanDicom(x, y) {
  manualPan(x, y);
}

export function manualZoomDicom(delta) {
  manualZoom(delta);
}

export function manualRotateDicom(delta) {
  manualRotate(delta);
}

export function manualScrollDicom(n) {
  manualScroll(n);
  const total = getImageCount();
  if (total > 1) {
    updateScrollIndicator(getCurrentIndex() + 1, total);
  }
}

export function manualWindowDicom(wl, ww) {
  manualWindow(wl, ww);
}

export function debugCornerstone() {
  const dicom_element = document.getElementById("dicom-image");
  const engine = window.dv3dEngine;
  console.debug("RTS viewer3d debug", {
    element: dicom_element,
    engine,
    index: getCurrentIndex(),
    count: getImageCount(),
    windowLevel: getWindowLevel(),
  });
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
  const value = sel.options[sel.selectedIndex].value;

  if (TOOL_BY_SELECT[value]) {
    setActiveTool(TOOL_BY_SELECT[value]);
  } else {
    switch (value) {
      case "abdomen": {
        setWindowLevel(150, 500);
        sel.selectedIndex = find_option(sel, "window");
        changeControlSelection();
        break;
      }
      case "pulmonary": {
        setWindowLevel(-500, 1500);
        sel.selectedIndex = find_option(sel, "window");
        changeControlSelection();
        break;
      }
      case "brain": {
        setWindowLevel(50, 80);
        sel.selectedIndex = find_option(sel, "window");
        changeControlSelection();
        break;
      }
      case "bone": {
        setWindowLevel(570, 3000);
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
  }
  sel.blur();
  if (event) {
    event.preventDefault();
  }
}

function resetViewer(dicom_element) {
  resetView();
}

/**
 * Handle key button events
 * These are the same as in the RCR pratique implementation
 * @param {*} event - KeyEvent
 */
export function keydown_handler(event) {
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

export function cleanupViewerMemory() {
  purgeCaches();
}

export function initRtsDicomLoader() {
  // Loaders are registered by viewer3d.js once the engine is initialised.
}

/**
 * Build a cornerstone imageId for one exam image entry.
 *
 * DICOM goes through the cache-aware `rtsdicom:` loader; non-DICOM images go
 * through `external:` (also cache-aware, served from Cache Storage when the
 * exam was pre-cached). The server's per-image `image_is_dicom` map is
 * preferred over the filename heuristic when present.
 */
function toImageId(data, i, isDicomMap) {
  if (data instanceof Blob) return "rtsdicom:" + i;
  if (typeof data === "string") {
    if (data.startsWith("data:image")) return "external:" + data;
    if (data.startsWith("data:")) return "rtsdicom:" + i;
    if (data.startsWith("wadouri:") || data.startsWith("external:")) return data;
    if (helper.isDicomImage(data, isDicomMap)) return "rtsdicom:" + i;
    return "external:" + data;
  }
  return "rtsdicom:" + i;
}

async function load(images, annotations, isDicomMap) {
  await ensureEngine();

  // Reset active stack for on-demand decoding and clear prior stack memory
  cleanupViewerMemory();

  const imageIds = images.map((data, i) => toImageId(data, i, isDicomMap));

  const element = document.getElementById("dicom-image");
  createViewport(element);
  await setStack(imageIds, 0, images);

  const stack = { currentImageIdIndex: 0, imageIds };
  loadMainImage(null, stack);

  if (annotations && annotations.length > 0) {
    await importAnnotations(annotations, imageIds);
  }
}

/**
 * View cornstone image
 * @param {*} t
 * @param {*} source
 */
export function openMainImage(current_question, t, source) {
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
        try {
          destroyViewport();
        } catch (e) {}
        const el = document.getElementById("dicom-image");
        if (el != undefined) {
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
    load(images, annotations, current_question.image_is_dicom);
  }
}

export function closeViewer(dicom_element) {
  // disable fullscreen if required
  if ($(".canvas-panel").length == 0) {
    disableFullscreen(dicom_element);
  }
  destroyViewport();
  $(".canvas-panel").remove();
  $(".figure-open").removeClass("figure-open").addClass("figure");
  $(dicom_element).remove();
  cleanupViewerMemory();
}

/** Tear down the cornerstone3D viewport without touching the surrounding DOM. */
export function destroyViewer() {
  destroyViewport();
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
  // Prefer the locally pre-cached copy so thumbnails work without a network.
  return getCachedImage(url)
    .then(function(cached) {
      return cached ? cached.arrayBuffer() : fetch(url).then(function(res) { return res.arrayBuffer(); });
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
  resizeEngine();
}
