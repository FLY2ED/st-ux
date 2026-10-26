import { ref } from 'vue'

// 주인공 표정. 게임에서 맞히거나 틀리면 잠깐 바뀌었다가 돌아온다
export const FACES = ['happy', 'shock', 'panic', 'proud', 'sleepy', 'think']
export const mood = ref('happy')
export const faceImg = (name) => new URL(`./assets/face-${name}.webp`, import.meta.url).href

let back
export function react(face, ms = 1600) {
  mood.value = face
  clearTimeout(back)
  back = setTimeout(() => (mood.value = 'happy'), ms)
}
