<script setup>
import { ref } from 'vue'
import { load } from '../data.js'
import { pastelOf } from '../shops.js'
import { sfx } from '../sound.js'

const KEY = 'gp-highlow-best'
const pool = ref([])
const round = ref(null)
const shown = ref([0, 0])
const result = ref(null)
const streak = ref(0)
const best = ref(readBest())

function readBest() {
  try {
    return Number(localStorage.getItem(KEY)) || 0
  } catch {
    return 0
  }
}

function saveBest(v) {
  try {
    localStorage.setItem(KEY, String(v))
  } catch {
    // 저장이 막힌 브라우저면 이번 판만 기억한다
  }
}

const rand = (n) => Math.floor(Math.random() * n)

function next() {
  const group = pool.value[rand(pool.value.length)]
  let a, b
  do {
    a = group.names[rand(group.names.length)]
    b = group.names[rand(group.names.length)]
  } while (a[1] === b[1])
  round.value = { cat: group.cat, pair: [a, b] }
  shown.value = [0, 0]
  result.value = null
}

function countUp(target) {
  const start = performance.now()
  const step = (t) => {
    const k = Math.min((t - start) / 700, 1)
    shown.value = target.map((v) => Math.round(v * k))
    if (k < 1) {
      sfx.tick()
      requestAnimationFrame(step)
    }
  }
  requestAnimationFrame(step)
}

function guess(i) {
  if (result.value) return
  const [a, b] = round.value.pair
  const win = i === 0 ? a[1] > b[1] : b[1] > a[1]
  result.value = win ? 'win' : 'lose'
  countUp([a[1], b[1]])
  setTimeout(() => (win ? sfx.right() : sfx.wrong()), 720)
  if (win) {
    streak.value += 1
    if (streak.value > best.value) {
      best.value = streak.value
      saveBest(best.value)
    }
  } else {
    streak.value = 0
  }
}

load('highlow.json').then((v) => {
  pool.value = v
  next()
})
</script>

<template>
  <div v-if="round" class="game">
    <div class="row score">
      <span>연속 <b class="big-num">{{ streak }}</b></span>
      <span class="grow"></span>
      <span class="muted">최고 {{ best }}</span>
    </div>
    <p class="q">
      전국 <b>{{ round.cat }}</b> 중에<br />
      어느 간판이 더 많을까?
    </p>
    <div class="cards">
      <button
        v-for="([name, count], i) in round.pair"
        :key="i"
        class="card"
        :class="{ win: result && count === Math.max(...round.pair.map((p) => p[1])) }"
        :style="{ '--c': pastelOf(name) }"
        @click="guess(i)"
      >
        <span class="sign">{{ name }}</span>
        <span class="count big-num">{{ result ? `${shown[i]}곳` : '?' }}</span>
      </button>
    </div>
    <div class="foot">
      <p v-if="result === 'win'" class="msg ok">정답! 🎉</p>
      <p v-else-if="result === 'lose'" class="msg no">땡! 다시 0부터</p>
      <p v-else class="msg muted">간판을 눌러서 고르세요</p>
      <button :disabled="!result" @click="next">다음 ▶</button>
    </div>
  </div>
  <p v-else>불러오는 중…</p>
</template>

<style scoped>
.game {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.q {
  margin: 0;
  text-align: center;
  font-size: 14px;
  line-height: 1.6;
}

.cards {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 14px 6px;
  min-height: 120px;
}

.card .sign {
  width: 100%;
  padding: 8px 4px;
  background: var(--c);
  border: 3px solid var(--ink);
  font-size: 15px;
  word-break: keep-all;
}

.card.win .sign {
  animation: blink 0.25s steps(2) 4;
  outline: 3px dashed var(--red);
  outline-offset: 2px;
}

@keyframes blink {
  50% {
    filter: brightness(1.3);
  }
}

.foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.msg {
  margin: 0;
  font-size: 14px;
}

.ok {
  color: #1f8a3c;
}

.no {
  color: var(--red);
}
</style>
