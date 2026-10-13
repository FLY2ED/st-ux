<script setup>
import { computed, ref } from 'vue'
import { load } from '../data.js'
import { pastelOf } from '../shops.js'

// 부동산·사무소 이름 조각은 순위를 덮어서 뺀다
const NOISE = new Set(['사무', '무소', '중개', '개사', '공인', '인중', '사사'])
const fame = ref(null)
const meta = ref(null)

load('fame.json').then((v) => (fame.value = v))
load('meta.json').then((v) => (meta.value = v))

const words = computed(() => fame.value?.words.filter(([w]) => !NOISE.has(w)).sort((a, b) => b[1] - a[1]))
</script>

<template>
  <div v-if="fame && meta" class="fame">
    <fieldset>
      <legend>전국 간판</legend>
      <div class="kpis">
        <div><span class="big-num">{{ meta.total.toLocaleString() }}</span><span class="muted">간판</span></div>
        <div><span class="big-num">{{ meta.names.toLocaleString() }}</span><span class="muted">서로 다른 이름</span></div>
      </div>
    </fieldset>

    <fieldset>
      <legend>🏆 체인 아닌데 제일 많은 이름</legend>
      <ol class="podium">
        <li v-for="([name, count], i) in fame.indie.slice(0, 10)" :key="name">
          <span class="medal">{{ ['🥇', '🥈', '🥉'][i] || i + 1 }}</span>
          <span class="tag" :style="{ background: pastelOf(name) }">{{ name }}</span>
          <span class="muted">{{ count }}곳</span>
        </li>
      </ol>
    </fieldset>

    <fieldset>
      <legend>🏬 프랜차이즈 TOP</legend>
      <ol class="podium">
        <li v-for="([name, count], i) in fame.chains.slice(0, 10)" :key="name">
          <span class="medal">{{ ['🥇', '🥈', '🥉'][i] || i + 1 }}</span>
          <span class="tag chain">{{ name }}</span>
          <span class="muted">{{ count.toLocaleString() }}곳</span>
        </li>
      </ol>
    </fieldset>

    <fieldset>
      <legend>🔤 간판에 제일 많이 들어간 두 글자</legend>
      <div class="chips">
        <span v-for="[w, c] in words" :key="w" class="chip">{{ w }} <small class="muted">{{ c.toLocaleString() }}</small></span>
      </div>
    </fieldset>

    <fieldset>
      <legend>☝️ 한 글자 간판</legend>
      <div class="chips">
        <span v-for="[w, c] in fame.oneChar" :key="w" class="chip one" :style="{ background: pastelOf(w) }">{{ w }}</span>
      </div>
      <p class="muted">‘수’ 간판만 {{ fame.oneChar[0][1] }}곳.</p>
    </fieldset>

    <fieldset>
      <legend>📏 제일 긴 간판</legend>
      <p class="longest">{{ fame.longest[0] }}</p>
      <p class="muted">{{ fame.longest[0].length }}글자</p>
    </fieldset>
  </div>
  <p v-else>불러오는 중…</p>
</template>

<style scoped>
.fame {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.kpis {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.kpis div {
  display: flex;
  flex-direction: column;
}

.podium {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 4px;
}

.podium li {
  display: grid;
  grid-template-columns: 26px 1fr auto;
  align-items: center;
  gap: 6px;
}

.tag.chain {
  background: #dcdce6;
}

.medal {
  text-align: center;
}

.tag {
  justify-self: start;
  padding: 2px 8px;
  border: 2px solid var(--ink);
}

.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.chip {
  padding: 2px 6px;
  border: 1px solid var(--ink);
  background: #fff;
}

.chip.one {
  font-size: 18px;
  width: 34px;
  text-align: center;
  border-width: 2px;
}

.longest {
  margin: 4px 0;
  font-size: 14px;
  word-break: break-all;
  background: #fff6c9;
  padding: 6px;
  border: 2px solid var(--ink);
}

p {
  margin: 4px 0 0;
}
</style>
