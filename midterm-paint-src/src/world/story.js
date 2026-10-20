// 「꺼진 간판의 도시」: 어느 밤 서울 간판이 한꺼번에 꺼지고 색과 사람이 사라졌다.
// 간판 수리공이 되어 동네마다 간판에 불을 다시 켠다. {goal} 켤 개수, {shop} 부탁받은 가게
export const STORY_KEY = 'gp-3d-story'

export const CHAPTERS = [
  {
    id: 'seoultech',
    title: '1장 · 꺼진 공릉동',
    goal: 10,
    weather: 'rain',
    npc: { name: '공릉 분식 사장님', face: '🍢', img: 'snack' },
    want: /분식|떡볶이|김밥/,
    intro: [
      '…어, 거기 누구야? 공구 가방을 멘 걸 보니 간판 수리공이구나!',
      '어젯밤 자정에 서울 간판이 한꺼번에 꺼졌어. 그러더니 색도, 사람도, 차도 다 사라져 버렸지.',
      '이상하지? 간판에 불이 들어오면 그 둘레만 다시 색이 돌아와. 이 동네 간판 {goal}개만 켜 줘!',
      '그리고… 우리 가게 「{shop}」 간판부터 부탁해. 위에 화살표 따라가면 있어.',
    ],
    half: '봐, 사람들이 하나둘 돌아오고 있어! 조금만 더!',
    shop: '우와, 우리 간판이다! 떡볶이 냄새가 다시 나는 것 같아!',
    done: ['해냈다! 공릉동에 불이 다 들어왔어!', '근데 들었어? 홍대 쪽은 아직 깜깜하대. 거긴 음악까지 멈췄다던데…'],
  },
  {
    id: 'hongdae',
    title: '2장 · 소리 잃은 홍대',
    goal: 14,
    weather: 'clear',
    npc: { name: '버스킹 기타리스트', face: '🎸', img: 'busker' },
    want: /노래방|생맥주|주점|악기/,
    intro: [
      '…쉿. 들려? 아무 소리도 안 나. 홍대에서 음악이 멈춘 건 처음이야.',
      '간판이 하나 켜질 때마다 음이 하나씩 돌아오는 것 같아. {goal}개 켜 주면 다시 공연할 수 있어!',
      '「{shop}」 앞이 내 자리거든. 거기부터 부탁해!',
    ],
    half: '베이스 라인이 돌아왔어! 이제 드럼만 있으면 돼!',
    shop: '여기야 여기! 이제 앰프만 꽂으면 된다!',
    done: ['앵콜! 홍대가 다시 시끄러워졌어!', '강남역 회사원 친구가 연락이 안 돼. 거긴 빌딩이 너무 높아서 더 어둡대.'],
  },
  {
    id: 'gangnam',
    title: '3장 · 멈춘 강남역',
    goal: 16,
    weather: 'rain',
    npc: { name: '야근하는 회사원', face: '💼', img: 'office' },
    want: /카페/,
    intro: [
      '보고서 저장하려는데 정전이라니… 아니, 간판만 꺼진 거라고요?',
      '이 거리 간판 {goal}개를 켜면 퇴근길 버스가 다시 다닐 거예요. 아마도요.',
      '일단 「{shop}」부터요. 커피가 없으면 저는 아무것도 못 해요.',
    ],
    half: '차 소리가 들려요! 막차는 놓치지 않겠네요.',
    shop: '아메리카노 냄새…! 살았다!',
    done: ['퇴근이다…! 고마워요, 수리공님.', '마지막은 광화문이래요. 서울에서 제일 오래된 간판들이 있는 곳이요.'],
  },
  {
    id: 'gwanghwamun',
    title: '4장 · 광화문의 마지막 불빛',
    goal: 16,
    weather: 'snow',
    npc: { name: '인쇄소 아저씨', face: '🖨️', img: 'print' },
    want: /명함|간판|복사|서점|문구/,
    intro: [
      '허허, 사십 년 동안 간판 글씨를 찍어 왔는데 이렇게 다 꺼진 건 처음 보네.',
      '간판은 가게의 얼굴이야. 얼굴이 꺼지면 동네가 자기를 잊어버리지.',
      '{goal}개만 켜 주게. 「{shop}」 것도 잊지 말고.',
    ],
    half: '눈 속에서도 불빛은 잘 보이는구먼. 조금 더!',
    shop: '저 글씨, 내가 찍은 거라네. 고맙네.',
    done: ['서울이 다시 자기를 기억해 냈구먼.', '자네한테 보여 줄 게 있네. 이 건물들이 언제부터 여기 서 있었는지… 시간을 거슬러 볼 텐가?'],
  },
]

// 마지막엔 프롤로그에서 「재미가 없네요」 하던 교수님이 다시 나온다
export const PROF = { name: '교수님', face: '👓', img: 'prof' }
export const ENDING = [
  '음… 이번 과제는, 재미있네요.',
  '자, 마지막으로 이 동네가 어떻게 쌓여 왔는지 같이 봅시다.',
  '아주 오래전부터 지금까지, 건물이 세워진 해(사용승인 연도) 순서대로 땅에서 솟아올라요.',
  '간판은 꺼져도, 거리는 이렇게 쌓여 왔어요. 아래 ▶ 를 눌러 보세요.',
]

export function fill(line, vars) {
  return line.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '')
}

export function readCleared() {
  try {
    return JSON.parse(localStorage.getItem(STORY_KEY))?.cleared || []
  } catch {
    return []
  }
}

export function saveCleared(list) {
  try {
    localStorage.setItem(STORY_KEY, JSON.stringify({ cleared: list }))
  } catch {
    // 저장이 막히면 이번 방문 동안만 기억한다
  }
}
