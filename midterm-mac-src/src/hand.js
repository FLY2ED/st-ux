// 웹캠 손 추적. 영상은 브라우저 밖으로 나가지 않고, 모델만 CDN 에서 받는다 (얼굴 추적 face.js 와 같은 MediaPipe)
const CDN = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.1.1'
const MODEL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task'

let landmarker

async function model() {
  if (landmarker) return landmarker
  const { HandLandmarker, FilesetResolver } = await import(/* @vite-ignore */ `${CDN}/vision_bundle.mjs`)
  const files = await FilesetResolver.forVisionTasks(`${CDN}/wasm`)
  landmarker = await HandLandmarker.createFromOptions(files, {
    baseOptions: { modelAssetPath: MODEL, delegate: 'GPU' },
    runningMode: 'VIDEO',
    numHands: 2,
  })
  return landmarker
}

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y)

// 카메라 가장자리까지 손을 뻗지 않아도 화면 끝에 닿게 가운데 70%만 화면에 펼친다. 웹캠을 배경으로 깔 때도 같은 만큼 잘라 손끝과 겹치게 한다
// 손 동작 안내는 여기 한 벌만 두고 지도(HandControl)와 별자리(NameGraph)가 같이 쓴다
export const GESTURES = [
  ['집어서 끌기', '돌리기'],
  ['짧게 집었다 놓기', '누르기'],
  ['두 손으로 집어 벌리기', '확대'],
]

export const REACH = { lo: 0.15, size: 0.7 }
export const span = (v) => Math.min(1, Math.max(0, (v - REACH.lo) / REACH.size))

// 손가락 끝이 둘째 마디보다 손목에서 멀면 편 손가락
function extended(p, tip, pip) {
  return dist(p[tip], p[0]) > dist(p[pip], p[0]) * 1.12
}

// 손 하나를 읽기 쉬운 값으로: x·y 는 엄지·검지 사이(거울처럼 좌우를 뒤집은 0~1), gap 은 엄지·검지 끝 거리(손 크기 기준)
function readHand(p) {
  const size = dist(p[0], p[9]) || 1e-3
  const gap = dist(p[4], p[8]) / size
  const open = [
    [8, 6],
    [12, 10],
    [16, 14],
    [20, 18],
  ].filter(([t, j]) => extended(p, t, j)).length
  return {
    x: 1 - (p[4].x + p[8].x) / 2,
    y: (p[4].y + p[8].y) / 2,
    gap,
    open,
    pts: p.map((q) => ({ x: 1 - q.x, y: q.y })),
  }
}

// read(): 보이는 손 목록(최대 2개). 같은 프레임을 두 번 읽지 않는다
export async function handTracker(video) {
  const lm = await model()
  let last = -1
  let hands = []
  return {
    read() {
      if (video.readyState < 2) return hands
      const t = performance.now()
      if (t - last < 28) return hands
      last = t
      const out = lm.detectForVideo(video, t)
      hands = (out.landmarks || []).map(readHand)
      return hands
    },
  }
}
