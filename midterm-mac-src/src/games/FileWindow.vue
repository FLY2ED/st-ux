<script setup>
import { ref } from 'vue'
import { load } from '../data.js'

// 바탕화면 문서를 여는 훑어보기 창. 텍스트 편집기처럼 보인다(폴더·디스크는 FinderWindow 가 연다)
defineProps({ file: { type: String, default: 'readme' } })
defineEmits(['open'])

const meta = ref(null)
load('meta.json').then((v) => (meta.value = v)).catch(() => {})
const n = (v) => (v == null ? '…' : v.toLocaleString('ko-KR'))
</script>

<template>
  <div class="fw" :class="`fw-${file}`">
    <!-- 수리공 수첩.txt: 텍스트 편집기 -->
    <article v-if="file === 'readme'" class="doc">
      <h1>간판 도감에 오신 걸 환영해요</h1>
      <p>
        전국에 걸린 간판 <b>{{ n(meta?.total) }}개</b>의 이름을 모아 놀 거리로 만든 작은 컴퓨터예요. 가게 이름은 모두
        {{ meta?.source || '공공데이터' }}에서 가져왔고, 기준일은 {{ meta?.date || '…' }}이에요.
      </p>
      <h2>바탕화면</h2>
      <ul>
        <li>아이콘을 끌어서 옮기면 가까운 칸에 맞춰 놓여요. 자리는 기억해 둬요.</li>
        <li>빈 곳을 끌면 상자가 생기고, 상자에 닿은 아이콘이 모두 골라져요. 고른 채로 끌면 함께 움직여요.</li>
        <li>두 번 누르거나, 고른 뒤 Enter·⌘O 를 누르면 열려요. ⌘A 는 모두 고르기, Esc 는 고르기 풀기.</li>
      </ul>
      <h2>둘러볼 곳</h2>
      <ul>
        <li><b>Dock</b>: 간판 수리공, 게임, 간판 지도, 간판 브라우저가 모두 아래 Dock 에 있어요.</li>
        <li><b>내가 차린 가게</b> 폴더: 「내 가게 차리기」에서 연 가게가 쌓여요.</li>
        <li><b>간판도감 HD</b>: 응용 프로그램과 바탕화면을 Finder 로 둘러봐요.</li>
      </ul>
      <h2>단축키</h2>
      <ul>
        <li>⌘K 찾기(Spotlight) · ⌘W 창 닫기 · ⌘M 최소화</li>
      </ul>
    </article>
  </div>
</template>

<style scoped>
.fw {
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  color: var(--label);
  background: var(--window);
  font-size: 13px;
}

/* 텍스트 편집기 */
.doc {
  flex: 1;
  overflow: auto;
  padding: 22px 28px 28px;
  background: var(--field);
  line-height: 1.65;
  user-select: text;
}

.doc h1 {
  margin: 0 0 8px;
  font-size: 20px;
  letter-spacing: -0.01em;
}

.doc h2 {
  margin: 18px 0 4px;
  font-size: 14px;
}

.doc p,
.doc ul {
  margin: 0;
}

.doc ul {
  padding-left: 18px;
}

.doc li + li {
  margin-top: 2px;
}
</style>
