document.addEventListener("DOMContentLoaded", () => {
  // Get references to the canvas and initialize WebGL
  const canvas = document.getElementById("webglCanvas");
  const gl = canvas.getContext("webgl");

  // Initialize video feed from the camera
  const video = document.createElement("video");
  video.autoplay = true;
  navigator.mediaDevices
    .getUserMedia({ video: true })
    .then((stream) => {
      video.srcObject = stream;
    })
    .catch((err) => console.error("Error accessing camera:", err));

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
    uniform sampler2D u_texture;
    uniform float u_distortion;

    void main() {
      vec2 coord = v_texCoord;
      coord -= 0.5; // Center the coordinates
      coord *= 1.0 + u_distortion * length(coord); // Apply distortion
      coord += 0.5; // Restore to original range
      gl_FragColor = texture2D(u_texture, coord);
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
  const distortionLocation = gl.getUniformLocation(program, "u_distortion");

  // Create a buffer for positions
  const positionBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
  const positions = new Float32Array([
    -1.0, -1.0, 1.0, -1.0, -1.0, 1.0, 1.0, 1.0,
  ]);
  gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);

  // Create a buffer for texture coordinates
  const texCoordBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffer);
  const texCoords = new Float32Array([0.0, 1.0, 1.0, 1.0, 0.0, 0.0, 1.0, 0.0]);
  gl.bufferData(gl.ARRAY_BUFFER, texCoords, gl.STATIC_DRAW);

  // Utility function to set texture parameters
  function setTextureParameters(gl) {
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  }

  // Create a texture and bind the video to it
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  setTextureParameters(gl);

  function updateCanvasViewport() {
    // const width = canvas.clientWidth;
    // const height = canvas.clientHeight;
    // if (canvas.width !== width || canvas.height !== height) {
    //   canvas.width = width;
    //   canvas.height = height;
    //   gl.viewport(0, 0, canvas.width, canvas.height);
    // }
  }

  video.addEventListener("loadedmetadata", updateCanvasViewport);

  let distortion = 0.0;
  const slider = document.getElementById("distortionSlider");
  slider.min = -0.2; // Set the minimum range of the slider
  slider.max = 0.2; // Set the maximum range of the slider
  let debounceTimeout;
  slider.addEventListener("input", (event) => {
    clearTimeout(debounceTimeout);
    debounceTimeout = setTimeout(() => {
      distortion = parseFloat(event.target.value);
    }, 100);
  });

  function render() {
    if (video.readyState >= 2) {
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        video
      );

      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);

      gl.useProgram(program);

      // Set positions
      gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
      gl.enableVertexAttribArray(positionLocation);
      gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);

      // Set texture coordinates
      gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffer);
      gl.enableVertexAttribArray(texCoordLocation);
      gl.vertexAttribPointer(texCoordLocation, 2, gl.FLOAT, false, 0, 0);

      // Set uniforms
      gl.uniform1i(textureLocation, 0);
      gl.uniform1f(distortionLocation, distortion);

      // Draw the rectangle
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }

    requestAnimationFrame(render);
  }

  window.addEventListener("resize", updateCanvasViewport);
  video.addEventListener("play", render);
});
