<script setup>
import { computed, ref, watch } from 'vue'
import { load } from '../data.js'
import { SHOP_STYLE } from '../shops.js'
import { sfx } from '../sound.js'

const props = defineProps({ start: String })
const street = ref([])
const key = ref(props.start || 'flower')
const mode = ref('indie')

load('street.json').then((v) => (street.value = v))
watch(() => props.start, (v) => v && (key.value = v))

const shop = computed(() => street.value.find((s) => s.key === key.value))
const list = computed(() => (shop.value ? shop.value[mode.value === 'indie' ? 'top' : 'chains'] : []))
const max = computed(() => list.value[0]?.[1] || 1)

function pick(k) {
  key.value = k
  sfx.click()
}
</script>

<template>
  <div v-if="shop">
    <menu role="tablist" class="tabs">
      <li v-for="s in street" :key="s.key" role="tab" :aria-selected="s.key === key">
        <a href="#" @click.prevent="pick(s.key)">{{ s.emoji }} {{ s.label }}</a>
      </li>
    </menu>
    <div class="window" role="tabpanel">
      <div class="window-body">
        <div class="head">
          <span class="big-num">{{ shop.emoji }} {{ shop.label }}</span>
          <span class="muted">전국 {{ shop.total.toLocaleString() }}곳</span>
        </div>
        <p class="fact">
          {{ shop.label }} {{ shop.wordShare }}%의 간판에 <b>‘{{ shop.word }}’</b>가 들어가 있어요.
        </p>
        <div class="row modes">
          <button :class="{ on: mode === 'indie' }" @click="mode = 'indie'">🏠 동네 가게</button>
          <button :class="{ on: mode === 'chain' }" @click="mode = 'chain'">🏬 프랜차이즈</button>
          <span class="grow"></span>
          <span class="muted">체인 비율 {{ shop.chainShare }}%</span>
        </div>
        <div class="share" :title="`프랜차이즈 ${shop.chainShare}%`">
          <span :style="{ width: `${shop.chainShare}%` }"></span>
        </div>
        <div class="sunken-panel">
          <p v-if="!list.length" class="empty muted">이 업종은 프랜차이즈가 거의 없어요. 전부 동네 가게!</p>
          <ol class="bars">
            <li v-for="([name, count], i) in list" :key="name">
              <span class="rank">{{ i + 1 }}</span>
              <span class="label">
                <span
                  class="fill"
                  :style="{ width: `${(count / max) * 100}%`, background: mode === 'indie' ? SHOP_STYLE[shop.key].wall : '#dcdce6' }"
                ></span>
                <span class="name">{{ name }}</span>
              </span>
              <span class="count">{{ count }}곳</span>
            </li>
          </ol>
        </div>
        <p class="muted note">
          {{ mode === 'indie' ? '프랜차이즈는 빼고 셌어요.' : '지점명이 붙은 간판이 많거나 알려진 체인만 모았어요.' }}
        </p>
      </div>
    </div>
  </div>
  <p v-else>불러오는 중…</p>
</template>

<style scoped>
.tabs {
  display: flex;
  overflow-x: auto;
  scrollbar-width: none;
}

.tabs li {
  flex: none;
}

.head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  margin-bottom: 4px;
}

.fact {
  margin: 4px 0 8px;
  padding: 6px 8px;
  background: #fff6c9;
  border: 1px dashed #c9a400;
}

.note {
  margin: 6px 0 0;
}

.modes {
  margin-bottom: 4px;
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

.share {
  height: 10px;
  margin-bottom: 6px;
  background: var(--green);
  border: 2px solid var(--ink);
}

.share span {
  display: block;
  height: 100%;
  background: repeating-linear-gradient(45deg, #9a9ab0 0 3px, #c8c8d8 3px 6px);
  border-right: 2px solid var(--ink);
}

.empty {
  margin: 0;
  padding: 16px 8px;
  text-align: center;
}
</style>
