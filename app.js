function setupCameraButton(video, gl) {
  const startCameraButton = document.getElementById("startCameraButton");

  async function startCamera() {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoInputs = devices.filter(
        (device) => device.kind === "videoinput"
      );

      // Prefer a "back" camera if available
      const backCamera = videoInputs.find((device) =>
        device.label.toLowerCase().includes("back")
      );
      const constraints = {
        video: backCamera ? { deviceId: backCamera.deviceId } : true,
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      video.srcObject = stream;

      video.addEventListener("loadedmetadata", () => {
        updateCanvasSize(video, gl);
        video.play();
      });
    } catch (err) {
      console.error("Error accessing camera:", err);
    }
  }

  startCameraButton.addEventListener("click", () => {
    startCamera();
  });
}

function initializeVideo(gl) {
  // Initialize video feed from the camera
  const video = document.createElement("video");
  video.autoplay = true;
  navigator.mediaDevices
    .getUserMedia({ video: true })
    .then((stream) => {
      video.srcObject = stream;
    })
    .catch((err) => console.error("Error accessing camera:", err));

  setupCameraButton(video, gl);
  return video;
}

function updateCanvasSize(video, gl) {
  const container = document.getElementById("stuffContainer");
  const canvas = document.getElementById("webglCanvas");
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

    void main() {
      vec4 videoColor = texture2D(u_texture, v_texCoord);

      // Adjust overlay texture sampling for its resolution
      vec2 overlayCoord = v_texCoord * u_canvasResolution / u_overlayResolution;
      vec4 overlayColor = texture2D(u_overlayTexture, overlayCoord);

      // Optionally apply an inverse alpha mask
      if (u_applyAlphaMask) {
        overlayColor.a = 1.0 - overlayColor.a;
      }

      // Blend video and overlay using transparency
      vec4 blendedColor = mix(videoColor, overlayColor, u_transparency);
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

  // Look up attribute and uniform locations
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

  // Prepare buffers
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

  // Create texture for video
  const videoTexture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, videoTexture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

  function render() {
    const { imageTexture, transparency, overlayResolution, applyAlphaMask } =
      getOverlaySettings();

    if (video.readyState >= 2) {
      // Update video texture
      gl.bindTexture(gl.TEXTURE_2D, videoTexture);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        video
      );

      // Clear the canvas
      gl.clear(gl.COLOR_BUFFER_BIT);

      gl.useProgram(program);

      // Set position buffer
      gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
      gl.enableVertexAttribArray(positionLocation);
      gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);

      // Set texture coordinate buffer
      gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffer);
      gl.enableVertexAttribArray(texCoordLocation);
      gl.vertexAttribPointer(texCoordLocation, 2, gl.FLOAT, false, 0, 0);

      // Set uniforms
      gl.uniform1i(textureLocation, 0); // Video texture
      gl.uniform1f(transparencyLocation, transparency);
      gl.uniform2f(canvasResolutionLocation, canvas.width, canvas.height);
      gl.uniform2f(
        overlayResolutionLocation,
        overlayResolution.width,
        overlayResolution.height
      );
      gl.uniform1f(distortionLocation, getDistortion());
      gl.uniform1i(alphaMaskLocation, applyAlphaMask ? 1 : 0);

      if (imageTexture) {
        // Bind and activate overlay texture
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, imageTexture);
        gl.uniform1i(overlayTextureLocation, 1);
      }

      // Draw the rectangle
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
  const video = initializeVideo(gl);

  setupCameraButton(video, gl);
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
