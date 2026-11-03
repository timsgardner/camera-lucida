import { createTexture } from "./renderer.js";
import { OVERLAY_MODES } from "./shaders.js";

export function setupControlMenu() {
  const menuToggle = document.getElementById("menuToggle");
  const controlsPanel = document.getElementById("controlsPanel");
  const closeControlsButton = document.getElementById("closeControlsButton");

  function setMenuOpen(isOpen) {
    controlsPanel.classList.toggle("is-open", isOpen);
    document.body.classList.toggle("controls-open", isOpen);
    menuToggle.setAttribute("aria-expanded", String(isOpen));

    if (isOpen) {
      closeControlsButton.focus();
    } else {
      menuToggle.focus();
    }
  }

  menuToggle.addEventListener("click", () => setMenuOpen(true));
  closeControlsButton.addEventListener("click", () => setMenuOpen(false));
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && controlsPanel.classList.contains("is-open")) {
      setMenuOpen(false);
    }
  });
}

export function setupDistortionSlider() {
  const slider = document.getElementById("distortionSlider");
  const input = document.getElementById("distortionValue");

  let distortion = parseFloat(slider.value);

  function updateDistortion(value) {
    distortion = value;
    slider.value = value; // Sync the slider
    input.value = value; // Sync the input field
  }

  // Handle slider input
  slider.addEventListener("input", (event) => {
    const value = parseFloat(event.target.value);
    updateDistortion(value);
  });

  // Handle input field interactions
  input.addEventListener("blur", () => {
    // Update the distortion when the user leaves the input field
    let value = parseFloat(input.value);
    const min = parseFloat(input.min);
    const max = parseFloat(input.max);

    if (isNaN(value)) {
      value = distortion; // Revert to the current distortion if input is invalid
    } else {
      // Clamp the value to the slider's range
      if (value < min) value = min;
      if (value > max) value = max;
    }

    updateDistortion(value);
  });

  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      // Handle updates when pressing Enter
      input.blur(); // Trigger the blur handler to update the value
    }
  });

  return () => distortion;
}

export function setupPencilEnhance() {
  const pencilToggle = document.getElementById("pencilToggle");
  const pencilStrengthSlider = document.getElementById("pencilStrengthSlider");

  let enhancePencil = pencilToggle.checked;
  let pencilStrength = parseFloat(pencilStrengthSlider.value);
  pencilStrengthSlider.disabled = !enhancePencil;

  pencilToggle.addEventListener("change", (event) => {
    enhancePencil = event.target.checked;
    pencilStrengthSlider.disabled = !enhancePencil;
  });

  pencilStrengthSlider.addEventListener("input", (event) => {
    pencilStrength = parseFloat(event.target.value);
  });

  return () => ({ enhancePencil, pencilStrength });
}

export function setupFreeze(video) {
  const canvasContainer = document.getElementById("canvasContainer");
  const frozenIndicator = document.getElementById("frozenIndicator");

  let isFrozen = false;

  function setFrozen(frozen) {
    isFrozen = frozen;
    frozenIndicator.hidden = !frozen;
  }

  canvasContainer.addEventListener("click", () => {
    if (video.readyState >= 2) {
      setFrozen(!isFrozen);
    }
  });

  // Show a newly started camera straight away
  video.addEventListener("play", () => setFrozen(false));

  return () => isFrozen;
}

export function setupImageOverlay(gl) {
  const imageInput = document.getElementById("imageInput");
  const opacitySlider = document.getElementById("opacitySlider");
  const overlayModeSelect = document.getElementById("overlayModeSelect");
  const edgeThresholdSlider = document.getElementById("edgeThresholdSlider");

  let imageTexture = null;
  let overlayResolution = { width: 1, height: 1 };
  let opacity = parseFloat(opacitySlider.value);
  let overlayMode;
  let edgeThreshold = parseFloat(edgeThresholdSlider.value);

  function updateOverlayMode() {
    overlayMode = OVERLAY_MODES[overlayModeSelect.value];
    edgeThresholdSlider.disabled = overlayMode !== OVERLAY_MODES.edges;
  }

  updateOverlayMode();

  // Update opacity from slider
  opacitySlider.addEventListener("input", (event) => {
    opacity = parseFloat(event.target.value);
  });

  overlayModeSelect.addEventListener("change", updateOverlayMode);

  // Update edge threshold from slider
  edgeThresholdSlider.addEventListener("input", (event) => {
    edgeThreshold = parseFloat(event.target.value);
  });

  // Handle image uploads
  imageInput.addEventListener("change", (event) => {
    const file = event.target.files[0];
    if (!file) return;

    const imageUrl = URL.createObjectURL(file);
    const img = new Image();
    img.onerror = () => URL.revokeObjectURL(imageUrl);
    img.onload = () => {
      URL.revokeObjectURL(imageUrl);

      if (imageTexture) {
        gl.deleteTexture(imageTexture);
      }

      imageTexture = createTexture(gl);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);

      // Update overlay resolution
      overlayResolution = { width: img.width, height: img.height };
    };
    img.src = imageUrl;
  });

  // Provide current overlay settings
  return () => ({
    imageTexture,
    opacity,
    overlayResolution,
    overlayMode,
    edgeThreshold,
  });
}
