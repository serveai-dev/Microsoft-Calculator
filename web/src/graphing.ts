import { parseEquation, type Equation, type Scope } from './expr.ts'
import { G, icon, esc, type View } from './ui.ts'

// EquationBrush1..13 from src/Calculator/App.xaml (light / dark)
const LIGHT = ['#0063B1', '#00B7C3', '#6600CC', '#107C10', '#00CC6A', '#008055', '#58595B', '#E81123', '#E3008C', '#B31564', '#FFB900', '#F7630C', '#8E562E']
const DARK = ['#4D92C8', '#4DCDD5', '#A366E0', '#58A358', '#4DDB97', '#4DA688', '#8A8B8C', '#EF5865', '#EB4DAF', '#CA5B93', '#FFCE4D', '#F99255', '#B0896D']
const STYLES: [string, number[]][] = [['Solid', []], ['Dot', [2, 4]], ['Dash', [10, 6]]]
const ANGLE = { Radians: 1, Degrees: Math.PI / 180, Gradians: Math.PI / 200 }

interface Eq { src: string; color: number; style: number; visible: boolean; parsed?: Equation; error?: string }
interface Var { value: number; min: number; max: number; step: number }
interface ViewBox { xmin: number; xmax: number; ymin: number; ymax: number }

const state = {
  eqs: [] as Eq[],
  vars: {} as Record<string, Var>,
  units: 'Radians' as keyof typeof ANGLE,
  thickness: 2,
  theme: 'match' as 'light' | 'match',
  view: null as ViewBox | null,
}

const isAppDark = () => {
  const t = document.documentElement.dataset.theme
  return t === 'dark' || (!t && matchMedia('(prefers-color-scheme: dark)').matches)
}

function niceStep(span: number, px: number): number {
  const raw = span / Math.max(1, px / 90)
  const p = 10 ** Math.floor(Math.log10(raw))
  const n = raw / p
  return (n < 1.5 ? 1 : n < 3.5 ? 2 : n < 7.5 ? 5 : 10) * p
}

const fmtNum = (n: number) => String(Number(n.toPrecision(6)))

export function mountGraphing(root: HTMLElement, header: HTMLElement): View {
  let showGraph = false
  let focused: HTMLInputElement | null = null
  let styleFor: number | null = null
  let optionsOpen = false
  let hover: { x: number; y: number } | null = null

  header.innerHTML = `<button class="hdr-btn narrow-only" data-a="toggleview" title="Switch view">${icon(G.graph)}</button>`
  root.innerHTML = `<div class="graphing">
    <section class="eq-pane">
      <div class="eq-list"></div>
      <div class="vars"></div>
      <div class="keypad k5 graph-keys">${[
        ['x', 'x'], ['y', 'y'], [icon(G.pi), 'π'], ['e', 'e'], [icon(G.back), '⌫'],
        [icon(G.sqr), '^2'], [icon(G.xpowy), '^'], [icon(G.sqrt), '√('], ['(', '('], [')', ')'],
        ['sin', 'sin('], ['cos', 'cos('], ['tan', 'tan('], [icon(G.abs), 'abs('], [icon(G.div), '/'],
        ['7', '7'], ['8', '8'], ['9', '9'], ['ln', 'ln('], [icon(G.mul), '*'],
        ['4', '4'], ['5', '5'], ['6', '6'], ['log', 'log('], [icon(G.minus), '-'],
        ['1', '1'], ['2', '2'], ['3', '3'], ['=', '='], [icon(G.plus), '+'],
        ['&lt;', '<'], ['&gt;', '>'], ['0', '0'], ['.', '.'], ['Enter', '⏎'],
      ].map(([l, ins]) => `<button class="${/^[0-9.]$/.test(ins) ? 'num' : ins === '⏎' ? 'accent' : 'op'}" data-ins="${esc(ins)}">${l}</button>`).join('')}</div>
    </section>
    <section class="graph-pane">
      <canvas></canvas>
      <div class="graph-top">
        <button class="flat" data-a="options" title="Graph options">${icon(G.settings)}</button>
      </div>
      <div class="graph-tools">
        <button class="flat" data-a="zin" title="Zoom in">${icon(G.plus)}</button>
        <button class="flat" data-a="zout" title="Zoom out">${icon(G.minus)}</button>
        <button class="flat" data-a="zreset" title="Reset view">${icon('')}</button>
      </div>
      <div class="trace-tip" hidden></div>
      <div class="popup graph-options" hidden></div>
    </section>
  </div>`

  const $ = <E extends HTMLElement>(s: string) => root.querySelector(s) as E
  const canvas = $<HTMLCanvasElement>('canvas'), eqList = $('.eq-list'), varsEl = $('.vars'), tip = $('.trace-tip'), opts = $('.graph-options')
  const ctx = canvas.getContext('2d')!

  const palette = () => (state.theme === 'light' || !isAppDark() ? LIGHT : DARK)

  function reparse(): void {
    const used = new Set<string>()
    for (const eq of state.eqs) {
      try {
        eq.parsed = parseEquation(eq.src)
        eq.error = undefined
        eq.parsed.vars.forEach((v) => used.add(v))
      } catch (e) {
        eq.parsed = undefined
        eq.error = (e as Error).message
      }
    }
    for (const v of used) state.vars[v] ??= { value: 1, min: -10, max: 10, step: 0.1 }
    for (const v of Object.keys(state.vars)) if (!used.has(v)) delete state.vars[v]
  }

  function drawList(): void {
    const colors = palette()
    eqList.innerHTML = state.eqs.map((eq, i) => `<div class="eq-row ${eq.visible ? '' : 'off'} ${eq.error ? 'bad' : ''}" style="--c:${colors[eq.color % colors.length]}">
        <button class="eq-swatch" data-a="vis:${i}" title="${eq.visible ? 'Hide' : 'Show'} equation">f<sub>${i + 1}</sub></button>
        <input class="eq-input" data-i="${i}" value="${esc(eq.src)}" spellcheck="false" autocomplete="off">
        <button class="flat eq-btn" data-a="style:${i}" title="Change equation style">${icon('')}</button>
        <button class="flat eq-btn" data-a="del:${i}" title="Remove equation">${icon('')}</button>
        ${eq.error ? `<div class="eq-err">${esc(eq.error)}</div>` : ''}
        ${styleFor === i ? `<div class="style-pop">${colors.map((c, ci) => `<button class="sw ${ci === eq.color ? 'on' : ''}" style="background:${c}" data-a="color:${i}:${ci}"></button>`).join('')}
          <div class="styles">${STYLES.map(([n], si) => `<button class="flat ${si === eq.style ? 'on' : ''}" data-a="lstyle:${i}:${si}">${n}</button>`).join('')}</div></div>` : ''}
      </div>`).join('') + `<div class="eq-row new" style="--c:${colors[state.eqs.length % colors.length]}">
        <span class="eq-swatch">f<sub>${state.eqs.length + 1}</sub></span>
        <input class="eq-input" data-i="new" placeholder="Enter an expression" spellcheck="false" autocomplete="off"></div>`
    const vars = Object.entries(state.vars)
    varsEl.innerHTML = vars.length ? '<div class="lbl">Variables</div>' + vars.map(([n, v]) => `<div class="var-row" data-v="${esc(n)}">
        <span class="var-name">${esc(n)}</span><input type="number" class="var-val" value="${v.value}" step="${v.step}">
        <input type="range" class="var-range" min="${v.min}" max="${v.max}" step="${v.step}" value="${v.value}">
        <label>Min<input type="number" class="var-min" value="${v.min}"></label><label>Max<input type="number" class="var-max" value="${v.max}"></label>
        <label>Step<input type="number" class="var-step" value="${v.step}"></label></div>`).join('') : ''
  }

  function drawOptions(): void {
    opts.hidden = !optionsOpen
    if (!optionsOpen || !state.view) return
    const v = state.view
    const label = { xmin: 'X-Min', xmax: 'X-Max', ymin: 'Y-Min', ymax: 'Y-Max' }
    opts.innerHTML = `<div class="lbl strong">Graph options</div>
      <div class="win-grid">${(['xmin', 'xmax', 'ymin', 'ymax'] as const).map((k) =>
        `<label>${label[k]}<input type="number" data-win="${k}" value="${fmtNum(v[k])}"></label>`).join('')}</div>
      <div class="lbl">Units</div>
      <div class="radios">${Object.keys(ANGLE).map((u) => `<label class="radio"><input type="radio" name="units" value="${u}" ${u === state.units ? 'checked' : ''}><span>${u}</span></label>`).join('')}</div>
      <div class="lbl">Line thickness</div><input type="range" class="thick" min="1" max="4" step="0.5" value="${state.thickness}">
      <div class="lbl">Graph theme</div>
      <div class="radios"><label class="radio"><input type="radio" name="gtheme" value="light" ${state.theme === 'light' ? 'checked' : ''}><span>Always light</span></label>
        <label class="radio"><input type="radio" name="gtheme" value="match" ${state.theme === 'match' ? 'checked' : ''}><span>Match app theme</span></label></div>
      <button class="link" data-a="zreset">Reset view</button>`
  }

  function size(): { w: number; h: number } {
    const r = canvas.getBoundingClientRect()
    const dpr = devicePixelRatio || 1
    if (canvas.width !== Math.round(r.width * dpr) || canvas.height !== Math.round(r.height * dpr)) {
      canvas.width = Math.round(r.width * dpr)
      canvas.height = Math.round(r.height * dpr)
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    return { w: r.width, h: r.height }
  }

  function defaultView(w: number, h: number): ViewBox {
    const half = 10 * (w / Math.max(1, h))
    return { xmin: -half, xmax: half, ymin: -10, ymax: 10 }
  }

  function draw(): void {
    const { w, h } = size()
    if (!w || !h) return
    if (!state.view) state.view = defaultView(w, h)
    const v = state.view
    const dark = state.theme !== 'light' && isAppDark()
    const sx = (x: number) => ((x - v.xmin) / (v.xmax - v.xmin)) * w
    const sy = (y: number) => ((v.ymax - y) / (v.ymax - v.ymin)) * h
    ctx.fillStyle = dark ? '#1f1f1f' : '#ffffff'
    ctx.fillRect(0, 0, w, h)

    const step = niceStep(v.xmax - v.xmin, w), ystep = niceStep(v.ymax - v.ymin, h)
    ctx.lineWidth = 1
    for (const minor of [true, false]) {
      const xs = minor ? step / 5 : step, ys = minor ? ystep / 5 : ystep
      ctx.strokeStyle = dark ? (minor ? '#2a2a2a' : '#3a3a3a') : (minor ? '#f0f0f0' : '#dcdcdc')
      ctx.beginPath()
      for (let x = Math.ceil(v.xmin / xs) * xs; x <= v.xmax; x += xs) { ctx.moveTo(Math.round(sx(x)) + 0.5, 0); ctx.lineTo(Math.round(sx(x)) + 0.5, h) }
      for (let y = Math.ceil(v.ymin / ys) * ys; y <= v.ymax; y += ys) { ctx.moveTo(0, Math.round(sy(y)) + 0.5); ctx.lineTo(w, Math.round(sy(y)) + 0.5) }
      ctx.stroke()
    }
    const ax = Math.min(Math.max(sx(0), 0), w), ay = Math.min(Math.max(sy(0), 0), h)
    ctx.strokeStyle = dark ? '#a0a0a0' : '#4a4a4a'
    ctx.beginPath()
    ctx.moveTo(0, Math.round(sy(0)) + 0.5); ctx.lineTo(w, Math.round(sy(0)) + 0.5)
    ctx.moveTo(Math.round(sx(0)) + 0.5, 0); ctx.lineTo(Math.round(sx(0)) + 0.5, h)
    ctx.stroke()
    ctx.fillStyle = dark ? '#c8c8c8' : '#3a3a3a'
    ctx.font = '12px "Segoe UI Variable Text", "Segoe UI", sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    for (let x = Math.ceil(v.xmin / step) * step; x <= v.xmax; x += step) {
      if (Math.abs(x) > step / 2) ctx.fillText(fmtNum(x), sx(x), Math.min(ay + 4, h - 16))
    }
    ctx.textAlign = 'right'
    ctx.textBaseline = 'middle'
    for (let y = Math.ceil(v.ymin / ystep) * ystep; y <= v.ymax; y += ystep) {
      if (Math.abs(y) > ystep / 2) ctx.fillText(fmtNum(y), Math.max(ax - 4, 30), sy(y))
    }

    const colors = palette()
    const vars = Object.fromEntries(Object.entries(state.vars).map(([n, x]) => [n, x.value]))
    const scope: Scope = { x: 0, y: 0, vars, angle: ANGLE[state.units] }
    const f = (eq: Equation, x: number, y: number) => { scope.x = x; scope.y = y; return eq.f(scope) }
    ctx.lineWidth = state.thickness
    ctx.lineJoin = 'round'
    ctx.lineCap = 'round'

    for (const eq of state.eqs) {
      const p = eq.parsed
      if (!eq.visible || !p) continue
      const color = colors[eq.color % colors.length]
      ctx.strokeStyle = ctx.fillStyle = color
      ctx.setLineDash(p.rel === '<' || p.rel === '>' ? [6, 4] : STYLES[eq.style][1])
      if (p.kind === 'explicit') {
        ctx.beginPath()
        let pen = false, prev = 0
        for (let px = 0; px <= w; px += 0.5) {
          const y = f(p, v.xmin + (px / w) * (v.xmax - v.xmin), 0)
          if (!Number.isFinite(y)) { pen = false; continue }
          const py = Math.max(-1e5, Math.min(1e5, sy(y)))
          if (pen && Math.abs(py - prev) > h * 1.5) pen = false
          if (pen) ctx.lineTo(px, py)
          else ctx.moveTo(px, py)
          pen = true
          prev = py
        }
        ctx.stroke()
      } else {
        drawImplicit(p, w, h, v, (x, y) => f(p, x, y))
      }
    }
    ctx.setLineDash([])

    tip.hidden = true
    if (hover) {
      let best: { d: number; py: number; y: number; c: string } | null = null
      const x = v.xmin + (hover.x / w) * (v.xmax - v.xmin)
      for (const eq of state.eqs) {
        if (!eq.visible || eq.parsed?.kind !== 'explicit') continue
        const y = f(eq.parsed, x, 0)
        if (!Number.isFinite(y)) continue
        const d = Math.abs(sy(y) - hover.y)
        if (d < 30 && (!best || d < best.d)) best = { d, py: sy(y), y, c: colors[eq.color % colors.length] }
      }
      if (best) {
        ctx.fillStyle = best.c
        ctx.beginPath()
        ctx.arc(hover.x, best.py, 5, 0, Math.PI * 2)
        ctx.fill()
        tip.hidden = false
        tip.textContent = `(${fmtNum(x)}, ${fmtNum(best.y)})`
        tip.style.left = `${hover.x + 12}px`
        tip.style.top = `${best.py - 32}px`
      }
    }
  }

  /** Marching squares for f(x,y)=0, plus shading for inequalities. */
  function drawImplicit(p: Equation, w: number, h: number, v: ViewBox, F: (x: number, y: number) => number): void {
    const cell = 4
    const cols = Math.ceil(w / cell), rows = Math.ceil(h / cell)
    const X = (i: number) => v.xmin + ((i * cell) / w) * (v.xmax - v.xmin)
    const Y = (j: number) => v.ymax - ((j * cell) / h) * (v.ymax - v.ymin)
    const g = new Float64Array((cols + 1) * (rows + 1))
    for (let j = 0; j <= rows; j++) for (let i = 0; i <= cols; i++) g[j * (cols + 1) + i] = F(X(i), Y(j))
    const at = (i: number, j: number) => g[j * (cols + 1) + i]

    if (p.rel !== '=') {
      const want = p.rel.startsWith('<') ? -1 : 1
      ctx.globalAlpha = 0.25
      for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
        const c = (at(i, j) + at(i + 1, j) + at(i, j + 1) + at(i + 1, j + 1)) / 4
        if (Math.sign(c) === want) ctx.fillRect(i * cell, j * cell, cell, cell)
      }
      ctx.globalAlpha = 1
    }

    ctx.beginPath()
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
      const c = [at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j + 1)]
      if (c.some((n) => !Number.isFinite(n))) continue
      const corners: [number, number][] = [[i, j], [i + 1, j], [i + 1, j + 1], [i, j + 1]]
      const pts: [number, number][] = []
      for (let e = 0; e < 4; e++) {
        const a = c[e], b = c[(e + 1) % 4]
        if ((a < 0) === (b < 0)) continue
        const t = a / (a - b)
        const [ai, aj] = corners[e], [bi, bj] = corners[(e + 1) % 4]
        const pi = ai + (bi - ai) * t, pj = aj + (bj - aj) * t
        if (Math.abs(F(X(pi), Y(pj))) > Math.abs(a) + Math.abs(b)) continue
        pts.push([pi * cell, pj * cell])
      }
      for (let k = 0; k + 1 < pts.length; k += 2) { ctx.moveTo(...pts[k]); ctx.lineTo(...pts[k + 1]) }
    }
    ctx.stroke()
  }

  function render(): void {
    root.querySelector('.graphing')!.classList.toggle('show-graph', showGraph)
    drawList()
    drawOptions()
    draw()
  }

  function zoom(factor: number, cx?: number, cy?: number): void {
    const v = state.view!
    const x = cx ?? (v.xmin + v.xmax) / 2, y = cy ?? (v.ymin + v.ymax) / 2
    state.view = { xmin: x + (v.xmin - x) * factor, xmax: x + (v.xmax - x) * factor, ymin: y + (v.ymin - y) * factor, ymax: y + (v.ymax - y) * factor }
    drawOptions()
    draw()
  }

  function commit(input: HTMLInputElement): void {
    const i = input.dataset.i!
    const src = input.value.trim()
    if (i === 'new') {
      if (!src) return
      state.eqs.push({ src, color: state.eqs.length % LIGHT.length, style: 0, visible: true })
    } else if (!src) {
      state.eqs.splice(Number(i), 1)
    } else {
      state.eqs[Number(i)].src = src
    }
    reparse()
    render()
    if (i === 'new') root.querySelector<HTMLInputElement>('.eq-input[data-i=new]')?.focus()
  }

  root.addEventListener('mousedown', (e) => {
    if ((e.target as HTMLElement).closest('[data-ins]')) e.preventDefault()
  })
  root.addEventListener('click', (e) => {
    const t = e.target as HTMLElement
    const ins = t.closest<HTMLElement>('[data-ins]')
    if (ins) {
      const input = focused?.isConnected ? focused : root.querySelector<HTMLInputElement>('.eq-input[data-i=new]')!
      const s = ins.dataset.ins!
      if (s === '⏎') return commit(input)
      const a = input.selectionStart ?? input.value.length, b = input.selectionEnd ?? a
      if (s === '⌫') {
        const from = a === b ? Math.max(0, a - 1) : a
        input.value = input.value.slice(0, from) + input.value.slice(b)
        input.setSelectionRange(from, from)
      } else {
        input.value = input.value.slice(0, a) + s + input.value.slice(b)
        input.setSelectionRange(a + s.length, a + s.length)
      }
      input.focus()
      return
    }
    const b = t.closest<HTMLElement>('[data-a]')
    if (!b) {
      if (optionsOpen && !t.closest('.graph-options')) { optionsOpen = false; drawOptions() }
      return
    }
    const [cmd, arg, arg2] = b.dataset.a!.split(':')
    const i = Number(arg)
    switch (cmd) {
      case 'vis': state.eqs[i].visible = !state.eqs[i].visible; break
      case 'del': state.eqs.splice(i, 1); styleFor = null; reparse(); break
      case 'style': styleFor = styleFor === i ? null : i; break
      case 'color': state.eqs[i].color = Number(arg2); break
      case 'lstyle': state.eqs[i].style = Number(arg2); styleFor = null; break
      case 'zin': return zoom(1 / 1.5)
      case 'zout': return zoom(1.5)
      case 'zreset': { const { w, h } = size(); state.view = defaultView(w, h); break }
      case 'options': optionsOpen = !optionsOpen; break
    }
    render()
  })
  header.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('[data-a=toggleview]')) { showGraph = !showGraph; render() }
  })

  root.addEventListener('focusin', (e) => {
    const t = e.target as HTMLElement
    if (t.matches('.eq-input')) focused = t as HTMLInputElement
  })
  root.addEventListener('keydown', (e) => {
    const t = e.target as HTMLElement
    if (e.key === 'Enter' && t.matches('.eq-input')) commit(t as HTMLInputElement)
  })
  root.addEventListener('change', (e) => {
    const t = e.target as HTMLInputElement
    if (t.matches('.eq-input')) {
      if (t.dataset.i !== 'new') commit(t)
      return
    }
    if (t.dataset.win) {
      const val = Number(t.value)
      if (Number.isFinite(val)) state.view = { ...state.view!, [t.dataset.win]: val }
      if (state.view!.xmin >= state.view!.xmax || state.view!.ymin >= state.view!.ymax) state.view = null
      return render()
    }
    if (t.name === 'units') state.units = t.value as keyof typeof ANGLE
    if (t.name === 'gtheme') { state.theme = t.value as 'light' | 'match'; drawList() }
    const row = t.closest<HTMLElement>('.var-row')
    if (row) {
      const v = state.vars[row.dataset.v!]
      const n = Number(t.value)
      if (Number.isFinite(n)) {
        if (t.matches('.var-min')) v.min = n
        else if (t.matches('.var-max')) v.max = n
        else if (t.matches('.var-step') && n > 0) v.step = n
      }
      drawList()
    }
    draw()
  })
  root.addEventListener('input', (e) => {
    const t = e.target as HTMLInputElement
    const row = t.closest<HTMLElement>('.var-row')
    if (row && (t.matches('.var-range') || t.matches('.var-val'))) {
      const n = Number(t.value)
      if (!Number.isFinite(n)) return
      state.vars[row.dataset.v!].value = n
      row.querySelector<HTMLInputElement>(t.matches('.var-range') ? '.var-val' : '.var-range')!.value = String(n)
      draw()
    }
    if (t.matches('.thick')) { state.thickness = Number(t.value); draw() }
  })

  let drag: { x: number; y: number; view: ViewBox } | null = null
  canvas.addEventListener('pointerdown', (e) => {
    drag = { x: e.offsetX, y: e.offsetY, view: { ...state.view! } }
    canvas.setPointerCapture(e.pointerId)
  })
  canvas.addEventListener('pointermove', (e) => {
    if (drag) {
      const { w, h } = size()
      const v = drag.view
      const dx = ((e.offsetX - drag.x) / w) * (v.xmax - v.xmin), dy = ((e.offsetY - drag.y) / h) * (v.ymax - v.ymin)
      state.view = { xmin: v.xmin - dx, xmax: v.xmax - dx, ymin: v.ymin + dy, ymax: v.ymax + dy }
      hover = null
    } else {
      hover = { x: e.offsetX, y: e.offsetY }
    }
    draw()
  })
  canvas.addEventListener('pointerup', () => { drag = null; drawOptions() })
  canvas.addEventListener('pointerleave', () => { hover = null; draw() })
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault()
    const { w, h } = size()
    const v = state.view!
    zoom(e.deltaY > 0 ? 1.15 : 1 / 1.15, v.xmin + (e.offsetX / w) * (v.xmax - v.xmin), v.ymax - (e.offsetY / h) * (v.ymax - v.ymin))
  }, { passive: false })

  const ro = new ResizeObserver(() => draw())
  ro.observe(canvas)
  const mq = matchMedia('(prefers-color-scheme: dark)')
  const onScheme = () => render()
  mq.addEventListener('change', onScheme)

  reparse()
  render()
  return { destroy: () => { ro.disconnect(); mq.removeEventListener('change', onScheme) } }
}
