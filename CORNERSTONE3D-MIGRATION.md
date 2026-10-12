# RTS → cornerstone3D migration

Status: **implemented; pending visual verification.** RTS's viewer now runs on
cornerstone3D while keeping its existing DOM, toolbar and flow. Remaining:
confirm on a visible screen and remove the dev harnesses before release.

## Why

RTS (`/home/ross/rts`) is the candidate-facing exam client. Annotations are
authored in the Django app via dv3d and delivered to RTS in the exam JSON.

- RTS vendors **cornerstone-core 2.3.0** + **cornerstone-tools 4.22.1** and reads
  the classic per-image toolState object via
  `globalImageIdSpecificToolStateManager.restoreToolState` (`js/viewer.js`).
- dv3d stores the cornerstone3D format: a JSON **array** of annotation objects
  with **world-coordinate** points and `metadata.referencedImageId`
  (`rapids/models.py:set_case_annotations`, `get_case_annotations_json`;
  `anatomy/models.py:get_case_annotations_json`).
- `get_exam_question_json` / `get_question_json` serve the **raw**
  `image_annotations`, so once a question is re-saved in dv3d, RTS receives the
  array format and `restoreToolState` renders nothing.

No 2D cornerstone release reads the cornerstone3D format, so the fix is to move
RTS onto cornerstone3D.

## Decisions

- **RTS keeps its own DOM, toolbar, controls and offline loader.** RTS is a
  high-stakes exam client with a bespoke layout and offline (IndexedDB) image
  flow; swapping its UI wholesale is not acceptable. We upgrade the *engine*.
- **The engine comes from the dv3d bundle.** dv3d now exposes its bundled
  cornerstone3D on `window.dv3dEngine` (`dv3d/dicom-viewer/src/hostEngine.ts`),
  so RTS does not need its own bundler. The surface is:
  `cornerstone`, `cornerstoneTools`, `cornerstoneDICOMImageLoader`, `imageLoader`,
  `metaData`, `cache`, `volumeLoader`, `Enums`, and `init(options)`.
- RTS stays a **no-build** ES-module app.

## Key challenges

1. **Offline imageIds ↔ annotation `referencedImageId`.**
   RTS serves slices from IndexedDB via its own `rtsdicom:` scheme; dv3d's stored
   annotations reference `wadouri:<media-url>` (see `helpers/urls.viewer_image_id`).
   cornerstones3D tools only render an annotation on the viewport whose imageId
   matches `metadata.referencedImageId`, so the two must agree.
   Planned fix: register RTS's `rtsdicom:` loader/provider with cornerstone3D and
   rewrite each annotation's `referencedImageId` to the RTS imageId for the image
   it belongs to (RTS knows the image order from `current_question.images`).
2. **Blob storage.** The offline path keeps slices as Blobs (added to the old
   `wadouri.fileManager`). cornerstone3D equivalent: add the Blob to
   `window.dv3dEngine.cornerstoneDICOMImageLoader.wadouri.fileManager` and load
   `wadouri:<fileId>`, or implement `rtsdicom:` on top of that loader.
3. **Tool/control parity.** RTS tools: Pan, Zoom, Wwwc, Rotate, StackScroll,
   StackScrollMouseWheel, Eraser, Length, RectangleRoi, ArrowAnnotate. All exist
   in cornerstone3D (WindowLevel/Rotate/StackScroll/ArrowAnnotate/Length/
   RectangleROI/Eraser). The custom toolbar (`interact.js`,
   `viewer.changeControlSelection`, `manualPanDicom`, …) drives them through the
   tool group instead of cornerstoneTools 4.
4. **Bundle delivery & versioning.** The ~5 MB dv3d bundle + wasm assets must be
   available offline. Options: vendor under `lib/dv3d/` (included in the release)
   or fetch-and-pin at release time. To decide during stage 1.

## Staged plan

- **Stage 0 (done).** dv3d exposes `window.dv3dEngine`; built and verified in dev.
- **Stage 1 (done).** The dv3d bundle is vendored under `lib/dv3d/` (built with
  `DV3D_BASE=./` so the wasm/worker refs are relative) and `js/viewer3d.js` owns
  the engine: init, `rtsdicom:`/`external:` loaders, metadata provider, viewport,
  tool group, annotation import, controls.
- **Stage 2 (done).** `rtsdicom:` (base64/Blob -> wadouri fileManager) and the
  annotation `referencedImageId` remap (annotations are index-aligned with the
  exam JSON images, so each annotation's id is rewritten to the RTS imageId).
- **Stage 3 (done).** Toolbar/keybindings/fullscreen/scroll-indicator/manual
  pan/zoom/rotate/window/scroll mapped onto the cornerstone3D tool group
  (`js/viewer.js` keeps the same DOM and exported API).
- **Stage 4 (done).** `js/viewer.js` drives `viewer3d.js`; `js/main.js`
  thumbnails use `viewer.renderThumbnail`; `index.html` loads the dv3d bundle +
  `host.css` instead of the cornerstone 2D scripts.
- **Stage 5 (done except release bump).** Dev harnesses removed and the unused
  cornerstone 2D libraries deleted (~7.7 MB). Remaining: bump the RTS version
  via `scripts/release.sh` before deploying (the `?v=` cache-busting strings are
  still at the old version).

## Verified so far

- The vendored bundle loads from the RTS origin, `window.dv3dEngine` initialises,
  and the wasm codec resolves with `content-type: application/wasm`.
- A stack loads (256x256), tools register, and annotations render (4 SVG circles)
  on a visible screen.
- Legacy pixel handles `(60,60)->(180,140)` and dv3d world points
  `[[42,42,0],[126,98,0]]` both import and map back to canvas `[[60,280],[180,360]]`
  through the real `viewer.openMainImage` flow.


## Testing

- `npm test` / `npm run lint` in RTS.
- Manual: load an anatomy question (single image) and a rapid (stack) with
  arrow/length/ROI annotations saved in dv3d; confirm they render and that the
  tools behave as before.
- Regression: legacy-format questions must still render (dv3d converts legacy →
  native on import).
