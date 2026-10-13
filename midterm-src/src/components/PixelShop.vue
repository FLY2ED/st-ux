<script setup>
import { computed } from 'vue'
import { SHOP_STYLE, shopImg } from '../shops.js'

const props = defineProps({ shop: Object, small: Boolean })
const style = computed(() => SHOP_STYLE[props.shop.key] || { wall: '#eee', sign: '#888' })
</script>

<template>
  <div class="shop" :class="{ small }" :style="{ '--sign': style.sign }">
    <div class="sign">{{ shop.label }}</div>
    <div class="posts"></div>
    <img class="front pixel" :src="shopImg(shop.key)" alt="" draggable="false" />
  </div>
</template>

<style scoped>
.shop {
  --w: 120px;
  width: var(--w);
  flex: none;
  display: flex;
  flex-direction: column;
  align-items: center;
}

.sign {
  max-width: 88%;
  padding: 3px 8px;
  color: #fff;
  font-size: 12px;
  font-weight: 700;
  line-height: 1.2;
  text-align: center;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  background: var(--sign);
  border: 2px solid var(--ink);
  border-radius: 3px;
  box-shadow: 2px 2px 0 var(--ink);
  text-shadow: 1px 1px 0 rgb(0 0 0 / 0.35);
}

/* 간판을 지붕에 세우는 두 기둥 */
.posts {
  width: 46%;
  height: 5px;
  border-inline: 2px solid var(--ink);
}

.front {
  display: block;
  width: 100%;
  height: auto;
  margin-top: -1px;
}

.small {
  --w: 92px;
}

.small .sign {
  padding: 2px 6px;
  font-size: 11px;
}

.small .posts {
  height: 4px;
}
</style>
