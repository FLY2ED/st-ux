<script setup>
import { computed, ref, shallowRef } from 'vue'
import KoreaMap from './KoreaMap.vue'
import { looksLikeName, search } from '../data.js'
import { pastelOf } from '../shops.js'
import { sfx } from '../sound.js'

const MAX_FLOORS = 9
const query = ref('')
const result = ref(null)
const floors = ref([])
const busy = ref(false)
const error = ref('')
const view = ref('building')
const built = shallowRef([])

const candidates = computed(() => {
  if (!result.value) return []
  const withFloor = result.value.rows.filter((r) => r.floor !== null)
  const exact = withFloor.filter((r) => r.exact)
  return exact.length >= 3 ? exact : withFloor
})

function build() {
  const byFloor = new Map()
  for (const row of [...candidates.value].sort(() => Math.random() - 0.5)) {
    if (!byFloor.has(row.floor)) byFloor.set(row.floor, row)
  }
  const picked = [...byFloor.values()]
    .sort(() => Math.random() - 0.5)
    .slice(0, MAX_FLOORS)
    .sort((a, b) => b.floor - a.floor)
  built.value = picked
  floors.value = []
  picked
    .slice()
    .reverse()
    .forEach((row, i) => {
      setTimeout(() => {
        floors.value = [row, ...floors.value]
        sfx.build(i)
      }, i * 140)
    })
}

async function submit() {
  const word = query.value.trim()
  error.value = ''
  if (!/[가-힣]{2}/.test(word)) {
    error.value = '한글 두 글자 이상 넣어 주세요'
    return
  }
  busy.value = true
  try {
    result.value = await search(word)
    if (!candidates.value.length) error.value = '층 정보가 있는 간판이 없어요'
    else build()
  } catch {
    error.value = '데이터를 못 불러왔어요'
  } finally {
    busy.value = false
  }
}

const listed = computed(() => {
  if (!result.value) return []
  const seen = new Set()
  return result.value.rows
    .filter((r) => r.exact && !seen.has(r.name) && seen.add(r.name))
    .map((r) => {
      const i = r.name.indexOf(result.value.word)
      return {
        ...r,
        parts: [r.name.slice(0, i), result.value.word, r.name.slice(i + result.value.word.length)],
        accident: !looksLikeName(r.name, result.value.word),
      }
    })
    .sort((a, b) => a.accident - b.accident)
})

const mapRows = computed(() => (view.value === 'list' ? listed.value : built.value))

const floorLabel = (f) => (f < 0 ? `B${-f}` : `${f}F`)
</script>

<template>
  <div class="bld">
    <form class="row" @submit.prevent="submit">
      <input v-model="query" class="grow" type="text" placeholder="내 이름 (예: 민수)" maxlength="10" />
      <button type="submit" :disabled="busy">짓기</button>
    </form>
    <p v-if="error" class="err">{{ error }}</p>

    <template v-if="result && floors.length">
      <p class="muted">
        전국 간판 중 ‘{{ result.word }}’이 들어간 곳 {{ result.exactCount ? '' : '최대 ' }}{{ result.count.toLocaleString() }}곳.
        진짜 그 층에 있는 가게만 쌓았어요.
      </p>
      <div class="row modes">
        <button :class="{ on: view === 'building' }" @click="view = 'building'">🏢 빌딩</button>
        <button :class="{ on: view === 'list' }" @click="view = 'list'">📋 간판 목록</button>
      </div>
      <div class="split">
        <div class="main">
          <div v-if="view === 'list'" class="sunken-panel list">
            <ul>
              <li v-for="r in listed" :key="r.name" :class="{ accident: r.accident }">
                <span>{{ r.parts[0] }}<b>{{ r.parts[1] }}</b>{{ r.parts[2] }}</span>
                <span v-if="r.accident" class="huh">?!</span>
                <small class="muted">{{ r.region.split(' ').slice(-1)[0] }}</small>
              </li>
            </ul>
            <p class="muted legend">노란 줄 = 이름이 아니라 우연히 걸린 곳</p>
          </div>
          <div v-else class="sky">
            <div class="tower">
              <div class="roof">{{ result.word }} 빌딩</div>
              <TransitionGroup name="drop" tag="div">
                <div
                  v-for="f in floors"
                  :key="f.name + f.floor + f.region"
                  class="floor"
                  :class="{ under: f.floor < 0 }"
                  :style="{ '--c': pastelOf(f.name) }"
                >
                  <span class="no">{{ floorLabel(f.floor) }}</span>
                  <span class="sign">{{ f.name }}</span>
                  <span class="where">{{ f.region.split(' ').slice(-1)[0] }} · {{ f.cat }}</span>
                </div>
              </TransitionGroup>
              <div class="ground"></div>
            </div>
          </div>
          <button v-if="view === 'building'" class="wide" @click="build(), sfx.click()">🔨 다시 짓기</button>
        </div>
        <aside class="side">
          <KoreaMap :rows="mapRows" quiet />
          <p class="muted">{{ view === 'list' ? '목록에 있는 가게' : '빌딩에 들어온 가게' }}가 실제로 있는 동네예요. 간판 색 = 불빛 색.</p>
        </aside>
      </div>
    </template>
    <p v-else-if="!result" class="muted hint">
      이름을 넣으면 그 글자가 들어간 전국의 진짜 가게들을, 진짜 층에 맞춰 한 건물에 쌓아요.
    </p>
  </div>
</template>

<style scoped>
.bld {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.split {
  display: grid;
  grid-template-columns: 1fr 220px;
  gap: 10px;
  align-items: start;
}

.main {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}

.side {
  position: sticky;
  top: 0;
}

.side p {
  margin: 4px 0 0;
  font-size: 11px;
  line-height: 1.5;
}

@media (max-width: 719px) {
  .split {
    grid-template-columns: 1fr;
  }
}

.err {
  margin: 0;
  color: var(--red);
}

.hint {
  line-height: 1.6;
}

.sky {
  padding: 16px 10px 0;
  background: linear-gradient(#bfe3ff, #eaf6ff);
  border: 2px inset #fff;
}

.tower {
  margin: 0 auto;
  max-width: 300px;
}

.roof {
  margin: 0 18px;
  padding: 4px;
  text-align: center;
  background: var(--yellow);
  border: 3px solid var(--ink);
  border-bottom: 0;
}

.floor {
  display: grid;
  grid-template-columns: 30px 1fr;
  grid-template-rows: auto auto;
  column-gap: 6px;
  padding: 5px 6px;
  background: #fffaf2;
  border: 3px solid var(--ink);
  border-bottom-width: 0;
}

.floor .no {
  grid-row: span 2;
  align-self: center;
  text-align: center;
  color: #6b6b7b;
}

.floor .sign {
  justify-self: start;
  max-width: 100%;
  padding: 2px 6px;
  background: var(--c);
  border: 2px solid var(--ink);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.floor .where {
  font-size: 11px;
  color: #6b6b7b;
}

.floor.under {
  background: #d9d3e8;
}

.ground {
  height: 10px;
  margin: 0 -10px;
  background: #8bc48a;
  border-top: 3px solid var(--ink);
}

.drop-enter-active {
  transition: transform 0.25s steps(5), opacity 0.25s;
}

.drop-enter-from {
  transform: translateY(-40px);
  opacity: 0;
}

.wide {
  width: 100%;
}

.modes button {
  min-width: 0;
  padding: 0 8px;
}

.modes button.on {
  box-shadow: inset -1px -1px #fff, inset 1px 1px #0a0a0a, inset -2px -2px #dfdfdf, inset 2px 2px grey;
  background: #e8e8e8;
  font-weight: 700;
}

.list ul {
  list-style: none;
  margin: 0;
  padding: 4px;
}

.list li {
  display: flex;
  gap: 6px;
  align-items: baseline;
  padding: 4px 6px;
  border-bottom: 1px dotted #ccc;
  font-size: 13px;
}

.list li b {
  color: #d63a7a;
}

.list li small {
  margin-left: auto;
}

.list li.accident {
  background: #fff3a8;
}

.huh {
  color: var(--red);
  font-weight: 700;
}

.legend {
  margin: 0;
  padding: 6px;
}
</style>
