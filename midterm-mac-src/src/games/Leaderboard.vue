<script setup>
// 게임 끝 화면에 붙는 리더보드. score 를 주면 올리고(등록 전이면 이름부터 받는다), 순위표를 보여 준다
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { board, enter, player, submit } from '../arcade.js'

const props = defineProps({
  game: { type: String, required: true },
  score: { type: Number, default: null },
  limit: { type: Number, default: 5 },
  unit: { type: String, default: '점' },
})

const me = ref(player())
const name = ref('')
const pass = ref('')
const top = ref([])
const total = ref(0)
const mine = ref(null)
const result = ref(null)
const error = ref('')
const busy = ref(false)
const sent = ref(false)

async function refresh() {
  try {
    const b = await board(props.game, props.limit)
    top.value = b.top
    total.value = b.players
    mine.value = b.me
  } catch (e) {
    error.value = e.message
  }
}

// 게임이 끝났다는 알림. 간판 수리공 이야기 안에서 연 게임이면 이걸 듣고 퀘스트를 마친다
function over() {
  if (props.score != null) window.dispatchEvent(new CustomEvent('game:over', { detail: { game: props.game, score: props.score } }))
}

async function send() {
  if (props.score == null || sent.value || !me.value) return
  sent.value = true
  try {
    result.value = await submit(props.game, props.score)
  } catch (e) {
    error.value = e.message
  }
  await refresh()
}

async function join() {
  error.value = ''
  busy.value = true
  try {
    me.value = await enter(name.value.trim(), pass.value)
    await send()
    await refresh()
  } catch (e) {
    error.value = e.message
  }
  busy.value = false
}

const onPlayer = (e) => (me.value = e.detail)
onMounted(async () => {
  window.addEventListener('arcade:player', onPlayer)
  over()
  await refresh()
  await send()
})
onBeforeUnmount(() => window.removeEventListener('arcade:player', onPlayer))
watch(
  () => props.score,
  () => {
    sent.value = false
    result.value = null
    over()
    send()
  },
)
</script>

<template>
  <div class="lb">
    <div class="lb-head">
      <strong>리더보드</strong>
      <span class="muted">{{ total ? `${total}명 참가` : '첫 기록을 남겨 보세요' }}</span>
    </div>

    <p v-if="result" class="lb-me" :class="{ rec: result.record }">
      <template v-if="result.record">새 최고 기록! 전체 {{ result.rank }}위</template>
      <template v-else>최고 {{ result.best.toLocaleString() }}{{ unit }} · 전체 {{ result.rank }}위</template>
    </p>

    <ol v-if="top.length" class="lb-list">
      <li v-for="(r, i) in top" :key="r.name" :class="{ me: me && r.name === me.name }">
        <span class="no" :class="`n${i + 1}`">{{ i + 1 }}</span>
        <span class="who">{{ r.name }}</span>
        <span class="pts">{{ r.score.toLocaleString() }}</span>
      </li>
      <li v-if="mine && mine.rank > top.length" class="me gap">
        <span class="no">{{ mine.rank }}</span>
        <span class="who">{{ me?.name }}</span>
        <span class="pts">{{ mine.best.toLocaleString() }}</span>
      </li>
    </ol>

    <form v-if="!me" class="lb-join" @submit.prevent="join">
      <input v-model="name" maxlength="10" placeholder="닉네임 (2~10자)" aria-label="닉네임" />
      <input v-model="pass" type="password" maxlength="32" placeholder="암호 (4자 이상)" aria-label="암호" autocomplete="current-password" />
      <button type="submit" :disabled="busy || name.trim().length < 2 || pass.length < 4">
        {{ score != null ? '등록하고 올리기' : '등록' }}
      </button>
    </form>
    <p v-if="!me" class="lb-hint muted">처음이면 새로 만들고, 있던 이름이면 암호로 이어서 해요</p>
    <p v-else class="lb-hint muted">{{ me.name }}(으)로 참가 중</p>
    <p v-if="error" class="m-err">{{ error }}</p>
  </div>
</template>

<style scoped>
.lb {
  width: min(300px, 100%);
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 8px;
  padding: 12px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.78);
  box-shadow: 0 0 0 0.5px var(--sep), 0 6px 20px rgba(0, 0, 0, 0.08);
  text-align: left;
  user-select: text;
}
html.dark .lb {
  background: var(--sheet);
}
.lb-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  font-size: 13px;
}
.lb-head .muted {
  font-size: 11px;
}
.lb-me {
  margin: 0;
  padding: 6px 8px;
  border-radius: 8px;
  background: rgba(10, 132, 255, 0.1);
  color: var(--accent);
  font-size: 12px;
  font-weight: 600;
}
.lb-me.rec {
  background: rgba(255, 159, 10, 0.14);
  color: #c46a00;
}
.lb-list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: grid;
  gap: 2px;
}
.lb-list li {
  display: grid;
  grid-template-columns: 22px 1fr auto;
  align-items: center;
  gap: 8px;
  padding: 4px 6px;
  border-radius: 6px;
  font-size: 12px;
}
.lb-list li.me {
  background: rgba(10, 132, 255, 0.12);
  font-weight: 600;
}
.lb-list li.gap {
  margin-top: 4px;
  border-top: 1px dashed var(--sep);
  border-radius: 0 0 6px 6px;
}
.no {
  display: grid;
  place-items: center;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: var(--fill);
  font-size: 11px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}
.no.n1 { background: #ffd60a; color: rgba(0, 0, 0, 0.85); }
.no.n2 { background: #d1d1d6; color: rgba(0, 0, 0, 0.85); }
.no.n3 { background: #e3a869; color: #fff; }
.who {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pts {
  font-variant-numeric: tabular-nums;
  color: var(--label-2);
}
.lb-join {
  display: flex;
  gap: 6px;
}
.lb-join input {
  flex: 1;
  width: 0;
  min-width: 0;
}
.lb-hint {
  margin: 0;
  font-size: 11px;
}
</style>
