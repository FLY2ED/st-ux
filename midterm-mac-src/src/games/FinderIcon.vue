<script setup>
import { shopImg, SHOP_STYLE } from '../shops.js'

// Finder 항목 아이콘. 바탕화면(Desktop.jsx)과 같은 폴더·문서 모양을 Vue 로 옮겼다
defineProps({ item: { type: Object, required: true } })
</script>

<template>
  <span class="fi">
    <svg v-if="item.type === 'folder'" viewBox="0 0 64 64" aria-hidden="true">
      <path d="M5 15a4 4 0 0 1 4-4h14.5a3 3 0 0 1 2.2 1l3.3 3.6h26a4 4 0 0 1 4 4V50a4 4 0 0 1-4 4H9a4 4 0 0 1-4-4z" fill="#3b97ea" />
      <rect x="5" y="20" width="54" height="34" rx="4" fill="#6dbdfb" />
      <rect x="5" y="20" width="54" height="34" rx="4" fill="url(#fi-front)" />
      <path d="M5 21.5h54" stroke="#fff" stroke-opacity=".45" />
      <defs>
        <linearGradient id="fi-front" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#8fd0ff" />
          <stop offset="1" stop-color="#52adf7" />
        </linearGradient>
      </defs>
      <g fill="none" stroke="#2f86d6" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" opacity=".8">
        <template v-if="item.glyph === 'photos'">
          <rect x="23" y="29" width="18" height="15" rx="2.5" />
          <path d="M24.5 42l5.5-6 4 4 2.5-2.5 3.5 4" />
        </template>
        <template v-else-if="item.glyph === 'mine'">
          <path d="M22 33h20l-1.5-5h-17z" />
          <path d="M24 33v11h16V33M29.5 44v-6h5v6" />
        </template>
        <template v-else-if="item.glyph === 'apps'">
          <path d="M32 27l-8 15M32 27l8 15M26.5 37.5h11" />
        </template>
        <template v-else-if="item.glyph === 'desktop'">
          <rect x="22" y="28" width="20" height="13" rx="1.5" />
          <path d="M28 45h8M32 41v4" />
        </template>
      </g>
    </svg>

    <svg v-else-if="item.type === 'hd'" viewBox="0 0 64 64" aria-hidden="true">
      <rect x="6" y="22" width="52" height="22" rx="5" fill="#d6d6db" />
      <rect x="6" y="22" width="52" height="11" rx="5" fill="#ececf0" />
      <rect x="6" y="22" width="52" height="22" rx="5" fill="none" stroke="#000" stroke-opacity=".15" />
      <circle cx="49" cy="38" r="1.8" fill="#34c759" />
    </svg>

    <span v-else-if="item.type === 'image'" class="fi-photo" :style="{ background: SHOP_STYLE[item.key].wall }">
      <img :src="shopImg(item.key)" alt="" draggable="false" />
    </span>

    <span v-else-if="item.type === 'shop'" class="fi-photo" :style="{ background: SHOP_STYLE[item.key]?.wall }">
      <img :src="shopImg(item.key)" alt="" draggable="false" />
      <em :style="{ background: SHOP_STYLE[item.key]?.sign }">{{ item.name }}</em>
    </span>

    <img v-else-if="item.type === 'app'" class="fi-app" :src="item.img" alt="" draggable="false" />

    <span v-else-if="item.type === 'alias'" class="fi-alias">
      <img class="fi-app" :src="item.img" alt="" draggable="false" />
      <svg viewBox="0 0 16 16">
        <rect x=".5" y=".5" width="15" height="15" rx="3" fill="#fff" stroke="#000" stroke-opacity=".25" />
        <path d="M4.5 11.5c0-4 2-6 6-6M8 3l3 2.5L8 8" fill="none" stroke="#1d1d1f" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
    </span>

    <span v-else-if="item.type === 'png'" class="fi-png" :style="{ background: item.tint }">{{ item.sample }}</span>

    <svg v-else viewBox="0 0 64 64" aria-hidden="true">
      <path d="M15 4h24l13 13v40a3 3 0 0 1-3 3H15a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3z" fill="#fff" stroke="#000" stroke-opacity=".16" />
      <path d="M39 4v10a3 3 0 0 0 3 3h10" fill="#e9e9ee" stroke="#000" stroke-opacity=".16" />
      <g v-if="item.type === 'csv'" fill="none" stroke="#34c759" stroke-width="1.2">
        <rect x="18" y="16" width="28" height="26" rx="1.5" />
        <path d="M18 22.5h28M18 29h28M18 35.5h28M27 16v26" />
      </g>
      <image v-else-if="item.type === 'webloc'" :href="item.img" x="16" y="20" width="32" height="32" />
      <g v-else stroke="#c7c7cc" stroke-width="1.6" stroke-linecap="round">
        <path v-for="(y, i) in [16, 21, 26, 31, 36, 41]" :key="y" :d="`M19 ${y}h${i % 3 === 2 ? 16 : 26}`" />
      </g>
      <text v-if="item.badge" x="32" y="55" text-anchor="middle" font-size="7.5" font-weight="700" fill="#8e8e93" letter-spacing=".04em">{{ item.badge }}</text>
    </svg>
  </span>
</template>

<style scoped>
.fi {
  display: grid;
  /* 칸을 아이콘 크기로 못 박아야 안쪽 % 크기가 아이콘 기준이 된다 */
  grid-template: 100% / 100%;
  place-items: center;
  width: var(--fi, 64px);
  height: var(--fi, 64px);
  flex: none;
}

.fi > svg,
.fi-app {
  width: 100%;
  height: 100%;
}

.fi-photo {
  position: relative;
  display: grid;
  place-items: center;
  width: 88%;
  height: 88%;
  border-radius: calc(var(--fi, 64px) * 0.08);
  overflow: hidden;
  box-shadow: 0 0 0 0.5px rgba(0, 0, 0, 0.18), 0 1px 3px rgba(0, 0, 0, 0.18);
}

.fi-photo img {
  image-rendering: pixelated;
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.fi-photo em {
  position: absolute;
  left: 50%;
  top: 9%;
  transform: translateX(-50%);
  max-width: 88%;
  padding: 0 4px;
  border-radius: 3px;
  color: #fff;
  font-size: max(7px, calc(var(--fi, 64px) * 0.12));
  font-style: normal;
  font-weight: 800;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.fi-alias {
  position: relative;
  width: 100%;
  height: 100%;
}

.fi-alias svg {
  position: absolute;
  left: 4%;
  bottom: 4%;
  width: 26%;
  height: 26%;
}

.fi-png {
  display: grid;
  place-items: center;
  width: 80%;
  height: 62%;
  padding: 2px;
  border: 2px solid #fff;
  border-radius: 3px;
  box-shadow: 0 0 0 0.5px rgba(0, 0, 0, 0.2), 0 1px 3px rgba(0, 0, 0, 0.2);
  color: #1d1d1f;
  font-size: max(6px, calc(var(--fi, 64px) * 0.13));
  font-weight: 900;
  line-height: 1.1;
  text-align: center;
  word-break: keep-all;
  overflow: hidden;
}
</style>
