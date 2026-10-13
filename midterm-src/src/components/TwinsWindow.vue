<script setup>
import { computed, ref } from 'vue'
import { load } from '../data.js'
import { pastelOf } from '../shops.js'
import { sfx } from '../sound.js'

const emit = defineEmits(['open'])

const data = ref(null)
const tab = ref('top')
const lonelyAt = ref(0)
const meta = ref(null)

load('meta.json').then((v) => (meta.value = v))

load('twins.json').then((v) => {
  data.value = v
  lonelyAt.value = Math.floor(Math.random() * v.lonely.length)
})

const max = computed(() => data.value?.top[0][1] || 1)
const lonely = computed(() => data.value?.lonely[lonelyAt.value])

function another() {
  lonelyAt.value = (lonelyAt.value + 1 + Math.floor(Math.random() * 50)) % data.value.lonely.length
  sfx.bell()
}
</script>

<template>
  <div v-if="data">
    <menu role="tablist">
      <li role="tab" :aria-selected="tab === 'top'"><a href="#" @click.prevent="tab = 'top'">전국 쌍둥이</a></li>
      <li role="tab" :aria-selected="tab === 'building'"><a href="#" @click.prevent="tab = 'building'">한 건물 쌍둥이</a></li>
      <li role="tab" :aria-selected="tab === 'lonely'"><a href="#" @click.prevent="tab = 'lonely'">세상에 하나뿐</a></li>
    </menu>
    <div class="window" role="tabpanel">
      <div class="window-body">
        <template v-if="tab === 'top'">
          <p class="muted">같은 이름 간판이 가장 많은 곳. <span class="chain">체인</span>은 회색. 누르면 지도에 떠요.</p>
          <div class="sunken-panel list">
            <ol class="bars">
              <li v-for="([name, count, chain], i) in data.top" :key="name" class="pick" @click="emit('open', 'map', { q: name })">
                <span class="rank">{{ i + 1 }}</span>
                <span class="label">
                  <span class="fill" :style="{ width: `${(count / max) * 100}%`, background: chain ? '#ddd' : pastelOf(name) }"></span>
                  <span class="name">{{ name }}</span>
                </span>
                <span class="count">{{ count.toLocaleString() }}</span>
              </li>
            </ol>
          </div>
        </template>

        <template v-else-if="tab === 'building'">
          <p class="muted">주소 하나에 같은 간판이 몇 개나 붙어 있을까.</p>
          <div class="sunken-panel list">
            <table class="t">
              <tbody>
                <tr v-for="[name, addr, count] in data.clusters" :key="name + addr">
                  <td>
                    <b>{{ name }}</b><br /><span class="muted">{{ addr }}</span>
                  </td>
                  <td class="n">×{{ count }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </template>

        <template v-else>
          <p class="muted">전국에 딱 한 곳뿐인 이름. <template v-if="meta">이런 이름이 {{ meta.uniqueNames.toLocaleString() }}개 있어요.</template></p>
          <div class="one">
            <div class="sign" :style="{ background: pastelOf(lonely[0]) }">{{ lonely[0] }}</div>
            <p>{{ lonely[2] }} · {{ lonely[1] }}</p>
          </div>
          <button class="wide" @click="another">다른 간판 보기 🔔</button>
        </template>
      </div>
    </div>
  </div>
  <p v-else>불러오는 중…</p>
</template>

<style scoped>
.list {
  max-height: 52dvh;
  overflow: auto;
}

.pick {
  cursor: pointer;
}

.pick:hover .name {
  text-decoration: underline;
}

.chain {
  background: #ddd;
  padding: 0 4px;
}

.t {
  width: 100%;
  border-collapse: collapse;
}

.t td {
  padding: 5px 6px;
  border-bottom: 1px dotted #bbb;
  vertical-align: top;
}

.t .n {
  text-align: right;
  font-size: 16px;
  white-space: nowrap;
}

.one {
  display: grid;
  place-items: center;
  padding: 20px 0 8px;
}

.one .sign {
  max-width: 100%;
  padding: 12px 18px;
  border: 3px solid var(--ink);
  box-shadow: 4px 4px 0 rgb(0 0 0 / 0.2);
  font-size: 20px;
  word-break: break-all;
  text-align: center;
}

.wide {
  width: 100%;
}
</style>
