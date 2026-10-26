<script setup>
// 간판도감.kr 의 사진 카드. 홈은 세로 카드(tall), 안쪽 페이지 머리말은 가로 띠(wide), 이야기 묶음은 작은 카드(mini)
defineProps({
  img: { type: String, required: true },
  title: { type: String, default: '' },
  sub: { type: String, default: '' },
  kicker: { type: String, default: '' },
  size: { type: String, default: 'wide' },
  busy: { type: Boolean, default: false },
  glow: { type: Boolean, default: true },
})
</script>

<template>
  <div class="cover-wrap" :class="size">
    <i v-if="glow" class="cover-glow"></i>
    <div class="cover" :style="{ backgroundImage: `url(${img})` }">
      <span v-if="kicker" class="kicker">{{ kicker }}</span>
      <h1 class="cover-t">{{ title }}</h1>
      <p class="cover-s"><i v-if="busy" class="spin"></i>{{ sub }}</p>
      <div v-if="$slots.default" class="cover-foot"><slot /></div>
    </div>
  </div>
</template>

<style scoped>
.cover-wrap {
  position: relative;
  width: 100%;
}

.cover-glow {
  position: absolute;
  inset: 45% -12% -26%;
  border-radius: 50%;
  background: radial-gradient(closest-side, rgb(196 182 120 / 0.34), transparent);
  filter: blur(22px);
  pointer-events: none;
}

.cover {
  position: relative;
  display: grid;
  grid-template-rows: auto auto auto 1fr auto;
  align-content: start;
  overflow: hidden;
  border-radius: 34px;
  background: center / cover no-repeat;
  color: #fff;
  text-align: center;
  box-shadow: 0 30px 60px -30px rgb(0 0 0 / 0.6);
}

/* 사진 아래쪽을 흐리게 덮어 버튼·글자가 읽히게 한다 */
.cover::after {
  content: '';
  position: absolute;
  inset: 50% 0 0;
  background: linear-gradient(transparent, rgb(40 32 20 / 0.55));
  backdrop-filter: blur(6px);
  mask: linear-gradient(transparent, #000 45%);
  pointer-events: none;
}

.cover::before {
  content: '';
  position: absolute;
  inset: 0 0 60%;
  background: linear-gradient(rgb(0 0 0 / 0.22), transparent);
  pointer-events: none;
}

.kicker,
.cover-t,
.cover-s,
.cover-foot {
  position: relative;
  z-index: 1;
}

.kicker {
  justify-self: center;
  display: inline-flex;
  align-items: center;
  height: 24px;
  margin-bottom: 10px;
  padding: 0 11px;
  border-radius: 999px;
  background: rgb(255 255 255 / 0.22);
  backdrop-filter: blur(8px);
  font-size: 11.5px;
  font-weight: 600;
}

.cover-t {
  margin: 0;
  font-size: 34px;
  font-weight: 600;
  letter-spacing: -0.03em;
  line-height: 1.2;
  word-break: keep-all;
  text-shadow: 0 1px 14px rgb(0 0 0 / 0.25);
}

.cover-s {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  margin: 6px 0 0;
  font-size: 14px;
  text-shadow: 0 1px 8px rgb(0 0 0 / 0.3);
}

.cover-foot {
  grid-row: 5;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.tall .cover {
  width: 300px;
  aspect-ratio: 3 / 4;
  margin: 0 auto;
  padding: 26px 18px 18px;
}

.wide .cover {
  min-height: 230px;
  padding: 34px 28px 20px;
}

.wide .cover-t {
  font-size: 44px;
}

/* 작은 카드는 글자를 아래로 내리고 사진 아래쪽을 어둡게 깐다 */
.mini .cover {
  grid-template-rows: auto 1fr auto auto;
  aspect-ratio: 4 / 5;
  padding: 14px 14px 16px;
  border-radius: 26px;
  text-align: left;
  box-shadow: 0 20px 40px -26px rgb(0 0 0 / 0.6);
}

.mini .cover::after {
  inset: 35% 0 0;
  background: linear-gradient(transparent, rgb(12 10 8 / 0.78) 70%);
  backdrop-filter: blur(4px);
  mask: linear-gradient(transparent, #000 35%);
}

.mini .kicker {
  justify-self: start;
  margin-bottom: 0;
}

.mini .cover-t {
  grid-row: 3;
}

.mini .cover-s {
  grid-row: 4;
}

.mini .cover-t {
  font-size: 17px;
  font-weight: 700;
  line-height: 1.35;
}

.mini .cover-s {
  justify-content: flex-start;
  font-size: 12px;
  opacity: 0.9;
}

.mini .cover-glow {
  display: none;
}

.spin {
  width: 13px;
  height: 13px;
  border: 2px solid rgb(255 255 255 / 0.35);
  border-top-color: #fff;
  border-radius: 50%;
  animation: cover-spin 0.8s linear infinite;
}

@keyframes cover-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
