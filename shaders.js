export const vertexShaderSource = `
    attribute vec2 a_position;
    attribute vec2 a_texCoord;
    varying vec2 v_texCoord;

    void main() {
      gl_Position = vec4(a_position, 0.0, 1.0);
      v_texCoord = a_texCoord;
    }
  `;

export const OVERLAY_MODES = { normal: 0, inverseMask: 1, edges: 2 };

export const fragmentShaderSource = `
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
