<script setup>
// 손으로 그린 가게 한 칸. 빈 간판 자리에 이름을 손글씨로 얹는다
const props = defineProps({ shop: Object, small: Boolean, lit: Boolean })
const FRONT = new URL('../assets/shop-front.webp', import.meta.url).href
</script>

<template>
  <div class="shop" :class="{ small, lit }">
    <img class="front" :src="FRONT" alt="" draggable="false" />
    <div class="sign hand">
      <span>{{ props.shop.label }}</span>
    </div>
    <span v-if="props.shop.emoji" class="emo" aria-hidden="true">{{ props.shop.emoji }}</span>
  </div>
</template>

<style scoped>
.shop {
  --w: 200px;
  position: relative;
  width: var(--w);
  flex: none;
}

.front {
  display: block;
  width: 100%;
  height: auto;
}

/* 그림 속 빈 간판 칸 (shop-front.webp 기준 비율) */
.sign {
  position: absolute;
  left: 12.7%;
  top: 4.1%;
  width: 71.8%;
  height: 18.6%;
  display: grid;
  place-items: center;
  padding: 0 4%;
  font-size: calc(var(--w) * 0.11);
  line-height: 1;
  white-space: nowrap;
  overflow: hidden;
}

.sign span {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
}

.lit .sign {
  background: linear-gradient(100deg, transparent 2%, var(--hl) 4% 95%, transparent 97%);
}

.emo {
  position: absolute;
  left: 34%;
  top: 58%;
  font-size: calc(var(--w) * 0.11);
  filter: grayscale(1) contrast(1.4);
  opacity: 0.8;
}

.small {
  --w: 104px;
}
</style>
