import { initializeVideo, setupCameraButton } from "./camera.js";
import {
  setupControlMenu,
  setupFreeze,
  setupImageOverlay,
  setupPencilEnhance,
} from "./controls.js";
import { setupRender, showFatalError, updateCanvasSize } from "./renderer.js";

const canvas = document.getElementById("webglCanvas");
const gl = canvas.getContext("webgl");

if (gl) {
  const video = initializeVideo();

  setupControlMenu();
  setupCameraButton(video);
  // Also catches the control bar changing height as controls show and hide
  new ResizeObserver(() => updateCanvasSize(video, gl)).observe(
    document.getElementById("canvasContainer")
  );
  video.addEventListener("loadedmetadata", () => updateCanvasSize(video, gl));

  setupRender(video, gl, {
    getOverlaySettings: setupImageOverlay(gl),
    getPencilSettings: setupPencilEnhance(),
    getIsFrozen: setupFreeze(video),
  });
} else {
  showFatalError("This browser doesn't support WebGL.");
}
