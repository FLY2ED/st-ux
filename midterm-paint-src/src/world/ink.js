import * as THREE from 'three'

// 3D 거리를 펜 그림처럼: 깊이 경계에 잉크 선, 어두운 곳은 빗금, 바탕은 종이.
// 노란 형광펜 색만 진하게 남기고 나머지 색은 연하게 뺀다
const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`

const FRAG = /* glsl */ `
#include <packing>
uniform sampler2D tColor;
uniform sampler2D tDepth;
uniform vec2 uRes;
uniform float uNear;
uniform float uFar;
uniform float uNight;
uniform float uBoil;
varying vec2 vUv;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float lin(vec2 uv) {
  float d = texture2D(tDepth, uv).x;
  return perspectiveDepthToViewZ(d, uNear, uFar) * -1.0;
}

void main() {
  // 선이 1/4초마다 살짝 떨린다
  vec2 jit = (vec2(hash(floor(vUv * 90.0) + uBoil), hash(floor(vUv * 90.0) + uBoil + 7.0)) - 0.5) * 1.1 / uRes;
  vec2 uv = vUv + jit;
  vec2 px = 1.0 / uRes;
  float raw = texture2D(tDepth, uv).x;
  float d = lin(uv);
  // 1/깊이는 평면 위에서 화면 좌표에 대해 직선으로 변하므로, 그 2차 변화가 곧 윤곽·모서리다.
  // 그래서 비스듬한 바닥(지평선 근처)에는 선이 생기지 않는다
  float w = 1.0 / d;
  float wl = 1.0 / lin(uv - vec2(px.x, 0.0));
  float wr = 1.0 / lin(uv + vec2(px.x, 0.0));
  float wu = 1.0 / lin(uv + vec2(0.0, px.y));
  float wd = 1.0 / lin(uv - vec2(0.0, px.y));
  float crease = (abs(wl + wr - 2.0 * w) + abs(wu + wd - 2.0 * w)) / w;
  // 장면은 선형 색으로 그려지므로 화면 색으로 바꿔서 본다
  vec3 c = pow(clamp(texture2D(tColor, uv).rgb, 0.0, 1.0), vec3(1.0 / 2.2));
  vec3 cl = pow(clamp(texture2D(tColor, uv - vec2(px.x, 0.0)).rgb, 0.0, 1.0), vec3(1.0 / 2.2));
  vec3 cu = pow(clamp(texture2D(tColor, uv + vec2(0.0, px.y)).rgb, 0.0, 1.0), vec3(1.0 / 2.2));
  float tone = length(c - cl) + length(c - cu);

  float edge = smoothstep(0.01, 0.03, crease) + smoothstep(0.32, 0.55, tone) * 0.5;
  // 멀수록 선이 연해진다
  edge *= 1.0 - smoothstep(70.0, 220.0, d);
  edge = clamp(edge, 0.0, 1.0);

  float l = dot(c, vec3(0.299, 0.587, 0.114));
  l = clamp(l * (1.15 + uNight * 2.2), 0.0, 1.0);
  float mx = max(c.r, max(c.g, c.b));
  float mn = min(c.r, min(c.g, c.b));
  float sat = mx > 0.0 ? (mx - mn) / mx : 0.0;
  // 노란 쪽 진한 색 = 형광펜
  float yellow = smoothstep(0.45, 0.7, sat) * smoothstep(0.35, 0.6, c.r) * smoothstep(0.25, 0.5, c.g) * (1.0 - smoothstep(0.35, 0.6, c.b / max(c.r, 0.001)));

  vec3 paper = vec3(1.0, 0.985, 0.94);
  vec2 g = gl_FragCoord.xy;
  // 빗금: 어두우면 한 방향, 더 어두우면 엇갈려 한 번 더
  float h1 = step(mod(g.x + g.y, 7.0), 1.0);
  float h2 = step(mod(g.x - g.y, 6.0), 1.0);
  float shade = 0.0;
  shade += h1 * (1.0 - smoothstep(0.3, 0.42, l)) * 0.7;
  shade += h2 * (1.0 - smoothstep(0.16, 0.26, l)) * 0.75;
  vec3 wash = mix(paper, c / max(mx, 0.35) * 0.9 + 0.1, 0.22 * smoothstep(0.1, 0.5, sat));
  wash *= 0.9 + 0.1 * smoothstep(0.2, 0.8, l);
  vec3 hl = vec3(1.0, 0.8, 0.27);
  vec3 col = mix(wash, hl, yellow * 0.9);
  col = mix(col, vec3(0.11), clamp(shade, 0.0, 1.0) * (1.0 - yellow));
  // 하늘은 빈 종이
  if (raw >= 0.9999) col = paper;
  col = mix(col, vec3(0.11), edge);
  // 밤에는 공책을 스탠드 불빛 아래서 보는 듯 어둑하게, 형광펜은 그대로 밝게
  vec3 night = mix(vec3(1.0), vec3(0.5, 0.53, 0.66), uNight * 0.85);
  col *= mix(night, vec3(1.0), yellow);
  // 종이 결
  col *= 0.97 + 0.03 * hash(floor(g / 2.0));
  gl_FragColor = vec4(col, 1.0);
}
`

export function makeInk(renderer) {
  const depth = new THREE.DepthTexture(1, 1)
  depth.type = THREE.UnsignedIntType
  const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthTexture: depth })
  const mat = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: {
      tColor: { value: rt.texture },
      tDepth: { value: depth },
      uRes: { value: new THREE.Vector2(1, 1) },
      uNear: { value: 0.1 },
      uFar: { value: 1000 },
      uNight: { value: 0 },
      uBoil: { value: 0 },
    },
    depthTest: false,
    depthWrite: false,
  })
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat)
  quad.frustumCulled = false
  const post = new THREE.Scene()
  post.add(quad)
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
  const u = mat.uniforms
  return {
    uniforms: u,
    setSize(w, h) {
      const r = renderer.getPixelRatio()
      rt.setSize(Math.floor(w * r), Math.floor(h * r))
      u.uRes.value.set(Math.floor(w * r), Math.floor(h * r))
    },
    render(scene, camera, now) {
      u.uNear.value = camera.near
      u.uFar.value = camera.far
      u.uBoil.value = Math.floor(now / 250) % 3
      renderer.setRenderTarget(rt)
      renderer.render(scene, camera)
      renderer.setRenderTarget(null)
      renderer.render(post, cam)
    },
    dispose() {
      rt.dispose()
      depth.dispose()
      mat.dispose()
      quad.geometry.dispose()
    },
  }
}
