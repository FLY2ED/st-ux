// 폰 문자로 이어지는 이야기. 플레이어 번호는 간판 구석 "간판 수리 010-…" 스티커에 적혀 있어서,
// 간판이 꺼지면 사람들이 그 번호로 연락한다는 설정이다.
// 대화(thread)는 who(얼굴)·name(연락처 이름)·when(첫 줄 시각)·script(차례로 나오는 말)로 이루어진다.
// script 한 줄: { t } 상대 말 · { photo } 꺼진 골목 사진 · { choose: [..] } 답장 고르기 · { read } 읽음 표시
//   · { next } 다음 대화가 알림으로 들어온다 · { go, sub } 게임으로 가는 버튼
// {me} 는 로그인한 이름으로 바뀐다
import bunsik from '../assets/npc/p-bunsik.png'

export const PHONE_KEY = 'gp-phone'

export const FACES = { bunsik }

// 메시지 앱 아이콘(알림에 쓴다)
export const MSG_ICON =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 38 38"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5df36b"/><stop offset="1" stop-color="#1fbf3a"/></linearGradient></defs><rect width="38" height="38" rx="9" fill="url(#g)"/><path fill="#fff" d="M19 8.5c-6.4 0-11.5 4.1-11.5 9.2 0 2.9 1.7 5.5 4.3 7.2l-.8 4.4 4.7-2.6c1 .2 2.1.3 3.3.3 6.4 0 11.5-4.1 11.5-9.3S25.4 8.5 19 8.5z"/></svg>',
  )

export const PHONE_STORIES = {
  start: {
    clock: '12:04',
    notice: { title: '010-4821-7733', text: '저기요… 혹시 간판 수리하시는 분 맞나요?' },
    threads: [
      {
        who: 'unknown',
        name: '010-4821-7733',
        when: '오늘 오전 12:03',
        script: [
          { t: '저기요… 혹시 간판 수리하시는 분 맞나요?' },
          { t: '간판 밑에 붙은 스티커 보고 연락드려요' },
          { t: '과기대 처음 와 봤는데 간판이 다 꺼져서 정문이 어딘지 모르겠어요 ㅠㅠ', gap: true },
          { photo: true },
          { t: '간판 글자가 다 뜯겨서 바닥에 굴러다녀요… 도둑 든 거 아니에요?' },
          { choose: ['지금 갈게요. 거기 계세요', '거기 어디쯤이에요?'] },
          { t: '분식집 같은 게 보이는데 불이 꺼져 있어요' },
          { t: '감사합니다 진짜로 🙏' },
          { read: '읽음 오전 12:04' },
          { next: { who: 'bunsik', title: '공릉 분식 사장님', text: '{me}! 소식 들었어?' } },
        ],
      },
      {
        who: 'bunsik',
        name: '공릉 분식 사장님',
        when: '오늘 오전 12:05',
        script: [
          { t: '{me}! 소식 들었어?' },
          { t: '자정에 간판 도둑이 들었어! 동네 간판 글자를 몽땅 뜯어 가서 불이 다 꺼졌어' },
          { t: '도둑이 도망가다 흘린 글자를 제자리에 붙이면 불이 다시 켜지더라', gap: true },
          { t: '우리 가게부터 와 줘. 과기대 정문 바로 앞이야' },
          { choose: ['공구 챙겨서 갈게요', '정문에 길 잃은 학생도 있대요'] },
          { t: '그 학생도 우리 간판 켜지면 길 찾을 거야. 어서!' },
          { go: '과기대로 가기', sub: '7호선 공릉역 · 1장 꺼진 공릉동' },
        ],
      },
    ],
  },
}

export function phoneSeen(key) {
  try {
    return !!JSON.parse(localStorage.getItem(PHONE_KEY) || '{}')[key]
  } catch {
    return false
  }
}

export function markPhone(key) {
  try {
    const seen = JSON.parse(localStorage.getItem(PHONE_KEY) || '{}')
    localStorage.setItem(PHONE_KEY, JSON.stringify({ ...seen, [key]: Date.now() }))
  } catch {
    // 저장이 막히면 다음에 또 온다
  }
}
