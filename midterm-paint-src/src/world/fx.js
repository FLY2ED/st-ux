import * as THREE from 'three'

// 꺼진 간판의 도시: 불 켠 간판 둘레만 색이 돌아오고 나머지는 잿빛인 셰이더.
// 서울 타임머신: 건물이 사용승인 연도 순서로 땅에서 솟아오르는 셰이더.
// 모든 재질이 같은 유니폼을 나눠 써서 값만 바꾸면 한꺼번에 바뀐다
export const MAX_LIT = 48

export const fx = {
  uSpreadOn: { value: 0 },
  uSpreadN: { value: 0 },
  uSpreadP: { value: Array.from({ length: MAX_LIT }, () => new THREE.Vector4()) },
  uSpreadC: { value: Array.from({ length: MAX_LIT }, () => new THREE.Vector3()) },
  // 마지막에 동네 전체로 퍼지는 물결: x, z, 반지름
  uWave: { value: new THREE.Vector3(0, 0, 0) },
  uNight: { value: 0 },
  uYear: { value: 9999 },
}

const COMMON = /* glsl */ `
uniform float uSpreadOn;
uniform int uSpreadN;
uniform vec4 uSpreadP[${MAX_LIT}];
uniform vec3 uSpreadC[${MAX_LIT}];
uniform vec3 uWave;
uniform float uNight;
uniform float uYear;
varying vec3 vSpreadPos;
#ifdef FX_YEAR
varying float vRise;
varying float vYear;
#endif
`

const VERTEX_RISE = /* glsl */ `
#include <begin_vertex>
#ifdef FX_YEAR
vYear = aYear;
vRise = aYear < 1.0 ? 1.0 : clamp((uYear - aYear) / 1.2, 0.0, 1.0);
transformed.y *= vRise * vRise * (3.0 - 2.0 * vRise);
#endif
`

const VERTEX_POS = /* glsl */ `
#include <project_vertex>
vec4 fxWorld = vec4(transformed, 1.0);
#ifdef USE_INSTANCING
fxWorld = instanceMatrix * fxWorld;
#endif
vSpreadPos = (modelMatrix * fxWorld).xyz;
`

const FRAGMENT_START = /* glsl */ `
void main() {
#ifdef FX_YEAR
  if (vRise <= 0.001) discard;
  // 사용승인 연도를 모르는 건물은 다 지어질 때까지 반투명한 그물로 둔다
  if (vYear < 1.0 && uYear < 2025.5 && mod(floor(gl_FragCoord.x) + floor(gl_FragCoord.y), 2.0) < 1.0) discard;
#endif
`

const FRAGMENT_COLOR = /* glsl */ `
#include <opaque_fragment>
if (uSpreadOn > 0.5) {
  vec3 p = vSpreadPos;
  // 물감이 번지듯 가장자리를 흔든다
  float wob = sin(p.x * 0.9) * sin(p.z * 0.8) * 0.5 + sin(p.x * 0.23 + p.z * 0.31) * 0.5;
  float lit = 1.0 - smoothstep(uWave.z - 6.0, uWave.z, distance(p.xz, uWave.xy) + wob * 4.0);
  vec3 spill = vec3(0.0);
  for (int i = 0; i < ${MAX_LIT}; i++) {
    if (i >= uSpreadN) break;
    vec4 s = uSpreadP[i];
#ifdef FX_SIGN
    vec3 dd = p - s.xyz;
    if (length(dd.xz) < 0.95 && abs(dd.y) < 0.42 && s.w > 0.2) lit = 1.0;
#else
    float d = distance(p.xz, s.xz) + wob * 2.5;
    lit = max(lit, 1.0 - smoothstep(s.w - 3.0, s.w, d));
    // 네온 불빛이 둘레 벽과 젖은 바닥에 번진다
    float near = distance(p, s.xyz);
    float k = clamp(1.0 - near / 7.0, 0.0, 1.0);
#ifdef FX_WET
    k = min(1.0, k * 1.3);
#endif
    spill += uSpreadC[i] * k * k * min(1.0, s.w / 6.0);
    spill = min(spill, vec3(0.9));
#endif
  }
  vec3 c = gl_FragColor.rgb;
  float grey = dot(c, vec3(0.299, 0.587, 0.114));
#ifdef FX_SIGN
  vec3 off = vec3(grey * 0.18 + 0.015);
  gl_FragColor.rgb = mix(off, c * 1.2, lit);
#else
  vec3 dead = vec3(grey * 0.42) + vec3(0.0, 0.004, 0.012);
  // 불이 돌아온 곳은 색을 더 진하고 밝게
  vec3 alive = mix(vec3(grey), c, 1.25);
  // 빛 번짐(블룸)은 간판 네온에만 걸리도록 벽·창은 문턱 아래로 묶는다
  gl_FragColor.rgb = min(mix(dead, alive, lit) + spill * (0.18 + uNight * 0.3), vec3(0.86));
#endif
}
`

// 재질 하나에 셰이더 조각을 끼운다. kind: base | sign | wet | year
// clone() 한 재질은 onBeforeCompile 을 물려받지 않으므로 재질 객체 자체로 기억한다
const done = new WeakSet()
export function patch(material, kind = 'base') {
  if (done.has(material)) return
  done.add(material)
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, fx)
    const defs = { sign: '#define FX_SIGN\n', wet: '#define FX_WET\n', year: '#define FX_YEAR\nattribute float aYear;\n' }[kind] || ''
    shader.vertexShader = defs + COMMON + shader.vertexShader.replace('#include <begin_vertex>', VERTEX_RISE).replace('#include <project_vertex>', VERTEX_POS)
    shader.fragmentShader = defs.replace('attribute float aYear;\n', '') + COMMON + shader.fragmentShader.replace('void main() {', FRAGMENT_START).replace('#include <opaque_fragment>', FRAGMENT_COLOR)
  }
  material.customProgramCacheKey = () => `fx-${kind}`
  material.needsUpdate = true
}

// 불 켠 간판은 업종과 상관없이 노란 형광펜 한 색
const HL = new THREE.Color('#ffcb45')
export function neonOf() {
  return HL.clone()
}
