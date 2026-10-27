import { defineAsyncComponent } from 'vue'

// 사장님 부탁·보스 대결로 여는 놀이: 바탕화면 앱을 그대로 거리 위 판에 띄운다. free 는 끝내지 않아도 돌아갈 수 있다
export const QUESTS = {
  rain: { title: '간판 산성비', comp: defineAsyncComponent(() => import('../RainWindow.vue')), ink: true },
  dodge: { title: '점심 간판 피하기', comp: defineAsyncComponent(() => import('../DodgeWindow.vue')), ink: true },
  scratch: { title: '간판 청소', comp: defineAsyncComponent(() => import('../ScratchWindow.vue')), ink: true },
  more: { title: '더 많을까?', comp: defineAsyncComponent(() => import('../MoreWindow.vue')), ink: 'paper' },
  booth: { title: '간판 네컷', comp: defineAsyncComponent(() => import('../BoothWindow.vue')), ink: true, skip: true },
  type: { title: '간판 타자왕', comp: defineAsyncComponent(() => import('../TypeWindow.vue')), ink: true },
  guess: { title: '간판 어디게', comp: defineAsyncComponent(() => import('../GuessWindow.vue')), ink: true },
  map: { title: '간판 지도', comp: defineAsyncComponent(() => import('../BuildingWindow.vue')), mode: 'name' },
  open: { title: '내 가게 차리기', comp: defineAsyncComponent(() => import('../BuildingWindow.vue')), mode: 'shop', free: true },
  atlas: { title: '간판 지도', comp: defineAsyncComponent(() => import('../BuildingWindow.vue')), mode: 'name', free: true },
}
export const BOSS_GOAL = { rain: 6, type: 4, more: 2, map: 3 }

// 왼쪽 위 의뢰 카드에 적는 부탁 까닭
export const WHY = {
  scratch: '그을음이 간판 글자를 덮어서 안 보여요',
  dodge: '떨어지는 간판 때문에 배달을 못 나가요',
  booth: '도둑이 또 올까 봐 이름 포스터를 붙이고 싶어요',
  guess: '되찾은 글자가 어느 동네 건지 헷갈려요',
}

// 이야기 속 놀이 중에 '봐주세요'·'살려주세요'를 치면 봐준다. 한글 입력기가 켜져 있어도 되게 자판 위치(두벌식)로 읽는다
const PLEAS = ['qhkwntpdy', 'tkffuwntpdy']
export function pleaReader() {
  let typed = ''
  return {
    reset: () => (typed = ''),
    // 글자 자판 하나를 받아 빌기를 다 쳤으면 true
    push(code) {
      const m = /^Key([A-Z])$/.exec(code)
      if (!m) return false
      typed = (typed + m[1].toLowerCase()).slice(-12)
      if (!PLEAS.some((w) => typed.endsWith(w))) return false
      typed = ''
      return true
    },
  }
}
