<script setup>
import { onMounted, ref, shallowRef, watch } from 'vue'
import KoreaMap from './KoreaMap.vue'
import { search } from '../data.js'

const props = defineProps({ q: String })
const SUGGEST = ['행복', '사랑', '치킨', '꽃집', '바다', '엄마']
const query = ref('')
const result = ref(null)
const lit = shallowRef([])
const error = ref('')

async function submit(word = query.value) {
  query.value = word
  error.value = ''
  if (!/[가-힣]{2}/.test(word.trim())) {
    error.value = '한글 두 글자 이상 넣어 주세요'
    return
  }
  try {
    result.value = await search(word)
  } catch {
    error.value = '데이터를 못 불러왔어요'
    return
  }
  const rows = result.value.rows.filter((r) => r.exact)
  lit.value = rows.length ? rows : result.value.rows
}

onMounted(() => props.q && submit(props.q))
watch(() => props.q, (q) => q && submit(q))
</script>

<template>
  <div class="map">
    <form class="row" @submit.prevent="submit()">
      <input v-model="query" class="grow" type="text" placeholder="간판에 들어갈 말 (예: 행복)" maxlength="10" />
      <button type="submit">찾기</button>
    </form>
    <div class="chips">
      <button v-for="s in SUGGEST" :key="s" type="button" @click="submit(s)">{{ s }}</button>
    </div>
    <p v-if="error" class="err">{{ error }}</p>
    <KoreaMap :rows="lit" />
    <p v-if="result" class="muted">
      ‘{{ result.word }}’ 간판 {{ result.exactCount ? '' : '최대 ' }}{{ result.count.toLocaleString() }}곳 중
      {{ result.rows.filter((r) => r.exact).length || result.rows.length }}곳에 불을 켰어요. (시군구 단위 위치)
    </p>
    <p v-else class="muted">점 하나가 약 2km 칸이에요. 색은 그 칸에서 제일 많은 업종.</p>
  </div>
</template>

<style scoped>
.map {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.chips button {
  min-width: 0;
  padding: 0 8px;
}

.err {
  margin: 0;
  color: var(--red);
}

p {
  margin: 0;
}
</style>
