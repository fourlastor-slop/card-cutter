// The sheets' shaders. Light comes in bands (lit, half lit, in shadow, with hard edges between
// them). The gloss is a studio mirrored in the surface: a few soft boxes around the camera,
// sharper the smoother the surface, tinted by the print as much as the surface is a metal,
// and kept out of the key light's shadow so that a shadow stays dark. Ambient occlusion is
// baked per level (sheets.ts).

const light = /* glsl */ `
uniform vec3 keyDir;
uniform vec3 keyColor;
uniform vec3 rimDir;
uniform vec3 rimColor;
uniform vec3 ambient;
uniform float specAmount;
uniform float gloss;
uniform sampler2D shadowMap;
uniform mat4 shadowMatrix;
uniform float shadowTexel;
uniform sampler2D ao;
uniform float aoStrength;
// holo foil: 0 off, 1 the art window, 2 the whole printed face; the art window in UV (x0, y0, x1, y1)
uniform int holo;
uniform vec4 artWindow;

// A soft-edged box of the studio: its middle and half its size, in degrees (azimuth 0 toward
// the camera, right positive; elevation up), its edge the softer the rougher the surface.
float studioBox(vec2 at, vec4 box, float soft) {
  vec2 off = abs(at - box.xy) / box.zw;
  return (1.0 - smoothstep(1.0 - soft, 1.0, off.x)) * (1.0 - smoothstep(1.0 - soft, 1.0, off.y));
}

// The studio along a direction (the camera stays put: the card turns): dim all round, a large
// warm box up on the left where the key light is, a narrow cool strip on the right, a dim
// floor's light below.
vec3 studio(vec3 toward, float roughness) {
  vec2 at = vec2(degrees(atan(toward.x, toward.z)), degrees(asin(clamp(toward.y, -1.0, 1.0))));
  float soft = mix(0.1, 0.8, roughness);
  float peak = mix(1.2, 0.6, roughness);
  vec3 boxes = vec3(1.0, 0.93, 0.82) * 0.8 * studioBox(at, vec4(-28.0, 22.0, 22.0, 18.0), soft);
  boxes += vec3(0.8, 0.88, 1.0) * 0.9 * studioBox(at, vec4(46.0, 2.0, 6.0, 34.0), soft);
  boxes += vec3(1.0, 0.85, 0.7) * 0.35 * studioBox(at, vec4(0.0, -34.0, 70.0, 10.0), soft);
  return vec3(0.24) + boxes * peak;
}

float band(float facing, float shadow) {
  float lit = smoothstep(0.0, 0.06, facing) * shadow;
  return lit * mix(0.68, 1.0, smoothstep(0.36, 0.42, facing));
}

float keyShadow(vec3 world, vec3 n) {
  vec4 p = shadowMatrix * vec4(world + n * 0.004, 1.0);
  vec3 c = p.xyz / p.w * 0.5 + 0.5;
  if (c.x < 0.0 || c.x > 1.0 || c.y < 0.0 || c.y > 1.0 || c.z > 1.0) return 1.0;
  float sum = 0.0;
  for (int i = -1; i <= 1; i++)
    for (int j = -1; j <= 1; j++)
      sum += step(c.z - 0.0004, texture2D(shadowMap, c.xy + vec2(float(i), float(j)) * shadowTexel).r);
  return smoothstep(0.3, 0.7, sum / 9.0);
}

// surface: the sheet's own normal, for the light's bands and the shadow; n: the normal the
// gloss mirrors the studio in (with the paper's grain: a coated card shows its texture in its
// reflections, not in its print)
vec3 shadeTinted(vec3 albedo, float metallic, float roughness, vec3 surface, vec3 n, vec3 world, float occlusion, vec3 tint) {
  float shadow = keyShadow(world, surface);
  float facing = dot(surface, keyDir);
  vec3 diffuse = keyColor * band(facing, shadow) + rimColor * band(dot(surface, rimDir), 1.0) + ambient;
  vec3 v = normalize(cameraPosition - world);
  // the shadow keeps the studio out only where the surface faces the light (a side facing
  // away is in its own shadow, and catches the studio's other lights)
  float open = mix(1.0, shadow, smoothstep(-0.05, 0.1, facing));
  vec3 spec = keyColor * specAmount * gloss * open * tint * studio(reflect(-v, n), roughness);
  return (albedo * (1.0 - metallic) * diffuse + spec) * (1.0 - aoStrength * occlusion);
}

vec3 shade(vec3 albedo, float metallic, float roughness, vec3 n, vec3 world, float occlusion) {
  return shadeTinted(albedo, metallic, roughness, n, n, world, occlusion, mix(vec3(0.04), albedo, metallic));
}
`;

const vertex = /* glsl */ `
varying vec2 vUv;
varying vec3 vWorld;
varying vec3 vNormal;
varying vec3 vTangent;
varying vec3 vBitangent;
varying float vBelow;
void main() {
  vUv = uv;
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  mat3 m = mat3(modelMatrix);
  vNormal = normalize(m * normal);
  vTangent = normalize(m * vec3(1.0, 0.0, 0.0));
  vBitangent = normalize(m * vec3(0.0, 1.0, 0.0));
  vBelow = step(0.5, -normal.z);
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

/** A sheet's faces: the scan cut by its mask, on card with a paper's grain. */
export const sheetShader = {
  vertexShader: vertex,
  fragmentShader: /* glsl */ `
${light}
uniform sampler2D scan;
uniform sampler2D mask;
uniform sampler2D cardBack;
uniform sampler2D grain;
uniform vec2 grainRepeats;
uniform vec2 grainOffset;
uniform float grainDepth;
uniform bool showsBack;
uniform vec3 underside;
uniform float metallic;
uniform float roughness;
uniform float roughnessSpread;
uniform float grainTone;
varying vec2 vUv;
varying vec3 vWorld;
varying vec3 vNormal;
varying vec3 vTangent;
varying vec3 vBitangent;
varying float vBelow;
void main() {
  float m = texture2D(mask, vUv).r;
  float alpha = clamp((m - 0.5) / max(fwidth(m), 1e-4) + 0.5, 0.0, 1.0);
  if (alpha < 0.02) discard;
  vec3 color;
  if (vBelow > 0.5) {
    // (seen from behind, the card back's left is the scan's right)
    vec3 albedo = showsBack ? texture2D(cardBack, vec2(1.0 - vUv.x, vUv.y)).rgb : underside;
    color = shade(albedo, 0.0, 0.9, normalize(vNormal), vWorld, 0.0);
  } else {
    vec4 paper = texture2D(grain, vUv * grainRepeats + grainOffset);
    vec3 albedo = texture2D(scan, vUv).rgb * (1.0 + grainTone * (paper.a - 0.5));
    float rough = clamp(roughness + roughnessSpread * (0.5 - paper.a), 0.0, 1.0);
    vec3 slope = normalize(vec3((paper.xy * 2.0 - 1.0) * grainDepth, 1.0));
    vec3 n = normalize(slope.x * vTangent + slope.y * vBitangent + slope.z * vNormal);
    vec3 tint = mix(vec3(0.04), albedo, metallic);
    float foil = holo == 2 ? 1.0
      : holo == 1 ? step(artWindow.x, vUv.x) * step(vUv.x, artWindow.z) * step(artWindow.y, vUv.y) * step(vUv.y, artWindow.w)
      : 0.0;
    if (foil > 0.0) {
      // a prismatic foil under the ink: a rainbow that slides with the angle the light comes
      // off at and across the card in diagonal bands, flecked by the paper's grain; the ink
      // lets more of it through where it is light
      // (off the sheet's flat face: the grain's bumps would scatter it into speckle)
      vec3 r = reflect(-normalize(cameraPosition - vWorld), normalize(vNormal));
      float phase = r.x * 3.0 + r.y * 2.0 + dot(vUv, vec2(2.6, -1.8)) + paper.a * 0.25;
      vec3 rainbow = 0.5 + 0.5 * cos(6.2832 * (phase + vec3(0.0, 0.33, 0.67)));
      float ink = dot(albedo, vec3(0.2126, 0.7152, 0.0722));
      albedo = mix(albedo, albedo * (0.45 + 1.1 * rainbow), foil * (0.25 + 0.3 * sqrt(ink)));
      vec3 sheen = mix(albedo, rainbow, 0.85) * (0.9 + 1.8 * sqrt(ink));
      tint = mix(tint, sheen, foil);
      rough = mix(rough, 0.18, foil);
    }
    color = shadeTinted(albedo, metallic, rough, normalize(vNormal), n, vWorld, texture2D(ao, vUv).r, tint);
  }
  gl_FragColor = linearToOutputTexel(vec4(color, alpha));
}
`,
};

/** The cut edges: the print's colour where it was cut, darker, matte, streaked with fibres. */
export const edgeShader = {
  vertexShader: vertex,
  fragmentShader: /* glsl */ `
${light}
uniform sampler2D scan;
uniform sampler2D grain;
uniform float edgeShade;
varying vec2 vUv;
varying vec3 vWorld;
varying vec3 vNormal;
void main() {
  // (an edge has the same scan coordinates all the way down: the grain makes streaks along it)
  float fibre = texture2D(grain, vUv * vec2(40.0, 58.0)).a;
  vec3 albedo = texture2D(scan, vUv).rgb * edgeShade * (0.75 + 0.5 * fibre);
  vec3 color = shade(albedo, 0.1, 0.85, normalize(vNormal), vWorld, texture2D(ao, vUv).r);
  gl_FragColor = linearToOutputTexel(vec4(color, 1.0));
}
`,
};

/** For the key light's shadow map: only the sheet's shape. */
export const casterShader = {
  vertexShader: /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`,
  fragmentShader: /* glsl */ `
uniform sampler2D mask;
uniform bool masked;
varying vec2 vUv;
void main() {
  if (masked && texture2D(mask, vUv).r < 0.5) discard;
  gl_FragColor = vec4(1.0);
}
`,
};

/** The dark backdrop behind the card. */
export const backdropShader = {
  vertexShader: /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`,
  fragmentShader: /* glsl */ `
varying vec2 vUv;
void main() {
  float r = length(vUv - 0.5) * 2.0;
  vec3 c = mix(vec3(0.02, 0.022, 0.032), vec3(0.003, 0.0035, 0.005), smoothstep(0.0, 0.75, r));
  gl_FragColor = linearToOutputTexel(vec4(c, 1.0));
}
`,
};
