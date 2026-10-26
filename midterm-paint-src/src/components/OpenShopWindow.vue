<script setup>
import { computed, ref } from 'vue'
import { load, nameCount, search } from '../data.js'
import { sfx } from '../sound.js'
import PixelShop from './PixelShop.vue'

const props = defineProps({ myShops: Array })
const emit = defineEmits(['opened'])

const street = ref([])
const key = ref('bread')
const name = ref('')
const busy = ref(false)
const error = ref('')
const result = ref(null)

load('street.json').then((v) => (street.value = v))

const kind = computed(() => street.value.find((s) => s.key === key.value))

async function openShop() {
  const n = name.value.trim().replace(/\s+/g, '')
  error.value = ''
  if (!/[가-힣]{2}/.test(n)) {
    error.value = '한글 두 글자 이상 넣어 주세요'
    return
  }
  busy.value = true
  try {
    const [count, found] = await Promise.all([nameCount(n), search(n)])
    const exactSeen = found.rows.some((r) => r.name === n)
    const similar = [...new Set(found.rows.filter((r) => r.name !== n && r.cat === kind.value.label).map((r) => r.name))]
    const others = [...new Set(found.rows.filter((r) => r.name !== n).map((r) => r.name))]
    result.value = {
      name: n,
      count: count || (exactSeen ? 1 : 0),
      similar: (similar.length ? similar : others).slice(0, 3),
    }
    emit('opened', { key: key.value, label: n, emoji: kind.value.emoji })
    if (result.value.count) sfx.bell()
    else sfx.right()
  } catch {
    error.value = '데이터를 못 불러왔어요'
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="open">
    <div class="field-row-stacked">
      <label>업종</label>
      <select v-model="key">
        <option v-for="s in street" :key="s.key" :value="s.key">{{ s.emoji }} {{ s.label }}</option>
      </select>
    </div>
    <form class="field-row-stacked" @submit.prevent="openShop">
      <label>간판 이름</label>
      <div class="row">
        <input v-model="name" class="grow" type="text" placeholder="예: 꽈배기공화국" maxlength="12" />
        <button type="submit" :disabled="busy">개업하기!</button>
      </div>
    </form>
    <p v-if="error" class="err">{{ error }}</p>

    <div v-if="result && kind" class="result">
      <PixelShop :shop="{ key, label: result.name, emoji: kind.emoji }" />
      <div class="say">
        <p v-if="!result.count" class="big">전국 0곳 — 당신이 최초! 🎉</p>
        <p v-else class="big">이미 전국에 <b>{{ result.count.toLocaleString() }}곳</b> 있어요 👯</p>
        <p v-if="result.similar.length" class="muted">비슷한 간판: {{ result.similar.join(', ') }}</p>
        <p class="muted">내 거리 {{ myShops.length }}번째 가게로 입점했어요.</p>
      </div>
    </div>
    <p v-else class="muted hint">
      업종과 이름을 정하면 전국 277만 간판과 겹치는지 보고, 메인 거리 끝에 내 가게를 세워요.
    </p>
  </div>
</template>

<style scoped>
.open {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

select {
  height: 26px;
  font-size: 13px;
}

.err {
  margin: 0;
  color: var(--red);
}

.hint {
  line-height: 1.6;
}

.result {
  display: flex;
  gap: 12px;
  align-items: flex-end;
  padding: 12px;
  background: linear-gradient(#bfe3ff, #eaf6ff);
  border: 2px inset #fff;
}

.say p {
  margin: 4px 0 0;
}

.big {
  font-size: 14px;
}
</style>
