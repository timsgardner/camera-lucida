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
precision mediump float;
varying vec2 v_texCoord;
uniform sampler2D u_texture;           // Video texture
uniform sampler2D u_overlayTexture;   // Overlay image texture
uniform float u_transparency;         // Transparency for blending
uniform vec2 u_overlayResolution;     // Resolution of overlay texture
uniform vec2 u_canvasResolution;      // Resolution of canvas
uniform float u_distortion;           // Distortion strength
uniform bool u_applyAlphaMask;        // Whether to apply inverse alpha masking
uniform bool u_hasOverlay;            // Whether an overlay is active

vec2 applyDistortion(vec2 coord, float distortion) {
  vec2 centered = coord - 0.5; // Center the coordinates
  float r = length(centered); // Distance from the center
  vec2 distorted = centered * (1.0 + distortion * r * r); // Radial distortion
  return distorted + 0.5; // Return to texture space
}

void main() {
  // Apply distortion to the video texture coordinates
  vec2 distortedCoord = applyDistortion(v_texCoord, u_distortion);
  vec4 videoColor = texture2D(u_texture, distortedCoord);

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
    if (u_applyAlphaMask) {
      overlayColor.a = 1.0 - luminance; // Light areas are more transparent

      // Replace RGB with the indigo blue color #063970
      overlayColor.rgb = vec3(0.0235, 0.2235, 0.4392);
      // overlayColor.rgb = vec3(0,0,0);
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

function setupRender(video, gl, getDistortion, getOverlaySettings) {
  const canvas = document.getElementById("webglCanvas");
  const vertexShader = createShader(gl, gl.VERTEX_SHADER, vertexShaderSource);
  const fragmentShader = createShader(
    gl,
    gl.FRAGMENT_SHADER,
    fragmentShaderSource
  );
  const program = createProgram(gl, vertexShader, fragmentShader);

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
  const alphaMaskLocation = gl.getUniformLocation(program, "u_applyAlphaMask");
  const hasOverlayLocation = gl.getUniformLocation(program, "u_hasOverlay");

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
    const { imageTexture, transparency, overlayResolution, applyAlphaMask } =
      getOverlaySettings();

    const hasOverlay = Boolean(imageTexture);

    if (video.readyState >= 2) {
      // Update the video texture
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

      // Set overlay-specific uniforms if an overlay is active
      if (hasOverlay) {
        gl.uniform2f(
          overlayResolutionLocation,
          overlayResolution.width,
          overlayResolution.height
        );
        gl.uniform1i(alphaMaskLocation, applyAlphaMask ? 1 : 0);
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

  video.addEventListener("play", render);
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

function setupImageOverlay(gl, updateRender) {
  const imageInput = document.getElementById("imageInput");
  const transparencySlider = document.getElementById("transparencySlider");
  const alphaMaskToggle = document.getElementById("alphaMaskToggle");

  let imageTexture = null;
  let overlayResolution = { width: 1, height: 1 };
  let transparency = parseFloat(transparencySlider.value);
  let applyAlphaMask = alphaMaskToggle.checked;

  // Update transparency from slider
  transparencySlider.addEventListener("input", (event) => {
    transparency = parseFloat(event.target.value);
    updateRender(); // Trigger a re-render
  });

  // Update alpha mask toggle
  alphaMaskToggle.addEventListener("change", (event) => {
    applyAlphaMask = event.target.checked;
    updateRender(); // Trigger a re-render
  });

  // Handle image uploads
  imageInput.addEventListener("change", (event) => {
    const file = event.target.files[0];
    if (!file) return;

    const img = new Image();
    img.onload = () => {
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
      updateRender(); // Trigger a re-render
    };
    img.src = URL.createObjectURL(file);
  });

  // Provide current overlay settings
  return () => ({
    imageTexture,
    transparency,
    overlayResolution,
    applyAlphaMask, // Ensure this is included
  });
}

document.addEventListener("DOMContentLoaded", () => {
  const canvas = document.getElementById("webglCanvas");
  const gl = canvas.getContext("webgl");
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
  const getOverlaySettings = setupImageOverlay(gl, () => {
    updateCanvasSize(video, gl); // Recalculate canvas if needed
  });

  // Setup WebGL rendering
  setupRender(video, gl, () => distortion, getOverlaySettings);
});
