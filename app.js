// Global variables
let originalImage = null; // For the uploaded image
let webglContext = null; // For WebGL setup
let useWebGL = true; // WebGL enabled by default
let videoTexture = null; // Global texture variable for reuse

// Event listeners for controls
document.getElementById("imageInput").addEventListener("change", function (e) {
  if (e.target.files.length > 0) {
    const file = e.target.files[0];
    const url = URL.createObjectURL(file);
    loadImage(url);
  }
});

document
  .getElementById("transparencySlider")
  .addEventListener("input", updateCanvas);

document
  .getElementById("distortionSlider")
  .addEventListener("input", updateCanvas);

document
  .getElementById("invertColorsToggle")
  .addEventListener("change", updateCanvas);

document
  .getElementById("useWebGLToggle")
  .addEventListener("change", function (e) {
    useWebGL = e.target.checked;
    updateCanvas(); // Re-render to reflect the toggle change
  });

document
  .getElementById("startCameraButton")
  .addEventListener("click", function () {
    setupCamera();
    this.disabled = true; // Disable the button after starting the camera
  });

// Initialize WebGL on page load
window.addEventListener("DOMContentLoaded", () => {
  const canvas = document.getElementById("overlayCanvas");
  webglContext = setupWebGL(canvas);
});

// Function to load an image
function loadImage(url) {
  const img = new Image();
  img.onload = function () {
    originalImage = { img };
    const canvas = document.getElementById("overlayCanvas");
    canvas.width = img.width;
    canvas.height = img.height;
    updateCanvas();
  };
  img.src = url;
}

// Utility to create and compile a shader
function createShader(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.error(`Error compiling shader: ${gl.getShaderInfoLog(shader)}`);
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

// Utility to create and link a WebGL program
function createProgram(gl, vertexShader, fragmentShader) {
  const program = gl.createProgram();
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error(`Error linking program: ${gl.getProgramInfoLog(program)}`);
    gl.deleteProgram(program);
    return null;
  }
  return program;
}

// Function to update the canvas
function updateCanvas() {
  const transparency = parseFloat(
    document.getElementById("transparencySlider").value
  );
  const distortionStrength = parseFloat(
    document.getElementById("distortionSlider").value
  );
  const invert = document.getElementById("invertColorsToggle").checked;

  const canvas = document.getElementById("overlayCanvas");
  const video = document.getElementById("videoFeed");

  if (useWebGL && webglContext) {
    const isVideo = video && !video.paused && !video.ended;
    const source = isVideo ? video : originalImage?.img;

    if (source) {
      renderWithWebGL(webglContext, source, distortionStrength, isVideo);
    }
  } else {
    // Fallback to 2D Canvas rendering
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const { img } = originalImage || {};

    if (img) {
      ctx.globalAlpha = transparency;
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    } else if (video && !video.paused && !video.ended) {
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    }

    if (invert) {
      canvas.style.filter = "invert(100%)";
    } else {
      canvas.style.filter = "none";
    }

    ctx.globalAlpha = 1.0;
  }
}

// Camera setup function
async function setupCamera() {
  const video = document.getElementById("videoFeed");

  const constraints = {
    video: {
      facingMode: { ideal: "environment" }, // Prefer the rear camera
    },
  };

  try {
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    video.srcObject = stream;

    video.addEventListener("loadedmetadata", () => {
      video.play();
      updateCanvas(); // Ensure the overlay is applied
    });
  } catch (error) {
    console.error("Error accessing the camera", error);
    alert(
      "An error occurred accessing the camera. Please check your device and permissions."
    );
  }
}

// WebGL setup function
function setupWebGL(canvas) {
  const gl = canvas.getContext("webgl");

  if (!gl) {
    alert("WebGL not supported");
    return null;
  }

  const vertexShaderSource = `
    attribute vec2 a_position;
    varying vec2 v_texCoord;

    void main() {
      gl_Position = vec4(a_position, 0.0, 1.0);
      v_texCoord = vec2((a_position.x + 1.0) / 2.0, 1.0 - (a_position.y + 1.0) / 2.0); // Flip Y-coordinate
    }
  `;

  const fragmentShaderSource = `
    precision mediump float;

    uniform sampler2D u_image;
    uniform float u_k1;

    varying vec2 v_texCoord;

    void main() {
      vec2 centered = (v_texCoord - 0.5) * 2.0;
      float r2 = dot(centered, centered);
      vec2 distorted = centered * (1.0 + u_k1 * r2);
      vec2 correctedTexCoord = distorted / 2.0 + 0.5;

      gl_FragColor = texture2D(u_image, correctedTexCoord);
    }
  `;

  const vertexShader = createShader(gl, gl.VERTEX_SHADER, vertexShaderSource);
  const fragmentShader = createShader(
    gl,
    gl.FRAGMENT_SHADER,
    fragmentShaderSource
  );
  const program = createProgram(gl, vertexShader, fragmentShader);
  gl.useProgram(program);

  // Set up a full-screen quad
  const positionBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
    gl.STATIC_DRAW
  );

  const positionLocation = gl.getAttribLocation(program, "a_position");
  gl.enableVertexAttribArray(positionLocation);
  gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);

  return { gl, program };
}

// WebGL render function
function renderWithWebGL(webglContext, source, k1, isVideo) {
  const { gl, program } = webglContext;

  if (!videoTexture) {
    videoTexture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, videoTexture);

    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  } else {
    gl.bindTexture(gl.TEXTURE_2D, videoTexture);
  }

  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);

  const k1Location = gl.getUniformLocation(program, "u_k1");
  gl.uniform1f(k1Location, k1);

  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.drawArrays(gl.TRIANGLES, 0, 6);

  if (isVideo) {
    requestAnimationFrame(() =>
      renderWithWebGL(webglContext, source, k1, true)
    );
  }
}
