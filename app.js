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
  document.getElementById("stuffContainer").textContent = message;
}

function updateCanvasSize(video, gl) {
  const container = document.getElementById("stuffContainer");
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

const fragmentShaderSource = `
// Edge detection offsets by single texels, which mediump can't resolve on mobile
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
varying vec2 v_texCoord;
uniform sampler2D u_texture;           // Video texture
uniform sampler2D u_overlayTexture;   // Overlay image texture
uniform float u_transparency;         // Transparency for blending
uniform vec2 u_overlayResolution;     // Resolution of overlay texture
uniform vec2 u_canvasResolution;      // Resolution of canvas
uniform float u_distortion;           // Distortion strength
uniform int u_overlayMode;            // 0: normal, 1: inverse alpha mask, 2: edges
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

float videoLuminance(vec2 coord) {
  vec4 color = texture2D(u_texture, coord);
  return 0.299 * color.r + 0.587 * color.g + 0.114 * color.b;
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
  float luminance = 0.299 * color.r + 0.587 * color.g + 0.114 * color.b;
  return mix(1.0, luminance, color.a); // Treat transparent pixels as white paper
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

void main() {
  // Apply distortion to the video texture coordinates
  vec2 distortedCoord = applyDistortion(v_texCoord, u_distortion);
  vec4 videoColor = u_enhancePencil ? enhancePencil(distortedCoord) : texture2D(u_texture, distortedCoord);

  vec4 blendedColor = videoColor; // Default to videoColor if no overlay

  if (u_hasOverlay) {
    // Aspect ratios
    float canvasAspect = u_canvasResolution.x / u_canvasResolution.y;
    float overlayAspect = u_overlayResolution.x / u_overlayResolution.y;

    // Scale factor for "object-fit: contain"
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

    // Scale and center the texture coordinates
    vec2 adjustedCoord = (v_texCoord - offset) / scaleFactor;

    // Clamp texture coordinates to avoid sampling outside the overlay
    if (adjustedCoord.x < 0.0 || adjustedCoord.x > 1.0 || adjustedCoord.y < 0.0 || adjustedCoord.y > 1.0) {
      gl_FragColor = videoColor; // No overlay contribution outside bounds
      return;
    }

    // Sample the overlay texture
    vec4 overlayColor = texture2D(u_overlayTexture, adjustedCoord);

    // Compute luminance of the overlay color
    float luminance = 0.299 * overlayColor.r + 0.587 * overlayColor.g + 0.114 * overlayColor.b;

    // Apply inverse alpha mask using luminance
    if (u_overlayMode == 1) {
      overlayColor.a = 1.0 - luminance; // Light areas are more transparent

      // Replace RGB with the indigo blue color #063970
      overlayColor.rgb = vec3(0.0235, 0.2235, 0.4392);
      // overlayColor.rgb = vec3(0,0,0);
    } else if (u_overlayMode == 2) {
      // Step by at least one screen pixel so downscaled overlays don't lose edges
      vec2 texel = max(1.0 / u_overlayResolution, 1.0 / (u_canvasResolution * scaleFactor));
      float edgeStrength = overlayEdgeStrength(adjustedCoord, texel);

      overlayColor.a = smoothstep(u_edgeThreshold, u_edgeThreshold + 0.1, edgeStrength);
      overlayColor.rgb = vec3(0.0235, 0.2235, 0.4392); // Indigo blue #063970
    }

    // Blend video and overlay using the computed alpha
    blendedColor = mix(videoColor, overlayColor, overlayColor.a * u_transparency);
  }

  gl_FragColor = blendedColor;
}


  `;

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

function setupRender(
  video,
  gl,
  getDistortion,
  getOverlaySettings,
  getPencilSettings
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

  const positionLocation = gl.getAttribLocation(program, "a_position");
  const texCoordLocation = gl.getAttribLocation(program, "a_texCoord");
  const textureLocation = gl.getUniformLocation(program, "u_texture");
  const overlayTextureLocation = gl.getUniformLocation(
    program,
    "u_overlayTexture"
  );
  const transparencyLocation = gl.getUniformLocation(program, "u_transparency");
  const canvasResolutionLocation = gl.getUniformLocation(
    program,
    "u_canvasResolution"
  );
  const overlayResolutionLocation = gl.getUniformLocation(
    program,
    "u_overlayResolution"
  );
  const distortionLocation = gl.getUniformLocation(program, "u_distortion");
  const overlayModeLocation = gl.getUniformLocation(program, "u_overlayMode");
  const edgeThresholdLocation = gl.getUniformLocation(
    program,
    "u_edgeThreshold"
  );
  const hasOverlayLocation = gl.getUniformLocation(program, "u_hasOverlay");
  const enhancePencilLocation = gl.getUniformLocation(
    program,
    "u_enhancePencil"
  );
  const pencilStrengthLocation = gl.getUniformLocation(
    program,
    "u_pencilStrength"
  );

  const positionBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1.0, -1.0, 1.0, -1.0, -1.0, 1.0, 1.0, 1.0]),
    gl.STATIC_DRAW
  );

  const texCoordBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffer);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([0.0, 1.0, 1.0, 1.0, 0.0, 0.0, 1.0, 0.0]),
    gl.STATIC_DRAW
  );

  const videoTexture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, videoTexture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

  function render() {
    const {
      imageTexture,
      transparency,
      overlayResolution,
      overlayMode,
      edgeThreshold,
    } = getOverlaySettings();

    const hasOverlay = Boolean(imageTexture);

    if (video.readyState >= 2) {
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
      gl.useProgram(program);

      // Set common uniforms
      gl.uniform1i(textureLocation, 0); // Video texture
      gl.uniform2f(canvasResolutionLocation, canvas.width, canvas.height);
      gl.uniform1i(hasOverlayLocation, hasOverlay ? 1 : 0);
      gl.uniform1f(distortionLocation, getDistortion());

      const { enhancePencil, pencilStrength } = getPencilSettings();
      gl.uniform1i(enhancePencilLocation, enhancePencil ? 1 : 0);
      gl.uniform1f(pencilStrengthLocation, pencilStrength);

      // Set overlay-specific uniforms if an overlay is active
      if (hasOverlay) {
        gl.uniform2f(
          overlayResolutionLocation,
          overlayResolution.width,
          overlayResolution.height
        );
        gl.uniform1i(overlayModeLocation, overlayMode);
        gl.uniform1f(edgeThresholdLocation, edgeThreshold);
        gl.uniform1f(transparencyLocation, transparency);

        // Bind and activate the overlay texture
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, imageTexture);
        gl.uniform1i(overlayTextureLocation, 1);
      }

      // Draw the scene
      gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
      gl.enableVertexAttribArray(positionLocation);
      gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);

      gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffer);
      gl.enableVertexAttribArray(texCoordLocation);
      gl.vertexAttribPointer(texCoordLocation, 2, gl.FLOAT, false, 0, 0);

      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }

    requestAnimationFrame(render);
  }

  render();
}

function setupDistortionSlider(getDistortion, setDistortion) {
  const slider = document.getElementById("distortionSlider");
  const input = document.getElementById("distortionValue");

  function updateDistortion(value) {
    setDistortion(value); // Update the distortion value in the rendering logic
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
      value = getDistortion(); // Revert to the current distortion if input is invalid
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

  // Initialize the input and slider with the current distortion value
  updateDistortion(getDistortion());
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

const EDGE_OVERLAY_MODE = 2; // Matches u_overlayMode in the fragment shader

function setupImageOverlay(gl) {
  const imageInput = document.getElementById("imageInput");
  const transparencySlider = document.getElementById("transparencySlider");
  const overlayModeSelect = document.getElementById("overlayModeSelect");
  const edgeThresholdSlider = document.getElementById("edgeThresholdSlider");

  let imageTexture = null;
  let overlayResolution = { width: 1, height: 1 };
  let transparency = parseFloat(transparencySlider.value);
  let overlayMode = parseInt(overlayModeSelect.value, 10);
  let edgeThreshold = parseFloat(edgeThresholdSlider.value);
  edgeThresholdSlider.disabled = overlayMode !== EDGE_OVERLAY_MODE;

  // Update transparency from slider
  transparencySlider.addEventListener("input", (event) => {
    transparency = parseFloat(event.target.value);
  });

  // Update overlay mode
  overlayModeSelect.addEventListener("change", (event) => {
    overlayMode = parseInt(event.target.value, 10);
    edgeThresholdSlider.disabled = overlayMode !== EDGE_OVERLAY_MODE;
  });

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

      imageTexture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, imageTexture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

      // Update overlay resolution
      overlayResolution = { width: img.width, height: img.height };
    };
    img.src = imageUrl;
  });

  // Provide current overlay settings
  return () => ({
    imageTexture,
    transparency,
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

  let distortion = 0.0;

  // Setup distortion slider
  setupDistortionSlider(
    () => distortion, // Getter for the current distortion value
    (value) => {
      distortion = value;
    } // Setter for updating the distortion value
  );

  // Setup image overlay
  const getOverlaySettings = setupImageOverlay(gl);

  const getPencilSettings = setupPencilEnhance();

  // Setup WebGL rendering
  setupRender(
    video,
    gl,
    () => distortion,
    getOverlaySettings,
    getPencilSettings
  );
});
