// 웹캠 얼굴 추적. 영상은 브라우저 밖으로 나가지 않고, 모델만 CDN 에서 받는다
const CDN = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.1.1'
const MODEL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task'

let landmarker

async function model() {
  if (landmarker) return landmarker
  const { FaceLandmarker, FilesetResolver } = await import(/* @vite-ignore */ `${CDN}/vision_bundle.mjs`)
  const files = await FilesetResolver.forVisionTasks(`${CDN}/wasm`)
  landmarker = await FaceLandmarker.createFromOptions(files, {
    baseOptions: { modelAssetPath: MODEL, delegate: 'GPU' },
    runningMode: 'VIDEO',
    numFaces: 1,
    outputFaceBlendshapes: true,
  })
  return landmarker
}

export async function openCamera(video) {
  const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480, facingMode: 'user' }, audio: false })
  video.srcObject = stream
  video.muted = true
  video.playsInline = true
  await video.play()
  return stream
}

export function closeCamera(stream) {
  stream?.getTracks().forEach((t) => t.stop())
}

// x, y: 얼굴 가운데(거울처럼 좌우를 뒤집은 0~1), top: 이마 위치, size: 얼굴 폭, mouth: 입 벌린 정도 0~1
export async function faceTracker(video) {
  const lm = await model()
  let last = -1
  let face = null
  return {
    read() {
      if (video.readyState < 2) return face
      const t = performance.now()
      if (t - last < 30) return face
      last = t
      const out = lm.detectForVideo(video, t)
      const pts = out.faceLandmarks?.[0]
      if (!pts) return (face = null)
      const xs = pts.map((p) => p.x)
      const ys = pts.map((p) => p.y)
      const minX = Math.min(...xs)
      const maxX = Math.max(...xs)
      const jaw = out.faceBlendshapes?.[0]?.categories.find((c) => c.categoryName === 'jawOpen')?.score || 0
      face = {
        x: 1 - (minX + maxX) / 2,
        y: (Math.min(...ys) + Math.max(...ys)) / 2,
        top: Math.min(...ys),
        size: maxX - minX,
        mouth: jaw,
      }
      return face
    },
  }
}
