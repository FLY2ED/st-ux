// 간판 이름 25만 개로만 배운 글자 단위 작은 GPT (4층 · 머리 4개 · 160차원, 143만 개 수).
// 가중치는 fp16 한 파일(signlm.bin)이고, 브라우저에서 바로 앞으로 계산한다. 서버도 AI 할당량도 쓰지 않는다
import { DATA } from './data.js'

let ready = null

// fp16 → fp32
function half(u16) {
  const out = new Float32Array(u16.length)
  for (let i = 0; i < u16.length; i++) {
    const h = u16[i]
    const s = h & 0x8000 ? -1 : 1
    const e = (h >> 10) & 0x1f
    const f = h & 0x3ff
    out[i] = e === 0 ? s * f * 2 ** -24 : e === 31 ? (f ? NaN : s * Infinity) : s * (1 + f / 1024) * 2 ** (e - 15)
  }
  return out
}

export function loadLM() {
  if (!ready) {
    ready = Promise.all([
      fetch(`${DATA}signlm/signlm.json`).then((r) => r.json()),
      fetch(`${DATA}signlm/signlm.bin`).then((r) => r.arrayBuffer()),
    ]).then(([man, buf]) => {
      const W = {}
      for (const t of man.tensors) {
        const n = t.shape.reduce((a, b) => a * b, 1)
        W[t.name] = half(new Uint16Array(buf, t.offset, n))
      }
      return makeModel(man, W)
    })
  }
  return ready
}

// erf 근사 (오차 1.5e-7). PyTorch 기본 GELU 가 erf 를 쓴다
function erf(x) {
  const s = x < 0 ? -1 : 1
  x = Math.abs(x)
  const t = 1 / (1 + 0.3275911 * x)
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x)
  return s * y
}

function makeModel(man, W) {
  const { vocab, D, L, H, ctx } = man
  const V = vocab.length
  const hd = D / H
  const stoi = new Map(vocab.map((c, i) => [c, i]))

  const norm = (x, g, b) => {
    let m = 0
    for (let i = 0; i < D; i++) m += x[i]
    m /= D
    let v = 0
    for (let i = 0; i < D; i++) v += (x[i] - m) ** 2
    const r = 1 / Math.sqrt(v / D + 1e-5)
    const out = new Float32Array(D)
    for (let i = 0; i < D; i++) out[i] = (x[i] - m) * r * g[i] + b[i]
    return out
  }
  // y = W x + b, W 는 [out, in]
  const lin = (x, w, b, nout) => {
    const nin = x.length
    const out = new Float32Array(nout)
    for (let o = 0; o < nout; o++) {
      let s = b ? b[o] : 0
      const row = o * nin
      for (let i = 0; i < nin; i++) s += w[row + i] * x[i]
      out[o] = s
    }
    return out
  }

  const encode = (s) => [0, ...[...s].map((c) => stoi.get(c) ?? 1)].slice(0, ctx)

  // 한 번 앞으로: 마지막 자리 다음 글자 확률과 층·머리별 주의(attention) 행렬을 돌려준다
  function run(text) {
    const ids = encode(text)
    const T = ids.length
    let h = ids.map((id, t) => {
      const v = new Float32Array(D)
      for (let i = 0; i < D; i++) v[i] = W['tok.weight'][id * D + i] + W['pos.weight'][t * D + i]
      return v
    })
    const att = []
    for (let l = 0; l < L; l++) {
      const p = `blocks.${l}.`
      const qkv = h.map((x) => lin(norm(x, W[p + 'ln1.weight'], W[p + 'ln1.bias']), W[p + 'qkv.weight'], W[p + 'qkv.bias'], 3 * D))
      const heads = []
      const mixed = h.map(() => new Float32Array(D))
      for (let hh = 0; hh < H; hh++) {
        const A = []
        for (let t = 0; t < T; t++) {
          const row = new Float32Array(T)
          let mx = -Infinity
          for (let s = 0; s <= t; s++) {
            let d = 0
            for (let i = 0; i < hd; i++) d += qkv[t][hh * hd + i] * qkv[s][D + hh * hd + i]
            row[s] = d / Math.sqrt(hd)
            if (row[s] > mx) mx = row[s]
          }
          let sum = 0
          for (let s = 0; s <= t; s++) sum += row[s] = Math.exp(row[s] - mx)
          for (let s = 0; s <= t; s++) {
            row[s] /= sum
            for (let i = 0; i < hd; i++) mixed[t][hh * hd + i] += row[s] * qkv[s][2 * D + hh * hd + i]
          }
          A.push(row)
        }
        heads.push(A)
      }
      att.push(heads)
      h = h.map((x, t) => {
        const a = lin(mixed[t], W[p + 'proj.weight'], W[p + 'proj.bias'], D)
        const y = new Float32Array(D)
        for (let i = 0; i < D; i++) y[i] = x[i] + a[i]
        const f = lin(norm(y, W[p + 'ln2.weight'], W[p + 'ln2.bias']), W[p + 'fc.weight'], W[p + 'fc.bias'], 4 * D)
        for (let i = 0; i < f.length; i++) f[i] = 0.5 * f[i] * (1 + erf(f[i] / Math.SQRT2))
        const o = lin(f, W[p + 'out.weight'], W[p + 'out.bias'], D)
        for (let i = 0; i < D; i++) y[i] += o[i]
        return y
      })
    }
    const last = norm(h[T - 1], W['lnf.weight'], W['lnf.bias'])
    const logits = lin(last, W['tok.weight'], null, V)
    return { ids, chars: ids.map((i) => vocab[i]), logits, att }
  }

  // 온도를 준 확률
  function probs(logits, temp = 1) {
    const p = new Float32Array(V)
    let mx = -Infinity
    for (let i = 0; i < V; i++) if (i !== 1 && logits[i] > mx) mx = logits[i]
    let sum = 0
    for (let i = 0; i < V; i++) sum += p[i] = i === 1 ? 0 : Math.exp((logits[i] - mx) / temp)
    for (let i = 0; i < V; i++) p[i] /= sum
    return p
  }

  // 다음 글자 후보 k 개. '^' 는 끝(이름이 여기서 끝남)으로 돌려준다
  function next(text, k = 8, temp = 1) {
    const p = probs(run(text).logits, temp)
    return [...p.keys()]
      .sort((a, b) => p[b] - p[a])
      .slice(0, k)
      .map((i) => ({ ch: i === 0 ? '끝' : vocab[i], end: i === 0, p: p[i] }))
  }

  // 앞글자를 주고 끝까지 이어 쓴다
  function sample(prefix = '', temp = 0.8, rnd = Math.random) {
    let s = prefix
    while ([...s].length < ctx - 1) {
      const p = probs(run(s).logits, temp)
      let r = rnd()
      let pick = 0
      for (let i = 0; i < V; i++) {
        r -= p[i]
        if (r <= 0) {
          pick = i
          break
        }
      }
      if (pick === 0) break
      s += vocab[pick]
    }
    return s
  }

  return { vocab, D, L, H, ctx, valLoss: man.val_loss, trainNames: man.train_names, run, probs, next, sample, encode }
}
