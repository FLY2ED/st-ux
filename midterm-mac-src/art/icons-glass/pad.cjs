// icontool 렌더(1024, 여백 없음)를 Dock 격자에 맞춰 여백·그림자를 넣고 552px webp로 쓴다
// 사용법: node pad.cjs <sharp.cjs 폴더> <렌더 폴더> <출력 폴더>
const fs = require('fs')
const sharp = require(process.argv[2] + '/sharp.cjs')
const [SRC, OUT] = process.argv.slice(3)
const C = 1024, T = 690, O = (C - T) / 2 // 기존 아이콘과 같은 타일 비율(≈ 69%)

const shadow = `<svg xmlns="http://www.w3.org/2000/svg" width="${C}" height="${C}" viewBox="0 0 ${C} ${C}">
<filter id="s" x="-20%" y="-20%" width="140%" height="150%"><feGaussianBlur stdDeviation="${0.018 * C}"/></filter>
<rect x="${O}" y="${O + 0.012 * C}" width="${T}" height="${T}" rx="${T * 0.225}" fill="#000" opacity=".26" filter="url(#s)"/></svg>`

;(async () => {
  for (const f of fs.readdirSync(SRC).filter((f) => f.endsWith('.png'))) {
    const tile = await sharp(`${SRC}/${f}`).resize(T, T).toBuffer()
    // sharp는 resize를 composite보다 먼저 하므로 합성과 축소를 나눈다
    const full = await sharp({ create: { width: C, height: C, channels: 4, background: '#0000' } })
      .composite([{ input: Buffer.from(shadow), left: 0, top: 0 }, { input: tile, left: O, top: O }])
      .png()
      .toBuffer()
    await sharp(full)
      .resize(552, 552)
      .webp({ quality: 92 })
      .toFile(`${OUT}/${f.replace('.png', '.webp')}`)
  }
  console.log('done')
})()
