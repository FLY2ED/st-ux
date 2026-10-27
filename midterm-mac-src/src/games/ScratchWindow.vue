<script setup>
// 간판 청소: 그을음·새똥·전단지로 꺼진 간판을 문질러 닦아 불을 켠다.
// 혼자 열 때나 이야기 속 부탁(embed)으로 열 때나 같은 장면(SignClean)을 쓰고, 부탁이면 사장님이 옆에 선다
import SignClean from './stage/SignClean.vue'
import './pixel.css'

const props = defineProps({
  embed: Boolean,
  ownerName: { type: String, default: '' },
  ownerArt: { type: String, default: '' },
  shopName: { type: String, default: '' },
  shopCat: { type: String, default: '' },
})
</script>

<template>
  <SignClean :embed="props.embed" :owner-name="props.ownerName" :owner-art="props.ownerArt" :shop-name="props.shopName" :shop-cat="props.shopCat" />
</template>
