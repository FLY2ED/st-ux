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
    <form class="group m-card" @submit.prevent="openShop">
      <label class="line">
        <span>업종</span>
        <select v-model="key">
          <option v-for="s in street" :key="s.key" :value="s.key">{{ s.emoji }} {{ s.label }}</option>
        </select>
      </label>
      <label class="line">
        <span>간판 이름</span>
        <input v-model="name" type="text" placeholder="예: 꽈배기공화국" maxlength="12" />
      </label>
    </form>
    <div class="act">
      <p v-if="error" class="m-err">{{ error }}</p>
      <button class="go" :disabled="busy" @click="openShop">{{ busy ? '확인 중…' : '개업하기' }}</button>
    </div>

    <div v-if="result && kind" class="result">
      <PixelShop :shop="{ key, label: result.name, emoji: kind.emoji }" />
      <div class="say">
        <p v-if="!result.count" class="big">전국 0곳, 내가 처음이에요</p>
        <p v-else class="big">이미 전국에 <b>{{ result.count.toLocaleString() }}곳</b> 있어요</p>
        <p v-if="result.similar.length" class="muted">비슷한 간판 · {{ result.similar.join(', ') }}</p>
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
  gap: 10px;
}

/* 시스템 설정처럼 묶인 입력 줄 */
.group {
  display: grid;
}

.line {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 42px;
  padding: 6px 12px;
}

.line + .line {
  border-top: 0.5px solid var(--sep);
}

.line span {
  flex: none;
  width: 64px;
  font-weight: 500;
}

.line select,
.line input {
  flex: 1;
  min-width: 0;
}

.act {
  display: flex;
  align-items: center;
  gap: 10px;
  justify-content: flex-end;
}

.act .m-err {
  flex: 1;
}

.hint {
  margin: 0;
  font-size: 12px;
  line-height: 1.6;
}

.result {
  display: flex;
  gap: 16px;
  align-items: flex-end;
  padding: 16px;
  border-radius: 12px;
  background: linear-gradient(#a9d3f7, #e6f2fc);
  box-shadow: inset 0 0 0 0.5px var(--sep);
}

html.dark .result {
  background: linear-gradient(var(--window-2), var(--panel));
}

.say p {
  margin: 4px 0 0;
  font-size: 12px;
}

.say .big {
  font-size: 16px;
  font-weight: 600;
}

.say .big b {
  color: var(--accent);
}
</style>
