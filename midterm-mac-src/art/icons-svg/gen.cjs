// 아이콘 SVG 생성: 한 아이콘 = 한 색조 세로 그라데이션 + 흰 기호, 미묘한 유리 하이라이트
const fs = require('fs')
const sharp = require(process.argv[2] + '/sharp.cjs')
const SVGDIR = process.argv[3], OUTDIR = process.argv[4]
const C = 1024, T = 690, O = (C - T) / 2 // 기존 파일과 같은 여백 비율(타일 ≈ 69%)
const k = T / 100

const ICONS = {
  street: { bg: ['#7d7bff', '#4b3fd6'], deep: '#3a2fb0', sym: (d) => `
    <rect x="16" y="40" width="30" height="44" rx="3" fill="${d.w}"/>
    <rect x="50" y="20" width="34" height="64" rx="3" fill="${d.w}"/>
    <rect x="20" y="46" width="22" height="8" rx="2" fill="${d.deep}" opacity=".55"/>
    <rect x="72" y="26" width="7" height="30" rx="2" fill="${d.deep}" opacity=".55"/>
    <g fill="${d.deep}" opacity=".3"><rect x="56" y="28" width="10" height="8" rx="1.5"/><rect x="56" y="42" width="10" height="8" rx="1.5"/><rect x="21" y="60" width="9" height="8" rx="1.5"/><rect x="33" y="60" width="9" height="8" rx="1.5"/></g>
    <rect x="57" y="66" width="12" height="18" rx="2" fill="${d.deep}" opacity=".45"/>
    <rect x="26" y="72" width="10" height="12" rx="2" fill="${d.deep}" opacity=".45"/>` },
  rain: { bg: ['#6fd0ff', '#1f8fe6'], deep: '#0d6cc0', sym: (d) => `
    <path d="M30 52 a14 14 0 0 1 2-27.8 a19 19 0 0 1 35.5 4.6 a12 12 0 0 1 3 23.2 z" fill="${d.w}"/>
    <g fill="${d.w}" opacity=".92">
      <rect x="27" y="61" width="14" height="10" rx="2.5" transform="rotate(-12 34 66)"/>
      <rect x="48" y="68" width="14" height="10" rx="2.5" transform="rotate(8 55 73)"/>
      <rect x="66" y="58" width="14" height="10" rx="2.5" transform="rotate(-6 73 63)"/>
    </g>` },
  dodge: { bg: ['#ffb340', '#ff7a00'], deep: '#d65a00', sym: (d) => `
    <path d="M18 50 h64 a32 30 0 0 1 -64 0 z" fill="${d.w}"/>
    <rect x="16" y="46" width="68" height="6" rx="3" fill="${d.w}"/>
    <rect x="53" y="12" width="5" height="40" rx="2.5" fill="${d.w}" transform="rotate(28 55 32)"/>
    <rect x="62" y="12" width="5" height="40" rx="2.5" fill="${d.w}" transform="rotate(34 64 32)"/>
    <path d="M30 40 q-4-6 0-12 M40 40 q-4-6 0-12" stroke="${d.w}" stroke-width="3.2" fill="none" stroke-linecap="round" opacity=".8"/>
    <path d="M30 62 a22 14 0 0 0 40 0" stroke="${d.deep}" stroke-width="3" fill="none" stroke-linecap="round" opacity=".35"/>` },
  scratch: { bg: ['#ffe066', '#f2b600'], deep: '#b98500', sym: (d) => `
    <path d="M14 30 h72 v12 a8 8 0 0 0 0 16 v12 h-72 v-12 a8 8 0 0 0 0-16 z" fill="${d.w}" transform="rotate(-8 50 50)"/>
    <g transform="rotate(-8 50 50)">
      <path d="M38 50 l3.5 -10 l3.5 10 l10.5 0 l-8.5 6 l3.2 10 l-8.7 -6.2 l-8.7 6.2 l3.2-10 l-8.5-6 z" fill="${d.deep}" opacity=".6" transform="translate(-4 -6) scale(1)"/>
      <rect x="60" y="38" width="18" height="5" rx="2.5" fill="${d.deep}" opacity=".35"/>
      <rect x="60" y="48" width="14" height="5" rx="2.5" fill="${d.deep}" opacity=".35"/>
      <rect x="60" y="58" width="16" height="5" rx="2.5" fill="${d.deep}" opacity=".35"/>
    </g>` },
  song: { bg: ['#d58bff', '#9b30e8'], deep: '#7417bf', sym: (d) => `
    <rect x="38" y="16" width="24" height="40" rx="12" fill="${d.w}"/>
    <g fill="${d.deep}" opacity=".3"><rect x="42" y="24" width="16" height="3" rx="1.5"/><rect x="42" y="31" width="16" height="3" rx="1.5"/><rect x="42" y="38" width="16" height="3" rx="1.5"/></g>
    <path d="M28 46 a22 22 0 0 0 44 0" stroke="${d.w}" stroke-width="5" fill="none" stroke-linecap="round"/>
    <rect x="47.5" y="67" width="5" height="12" rx="2" fill="${d.w}"/>
    <rect x="36" y="78" width="28" height="5.5" rx="2.75" fill="${d.w}"/>` },
  booth: { bg: ['#ff6b62', '#e3261f'], deep: '#b8150f', sym: (d) => `
    <g transform="rotate(-6 50 50)">
      <rect x="33" y="10" width="34" height="80" rx="4" fill="${d.w}"/>
      <g fill="${d.deep}" opacity=".42"><rect x="37" y="14" width="26" height="15" rx="2"/><rect x="37" y="32" width="26" height="15" rx="2"/><rect x="37" y="50" width="26" height="15" rx="2"/><rect x="37" y="68" width="26" height="15" rx="2"/></g>
    </g>` },
  guess: { bg: ['#5fe07c', '#1fae4b'], deep: '#118a37', sym: (d) => `
    <path d="M50 88 C36 70 24 58 24 42 a26 26 0 0 1 52 0 C76 58 64 70 50 88 z" fill="${d.w}"/>
    <path d="M42 36 a8 8 0 1 1 11 7.4 c-2.4 1-3 2.6-3 5" stroke="${d.deep}" stroke-width="5" fill="none" stroke-linecap="round" opacity=".7"/>
    <circle cx="50" cy="58" r="3.2" fill="${d.deep}" opacity=".7"/>` },
  more: { bg: ['#4fe3d8', '#00a7a5'], deep: '#007f80', sym: (d) => `
    <rect x="14" y="22" width="33" height="56" rx="6" fill="${d.w}"/>
    <rect x="53" y="22" width="33" height="56" rx="6" fill="${d.w}"/>
    <path d="M30.5 60 v-24 M21.5 45 l9-9 l9 9" stroke="${d.deep}" stroke-width="5" fill="none" stroke-linecap="round" stroke-linejoin="round" opacity=".6"/>
    <path d="M69.5 40 v24 M60.5 55 l9 9 l9-9" stroke="${d.deep}" stroke-width="5" fill="none" stroke-linecap="round" stroke-linejoin="round" opacity=".6"/>` },
  find: { bg: ['#4aa8ff', '#0a5fe0'], deep: '#0848b0', sym: (d) => `
    <circle cx="44" cy="44" r="24" fill="none" stroke="${d.w}" stroke-width="7.5"/>
    <circle cx="44" cy="44" r="20" fill="${d.w}" opacity=".22"/>
    <rect x="31" y="38" width="26" height="12" rx="2.5" fill="${d.w}"/>
    <rect x="35" y="42" width="18" height="4" rx="2" fill="${d.deep}" opacity=".45"/>
    <rect x="64" y="58" width="10" height="28" rx="5" fill="${d.w}" transform="rotate(-45 69 72)"/>` },
  open: { bg: ['#6b6b72', '#2c2c30'], deep: '#1c1c1e', sym: (d) => `
    <rect x="20" y="44" width="60" height="38" rx="3" fill="${d.w}"/>
    <path d="M16 26 h68 l4 16 h-76 z" fill="${d.w}"/>
    <path d="M12 42 a6.33 6 0 0 0 12.67 0 a6.33 6 0 0 0 12.67 0 a6.33 6 0 0 0 12.67 0 a6.33 6 0 0 0 12.67 0 a6.33 6 0 0 0 12.67 0 a6.33 6 0 0 0 12.67 0 z" fill="${d.w}"/>
    <g fill="${d.deep}" opacity=".32"><path d="M27.3 26 l-2.6 16 h12.6 l1.3-16 z"/><path d="M52.6 26 l0.6 16 h12.6 l-2.6-16 z"/></g>
    <rect x="28" y="58" width="16" height="24" rx="2" fill="${d.deep}" opacity=".5"/>
    <rect x="52" y="58" width="20" height="13" rx="2" fill="${d.deep}" opacity=".32"/>` },
  near: { bg: ['#ffffff', '#e6e6ec'], deep: '#0a84ff', light: true, sym: (d) => `
    <circle cx="50" cy="52" r="34" fill="none" stroke="#c7c7cf" stroke-width="2"/>
    <circle cx="50" cy="52" r="20" fill="none" stroke="#c7c7cf" stroke-width="2"/>
    <path d="M50 18 L73 80 L50 68 L27 80 Z" fill="url(#accent)" stroke="#ffffff" stroke-width="3.5" stroke-linejoin="round" transform="rotate(32 50 52)"/>` },
}

function svg(name) {
  const d = ICONS[name]
  const sym = d.sym({ w: 'url(#glass)', deep: d.deep })
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${C}" height="${C}" viewBox="0 0 ${C} ${C}">
<defs>
  <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${d.bg[0]}"/><stop offset="1" stop-color="${d.bg[1]}"/></linearGradient>
  <linearGradient id="sheen" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="${d.light ? 0.6 : 0.28}"/><stop offset=".5" stop-color="#fff" stop-opacity="0"/></linearGradient>
  <linearGradient id="rim" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".85"/><stop offset=".45" stop-color="#fff" stop-opacity=".12"/><stop offset="1" stop-color="#fff" stop-opacity=".35"/></linearGradient>
  <linearGradient id="glass" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#fff" stop-opacity=".86"/></linearGradient>
  <linearGradient id="accent" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#47a6ff"/><stop offset="1" stop-color="#0a6ff0"/></linearGradient>
  <filter id="tileShadow" x="-20%" y="-20%" width="140%" height="150%"><feDropShadow dx="0" dy="${0.012 * C}" stdDeviation="${0.018 * C}" flood-color="#000" flood-opacity=".26"/></filter>
  <filter id="symShadow" x="-20%" y="-20%" width="140%" height="150%"><feDropShadow dx="0" dy="1.2" stdDeviation="1.6" flood-color="${d.light ? '#0a3a80' : d.deep}" flood-opacity="${d.light ? 0.25 : 0.45}"/></filter>
  <clipPath id="tile"><rect width="100" height="100" rx="22.5"/></clipPath>
</defs>
<g transform="translate(${O} ${O}) scale(${k})">
  <rect width="100" height="100" rx="22.5" fill="url(#bg)" filter="url(#tileShadow)"/>
  <g clip-path="url(#tile)"><rect width="100" height="100" fill="url(#sheen)"/></g>
  <g filter="url(#symShadow)">${sym}</g>
  <rect x=".35" y=".35" width="99.3" height="99.3" rx="22.2" fill="none" stroke="url(#rim)" stroke-width=".7"/>
</g>
</svg>`
}

;(async () => {
  fs.mkdirSync(SVGDIR, { recursive: true })
  for (const name of Object.keys(ICONS)) {
    const s = svg(name)
    fs.writeFileSync(`${SVGDIR}/${name}.svg`, s)
    await sharp(Buffer.from(s)).resize(552, 552).webp({ quality: 92 }).toFile(`${OUTDIR}/${name}.webp`)
  }
  console.log('done')
})()
