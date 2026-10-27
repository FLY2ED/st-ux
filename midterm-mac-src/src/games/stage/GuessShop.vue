<script setup>
// 간판 어디게의 가게 한 채: 파스텔 간판판(모서리 나사·걸이)과 업종에 맞는 픽셀 가게 앞모습.
// 업종을 모르면 차양 달린 동네 가게를 그린다
import { computed } from 'vue'
import { pastelOf, shopImg, SHOP_STYLE } from '../../shops.js'

const props = defineProps({
  name: { type: String, default: '' },
  cat: { type: String, default: '' },
  width: { type: Number, default: 200 }, // 가게 앞모습 너비(px)
  bare: Boolean, // 간판판만
})

// 업종 소분류 → 거리 가게 그림. 위에서부터 먼저 맞는 것
const KIND = [
  ['book', /서점|독서실|문구|만화|학원|교육/],
  ['cafe', /카페|커피|아이스크림|빙수/],
  ['bread', /빵|도넛|제과/],
  ['pharm', /약국|의원|병원|한의|치과|의료|건강보조|안경/],
  ['ricecake', /떡|한과|반찬|건어물|곡물/],
  ['laundry', /세탁|빨래|수선/],
  ['karaoke', /노래방|PC방|게임|오락|당구|볼링|주점|생맥주/],
  ['hair', /미용|네일|피부 관리|화장품|마사지|이용/],
  ['chicken', /치킨|닭|버거|피자|족발/],
  ['flower', /꽃|화원|조경|채소|과일/],
  ['hardware', /철물|공구|자재|전기용품|정비|수리|타이어|부품|벽지/],
  ['snack', /분식|김밥|국수|한식|백반|중국집|국\/탕|냉면|전\/부침|음식|구이|회\/초밥|돈가스|면 요리|뷔페|요리/],
]

const key = computed(() => KIND.find(([, re]) => re.test(props.cat || ''))?.[0] || '')
const plate = computed(() => pastelOf(props.name || ' '))
const wall = computed(() => SHOP_STYLE[key.value]?.wall || '#efe4d6')
// 간판 글자가 길면 판 글씨를 줄인다
const fit = computed(() => {
  const n = [...(props.name || '')].length
  return n <= 5 ? 1 : n <= 8 ? 0.86 : 0.72
})
</script>

<template>
  <div class="gs" :style="{ '--w': `${width}px`, '--plate': plate, '--wall': wall, '--fit': fit }">
    <div class="gs-sign"><span>{{ name }}</span></div>
    <template v-if="!bare">
      <div class="gs-rods" aria-hidden="true"></div>
      <img v-if="key" class="gs-front" :src="shopImg(key)" alt="" draggable="false" />
      <div v-else class="gs-front gs-plain" aria-hidden="true">
        <i class="gs-awning"></i>
        <i class="gs-window"></i>
        <i class="gs-door"></i>
      </div>
    </template>
  </div>
</template>

<style scoped>
.gs {
  display: grid;
  justify-items: center;
  width: max-content;
  max-width: 100%;
  font-family: var(--game-font, 'Galmuri11 Game', 'Galmuri11', sans-serif);
}

/* 간판판: 진한 테두리 + 위 밝은 줄·아래 그늘 + 네 모서리 나사 */
.gs-sign {
  position: relative;
  z-index: 1;
  min-width: calc(var(--w) * 0.7);
  max-width: max(calc(var(--w) * 1.7), 100%);
  padding: calc(var(--w) * 0.05 + 4px) calc(var(--w) * 0.08 + 10px);
  color: #1d1d2b;
  background:
    linear-gradient(#fff8 0 0) top / 100% 3px no-repeat,
    linear-gradient(#0003 0 0) bottom / 100% 4px no-repeat,
    var(--plate);
  box-shadow:
    0 -3px 0 #1d1d2b,
    0 3px 0 #1d1d2b,
    -3px 0 0 #1d1d2b,
    3px 0 0 #1d1d2b,
    0 9px 0 rgb(0 0 0 / 0.35);
  font-size: calc(var(--w) * 0.15 * var(--fit));
  line-height: 1.2;
  text-align: center;
  word-break: keep-all;
  text-shadow: 2px 2px 0 rgb(255 255 255 / 0.45);
}

.gs-sign::before {
  content: '';
  position: absolute;
  inset: 5px;
  pointer-events: none;
  background:
    linear-gradient(#fff 0 0) 1px 1px / 2px 2px no-repeat,
    linear-gradient(#fff 0 0) calc(100% - 3px) 1px / 2px 2px no-repeat,
    linear-gradient(#fff 0 0) 1px calc(100% - 3px) / 2px 2px no-repeat,
    linear-gradient(#fff 0 0) calc(100% - 3px) calc(100% - 3px) / 2px 2px no-repeat,
    linear-gradient(#4a4458 0 0) 0 0 / 5px 5px no-repeat,
    linear-gradient(#4a4458 0 0) 100% 0 / 5px 5px no-repeat,
    linear-gradient(#4a4458 0 0) 0 100% / 5px 5px no-repeat,
    linear-gradient(#4a4458 0 0) 100% 100% / 5px 5px no-repeat;
}

.gs-sign span {
  position: relative;
  display: block;
}

/* 간판을 지붕에 세우는 두 걸이 */
.gs-rods {
  width: calc(var(--w) * 0.5);
  height: calc(var(--w) * 0.06 + 4px);
  margin-top: 3px;
  border-inline: 4px solid #1d1d2b;
  background: linear-gradient(90deg, #6b6f8a 0 4px, transparent 4px calc(100% - 4px), #6b6f8a calc(100% - 4px)) center / 100% 100% no-repeat;
  background-clip: content-box;
}

.gs-front {
  display: block;
  width: var(--w);
  height: calc(var(--w) * 150 / 176);
  image-rendering: pixelated;
  filter: drop-shadow(0 6px 0 rgb(0 0 0 / 0.35));
}

/* 업종을 모를 때: 줄무늬 차양 + 진열창 + 문 */
.gs-plain {
  position: relative;
  background: var(--wall);
  box-shadow: inset 0 0 0 3px #1d1d2b, inset 0 -10px 0 #b9ad9a;
}

.gs-plain i {
  position: absolute;
  display: block;
}

.gs-awning {
  inset: 0 -4% auto;
  height: 30%;
  background:
    radial-gradient(circle at 50% 0, transparent 58%, #1d1d2b 60% 72%, transparent 74%) bottom / 12.5% 22% repeat-x,
    repeating-linear-gradient(90deg, var(--plate) 0 12.5%, #fff1e8 12.5% 25%) top / 100% 80% no-repeat;
  box-shadow: 0 -3px 0 #1d1d2b;
}

.gs-window {
  top: 40%;
  left: 9%;
  width: 52%;
  height: 46%;
  background:
    linear-gradient(135deg, transparent 0 30%, rgb(255 255 255 / 0.35) 30% 38%, transparent 38% 52%, rgb(255 255 255 / 0.25) 52% 56%, transparent 56%),
    #7fb6dc;
  box-shadow: 0 0 0 3px #1d1d2b, inset 0 -6px 0 #5f93bd;
}

.gs-door {
  top: 40%;
  right: 9%;
  width: 22%;
  height: 55%;
  background:
    linear-gradient(#1d1d2b 0 0) 80% 55% / 3px 8px no-repeat,
    linear-gradient(#a7d3ec 0 0) 50% 20% / 70% 40% no-repeat,
    #8a5a3c;
  box-shadow: 0 0 0 3px #1d1d2b;
}
</style>
