/* global window */
/**
 * viewer3d.js — cornerstone3D engine adapter for the RTS viewer.
 *
 * RTS keeps its existing DOM, toolbar and flow (see `viewer.js`); this module
 * owns the cornerstone3D engine so `viewer.js` can stay UI-focused. It consumes
 * the cornerstone3D build that the dv3d bundle exposes on `window.dv3dEngine`
 * (see dv3d `src/hostEngine.ts`), so RTS needs no bundler of its own.
 *
 * Scope / API:
 *   - `ensureEngine()`            initialise the engine + loaders (idempotent)
 *   - `createViewport(element)`   create the rendering engine, stack viewport
 *                                 and tool group for the single RTS viewer
 *   - `destroyViewport()`         tear everything down (closeViewer)
 *   - `setStack(imageIds, i)`     load a stack and show image `i`
 *   - `setActiveTool(name)`       activate one tool (others stay passive so
 *                                 their annotations keep rendering)
 *   - `importAnnotations(...)`    load new-dv3d or legacy annotations
 *   - `manualPan/Zoom/Rotate/Window/Scroll`  keyboard/arrow controls
 *   - `resetView()`, `resize()`, `purgeCaches()`, `base64ToBlob()`
 *
 * The imageId scheme matches the previous cornerstone 2D viewer:
 *   - `rtsdicom:<index>` for base64/Blob slices held in the active stack
 *   - `wadouri:<url>`    for remote DICOM
 *   - `external:<url>`   for non-DICOM images (base64 data URLs / blob URLs)
 */

import * as helper from "./helpers.js?v=1.3.0";
import { getCachedImage } from "./precache.js?v=1.3.0";

const RE_ID = "rts-rendering-engine";
const VP_ID = "rts-viewport";
const TG_ID = "rts-toolgroup";

// Keep at most this many decoded slices' Blob->fileId mappings alive, mirroring
// the memory behaviour of the old cornerstone 2D viewer.
const MAX_ACTIVE_SLICES = 12;

const state = {
  engine: null,
  re: null,
  vp: null,
  tg: null,
  element: null,
  imageIds: [],
  isStack: false,
  activeStackData: null,
  fileIds: new Map(),
  sourceIds: new Map(),
  metaCache: new Map(),
  lru: [],
  loadersRegistered: false,
  toolsRegistered: false,
};

// Tools RTS uses. Annotation tools are kept passive (so their stored
// annotations render) unless explicitly selected.
const INTERACTION_TOOLS = ["Pan", "Zoom", "WindowLevel", "StackScroll", "PlanarRotate", "Eraser"];
const ANNOTATION_TOOLS = ["ArrowAnnotate", "Length", "RectangleROI", "EllipticalROI", "Angle", "CobbAngle", "Bidirectional"];
const ALL_TOOLS = INTERACTION_TOOLS.concat(ANNOTATION_TOOLS);

function engine() {
  return window.dv3dEngine;
}

function touchSlice(index) {
  const at = state.lru.indexOf(index);
  if (at >= 0) state.lru.splice(at, 1);
  state.lru.push(index);
  while (state.lru.length > MAX_ACTIVE_SLICES) {
    evictSlice(state.lru.shift());
  }
}

function evictSlice(index) {
  if (index === undefined || index === null) return;
  state.sourceIds.delete(index);
  if (state.fileIds.has(index)) {
    const fileId = state.fileIds.get(index);
    state.fileIds.delete(index);
    try {
      const loader = state.engine.cornerstoneDICOMImageLoader;
      const fileManager = loader && loader.wadouri && loader.wadouri.fileManager;
      if (fileManager && typeof fileManager.remove === "function") {
        fileManager.remove(parseInt(String(fileId).replace("dicomfile:", ""), 10));
      }
    } catch (e) {
      // dataset already gone; ignore
    }
  }
  try {
    state.engine.cornerstone.cache.removeImageLoadObject("rtsdicom:" + index);
  } catch (e) {
    // not cached; ignore
  }
}

/** Convert a base64 data URL (or bare base64) into a Blob. */
export function base64ToBlob(dataUrl, mimeType = "application/dicom") {
  const commaIdx = dataUrl.indexOf(",");
  let base64Str = commaIdx >= 0 ? dataUrl.slice(commaIdx + 1) : dataUrl;
  if (/[\n\r ]/.test(base64Str)) base64Str = base64Str.replace(/\s+/g, "");
  const binaryStr = atob(base64Str);
  const len = binaryStr.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = binaryStr.charCodeAt(i);
  return new Blob([bytes], { type: mimeType });
}

/**
 * Add a slice's bytes to the dicom-image-loader file manager (once) and return
 * its `dicomfile:` id.
 */
function ensureFileId(index) {
  if (state.fileIds.has(index)) return state.fileIds.get(index);
  const item = state.activeStackData ? state.activeStackData[index] : undefined;
  if (item === undefined || item === null) return null;

  const loader = state.engine.cornerstoneDICOMImageLoader;
  const fileManager = loader && loader.wadouri && loader.wadouri.fileManager;
  if (!fileManager) throw new Error("cornerstone dicom-image-loader unavailable");

  let blob;
  if (item instanceof Blob) {
    blob = item;
  } else if (typeof item === "string" && item.startsWith("data:")) {
    blob = base64ToBlob(item, "application/dicom");
    state.activeStackData[index] = blob; // free the bulky base64 string
  } else {
    return null;
  }
  const fileId = fileManager.add(blob);
  state.fileIds.set(index, fileId);
  return fileId;
}

function loadExternalImage(url, imageId) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const w = img.naturalWidth || img.width;
        const h = img.naturalHeight || img.height;
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, w, h);
        const im = ctx.getImageData(0, 0, w, h);
        resolve({
          imageId,
          minPixelValue: 0,
          maxPixelValue: 255,
          slope: 1.0,
          intercept: 0,
          rows: h,
          columns: w,
          height: h,
          width: w,
          color: true,
          rgba: true,
          sizeInBytes: im.data.length,
          getPixelData: () => im.data,
          getImageData: () => im,
          getCanvas: () => canvas,
        });
      } catch (e) {
        reject(e);
      }
    };
    img.onerror = reject;
    img.src = url;
  });
}

/** Cache a slice's window/level + plane metadata keyed by index. */
function cacheSliceMetadata(index, sourceId) {
  const e = state.engine;
  try {
    const voi = e.metaData.get("voiLutModule", sourceId);
    if (voi) state.metaCache.set(index + "_voiLutModule", voi);
    const plane = e.metaData.get("imagePlaneModule", sourceId);
    if (plane) state.metaCache.set(index + "_imagePlaneModule", plane);
  } catch (err) {
    // metadata is best-effort
  }
}

/** Register RTS's image loaders + metadata provider with cornerstone3D. */
function registerLoaders() {
  if (state.loadersRegistered) return;
  const e = state.engine;
  const loader = e.cornerstoneDICOMImageLoader;

  // DICOM slices: `rtsdicom:<index>`. Bytes come from the active stack entry
  // (Blob / base64 / URL), preferring the offline pre-cache when present.
  e.imageLoader.registerImageLoader("rtsdicom", (imageId) => {
    const index = parseInt(imageId.replace("rtsdicom:", ""), 10);
    const promise = (async () => {
      const item = state.activeStackData ? state.activeStackData[index] : undefined;
      if (item === undefined || item === null) {
        throw new Error("No image data for slice index " + index);
      }

      // Remote URL: serve the pre-cached copy when available, else the network.
      if (typeof item === "string" && !item.startsWith("data:")) {
        const cached = await getCachedImage(item);
        if (cached) {
          const fileId = loader.wadouri.fileManager.add(await cached.blob());
          state.fileIds.set(index, fileId);
          state.sourceIds.set(index, fileId);
          const image = await loader.wadouri.loadImage(fileId).promise;
          image.imageId = imageId;
          cacheSliceMetadata(index, fileId);
          touchSlice(index);
          return image;
        }
        const wadouriId = item.startsWith("wadouri:") ? item : "wadouri:" + item;
        state.sourceIds.set(index, wadouriId);
        const image = await loader.wadouri.loadImage(wadouriId).promise;
        image.imageId = imageId;
        cacheSliceMetadata(index, wadouriId);
        touchSlice(index);
        return image;
      }

      const fileId = ensureFileId(index);
      if (!fileId) throw new Error("Invalid image data at slice index " + index);
      state.sourceIds.set(index, fileId);
      const image = await loader.wadouri.loadImage(fileId).promise;
      image.imageId = imageId;
      cacheSliceMetadata(index, fileId);
      touchSlice(index);
      return image;
    })();
    return { promise };
  });

  // Metadata for `rtsdicom:` slices. The dicom-image-loader only answers
  // `dicomfile:`/`wadouri:` ids, so delegate every lookup to the slice's
  // source id (the wadouri id or file-manager id it was loaded from).
  e.metaData.addProvider((type, imageId) => {
    if (typeof imageId !== "string" || !imageId.startsWith("rtsdicom:")) return undefined;
    const idx = parseInt(imageId.replace("rtsdicom:", ""), 10);
    const key = idx + "_" + type;
    if (state.metaCache.has(key)) return state.metaCache.get(key);
    const sourceId = state.fileIds.has(idx) ? state.fileIds.get(idx) : state.sourceIds.get(idx);
    if (sourceId) {
      const meta = e.metaData.get(type, sourceId);
      if (meta) state.metaCache.set(key, meta);
      return meta;
    }
    return undefined;
  });

  // Non-DICOM images (`external:<url>`), served from the pre-cache when present.
  e.imageLoader.registerImageLoader("external", (imageId) => ({
    promise: (async () => {
      const raw = imageId.replace(/^external:/, "");
      let src = raw;
      if (!raw.startsWith("data:") && !raw.startsWith("blob:")) {
        const cached = await getCachedImage(raw);
        src = cached ? URL.createObjectURL(await cached.blob()) : helper.absoluteUrl(raw);
      }
      return loadExternalImage(src, imageId);
    })(),
  }));

  state.loadersRegistered = true;
}

/** Initialise the engine and loaders. Safe to call repeatedly. */
export async function ensureEngine() {
  const e = engine();
  if (!e) throw new Error("dv3dEngine is not available (viewer bundle not loaded)");
  state.engine = e;
  await e.init({ maxWebWorkers: 4 });
  registerLoaders();
  return e;
}

function addTools(tools) {
  if (state.toolsRegistered) return;
  const names = [
    tools.PanTool,
    tools.ZoomTool,
    tools.WindowLevelTool,
    tools.StackScrollTool,
    tools.PlanarRotateTool,
    tools.EraserTool,
    tools.LengthTool,
    tools.RectangleROITool,
    tools.EllipticalROITool,
    tools.AngleTool,
    tools.CobbAngleTool,
    tools.ArrowAnnotateTool,
    tools.BidirectionalTool,
  ];
  names.forEach((t) => {
    if (!t) return;
    try {
      tools.addTool(t);
    } catch (e) {
      // already registered
    }
  });
  state.toolsRegistered = true;
}

/**
 * Create (or re-create) the single RTS viewport on `element`.
 * @param {HTMLElement} element - the `#dicom-image` container
 */
export function createViewport(element) {
  const e = state.engine;
  const cs = e.cornerstone;
  const tools = e.cornerstoneTools;

  addTools(tools);

  if (!state.re) {
    state.re = new cs.RenderingEngine(RE_ID);
  }
  state.element = element;
  state.re.enableElement({ viewportId: VP_ID, type: cs.Enums.ViewportType.STACK, element });
  state.vp = state.re.getViewport(VP_ID);
  state.re.resize(true);

  state.tg = tools.ToolGroupManager.getToolGroup(TG_ID);
  if (!state.tg) state.tg = tools.ToolGroupManager.createToolGroup(TG_ID);
  ALL_TOOLS.forEach((name) => {
    if (!state.tg.hasTool(name)) {
      try {
        state.tg.addTool(name);
      } catch (e) {
        // tool unavailable in this build
      }
    }
  });
  state.tg.addViewport(VP_ID, RE_ID);
}

/** Load a stack and display image `index`. */
export async function setStack(imageIds, index = 0, activeStackData = null) {
  state.imageIds = imageIds;
  state.activeStackData = activeStackData;
  state.isStack = Array.isArray(imageIds) && imageIds.length > 1;
  await state.vp.setStack(imageIds, index);
  state.re.resize(true);
  state.vp.render();
}

/** Activate one tool (Primary); all others stay passive so they keep rendering. */
export function setActiveTool(toolName) {
  const tg = state.tg;
  if (!tg) return;
  const Primary = state.engine.cornerstoneTools.Enums.MouseBindings.Primary;
  const Wheel = state.engine.cornerstoneTools.Enums.MouseBindings.Wheel;
  ALL_TOOLS.forEach((name) => {
    try {
      tg.setToolPassive(name);
    } catch (e) {
      // ignore
    }
  });
  if (toolName === "StackScroll") {
    tg.setToolActive("StackScroll", { bindings: [{ mouseButton: Primary }, { mouseButton: Wheel }] });
    return;
  }
  tg.setToolActive(toolName, { bindings: [{ mouseButton: Primary }] });
  if (state.isStack) {
    tg.setToolActive("StackScroll", { bindings: [{ mouseButton: Wheel }] });
  }
}

/** Index of the currently displayed image. */
export function getCurrentIndex() {
  return state.vp ? state.vp.getCurrentImageIdIndex() : 0;
}

export function getImageCount() {
  return state.imageIds ? state.imageIds.length : 0;
}

/** Window centre/width (from the viewport VOI range). */
export function getWindowLevel() {
  const range = state.vp.getProperties().voiRange;
  if (!range) return null;
  return {
    windowCenter: (range.lower + range.upper) / 2,
    windowWidth: range.upper - range.lower,
  };
}

function pixelToWorld(imageId, point) {
  const e = state.engine;
  const plane = e.metaData.get("imagePlaneModule", imageId);
  if (!plane) return undefined;
  const { rowCosines, columnCosines, imagePositionPatient, rowPixelSpacing, columnPixelSpacing } = plane;
  if (!rowCosines || !columnCosines || !imagePositionPatient) return undefined;
  const dx = columnPixelSpacing || 1;
  const dy = rowPixelSpacing || 1;
  return [
    imagePositionPatient[0] + rowCosines[0] * point.y * dy + columnCosines[0] * point.x * dx,
    imagePositionPatient[1] + rowCosines[1] * point.y * dy + columnCosines[1] * point.x * dx,
    imagePositionPatient[2] + rowCosines[2] * point.y * dy + columnCosines[2] * point.x * dx,
  ];
}

function frameOfReference(imageId) {
  const e = state.engine;
  const plane = e.metaData.get("imagePlaneModule", imageId);
  if (plane && plane.frameOfReferenceUID) return plane.frameOfReferenceUID;
  return e.metaData.get("frameOfReferenceUID", imageId) || undefined;
}

function viewPlaneNormal(imageId) {
  const plane = state.engine.metaData.get("imagePlaneModule", imageId);
  if (!plane || !plane.rowCosines || !plane.columnCosines) return undefined;
  const r = plane.rowCosines;
  const c = plane.columnCosines;
  return [
    r[1] * c[2] - r[2] * c[1],
    r[2] * c[0] - r[0] * c[2],
    r[0] * c[1] - r[1] * c[0],
  ];
}

function newUID() {
  try {
    return globalThis.crypto.randomUUID();
  } catch (e) {
    return "rts-" + Date.now() + "-" + Math.random().toString(36).slice(2);
  }
}

/** Ensure a slice's metadata is loaded so pixel->world conversion can run. */
async function ensurePlane(imageId) {
  const e = state.engine;
  if (e.metaData.get("imagePlaneModule", imageId)) return true;
  try {
    await e.imageLoader.loadImage(imageId);
  } catch (err) {
    return false;
  }
  return !!e.metaData.get("imagePlaneModule", imageId);
}

/** Remove every annotation from the cornerstone3D annotation state. */
export function clearAnnotations() {
  const stateApi = state.engine.cornerstoneTools.annotation.state;
  try {
    stateApi.removeAllAnnotations();
  } catch (e) {
    // ignore
  }
}

/**
 * Import annotations.
 *
 * `annotationsByImage` is the per-image array the exam JSON provides (one entry
 * per image, index-aligned with `imageIds`). Each entry is either:
 *   - a JSON array of cornerstone3D annotation objects (dv3d format), or
 *   - a legacy `{ ToolName: { data: [...] } }` object.
 */
export async function importAnnotations(annotationsByImage, imageIds) {
  clearAnnotations();
  const tools = state.engine.cornerstoneTools;
  const annotationState = tools.annotation.state;
  if (!Array.isArray(annotationsByImage)) return;

  for (let idx = 0; idx < annotationsByImage.length; idx++) {
    const raw = annotationsByImage[idx];
    if (!raw) continue;
    const imageId = imageIds[idx];
    if (!imageId) continue;
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      continue;
    }

    if (Array.isArray(parsed)) {
      parsed.forEach((ann) => {
        if (!ann || typeof ann !== "object") return;
        const copy = JSON.parse(JSON.stringify(ann));
        copy.metadata = copy.metadata || {};
        copy.metadata.referencedImageId = imageId;
        if (!copy.metadata.FrameOfReferenceUID) {
          copy.metadata.FrameOfReferenceUID = frameOfReference(imageId);
        }
        if (copy.metadata.toolName === "NoLabelArrowAnnotate") {
          copy.metadata.toolName = "ArrowAnnotate";
        }
        if (!copy.annotationUID) copy.annotationUID = newUID();
        copy.visibility = copy.visibility !== false;
        try {
          annotationState.addAnnotation(copy, copy.annotationUID);
        } catch (e) {
          console.warn("RTS: failed to import annotation", e);
        }
      });
    } else if (parsed && typeof parsed === "object") {
      // Legacy cornerstone tool-state: convert pixel handles to world points.
      await ensurePlane(imageId);
      Object.entries(parsed).forEach(([legacyTool, toolData]) => {
        const toolName = legacyTool === "NoLabelArrowAnnotate" ? "ArrowAnnotate" : legacyTool;
        if (!toolData || !Array.isArray(toolData.data)) return;
        toolData.data.forEach((d) => {
          if (!d || !d.handles || !d.handles.start || !d.handles.end) return;
          const start = pixelToWorld(imageId, { x: d.handles.start.y, y: d.handles.start.x });
          const end = pixelToWorld(imageId, { x: d.handles.end.y, y: d.handles.end.x });
          if (!start || !end) return;
          const annotation = {
            annotationUID: d.uuid || newUID(),
            metadata: {
              toolName,
              referencedImageId: imageId,
              FrameOfReferenceUID: frameOfReference(imageId),
              viewPlaneNormal: viewPlaneNormal(imageId),
            },
            data: {
              handles: { points: [start, end], textBox: d.handles.textBox },
              label: d.text || d.label || "",
              text: d.text || "",
            },
            visibility: d.visible !== false,
            isLocked: false,
            highlighted: false,
            invalidated: true,
          };
          try {
            annotationState.addAnnotation(annotation, annotation.annotationUID);
          } catch (e) {
            console.warn("RTS: failed to import legacy annotation", e);
          }
        });
      });
    }
  }
  if (state.vp) state.vp.render();
}

/** Pan the image by `x`,`y` canvas pixels (arrow-key control). */
export function manualPan(x, y) {
  const vp = state.vp;
  const camera = vp.getCamera();
  const p0 = vp.canvasToWorld([0, 0]);
  const p1 = vp.canvasToWorld([1, 0]);
  const p2 = vp.canvasToWorld([0, 1]);
  const dx = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]];
  const dy = [p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2]];
  const shift = [
    x * dx[0] + y * dy[0],
    x * dx[1] + y * dy[1],
    x * dx[2] + y * dy[2],
  ];
  vp.setCamera({
    focalPoint: camera.focalPoint.map((v, i) => v - shift[i]),
    position: camera.position.map((v, i) => v - shift[i]),
  });
  vp.render();
}

/** Zoom by a relative amount (`delta` is a percentage, as before). */
export function manualZoom(delta) {
  state.vp.setZoom(state.vp.getZoom() + delta / 100);
  state.vp.render();
}

/** Rotate by `delta` degrees. */
export function manualRotate(delta) {
  state.vp.setRotation(state.vp.getRotation() + delta);
  state.vp.render();
}

/** Adjust window centre/width by `wl`/`ww`. */
export function manualWindow(wl, ww) {
  const range = state.vp.getProperties().voiRange;
  if (!range) return;
  const center = (range.lower + range.upper) / 2 + wl;
  const width = range.upper - range.lower + ww;
  state.vp.setProperties({ voiRange: { lower: center - width / 2, upper: center + width / 2 } });
  state.vp.render();
}

/** Set an absolute window centre/width (CT presets). */
export function setWindowLevel(windowCenter, windowWidth) {
  state.vp.setProperties({
    voiRange: { lower: windowCenter - windowWidth / 2, upper: windowCenter + windowWidth / 2 },
  });
  state.vp.render();
}

/** Step the stack by `n` images, wrapping around (as the old viewer did). */
export function manualScroll(n) {
  const count = state.imageIds.length;
  if (count < 2) return;
  let next = state.vp.getCurrentImageIdIndex() + n;
  if (next >= count) next -= count;
  else if (next < 0) next += count;
  state.vp.setImageIdIndex(next);
  state.vp.render();
}

/** Reset pan/zoom/rotation, window/level and measurement annotations (the "reset" tool). */
export function resetView() {
  const tools = state.engine.cornerstoneTools;
  const annotationState = tools.annotation.state;
  const all = annotationState.getAllAnnotations ? annotationState.getAllAnnotations() : [];
  all.forEach((a) => {
    const tool = a.metadata && a.metadata.toolName;
    if (tool === "Length" || tool === "RectangleROI") {
      try {
        annotationState.removeAnnotation(a.annotationUID);
      } catch (e) {
        // ignore
      }
    }
  });
  state.vp.resetCamera();
  // resetProperties() restores the default VOI (window/level) and invert, and
  // re-renders — matching the old cornerstone 2D `reset` behaviour.
  if (typeof state.vp.resetProperties === "function") {
    state.vp.resetProperties();
  }
  state.vp.render();
}

export function resize() {
  if (state.re) state.re.resize(true);
  // Resizing clears the viewport canvas, so force a fresh draw afterwards.
  if (state.vp) state.vp.render();
}

/** Drop cached images / datasets (switching figures or closing the viewer). */
export function purgeCaches() {
  state.activeStackData = null;
  state.fileIds.clear();
  state.sourceIds.clear();
  state.metaCache.clear();
  state.lru.length = 0;
  try {
    state.engine.cornerstone.cache.purgeCache();
  } catch (e) {
    // ignore
  }
  try {
    const wadouri = state.engine.cornerstoneDICOMImageLoader.wadouri;
    if (wadouri && wadouri.fileManager && wadouri.fileManager.purge) wadouri.fileManager.purge();
    if (wadouri && wadouri.dataSetCacheManager && wadouri.dataSetCacheManager.purge) {
      wadouri.dataSetCacheManager.purge();
    }
  } catch (e) {
    // ignore
  }
}

/** Destroy the viewport (closing the viewer). */
export function destroyViewport() {
  try {
    if (state.re && state.element) state.re.disableElement(VP_ID);
  } catch (e) {
    // ignore
  }
  try {
    if (state.tg) state.engine.cornerstoneTools.ToolGroupManager.destroyToolGroup(TG_ID);
  } catch (e) {
    // ignore
  }
  state.vp = null;
  state.tg = null;
  state.element = null;
  state.imageIds = [];
  purgeCaches();
}

export function getEngineElement() {
  return state.element;
}

/** Subscribe to cornerstone3D's IMAGE_RENDERED event on the viewer element. */
export function addImageRenderedListener(element, handler) {
  if (!state.engine || !element) return;
  element.addEventListener(state.engine.cornerstone.Enums.Events.IMAGE_RENDERED, handler);
}

/**
 * Draw a loaded cornerstone image into a canvas (thumbnails).
 * Applies the image's default window/level (or min/max) for grayscale data.
 */
function drawImageToCanvas(canvas, image) {
  const rows = image.rows;
  const cols = image.columns;
  canvas.width = cols;
  canvas.height = rows;
  const ctx = canvas.getContext("2d");
  const out = ctx.createImageData(cols, rows);
  const data = out.data;
  const px = image.getPixelData();
  if (image.color || image.rgba) {
    // Color images: `rgba` (4 bytes/pixel) or RGB (3 bytes/pixel). Cornerstone
    // sets `color: true` for both, so pick the stride from `rgba`.
    const stride = image.rgba ? 4 : 3;
    for (let i = 0; i < cols * rows; i++) {
      data[i * 4] = px[i * stride];
      data[i * 4 + 1] = px[i * stride + 1];
      data[i * 4 + 2] = px[i * stride + 2];
      data[i * 4 + 3] = stride === 4 ? px[i * stride + 3] : 255;
    }
  } else {
    let wc = image.windowCenter;
    let ww = image.windowWidth;
    if (Array.isArray(wc)) wc = wc[0];
    if (Array.isArray(ww)) ww = ww[0];
    if (wc === undefined || wc === null || ww === undefined || ww === null) {
      wc = ((image.minPixelValue || 0) + (image.maxPixelValue || 255)) / 2;
      ww = (image.maxPixelValue || 255) - (image.minPixelValue || 0) || 1;
    }
    const slope = image.slope === undefined ? 1 : image.slope;
    const intercept = image.intercept === undefined ? 0 : image.intercept;
    const lower = wc - ww / 2;
    const range = ww || 1;
    for (let i = 0; i < cols * rows; i++) {
      const v = px[i] * slope + intercept;
      let g = (v - lower) / range;
      g = g < 0 ? 0 : g > 1 ? 1 : g;
      const b = Math.round(g * 255);
      data[i * 4] = b;
      data[i * 4 + 1] = b;
      data[i * 4 + 2] = b;
      data[i * 4 + 3] = 255;
    }
  }
  ctx.putImageData(out, 0, 0);
}

/**
 * Render a DICOM thumbnail into a canvas element.
 * `data` is a base64 data URL / Blob / remote URL (as provided by the exam JSON).
 */
export async function renderThumbnail(canvas, data) {
  await ensureEngine();
  const e = state.engine;
  const loader = e.cornerstoneDICOMImageLoader;
  let imageId;
  if (data instanceof Blob) {
    imageId = loader.wadouri.fileManager.add(data);
  } else if (typeof data === "string" && data.startsWith("data:")) {
    imageId = loader.wadouri.fileManager.add(base64ToBlob(data, "application/dicom"));
  } else if (typeof data === "string") {
    // Load the bytes the same way the viewer does: from the offline pre-cache
    // when present, otherwise a direct fetch. This mirrors the old viewer's
    // urltoFile path and keeps thumbnails working offline once pre-cached.
    const cached = await getCachedImage(data);
    const blob = cached ? await cached.blob() : await (await fetch(helper.absoluteUrl(data))).blob();
    imageId = loader.wadouri.fileManager.add(blob);
  } else {
    return;
  }
  const image = await loader.wadouri.loadImage(imageId).promise;
  drawImageToCanvas(canvas, image);
}
