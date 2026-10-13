<script setup>
import { computed } from 'vue'
import { SHOP_STYLE } from '../shops.js'

const props = defineProps({ shop: Object, small: Boolean })
const style = computed(() => SHOP_STYLE[props.shop.key] || { wall: '#eee', sign: '#888' })
</script>

<template>
  <div class="shop" :class="{ small }" :style="{ '--wall': style.wall, '--sign': style.sign }">
    <div class="awning"></div>
    <div class="sign">{{ shop.label }}</div>
    <div class="front">
      <div class="win">{{ shop.emoji }}</div>
      <div class="door"></div>
    </div>
  </div>
</template>

<style scoped>
.shop {
  width: 92px;
  flex: none;
  display: flex;
  flex-direction: column;
  border: 3px solid var(--ink);
  background: var(--wall);
  box-shadow: 4px 4px 0 rgb(0 0 0 / 0.18);
}

.awning {
  height: 14px;
  background: repeating-linear-gradient(90deg, var(--sign) 0 12px, #fff 12px 24px);
  border-bottom: 3px solid var(--ink);
}

.sign {
  margin: 6px 6px 0;
  padding: 3px 0;
  background: var(--sign);
  color: #fff;
  text-align: center;
  border: 2px solid var(--ink);
  font-size: 12px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  padding-inline: 2px;
}

.front {
  display: flex;
  gap: 6px;
  padding: 6px;
  align-items: flex-end;
}

.win {
  flex: 1;
  height: 34px;
  display: grid;
  place-items: center;
  font-size: 18px;
  background: #fffbe8;
  border: 2px solid var(--ink);
}

.door {
  width: 22px;
  height: 44px;
  background: var(--sign);
  border: 2px solid var(--ink);
  opacity: 0.85;
}

.small {
  width: 74px;
}

.small .win {
  height: 26px;
  font-size: 15px;
}

.small .door {
  width: 16px;
  height: 34px;
}
</style>
