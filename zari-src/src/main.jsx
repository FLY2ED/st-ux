// ?v=2: 새 화면(시안 확인용). 기본은 지금 화면
const v2 = new URLSearchParams(location.search).get('v') === '2'
if (v2) import('./v2/main.jsx')
else import('./main1.jsx')
