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

// ── 카메라 권한: 묻기 전에 상태를 살피고, 실패하면 이유별로 안내한다 ──────────
const CAMERA_KEY = 'gp-camera'

// 카메라는 https 나 localhost 에서만 열린다
export const cameraSecure = () =>
  window.isSecureContext || location.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(location.hostname)

export const cameraSupported = () => !!navigator.mediaDevices?.getUserMedia

// granted | denied | prompt | unknown (사파리처럼 권한 API 가 camera 를 모르면 unknown)
export async function cameraPermission() {
  if (!cameraSecure()) return 'unknown'
  try {
    const r = await navigator.permissions.query({ name: 'camera' })
    return r.state
  } catch {
    return 'unknown'
  }
}

// 권한을 받기 전에는 이름(label)이 비어 있다
export async function listCameras() {
  if (!cameraSecure() || !navigator.mediaDevices?.enumerateDevices) return []
  try {
    const all = await navigator.mediaDevices.enumerateDevices()
    return all
      .filter((d) => d.kind === 'videoinput')
      .map((d, i) => ({ id: d.deviceId, label: d.label || `카메라 ${i + 1}` }))
  } catch {
    return []
  }
}

export const savedCamera = () => {
  try {
    return localStorage.getItem(CAMERA_KEY)
  } catch {
    return null
  }
}

export function saveCamera(id) {
  try {
    if (id) localStorage.setItem(CAMERA_KEY, id)
    else localStorage.removeItem(CAMERA_KEY)
  } catch {}
}

export async function openCamera(video, deviceId = savedCamera()) {
  if (!cameraSecure()) throw Object.assign(new Error('insecure'), { name: 'SecurityContextError' })
  if (!cameraSupported()) throw Object.assign(new Error('unsupported'), { name: 'NotSupportedError' })
  const base = { width: 640, height: 480 }
  let stream
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: deviceId ? { ...base, deviceId: { exact: deviceId } } : { ...base, facingMode: 'user' },
      audio: false,
    })
  } catch (e) {
    // 저장해 둔 카메라가 빠졌으면 잊고 기본 카메라로 다시 연다
    if (!deviceId || !['OverconstrainedError', 'NotFoundError', 'ConstraintNotSatisfiedError'].includes(e.name)) throw e
    saveCamera(null)
    stream = await navigator.mediaDevices.getUserMedia({ video: { ...base, facingMode: 'user' }, audio: false })
  }
  const id = stream.getVideoTracks()[0]?.getSettings().deviceId
  if (id) saveCamera(id)
  video.srcObject = stream
  video.muted = true
  video.playsInline = true
  await video.play()
  return stream
}

export function closeCamera(stream) {
  stream?.getTracks().forEach((t) => t.stop())
}

// 브라우저마다 다시 허용하는 곳이 다르다
function allowSteps() {
  const ua = navigator.userAgent
  if (/iPhone|iPad/.test(ua)) return ['설정 앱 → Safari(또는 쓰는 브라우저) → 카메라를 ‘허용’으로 바꾸기', '이 페이지로 돌아와 다시 시도']
  if (/Safari/.test(ua) && !/Chrome|Edg/.test(ua)) return ['메뉴 막대 Safari → 이 웹 사이트 설정…', '카메라를 ‘허용’으로 바꾸기', '다시 시도 누르기']
  if (/Firefox/.test(ua)) return ['주소창 왼쪽 카메라(줄 그은) 아이콘 누르기', '‘임시로 차단됨’ 옆 ×로 차단 풀기', '다시 시도 누르기']
  return ['주소창 왼쪽 자물쇠(사이트 정보) 아이콘 누르기', '카메라를 ‘허용’으로 바꾸기', '다시 시도 누르기 (안 되면 새로고침)']
}

// kind: denied | missing | busy | constraint | insecure | unsupported | unknown
export function cameraError(err) {
  const name = err?.name || ''
  const msg = String(err?.message || '')
  if (name === 'SecurityContextError' || (!cameraSecure() && name !== 'NotFoundError'))
    return { kind: 'insecure', title: '보안 연결(https)에서만 카메라를 쓸 수 있어요', guide: ['주소가 https:// 로 시작하는 페이지에서 열어 주세요'] }
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError' || /Permission denied/i.test(msg))
    return { kind: 'denied', title: '카메라 권한이 꺼져 있어요', guide: allowSteps() }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError')
    return { kind: 'missing', title: '연결된 카메라를 찾지 못했어요', guide: ['카메라(웹캠)가 연결돼 있는지 확인해 주세요', '연결한 뒤 다시 시도'] }
  if (name === 'NotReadableError' || name === 'TrackStartError' || /Could not start video source/i.test(msg))
    return { kind: 'busy', title: '다른 앱이 카메라를 쓰고 있어요', guide: ['FaceTime·Zoom·다른 탭 등 카메라를 쓰는 곳을 닫아 주세요', '닫은 뒤 다시 시도'] }
  if (name === 'OverconstrainedError' || name === 'ConstraintNotSatisfiedError')
    return { kind: 'constraint', title: '이 카메라는 쓸 수 없는 설정이에요', guide: ['아래에서 다른 카메라를 골라 주세요'] }
  if (name === 'NotSupportedError')
    return { kind: 'unsupported', title: '이 브라우저는 카메라를 지원하지 않아요', guide: ['최신 Chrome·Safari·Edge 에서 열어 주세요'] }
  return { kind: 'unknown', title: '카메라를 열지 못했어요', guide: ['잠시 뒤 다시 시도해 주세요'] }
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
