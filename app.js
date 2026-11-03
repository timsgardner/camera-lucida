function setupCameraButton(video) {
  const startCameraButton = document.getElementById("startCameraButton");
  const cameraSelect = document.getElementById("cameraSelect");
  const cameraStatus = document.getElementById("cameraStatus");
  let currentStream = null;
  let isStarting = false;

  async function updateCameraList(activeDeviceId) {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const videoInputs = devices.filter(
      (device) => device.kind === "videoinput"
    );

    cameraSelect.replaceChildren();
    videoInputs.forEach((device, index) => {
      const option = document.createElement("option");
      option.value = device.deviceId;
      option.textContent = device.label || `Camera ${index + 1}`;
      cameraSelect.appendChild(option);
    });

    cameraSelect.disabled = videoInputs.length === 0;
    if (activeDeviceId && videoInputs.some((device) => device.deviceId === activeDeviceId)) {
      cameraSelect.value = activeDeviceId;
    }
  }

  async function startCamera(deviceId = null) {
    if (isStarting) return;

    isStarting = true;
    startCameraButton.disabled = true;
    cameraStatus.textContent = "Requesting camera access...";

    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("Camera access is not available in this browser.");
      }

      if (currentStream) {
        currentStream.getTracks().forEach((track) => track.stop());
      }

      const videoConstraints = deviceId
        ? { deviceId: { exact: deviceId } }
        : { facingMode: { ideal: "environment" } };

      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: videoConstraints,
          audio: false,
        });
      } catch (error) {
        if (deviceId || error.name !== "OverconstrainedError") {
          throw error;
        }
        stream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: false,
        });
      }

      currentStream = stream;
      video.srcObject = currentStream;
      const activeTrack = currentStream.getVideoTracks()[0];
      const activeDeviceId = activeTrack?.getSettings().deviceId;
      await updateCameraList(activeDeviceId);
      cameraStatus.textContent = "Camera active";

      await video.play();
    } catch (error) {
      cameraStatus.textContent = `Camera error: ${error.message}`;
      console.error("Error accessing camera:", error);
    } finally {
      isStarting = false;
      startCameraButton.disabled = false;
    }
  }

  cameraSelect.addEventListener("change", () => {
    if (cameraSelect.value) {
      startCamera(cameraSelect.value);
    }
  });

  startCameraButton.addEventListener("click", () => startCamera());
}

function initializeVideo() {
  const video = document.createElement("video");
  video.autoplay = true;
  video.muted = true;
  video.playsInline = true;
  return video;
}

function setupControlMenu() {
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

function showFatalError(message) {
  document.getElementById("canvasContainer").textContent = message;
}

function updateCanvasSize(video, gl) {
  const container = document.getElementById("canvasContainer");
  const canvas = document.getElementById("webglCanvas");
  if (!video.videoWidth || !video.videoHeight) return;

  const containerWidth = container.clientWidth;
  const containerHeight = container.clientHeight;
  const videoAspectRatio = video.videoWidth / video.videoHeight;

  let canvasWidth, canvasHeight;

  if (containerWidth / containerHeight > videoAspectRatio) {
    // Container is wider than the video aspect ratio
    canvasHeight = containerHeight;
    canvasWidth = canvasHeight * videoAspectRatio;
  } else {
    // Container is taller than the video aspect ratio
    canvasWidth = containerWidth;
    canvasHeight = canvasWidth / videoAspectRatio;
  }

  canvas.width = canvasWidth;
  canvas.height = canvasHeight;
  canvas.style.width = `${canvasWidth}px`;
  canvas.style.height = `${canvasHeight}px`;

  gl.viewport(0, 0, canvas.width, canvas.height);
}

// Initialize WebGL program
const vertexShaderSource = `
    attribute vec2 a_position;
    attribute vec2 a_texCoord;
    varying vec2 v_texCoord;

    void main() {
      gl_Position = vec4(a_position, 0.0, 1.0);
      v_texCoord = a_texCoord;
    }
  `;

const OVERLAY_MODES = { normal: 0, inverseMask: 1, edges: 2 };

const fragmentShaderSource = `
// Edge detection offsets by single texels, which mediump can't resolve on mobile
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

const int OVERLAY_MODE_INVERSE_MASK = ${OVERLAY_MODES.inverseMask};
const int OVERLAY_MODE_EDGES = ${OVERLAY_MODES.edges};
const vec3 TRACE_COLOR = vec3(0.0235, 0.2235, 0.4392); // Indigo blue #063970

varying vec2 v_texCoord;
uniform sampler2D u_texture;           // Video texture
uniform sampler2D u_overlayTexture;   // Overlay image texture
uniform float u_opacity;              // Overlay opacity for blending
uniform vec2 u_overlayResolution;     // Resolution of overlay texture
uniform vec2 u_canvasResolution;      // Resolution of canvas
uniform float u_distortion;           // Distortion strength
uniform int u_overlayMode;            // One of OVERLAY_MODES
uniform float u_edgeThreshold;        // Minimum gradient that counts as an edge
uniform bool u_hasOverlay;            // Whether an overlay is active
uniform bool u_enhancePencil;         // Whether to bring out faint pencil lines
uniform float u_pencilStrength;       // How strongly to darken pencil lines

vec2 applyDistortion(vec2 coord, float distortion) {
  vec2 centered = coord - 0.5; // Center the coordinates
  float r = length(centered); // Distance from the center
  vec2 distorted = centered * (1.0 + distortion * r * r); // Radial distortion
  return distorted + 0.5; // Return to texture space
}

float luminance(vec3 color) {
  return dot(color, vec3(0.299, 0.587, 0.114));
}

float videoLuminance(vec2 coord) {
  return luminance(texture2D(u_texture, coord).rgb);
}

// Average video brightness in a wide disc around coord, spiralling out from the center
float paperBrightness(vec2 coord) {
  vec2 radius = 0.05 * vec2(u_canvasResolution.y / u_canvasResolution.x, 1.0);
  float total = 0.0;

  for (int i = 0; i < 16; i++) {
    float angle = float(i) * 2.4; // Golden angle spreads samples evenly
    float sampleDistance = sqrt((float(i) + 0.5) / 16.0);
    total += videoLuminance(coord + radius * sampleDistance * vec2(cos(angle), sin(angle)));
  }

  return total / 16.0;
}

// Flatten the lighting so paper is white, then darken whatever is darker than the paper
vec4 enhancePencil(vec2 coord) {
  float ratio = videoLuminance(coord) / max(paperBrightness(coord), 0.01);
  float darkness = max(1.0 - ratio - 0.02, 0.0); // Small dead zone hides paper grain
  return vec4(vec3(1.0 - min(darkness * u_pencilStrength, 1.0)), 1.0);
}

float overlayLuminance(vec2 coord) {
  vec4 color = texture2D(u_overlayTexture, coord);
  return mix(1.0, luminance(color.rgb), color.a); // Treat transparent pixels as white paper
}

// Sobel gradient magnitude of the overlay at coord
float overlayEdgeStrength(vec2 coord, vec2 texel) {
  float topLeft = overlayLuminance(coord + texel * vec2(-1.0, -1.0));
  float top = overlayLuminance(coord + texel * vec2(0.0, -1.0));
  float topRight = overlayLuminance(coord + texel * vec2(1.0, -1.0));
  float left = overlayLuminance(coord + texel * vec2(-1.0, 0.0));
  float right = overlayLuminance(coord + texel * vec2(1.0, 0.0));
  float bottomLeft = overlayLuminance(coord + texel * vec2(-1.0, 1.0));
  float bottom = overlayLuminance(coord + texel * vec2(0.0, 1.0));
  float bottomRight = overlayLuminance(coord + texel * vec2(1.0, 1.0));

  float gradientX = topRight + 2.0 * right + bottomRight - topLeft - 2.0 * left - bottomLeft;
  float gradientY = bottomLeft + 2.0 * bottom + bottomRight - topLeft - 2.0 * top - topRight;
  return length(vec2(gradientX, gradientY));
}

// Blend the overlay, fitted like "object-fit: contain", over videoColor
vec4 applyOverlay(vec4 videoColor) {
  float canvasAspect = u_canvasResolution.x / u_canvasResolution.y;
  float overlayAspect = u_overlayResolution.x / u_overlayResolution.y;

  vec2 scaleFactor = vec2(1.0);
  vec2 offset = vec2(0.0);

  if (canvasAspect > overlayAspect) {
    // Canvas is wider than overlay
    scaleFactor.x = overlayAspect / canvasAspect;
    offset.x = (1.0 - scaleFactor.x) / 2.0;
  } else {
    // Canvas is taller than overlay
    scaleFactor.y = canvasAspect / overlayAspect;
    offset.y = (1.0 - scaleFactor.y) / 2.0;
  }

  vec2 overlayCoord = (v_texCoord - offset) / scaleFactor;

  // No overlay contribution outside its bounds
  if (overlayCoord.x < 0.0 || overlayCoord.x > 1.0 || overlayCoord.y < 0.0 || overlayCoord.y > 1.0) {
    return videoColor;
  }

  vec4 overlayColor = texture2D(u_overlayTexture, overlayCoord);

  if (u_overlayMode == OVERLAY_MODE_INVERSE_MASK) {
    overlayColor.a = 1.0 - luminance(overlayColor.rgb); // Light areas are more transparent
    overlayColor.rgb = TRACE_COLOR;
  } else if (u_overlayMode == OVERLAY_MODE_EDGES) {
    // Step by at least one screen pixel so downscaled overlays don't lose edges
    vec2 texel = max(1.0 / u_overlayResolution, 1.0 / (u_canvasResolution * scaleFactor));
    float edgeStrength = overlayEdgeStrength(overlayCoord, texel);

    overlayColor.a = smoothstep(u_edgeThreshold, u_edgeThreshold + 0.1, edgeStrength);
    overlayColor.rgb = TRACE_COLOR;
  }

  return mix(videoColor, overlayColor, overlayColor.a * u_opacity);
}

void main() {
  vec2 distortedCoord = applyDistortion(v_texCoord, u_distortion);
  vec4 videoColor = u_enhancePencil ? enhancePencil(distortedCoord) : texture2D(u_texture, distortedCoord);

  if (u_hasOverlay) {
    gl_FragColor = applyOverlay(videoColor);
  } else {
    gl_FragColor = videoColor;
  }
}
`;

function createTexture(gl) {
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  return texture;
}

function createShader(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.error("Shader compile error:", gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

function createProgram(gl, vertexShader, fragmentShader) {
  const program = gl.createProgram();
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error("Program link error:", gl.getProgramInfoLog(program));
    gl.deleteProgram(program);
    return null;
  }
  return program;
}

const UNIFORM_NAMES = [
  "u_texture",
  "u_overlayTexture",
  "u_opacity",
  "u_canvasResolution",
  "u_overlayResolution",
  "u_distortion",
  "u_overlayMode",
  "u_edgeThreshold",
  "u_hasOverlay",
  "u_enhancePencil",
  "u_pencilStrength",
];

function bindAttribute(gl, program, name, values) {
  const location = gl.getAttribLocation(program, name);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(values), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(location);
  gl.vertexAttribPointer(location, 2, gl.FLOAT, false, 0, 0);
}

function setupRender(
  video,
  gl,
  { getDistortion, getOverlaySettings, getPencilSettings }
) {
  const canvas = document.getElementById("webglCanvas");
  const vertexShader = createShader(gl, gl.VERTEX_SHADER, vertexShaderSource);
  const fragmentShader = createShader(
    gl,
    gl.FRAGMENT_SHADER,
    fragmentShaderSource
  );
  const program =
    vertexShader &&
    fragmentShader &&
    createProgram(gl, vertexShader, fragmentShader);
  if (!program) {
    showFatalError("Could not compile the graphics shaders.");
    return;
  }

  gl.useProgram(program);

  const uniforms = Object.fromEntries(
    UNIFORM_NAMES.map((name) => [name, gl.getUniformLocation(program, name)])
  );
  gl.uniform1i(uniforms.u_texture, 0);
  gl.uniform1i(uniforms.u_overlayTexture, 1);

  // Full-canvas quad
  bindAttribute(gl, program, "a_position", [-1, -1, 1, -1, -1, 1, 1, 1]);
  bindAttribute(gl, program, "a_texCoord", [0, 1, 1, 1, 0, 0, 1, 0]);

  gl.activeTexture(gl.TEXTURE0);
  const videoTexture = createTexture(gl);

  function render() {
    if (video.readyState >= 2) {
      const { imageTexture, opacity, overlayResolution, overlayMode, edgeThreshold } =
        getOverlaySettings();
      const { enhancePencil, pencilStrength } = getPencilSettings();
      const hasOverlay = Boolean(imageTexture);

      // Update the video texture
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, videoTexture);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        video
      );

      gl.clear(gl.COLOR_BUFFER_BIT);

      gl.uniform2f(uniforms.u_canvasResolution, canvas.width, canvas.height);
      gl.uniform1i(uniforms.u_hasOverlay, hasOverlay ? 1 : 0);
      gl.uniform1f(uniforms.u_distortion, getDistortion());
      gl.uniform1i(uniforms.u_enhancePencil, enhancePencil ? 1 : 0);
      gl.uniform1f(uniforms.u_pencilStrength, pencilStrength);

      // Set overlay-specific uniforms if an overlay is active
      if (hasOverlay) {
        gl.uniform2f(
          uniforms.u_overlayResolution,
          overlayResolution.width,
          overlayResolution.height
        );
        gl.uniform1i(uniforms.u_overlayMode, overlayMode);
        gl.uniform1f(uniforms.u_edgeThreshold, edgeThreshold);
        gl.uniform1f(uniforms.u_opacity, opacity);

        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, imageTexture);
      }

      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }

    requestAnimationFrame(render);
  }

  render();
}

function setupDistortionSlider() {
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

function setupPencilEnhance() {
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

function setupImageOverlay(gl) {
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

document.addEventListener("DOMContentLoaded", () => {
  const canvas = document.getElementById("webglCanvas");
  const gl = canvas.getContext("webgl");
  if (!gl) {
    showFatalError("This browser doesn't support WebGL.");
    return;
  }

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
});
