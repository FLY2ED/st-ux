import { SignLogo } from './MenuBar.jsx'

const fmt = (n) => n.toLocaleString('ko-KR')

// 이 간판 도감에 관하여: 데이터 출처와 쓴 오픈소스
export default function About({ meta }) {
  return (
    <div className="about">
      <SignLogo width="64" height="64" className="about-logo" />
      <h3>간판 도감</h3>
      <p className="muted">맥 에디션 · 시안</p>
      <dl>
        <dt>간판</dt>
        <dd>{meta ? `${fmt(meta.total)}곳` : '…'}</dd>
        <dt>업종</dt>
        <dd>{meta ? `${meta.categories}가지` : '…'}</dd>
        <dt>자료</dt>
        <dd>{meta ? `${meta.source}, ${meta.date}` : '…'}</dd>
        <dt>글꼴</dt>
        <dd>애플 기기는 시스템 글꼴, 그 밖에는 Pretendard(OFL)와 갈무리(OFL)</dd>
        <dt>오픈소스</dt>
        <dd>playground-macos · macos-web(Dock 확대), react-rnd, framer-motion, liquid-glass-react, figma-squircle — 모두 MIT</dd>
      </dl>
    </div>
  )
}
