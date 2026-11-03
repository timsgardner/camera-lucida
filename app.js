import { initializeVideo, setupCameraButton } from "./camera.js";
import {
  setupControlMenu,
  setupDistortionSlider,
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
  window.addEventListener("resize", () => updateCanvasSize(video, gl));
  video.addEventListener("loadedmetadata", () => updateCanvasSize(video, gl));

  setupRender(video, gl, {
    getDistortion: setupDistortionSlider(),
    getOverlaySettings: setupImageOverlay(gl),
    getPencilSettings: setupPencilEnhance(),
  });
} else {
  showFatalError("This browser doesn't support WebGL.");
}
