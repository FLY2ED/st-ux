<script setup>
import { computed, ref, watch } from 'vue'
import { search, nameCount } from '../data.js'
import { fmt, josa, shortRegion, swatchOf, useCount } from '../util.js'

const props = defineProps({ query: { type: String, default: '' } })

const result = ref(null)
const same = ref(null)
const busy = ref(false)
const error = ref('')
let seq = 0

watch(
  () => props.query,
  async (q) => {
    const word = q.trim()
    if (!word) return
    const id = ++seq
    busy.value = true
    error.value = ''
    try {
      const [found, exact] = await Promise.all([search(word), nameCount(word)])
      if (id !== seq) return
      if (!found) {
        error.value = '한글 두 글자 이상으로 찾아 주세요. 영어 상호(CU, GS25)는 아래 체인 목록에 있습니다.'
        result.value = null
      } else {
        result.value = found
        same.value = exact
      }
    } catch {
      if (id === seq) error.value = '데이터를 불러오지 못했습니다. 잠시 뒤에 다시 찾아 주세요.'
    }
    if (id === seq) busy.value = false
  },
  { immediate: true },
)

const total = computed(() => result.value?.count || 0)
const shownTotal = useCount(total)
const shownSame = useCount(computed(() => same.value || 0))

// 단어가 그대로 들어간 간판을 앞에, 글자 조각만 겹친 간판은 뒤에
const signs = computed(() => {
  const rows = result.value?.rows || []
  return [...rows].sort((a, b) => b.exact - a.exact).slice(0, 12)
})

function catLabel(cat = '') {
  return cat.replace(/ 소매업$| 서비스업$|업$/, '').split('/')[0]
}
</script>

<template>
  <section id="find" class="find wrap" aria-live="polite">
    <p v-if="error" class="error">{{ error }}</p>
    <div v-else-if="result" class="board" :class="{ busy }">
      <div class="tile count">
        <p class="label">‘{{ result.word }}’{{ josa(result.word, '이', '가') }} 들어간 간판</p>
        <p class="num">{{ result.exactCount ? '' : '최대 ' }}{{ fmt(shownTotal) }}<span>곳</span></p>
        <p class="note">
          {{
            result.exactCount
              ? '두 글자 단어는 전국 상호를 하나하나 센 정확한 개수입니다.'
              : '세 글자 이상은 가장 드문 두 글자 조각의 개수라, 실제는 이보다 적거나 같습니다.'
          }}
        </p>
      </div>
      <div class="tile same">
        <p class="label">이름이 똑같은 간판</p>
        <p class="num">
          <template v-if="same >= 2">{{ fmt(shownSame) }}<span>곳</span></template>
          <template v-else>1곳 이하</template>
        </p>
        <p class="note">
          {{ same >= 2 ? `‘${result.word}’ 그대로 붙인 가게가 전국에 이만큼 있습니다.` : `‘${result.word}’ 그대로인 간판은 전국에 한 곳뿐이거나 없습니다.` }}
        </p>
      </div>
      <ul class="signs">
        <li
          v-for="(s, i) in signs"
          :key="`${result.word}-${s.name}-${s.region}-${i}`"
          class="sign"
          :style="{ '--bg-c': swatchOf(s.name).bg, '--fg-c': swatchOf(s.name).fg, animationDelay: `${i * 45}ms` }"
        >
          <strong>{{ s.name }}</strong>
          <span>{{ catLabel(s.cat) }} · {{ shortRegion(s.region) }}<template v-if="s.floor"> · {{ s.floor }}층</template></span>
        </li>
      </ul>
    </div>
  </section>
</template>

<style scoped>
.find {
  padding-top: 8px;
}

.error {
  padding: var(--pad);
  border-radius: var(--tile);
  background: var(--surface);
  font-size: var(--step-lead);
}

.board {
  display: grid;
  grid-template-columns: repeat(12, minmax(0, 1fr));
  gap: var(--gap);
  transition: opacity 0.3s var(--out);
}

.board.busy {
  opacity: 0.5;
}

.tile {
  display: flex;
  flex-direction: column;
  min-height: 340px;
  padding: var(--pad);
  border-radius: var(--tile);
}

.count {
  grid-column: span 7;
  background: var(--ink);
  color: #fff;
}

.same {
  grid-column: span 5;
  background: var(--yellow);
}

.label {
  font-size: var(--step-lead);
  font-weight: 700;
  letter-spacing: -0.02em;
}

.num {
  margin-top: auto;
  font-size: var(--step-head);
  font-weight: 800;
  letter-spacing: -0.045em;
  line-height: 1;
  font-variant-numeric: tabular-nums;
}

.num span {
  margin-left: 0.08em;
  font-size: 0.5em;
  letter-spacing: -0.02em;
}

.note {
  max-width: 34em;
  margin-top: 16px;
  font-size: var(--step-body);
  opacity: 0.8;
}

.signs {
  grid-column: 1 / -1;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 270px), 1fr));
  gap: var(--gap);
  margin: 0;
  padding: 0;
  list-style: none;
}

.sign {
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  gap: 18px;
  min-height: 150px;
  padding: 20px var(--pad);
  border-radius: var(--tile);
  background: var(--bg-c);
  color: var(--fg-c);
  animation: drop 0.6s var(--out) both;
}

.sign strong {
  font-size: var(--step-lead);
  font-weight: 800;
  letter-spacing: -0.03em;
  line-height: 1.15;
  overflow-wrap: anywhere;
}

.sign span {
  font-size: var(--step-body);
  font-weight: 600;
  opacity: 0.85;
}

@keyframes drop {
  from {
    opacity: 0;
    transform: translateY(-14px) rotate(-1.5deg);
  }
}

@media (max-width: 860px) {
  .count,
  .same {
    grid-column: 1 / -1;
    min-height: 260px;
  }
}
</style>
