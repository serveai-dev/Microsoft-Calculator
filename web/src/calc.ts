import { Engine, DecArith, D, type Dec, type HistoryItem, type Angle } from './engine.ts'
import { G, icon, group, fit, historyHtml, memoryHtml, type View } from './ui.ts'

export const memory: Dec[] = []
const histories: Record<string, HistoryItem<Dec>[]> = { standard: [], scientific: [] }

interface Key { l: string; a: string; c?: string; l2?: string; a2?: string }
const k = (l: string, a: string, c?: string, l2?: string, a2?: string): Key => ({ l, a, c, l2, a2 })
const N = (d: string): Key => k(d, 'd:' + d, 'num')
const DIGITS = (r: string, op: Key): Key[] => [...r].map(N).concat(op)
const BOTTOM: Key[] = [k(icon(G.negate), 'neg', 'num'), N('0'), k('.', 'dot', 'num'), k(icon(G.eq), 'eq', 'accent')]

const STD: Key[] = [
  k(icon(G.percent), 'pct'), k('CE', 'ce'), k('C', 'c'), k(icon(G.back), 'bs'),
  k(icon(G.recip), 'u:recip'), k(icon(G.sqr), 'u:sqr'), k(icon(G.sqrt), 'u:sqrt'), k(icon(G.div), 'b:÷'),
  ...DIGITS('789', k(icon(G.mul), 'b:×')), ...DIGITS('456', k(icon(G.minus), 'b:-')), ...DIGITS('123', k(icon(G.plus), 'b:+')),
  ...BOTTOM,
]

const SCI: Key[] = [
  k(icon(G.shift), 'second', 'toggle'), k(icon(G.pi), 'pi'), k('e', 'e'), k('C', 'clr'), k(icon(G.back), 'bs'),
  k(icon(G.sqr), 'u:sqr', '', icon(G.cube), 'u:cube'), k(icon(G.recip), 'u:recip'), k(icon(G.abs), 'u:abs'), k('exp', 'exp'), k('mod', 'b:mod'),
  k(icon(G.sqrt), 'u:sqrt', '', icon(G.cbrt), 'u:cbrt'), k('(', 'lp'), k(')', 'rp'), k(icon(G.fact), 'u:fact'), k(icon(G.div), 'b:÷'),
  k(icon(G.xpowy), 'b:pow', '', icon(G.yroot), 'b:root'), ...DIGITS('789', k(icon(G.mul), 'b:×')),
  k(icon(G.pow10), 'u:pow10', '', icon(G.pow2), 'u:pow2'), ...DIGITS('456', k(icon(G.minus), 'b:-')),
  k('log', 'u:log', '', icon(G.logy), 'b:logy'), ...DIGITS('123', k(icon(G.plus), 'b:+')),
  k('ln', 'u:ln', '', icon(G.epow), 'u:exp'), ...BOTTOM,
]

const TRIG = ['sin', 'cos', 'tan', 'sec', 'csc', 'cot']
const ANGLES: Angle[] = ['DEG', 'RAD', 'GRAD']
const ENABLED_ON_ERROR = /^(d:|dot$|c$|ce$|clr$|bs$|eq$|tab:|side|hflyout|hpick|mpick)/

export function mountCalc(root: HTMLElement, header: HTMLElement, mode: 'standard' | 'scientific'): View {
  const sci = mode === 'scientific'
  const arith = new DecArith(sci ? 32 : 16)
  const eng = new Engine(arith, sci, histories[mode])
  const fmt = (v: Dec) => group(arith.format(v))
  let second = false, trig2nd = false, hyp = false
  let sideTab: 'history' | 'memory' = 'history'
  let overlay: 'history' | 'memory' | null = null
  let popup: 'trig' | 'func' | null = null

  root.innerHTML = `<div class="calc ${mode}">
    <section class="calc-main">
      <div class="display"><div class="expr"></div><div class="result" aria-live="polite"></div></div>
      ${sci ? `<div class="sci-row"><button class="flat" data-a="angle"></button><button class="flat" data-a="fe">F-E</button></div>` : ''}
      <div class="mem-row">
        <button data-a="m:mc" title="Clear all memory (Ctrl+L)">${icon(G.mc)}</button>
        <button data-a="m:mr" title="Memory recall (Ctrl+R)">${icon(G.mr)}</button>
        <button data-a="m:m+" title="Memory add (Ctrl+P)">${icon(G.mplus)}</button>
        <button data-a="m:m-" title="Memory subtract (Ctrl+Q)">${icon(G.mminus)}</button>
        <button data-a="m:ms" title="Memory store (Ctrl+M)">${icon(G.ms)}</button>
        <button data-a="mflyout" class="narrow-only" title="Memory">${icon(G.mlist)}</button>
      </div>
      ${sci ? `<div class="fly-row">
        <button class="flat" data-a="pop:trig">${icon(G.trig)}<span>Trigonometry</span>${icon(G.chevron, 'chev')}</button>
        <button class="flat" data-a="pop:func">${icon(G.func)}<span>Function</span>${icon(G.chevron, 'chev')}</button>
      </div>` : ''}
      <div class="keypad"></div>
      <div class="popup" hidden></div>
      <div class="overlay" hidden><div class="overlay-list"></div><button class="trash" data-a="oclear" title="Clear">${icon(G.trash)}</button></div>
    </section>
    <aside class="side">
      <div class="tabs"><button data-a="tab:history">History</button><button data-a="tab:memory">Memory</button></div>
      <div class="side-list"></div>
      <button class="trash" data-a="sideclear" title="Clear">${icon(G.trash)}</button>
    </aside>
  </div>`
  header.innerHTML = `<button class="hdr-btn narrow-only" data-a="hflyout" title="History (Ctrl+H)">${icon(G.history)}</button>`

  const $ = <E extends HTMLElement>(s: string) => root.querySelector(s) as E
  const exprEl = $('.expr'), resultEl = $('.result'), keypad = $('.keypad'), popupEl = $('.popup')
  const overlayEl = $('.overlay'), overlayList = $('.overlay-list'), sideList = $('.side-list')

  function drawKeypad(): void {
    keypad.className = 'keypad ' + (sci ? 'k5' : 'k4')
    keypad.innerHTML = (sci ? SCI : STD).map((key) => {
      const alt = second && key.a2
      return `<button class="${key.c || 'op'}" data-a="${alt ? key.a2 : key.a}">${alt ? key.l2 : key.l}</button>`
    }).join('')
  }

  function drawPopup(): void {
    popupEl.hidden = !popup
    const row = root.querySelector<HTMLElement>('.fly-row')
    if (row) popupEl.style.top = `${row.offsetTop + row.offsetHeight}px`
    if (popup === 'trig') {
      const sup = trig2nd ? '<sup>-1</sup>' : ''
      const names = TRIG.map((t) => `<button class="op" data-a="trig:${t}">${t}${hyp ? 'h' : ''}${sup}</button>`)
      popupEl.className = 'popup trig'
      popupEl.innerHTML = `<button class="op toggle ${trig2nd ? 'on' : ''}" data-a="trig2nd">${icon(G.shift)}</button>${names.slice(0, 3).join('')}
        <button class="op toggle ${hyp ? 'on' : ''}" data-a="hyp">hyp</button>${names.slice(3).join('')}`
    } else if (popup === 'func') {
      popupEl.className = 'popup func'
      popupEl.innerHTML = [[G.abs, 'u:abs'], [G.floor, 'u:floor'], [G.ceil, 'u:ceil'], ['rand', 'rand'], [G.dms, 'u:dms'], [G.deg, 'u:degrees']]
        .map(([l, a]) => `<button class="op" data-a="${a}">${l === 'rand' ? l : icon(l)}</button>`).join('')
    }
  }

  function render(): void {
    exprEl.textContent = eng.expression
    resultEl.textContent = eng.error ?? group(eng.display)
    resultEl.classList.toggle('err', !!eng.error)
    fit(resultEl, eng.error ? 30 : 46, 16)
    root.querySelectorAll<HTMLButtonElement>('.calc-main button[data-a]').forEach((b) => {
      const a = b.dataset.a!
      b.disabled = (!!eng.error && !ENABLED_ON_ERROR.test(a)) || (!memory.length && /^(m:mc|m:mr|mflyout)$/.test(a))
    })
    if (sci) {
      $('[data-a=angle]').textContent = arith.angle
      $('[data-a=fe]').classList.toggle('on', arith.fe)
      $('[data-a=second]').classList.toggle('on', second)
      $('[data-a=clr]').textContent = eng.hasEntry || eng.error ? 'CE' : 'C'
      const n = eng.openParens
      $('[data-a=lp]').innerHTML = n ? `(<sub>${n}</sub>` : '('
    }
    root.querySelectorAll('[data-a^="tab:"]').forEach((b) => b.classList.toggle('on', b.getAttribute('data-a') === 'tab:' + sideTab))
    sideList.innerHTML = sideTab === 'history' ? historyHtml(eng.history, fmt) : memoryHtml(memory, fmt)
    overlayEl.hidden = !overlay
    if (overlay) overlayList.innerHTML = overlay === 'history' ? historyHtml(eng.history, fmt) : memoryHtml(memory, fmt)
  }

  function mem(op: string, i = 0): void {
    if (eng.error) return
    const v = eng.value
    if (op === 'mr') return memory.length ? eng.setValue(memory[i]) : undefined
    if (op === 'mc') { if (i < 0) memory.length = 0; else memory.splice(i, 1); return }
    if (op === 'ms' || !memory.length) memory.unshift(v)
    else memory[i] = op === 'm+' ? memory[i].plus(v) : memory[i].minus(v)
    eng.commit()
  }

  async function act(a: string): Promise<void> {
    const [cmd, arg, arg2] = a.split(':')
    if (cmd !== 'pop' && cmd !== 'trig2nd' && cmd !== 'hyp') popup = null
    switch (cmd) {
      case 'd': eng.digit(arg); break
      case 'b': eng.binary(arg); break
      case 'u': eng.unary(arg); break
      case 'dot': eng.dot(); break
      case 'neg': eng.negate(); break
      case 'eq': eng.equals(); break
      case 'c': eng.clear(); break
      case 'ce': eng.clearEntry(); break
      case 'clr': if (eng.hasEntry || eng.error) eng.clearEntry(); else eng.clear(); break
      case 'bs': eng.backspace(); break
      case 'pct': eng.percent(); break
      case 'lp': eng.openParen(); break
      case 'rp': eng.closeParen(); break
      case 'exp': eng.exp(); break
      case 'pi': eng.setValue(D.acos(-1)); break
      case 'e': eng.setValue(D.exp(1)); break
      case 'rand': eng.setValue(D.random(32)); break
      case 'second': second = !second; drawKeypad(); break
      case 'angle': arith.angle = ANGLES[(ANGLES.indexOf(arith.angle) + 1) % 3]; break
      case 'angleset': arith.angle = arg as Angle; break
      case 'fe': arith.fe = !arith.fe; break
      case 'pop': popup = popup === arg ? null : (arg as 'trig' | 'func'); break
      case 'trig2nd': trig2nd = !trig2nd; break
      case 'hyp': hyp = !hyp; break
      case 'trig': eng.unary((trig2nd ? 'a' : '') + arg + (hyp ? 'h' : '')); break
      case 'm': mem(arg, arg === 'mc' ? -1 : 0); break
      case 'mitem': mem(arg, Number(arg2)); break
      case 'mpick': mem('mr', Number(arg)); overlay = null; break
      case 'hpick': eng.recall(eng.history[Number(arg)]); overlay = null; break
      case 'tab': sideTab = arg as 'history' | 'memory'; break
      case 'sideclear': if (sideTab === 'history') eng.history.length = 0; else memory.length = 0; break
      case 'oclear': if (overlay === 'history') eng.history.length = 0; else memory.length = 0; overlay = null; break
      case 'hclear': eng.history.length = 0; break
      case 'hflyout': overlay = overlay === 'history' ? null : 'history'; break
      case 'mflyout': overlay = overlay === 'memory' ? null : 'memory'; break
      case 'copy': await navigator.clipboard?.writeText(eng.display); break
      case 'paste': {
        const t = (await navigator.clipboard?.readText())?.replace(/[,\s]/g, '') ?? ''
        if (/^-?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(t)) eng.setValue(new D(t))
        break
      }
    }
    drawPopup()
    render()
  }

  const onClick = (e: MouseEvent) => {
    const target = e.target as HTMLElement
    const b = target.closest<HTMLElement>('[data-a]')
    if (b && !(b as HTMLButtonElement).disabled) {
      void act(b.dataset.a!)
    } else if (overlay && !target.closest('.overlay')) {
      overlay = null
      render()
    } else if (popup && !target.closest('.popup')) {
      popup = null
      drawPopup()
    }
  }
  root.addEventListener('click', onClick)
  header.addEventListener('click', onClick)

  const KEYS: Record<string, string> = {
    '.': 'dot', ',': 'dot', '+': 'b:+', '-': 'b:-', '*': 'b:×', '/': 'b:÷', Enter: 'eq', '=': 'eq',
    Escape: 'c', Delete: 'ce', Backspace: 'bs', F9: 'neg', '@': 'u:sqrt', r: 'u:recip', q: 'u:sqr',
  }
  const SCI_KEYS: Record<string, string> = {
    '%': 'b:mod', '^': 'b:pow', y: 'b:pow', '#': 'u:cube', '!': 'u:fact', '(': 'lp', ')': 'rp', p: 'pi', x: 'exp',
    n: 'u:ln', l: 'u:log', L: 'b:logy', g: 'u:pow2', '|': 'u:abs', '[': 'u:floor', ']': 'u:ceil', m: 'u:dms',
    v: 'fe', F3: 'angleset:DEG', F4: 'angleset:RAD', F5: 'angleset:GRAD', Escape: 'clr',
  }
  const TRIG_KEYS: Record<string, string> = { s: 'sin', o: 'cos', t: 'tan', u: 'sec', i: 'csc', j: 'cot' }

  function key(e: KeyboardEvent): boolean {
    const kk = e.key, lower = kk.toLowerCase()
    let a: string | undefined
    if (e.ctrlKey) {
      a = ({ m: 'm:ms', p: 'm:m+', q: 'm:m-', r: 'm:mr', l: 'm:mc', h: 'hflyout', c: 'copy', v: 'paste' } as Record<string, string>)[lower]
      if (e.shiftKey && lower === 'd') a = 'hclear'
      if (sci && lower === 'g') a = 'u:pow10'
      if (sci && lower === 'y') a = 'b:root'
      if (sci && lower === 'n') a = 'u:exp'
      if (sci && TRIG_KEYS[lower]) a = `u:${e.shiftKey ? 'a' : ''}${TRIG_KEYS[lower]}h`
    } else if (e.altKey) {
      return false
    } else if (/^[0-9]$/.test(kk)) {
      a = 'd:' + kk
    } else if (sci) {
      a = TRIG_KEYS[lower] ? `u:${e.shiftKey ? 'a' : ''}${TRIG_KEYS[lower]}` : SCI_KEYS[kk] ?? KEYS[kk]
    } else {
      a = kk === '%' ? 'pct' : KEYS[kk]
    }
    if (!a) return false
    void act(a)
    return true
  }

  drawKeypad()
  drawPopup()
  render()
  const onResize = () => fit(resultEl, eng.error ? 30 : 46, 16)
  window.addEventListener('resize', onResize)
  return { key, destroy: () => window.removeEventListener('resize', onResize) }
}
