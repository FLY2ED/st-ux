<script setup>
import { computed, ref } from 'vue'
import { load } from '../data.js'
import { pastelOf } from '../shops.js'
import { sfx } from '../sound.js'

const KEY = 'gp-kkeut-best'
const table = ref(null)
const chain = ref([])
const choices = ref([])
const over = ref('')
const best = ref(readBest())

function readBest() {
  try {
    return Number(localStorage.getItem(KEY)) || 0
  } catch {
    return 0
  }
}

const rand = (n) => Math.floor(Math.random() * n)
const last = computed(() => chain.value[chain.value.length - 1])
const used = (name) => chain.value.some((c) => c.name === name)

function candidates(ch) {
  return (table.value[ch] || []).filter(([n]) => !used(n))
}

function pickChoices() {
  const list = candidates(last.value.name.slice(-1))
  if (!list.length) {
    over.value = 'win'
    sfx.right()
    return
  }
  choices.value = [...list].sort(() => Math.random() - 0.5).slice(0, 4)
}

function start() {
  const firsts = Object.keys(table.value).filter((k) => table.value[k].length >= 3)
  const ch = firsts[rand(firsts.length)]
  const [name, count] = table.value[ch][rand(Math.min(4, table.value[ch].length))]
  chain.value = [{ name, count, who: 'cpu' }]
  over.value = ''
  pickChoices()
}

function pick([name, count]) {
  if (over.value) return
  sfx.click()
  chain.value.push({ name, count, who: 'me' })
  const mine = chain.value.filter((c) => c.who === 'me').length
  if (mine > best.value) {
    best.value = mine
    try {
      localStorage.setItem(KEY, String(mine))
    } catch {
      // 저장이 막히면 이번 판만 기억한다
    }
  }
  const reply = candidates(name.slice(-1))
  if (!reply.length) {
    over.value = 'win'
    sfx.right()
    return
  }
  // 컴퓨터는 다음 글자로 이어질 길이 있는 말을 골라서 판이 쉽게 안 끝나게 한다
  const alive = reply.filter(([n]) => (table.value[n.slice(-1)] || []).some(([m]) => m !== n))
  const [rn, rc] = (alive.length ? alive : reply)[rand((alive.length ? alive : reply).length)]
  setTimeout(() => {
    chain.value.push({ name: rn, count: rc, who: 'cpu' })
    sfx.bell()
    if (!candidates(rn.slice(-1)).length) {
      over.value = 'lose'
      sfx.wrong()
    } else pickChoices()
  }, 450)
}

load('kkeut.json').then((v) => {
  table.value = v
  start()
})
</script>

<template>
  <div v-if="table" class="kkeut">
    <p class="muted">앞 간판의 마지막 글자로 시작하는 간판을 이어 주세요. 최고 기록 {{ best }}번</p>
    <ol class="chain sunken-panel">
      <li v-for="(c, i) in chain" :key="i" :class="c.who">
        <span class="sign" :style="{ background: pastelOf(c.name) }">{{ c.name }}</span>
        <span class="muted">전국 {{ c.count.toLocaleString() }}곳</span>
      </li>
    </ol>
    <div v-if="!over" class="picks">
      <button v-for="[n, c] in choices" :key="n" :disabled="chain[chain.length - 1].who === 'me'" @click="pick([n, c])">
        {{ n }}
      </button>
    </div>
    <div v-else class="end">
      <b>{{ over === 'win' ? '이겼어요! 컴퓨터가 이을 간판이 없어요' : '졌어요… 이을 간판이 없어요' }}</b>
      <button @click="start">다시 하기</button>
    </div>
  </div>
  <p v-else class="muted">불러오는 중…</p>
</template>

<style scoped>
.kkeut {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

p {
  margin: 0;
}

.chain {
  list-style: none;
  margin: 0;
  padding: 6px;
  max-height: 200px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.chain li {
  display: flex;
  align-items: center;
  gap: 8px;
}

.chain li.me {
  flex-direction: row-reverse;
}

.sign {
  padding: 2px 8px;
  border: 2px solid var(--ink);
  box-shadow: 2px 2px 0 var(--ink);
  font-size: 14px;
}

.picks {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
}

.picks button {
  min-height: 34px;
  font-size: 14px;
}

.end {
  display: flex;
  flex-direction: column;
  gap: 6px;
  align-items: center;
}
</style>
