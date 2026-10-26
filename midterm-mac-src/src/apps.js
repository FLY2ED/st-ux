import BuildingWindow from './games/BuildingWindow.vue'
import BrowserWindow from './games/BrowserWindow.vue'
import FileWindow from './games/FileWindow.vue'
import FinderWindow from './games/FinderWindow.vue'
import GamesWindow from './games/GamesWindow.vue'
import { defineAsyncComponent } from 'vue'

// 간판 거리는 지도·간판 자료가 커서 처음 열 때 받는다. 거리는 3D 로 걷고, 놀이(play)는 그 안에서 2D 판으로 연다
const Street3D = defineAsyncComponent(() => import('./games/Street3D.vue'))

const icon = (n) => new URL(`./assets/mac/${n}.webp`, import.meta.url).href

// 산성비·점심 간판 피하기·간판 청소·네컷·어디게·더 많을까·타자왕·간판 지도·내 가게는 '간판 수리공' 이야기 안의 퀘스트가 되었다.
// 그 id 를 열면 간판 수리공 창이 그 퀘스트를 바로 띄운다(순위표·위젯 링크가 그대로 동작하게). 간판 지도 창은 Dock 오른쪽 칸과 이야기·위젯이 연다
// 맥 Dock 순서대로. 바탕화면에는 아이콘을 거의 두지 않고 앱은 Dock 에서 연다. 간판 수리공이 맨 앞이다. dock 이 붙은 게임만 Dock 에 나오고, 나머지 게임은 '게임' 앱과 Launchpad 에서 연다. 놀이, 칸막이, 찾아보기. immerse 는 초록 버튼을 누르면 메뉴바까지 덮는 전체 화면이 된다.
// ink 는 테마와 상관없이 창을 검게 칠한다(간판 청소). to 가 있는 항목은 따로 창을 만들지 않고 그 앱을 props 로 연다(가게·동네는 간판 지도 안의 탭)
export const APPS = [
  { id: 'street', dock: true, title: '간판 수리공', img: icon('street'), comp: Street3D, width: 980, height: 640, kind: 'play', immerse: true, fill: true, keys: '간판 수리공 거리 동네 이야기 스토리 퀘스트 산성비 점심 피하기 간판 청소 타자 어디게 더 많을까 네컷 내 가게 지도 건설 3D street' },
  { id: 'games', title: '게임', img: icon('games'), comp: GamesWindow, width: 920, height: 600, kind: 'hub', fill: true, unified: true, keys: '게임 오락실 모음 라이브러리 순위 도전 games arcade' },
  { id: 'rain', title: '간판 산성비', img: icon('rain'), to: 'street', props: { play: 'rain' }, kind: 'hidden' },
  { id: 'dodge', title: '점심 간판 피하기', img: icon('dodge'), to: 'street', props: { play: 'dodge' }, kind: 'hidden' },
  { id: 'scratch', title: '간판 청소', img: icon('scratch'), to: 'street', props: { play: 'scratch' }, kind: 'hidden' },
  { id: 'booth', title: '간판 네컷', img: icon('booth'), to: 'street', props: { play: 'booth' }, kind: 'hidden' },
  { id: 'guess', title: '간판 어디게', img: icon('guess'), to: 'street', props: { play: 'guess' }, kind: 'hidden' },
  { id: 'more', title: '더 많을까?', img: icon('more'), to: 'street', props: { play: 'more' }, kind: 'hidden' },
  { id: 'type', title: '간판 타자왕', img: icon('type'), to: 'street', props: { play: 'type' }, kind: 'hidden' },
  { id: 'building', title: '간판 지도', img: icon('find'), comp: BuildingWindow, width: 920, kind: 'look', props: { mode: 'name' }, keys: '내 이름 간판 찾기 지도 검색 find' },
  { id: 'web', title: '간판 브라우저', img: icon('web'), comp: BrowserWindow, width: 900, height: 620, kind: 'look', fill: true, keys: '브라우저 사파리 웹 분석 통계 순위 업종 똑같은 이름 web safari' },
  { id: 'open', title: '내 가게 차리기', img: icon('open'), to: 'building', props: { mode: 'shop' }, kind: 'hidden', keys: '가게 차리기 창업 open' },
  // 바탕화면 파일을 여는 훑어보기 창. Dock·Launchpad·Spotlight 에는 나오지 않는다
  { id: 'file', title: '훑어보기', img: icon('web'), comp: FileWindow, width: 600, height: 460, kind: 'hidden', fill: true, multi: 'file' },
  // 바탕화면 폴더를 여는 Finder 창. 폴더마다 따로 뜨고, 막대 없이 사이드바·툴바가 창 머리를 맡는다
  { id: 'finder', title: 'Finder', appName: 'Finder', img: icon('web'), comp: FinderWindow, width: 860, height: 520, kind: 'hidden', fill: true, unified: true, multi: 'at' },
  { id: 'near', title: '우리 동네 간판', img: icon('near'), to: 'building', props: { mode: 'near' }, kind: 'hidden', keys: '동네 근처 위치 near' },
]

export const appOf = (id) => APPS.find((a) => a.id === id)
