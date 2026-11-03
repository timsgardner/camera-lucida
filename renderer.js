import { fragmentShaderSource, vertexShaderSource } from "./shaders.js";

export function showFatalError(message) {
  document.getElementById("canvasContainer").textContent = message;
}

export function updateCanvasSize(video, gl) {
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

export function createTexture(gl) {
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

export function setupRender(
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
