// Icon Composer 문서(.icon) 생성: 배경 그라데이션 + 흰 기호 레이어(유리), 세부는 짙은 색 레이어
// 사용법: node make.cjs <sharp.cjs 폴더> <출력 폴더>
const fs = require('fs')
const sharp = require(process.argv[2] + '/sharp.cjs')
const OUT = process.argv[3]
const W = '#fff'
const SCALE = 0.84 // Apple 아이콘처럼 기호 둘레에 여백을 둔다

const ICONS = {
  street: { bg: ['#7d7bff', '#4b3fd6'], deep: '#3a2fb0', groups: [
    [['back', `<rect x="16" y="40" width="30" height="44" rx="3" fill="${W}"/>`]],
    [['front', `<rect x="50" y="20" width="34" height="64" rx="3" fill="${W}"/>`]],
    [['signs', (d) => `<g fill="${d}"><rect x="20" y="46" width="22" height="8" rx="2"/><rect x="72" y="26" width="7" height="30" rx="2"/><rect x="57" y="66" width="12" height="18" rx="2"/><rect x="26" y="72" width="10" height="12" rx="2"/></g>`, false]],
  ] },
  rain: { bg: ['#6fd0ff', '#1f8fe6'], groups: [
    [['cloud', `<path d="M30 52 a14 14 0 0 1 2-27.8 a19 19 0 0 1 35.5 4.6 a12 12 0 0 1 3 23.2 z" fill="${W}"/>`]],
    [['drops', `<g fill="${W}"><rect x="27" y="61" width="14" height="10" rx="2.5" transform="rotate(-12 34 66)"/><rect x="48" y="68" width="14" height="10" rx="2.5" transform="rotate(8 55 73)"/><rect x="66" y="58" width="14" height="10" rx="2.5" transform="rotate(-6 73 63)"/></g>`]],
  ] },
  dodge: { bg: ['#ffb340', '#ff7a00'], groups: [
    [['bowl', `<path d="M18 50 h64 a32 30 0 0 1 -64 0 z" fill="${W}"/><rect x="16" y="46" width="68" height="6" rx="3" fill="${W}"/>`]],
    [['sticks', `<rect x="53" y="12" width="5" height="40" rx="2.5" fill="${W}" transform="rotate(28 55 32)"/><rect x="62" y="12" width="5" height="40" rx="2.5" fill="${W}" transform="rotate(34 64 32)"/><path d="M30 40 q-4-6 0-12 M40 40 q-4-6 0-12" stroke="${W}" stroke-width="3.2" fill="none" stroke-linecap="round"/>`]],
  ] },
  scratch: { bg: ['#ffe066', '#f2b600'], deep: '#b98500', groups: [
    [['ticket', `<path d="M14 30 h72 v12 a8 8 0 0 0 0 16 v12 h-72 v-12 a8 8 0 0 0 0-16 z" fill="${W}" transform="rotate(-8 50 50)"/>`]],
    [['star', (d) => `<g transform="rotate(-8 50 50)" fill="${d}"><path d="M34 44 l3.5 -10 l3.5 10 l10.5 0 l-8.5 6 l3.2 10 l-8.7 -6.2 l-8.7 6.2 l3.2-10 l-8.5-6 z"/><rect x="60" y="38" width="18" height="5" rx="2.5" opacity=".6"/><rect x="60" y="48" width="14" height="5" rx="2.5" opacity=".6"/><rect x="60" y="58" width="16" height="5" rx="2.5" opacity=".6"/></g>`, false]],
  ] },
  song: { bg: ['#d58bff', '#9b30e8'], groups: [
    [['head', `<rect x="38" y="16" width="24" height="40" rx="12" fill="${W}"/>`]],
    [['stand', `<path d="M28 46 a22 22 0 0 0 44 0" stroke="${W}" stroke-width="5" fill="none" stroke-linecap="round"/><rect x="47.5" y="67" width="5" height="12" rx="2" fill="${W}"/><rect x="36" y="78" width="28" height="5.5" rx="2.75" fill="${W}"/>`]],
  ] },
  booth: { bg: ['#ff6b62', '#e3261f'], deep: '#b8150f', groups: [
    [['strip', `<rect x="33" y="10" width="34" height="80" rx="4" fill="${W}" transform="rotate(-6 50 50)"/>`]],
    [['frames', (d) => `<g transform="rotate(-6 50 50)" fill="${d}"><rect x="37" y="14" width="26" height="15" rx="2"/><rect x="37" y="32" width="26" height="15" rx="2"/><rect x="37" y="50" width="26" height="15" rx="2"/><rect x="37" y="68" width="26" height="15" rx="2"/></g>`, false]],
  ] },
  guess: { bg: ['#5fe07c', '#1fae4b'], deep: '#118a37', groups: [
    [['pin', `<path d="M50 88 C36 70 24 58 24 42 a26 26 0 0 1 52 0 C76 58 64 70 50 88 z" fill="${W}"/>`]],
    [['mark', (d) => `<path d="M42 36 a8 8 0 1 1 11 7.4 c-2.4 1-3 2.6-3 5" stroke="${d}" stroke-width="5.5" fill="none" stroke-linecap="round"/><circle cx="50" cy="58" r="3.4" fill="${d}"/>`, false]],
  ] },
  more: { bg: ['#4fe3d8', '#00a7a5'], deep: '#007f80', groups: [
    [['left', `<rect x="14" y="22" width="33" height="56" rx="6" fill="${W}"/>`]],
    [['right', `<rect x="53" y="22" width="33" height="56" rx="6" fill="${W}"/>`]],
    [['arrows', (d) => `<g stroke="${d}" stroke-width="5" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M30.5 60 v-24 M21.5 45 l9-9 l9 9"/><path d="M69.5 40 v24 M60.5 55 l9 9 l9-9"/></g>`, false]],
  ] },
  find: { bg: ['#4aa8ff', '#0a5fe0'], groups: [
    [['lens', `<circle cx="44" cy="44" r="24" fill="none" stroke="${W}" stroke-width="8"/><rect x="64" y="58" width="11" height="30" rx="5.5" fill="${W}" transform="rotate(-45 69 72)"/>`]],
    [['bar', `<rect x="31" y="38" width="26" height="12" rx="3" fill="${W}"/>`]],
  ] },
  open: { bg: ['#6b6b72', '#2c2c30'], deep: '#1c1c1e', groups: [
    [['awning', `<path d="M16 26 h68 l4 16 h-76 z" fill="${W}"/><path d="M12 42 a6.33 6 0 0 0 12.67 0 a6.33 6 0 0 0 12.67 0 a6.33 6 0 0 0 12.67 0 a6.33 6 0 0 0 12.67 0 a6.33 6 0 0 0 12.67 0 a6.33 6 0 0 0 12.67 0 z" fill="${W}"/>`]],
    [['shop', `<rect x="20" y="50" width="60" height="32" rx="3" fill="${W}"/>`]],
    [['door', (d) => `<g fill="${d}"><rect x="28" y="58" width="16" height="24" rx="2"/><rect x="52" y="58" width="20" height="13" rx="2" opacity=".6"/></g>`, false]],
  ] },
  web: { bg: ['#5ac8fa', '#0a6cff'], deep: '#ff3b30', groups: [
    [['dial', `<circle cx="50" cy="50" r="36" fill="${W}"/>`]],
    [['ticks', `<g stroke="#0a6cff" stroke-width="1.6" stroke-linecap="round" opacity=".55">${Array.from({ length: 24 }, (_, i) => `<path d="M50 18 v${i % 6 ? 4 : 7}" transform="rotate(${i * 15} 50 50)"/>`).join('')}</g>`, false]],
    [['needle', (d) => `<path d="M72 28 L53.8 53.8 L46.2 46.2 Z" fill="${d}"/><path d="M28 72 L46.2 46.2 L53.8 53.8 Z" fill="#c7c7cf"/>`, false]],
  ] },
  near: { bg: ['#ffffff', '#e6e6ec'], groups: [
    [['rings', `<circle cx="50" cy="50" r="34" fill="none" stroke="#c7c7cf" stroke-width="2"/><circle cx="50" cy="50" r="20" fill="none" stroke="#c7c7cf" stroke-width="2"/>`, false]],
    [['arrow', `<path d="M50 16 L73 78 L50 66 L27 78 Z" fill="#0a84ff" stroke-linejoin="round" transform="rotate(32 50 50)"/>`]],
  ] },
}

const srgb = (hex) => 'srgb:' + [1, 3, 5].map((i) => (parseInt(hex.slice(i, i + 2), 16) / 255).toFixed(5)).join(',') + ',1.00000'
const wrap = (body) => `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 100 100">${body}</svg>`

;(async () => {
  for (const [name, d] of Object.entries(ICONS)) {
    const layers = d.groups.map((g) => g.map(([n, s, glass = true]) => ({ n, s: typeof s === 'function' ? s(d.deep) : s, glass })))
    // 모든 레이어 경계 상자를 구해 기호를 캔버스 가운데로 옮긴다
    const all = wrap(layers.flat().map((l) => l.s.replaceAll('#c7c7cf', '#000')).join(''))
    const png = await sharp(Buffer.from(all)).png().toBuffer()
    const { info } = await sharp(png).trim({ threshold: 1 }).toBuffer({ resolveWithObject: true })
    const u = 10.24
    const dx = +(50 - (-info.trimOffsetLeft + info.width / 2) / u).toFixed(2), dy = +(50 - (-info.trimOffsetTop + info.height / 2) / u).toFixed(2)
    const dir = `${OUT}/${name}.icon`
    fs.rmSync(dir, { recursive: true, force: true })
    fs.mkdirSync(`${dir}/Assets`, { recursive: true })
    const groups = layers.map((g) => {
      for (const l of g) fs.writeFileSync(`${dir}/Assets/${l.n}.svg`, wrap(`<g transform="translate(50 50) scale(${SCALE}) translate(${dx - 50} ${dy - 50})">${l.s}</g>`))
      return {
        layers: g.map((l) => ({ 'image-name': `${l.n}.svg`, name: l.n, glass: l.glass })),
        shadow: { kind: 'neutral', opacity: 0.5 },
        translucency: { enabled: true, value: 0.4 },
      }
    })
    fs.writeFileSync(`${dir}/icon.json`, JSON.stringify({ fill: { 'linear-gradient': d.bg.map(srgb) }, groups: groups.reverse(), 'supported-platforms': { squares: 'shared' } }, null, 2))
    console.log(name, dx, dy)
  }
})()
