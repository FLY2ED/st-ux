import { BOSSES, ownerOf, spriteOf } from '../../world/story.js'

// 인물 그림: c- 길잡이·보스 서 있는 모습, f- 동네 사람·사장님, p- 대화창 얼굴
const NPC_ART = import.meta.glob('../../assets/npc/*.png', { eager: true, import: 'default' })
export const art = (name) => NPC_ART[`../../assets/npc/${name}.png`] || ''
export const whoOf = (npc, tone = 'npc') => ({ ...npc, portrait: npc.portrait || (npc.id ? art(`p-${npc.id}`) || art(`f-${npc.id}`) : ''), tone: npc.tone || tone })
export const bossWho = (id) => whoOf({ id, name: BOSSES[id].name, face: BOSSES[id].face }, 'boss')
export const ownerWho = (sign) => {
  const o = ownerOf(sign)
  return { ...o, sprite: spriteOf(sign.cat), portrait: art(`f-${spriteOf(sign.cat)}`) }
}

export const TAXI = { name: '택시 기사님', face: '🚕', portrait: '', tone: 'npc' }
export const PASSENGER = { name: '손님', face: '🧳', portrait: '', tone: 'npc' }
