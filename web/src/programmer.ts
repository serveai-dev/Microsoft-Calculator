import { Engine, ProgArith, type Radix } from './engine.ts'
import { G, icon, group, fit, memoryHtml, type View } from './ui.ts'

const memory: bigint[] = []
const WORDS: [string, number][] = [['QWORD', 64], ['DWORD', 32], ['WORD', 16], ['BYTE', 8]]
const RADIXES: [string, Radix][] = [['HEX', 16], ['DEC', 10], ['OCT', 8], ['BIN', 2]]
const SHIFTS = [
  ['Arithmetic shift', 'b:lsh', 'b:rsh'],
  ['Logical shift', 'b:lsh', 'b:rshl'],
  ['Rotate circular shift', 'u:rol', 'u:ror'],
  ['Rotate through carry circular shift', 'u:rolc', 'u:rorc'],
]
const ENABLED_ON_ERROR = /^(d:|c$|ce$|clr$|bs$|eq$|radix|mflyout|mpick)/

export function mountProgrammer(root: HTMLElement, header: HTMLElement): View {
  const arith = new ProgArith()
  const eng = new Engine(arith, true)
  let bitMode = false, shift = 0
  let popup: 'bitwise' | 'shift' | null = null
  let overlay = false

  const groupFor = (s: string, r: Radix) => (r === 10 ? group(s) : group(s, r === 8 ? 3 : 4, ' '))
  const fmt = (v: bigint, r: Radix = arith.radix) => groupFor(arith.format(v, r), r)

  root.innerHTML = `<div class="calc programmer">
    <section class="calc-main">
      <div class="display"><div class="expr"></div><div class="result" aria-live="polite"></div></div>
      <div class="radix-list">${RADIXES.map(([n, r]) => `<button data-a="radix:${r}"><span class="rn">${n}</span><span class="rv"></span></button>`).join('')}</div>
      <div class="prog-tools">
        <button class="flat" data-a="keypad:full" title="Full keypad">${icon(G.fullKeypad)}</button>
        <button class="flat" data-a="keypad:bits" title="Bit toggling keypad">${icon(G.bitFlip)}</button>
        <button class="flat word" data-a="word"></button>
        <button class="flat" data-a="ms" title="Memory store (Ctrl+M)">${icon(G.ms)}</button>
        <button class="flat narrow-only" data-a="mflyout" title="Memory">${icon(G.mlist)}</button>
      </div>
      <div class="fly-row">
        <button class="flat" data-a="pop:bitwise">${icon(G.bitwise)}<span>Bitwise</span>${icon(G.chevron, 'chev')}</button>
        <button class="flat" data-a="pop:shift">${icon(G.bitshift)}<span>Bit shift</span>${icon(G.chevron, 'chev')}</button>
      </div>
      <div class="keypad k5"></div>
      <div class="bits" hidden></div>
      <div class="popup" hidden></div>
      <div class="overlay" hidden><div class="overlay-list"></div><button class="trash" data-a="mclear" title="Clear">${icon(G.trash)}</button></div>
    </section>
    <aside class="side">
      <div class="tabs"><button class="on">Memory</button></div>
      <div class="side-list"></div>
      <button class="trash" data-a="mclear" title="Clear">${icon(G.trash)}</button>
    </aside>
  </div>`
  header.innerHTML = ''

  const $ = <E extends HTMLElement>(s: string) => root.querySelector(s) as E
  const exprEl = $('.expr'), resultEl = $('.result'), keypad = $('.keypad'), bitsEl = $('.bits'), popupEl = $('.popup')

  function drawKeypad(): void {
    const [, l, r] = SHIFTS[shift]
    const op = (glyph: string, a: string) => `<button class="op" data-a="${a}">${icon(glyph)}</button>`
    const hex = (d: string) => `<button class="op hex" data-a="d:${d}">${d}</button>`
    const num = (d: string) => `<button class="num" data-a="d:${d}">${d}</button>`
    keypad.innerHTML = [
      hex('A'), op(G.lsh, l), op(G.rsh, r), `<button class="op" data-a="clr">C</button>`, op(G.back, 'bs'),
      hex('B'), `<button class="op" data-a="lp">(</button>`, `<button class="op" data-a="rp">)</button>`, op(G.percent, 'b:pmod'), op(G.div, 'b:÷'),
      hex('C'), num('7'), num('8'), num('9'), op(G.mul, 'b:×'),
      hex('D'), num('4'), num('5'), num('6'), op(G.minus, 'b:-'),
      hex('E'), num('1'), num('2'), num('3'), op(G.plus, 'b:+'),
      hex('F'), `<button class="num" data-a="neg">${icon(G.negate)}</button>`, num('0'), `<button class="num" disabled>.</button>`,
      `<button class="accent" data-a="eq">${icon(G.eq)}</button>`,
    ].join('')
  }

  function drawBits(): void {
    const u = arith.unsigned(eng.value)
    let html = ''
    for (let row = 3; row >= 0; row--) {
      html += '<div class="bit-row">'
      for (let nib = 3; nib >= 0; nib--) {
        const low = row * 16 + nib * 4
        html += '<div class="nibble"><div class="nib-bits">'
        for (let b = low + 3; b >= low; b--) {
          html += `<button data-a="bit:${b}" ${b >= arith.bits ? 'disabled' : ''}>${(u >> BigInt(b)) & 1n}</button>`
        }
        html += `</div><span class="nib-label">${low}</span></div>`
      }
      html += '</div>'
    }
    bitsEl.innerHTML = html
  }

  function drawPopup(): void {
    popupEl.hidden = !popup
    const row = root.querySelector<HTMLElement>('.fly-row')!
    popupEl.style.top = `${row.offsetTop + row.offsetHeight}px`
    if (popup === 'bitwise') {
      popupEl.className = 'popup bitwise'
      popupEl.innerHTML = [['AND', 'b:and'], ['OR', 'b:or'], ['NOT', 'u:not'], ['NAND', 'b:nand'], ['NOR', 'b:nor'], ['XOR', 'b:xor']]
        .map(([l, a]) => `<button class="op" data-a="${a}">${l}</button>`).join('')
    } else if (popup === 'shift') {
      popupEl.className = 'popup shift'
      popupEl.innerHTML = SHIFTS.map(([label], i) =>
        `<label class="radio" data-a="shift:${i}"><input type="radio" name="shift" ${i === shift ? 'checked' : ''}><span>${label}</span></label>`).join('')
    }
  }

  function render(): void {
    exprEl.textContent = eng.expression
    resultEl.textContent = eng.error ?? (eng.entry !== null ? groupFor(eng.entry, arith.radix) : fmt(eng.value))
    fit(resultEl, eng.error ? 30 : 46, 16)
    root.querySelectorAll<HTMLButtonElement>('.radix-list button').forEach((b) => {
      const r = Number(b.dataset.a!.split(':')[1]) as Radix
      b.classList.toggle('on', r === arith.radix)
      b.querySelector('.rv')!.textContent = eng.error ? '' : fmt(eng.value, r)
    })
    $('[data-a=word]').textContent = WORDS.find(([, b]) => b === arith.bits)![0]
    $('[data-a=clr]').textContent = eng.hasEntry || eng.error ? 'CE' : 'C'
    const n = eng.openParens
    $('[data-a=lp]').innerHTML = n ? `(<sub>${n}</sub>` : '('
    root.querySelectorAll<HTMLButtonElement>('.calc-main button[data-a]').forEach((b) => {
      const a = b.dataset.a!
      const digit = /^d:([0-9A-F])$/.exec(a)
      b.disabled = (!!eng.error && !ENABLED_ON_ERROR.test(a))
        || (!!digit && parseInt(digit[1], 16) >= arith.radix)
        || (a === 'mflyout' && !memory.length)
    })
    keypad.hidden = bitMode
    bitsEl.hidden = !bitMode
    if (bitMode) drawBits()
    root.querySelector('[data-a="keypad:full"]')!.classList.toggle('on', !bitMode)
    root.querySelector('[data-a="keypad:bits"]')!.classList.toggle('on', bitMode)
    const memFmt = (v: bigint) => fmt(v)
    $('.side-list').innerHTML = memoryHtml(memory, memFmt)
    $('.overlay').hidden = !overlay
    if (overlay) $('.overlay-list').innerHTML = memoryHtml(memory, memFmt)
  }

  function setBits(bits: number): void {
    arith.bits = bits
    const v = arith.wrap(eng.value)
    if (eng.entry !== null && !eng.evaluated && !eng.error) eng.setEntryValue(v)
    else eng.value = v
  }

  function act(a: string): void {
    const [cmd, arg, arg2] = a.split(':')
    if (cmd !== 'pop') popup = null
    switch (cmd) {
      case 'd': eng.digit(arg); break
      case 'b': eng.binary(arg); break
      case 'u': eng.unary(arg); break
      case 'neg': eng.negate(); break
      case 'eq': eng.equals(); break
      case 'c': eng.clear(); break
      case 'ce': eng.clearEntry(); break
      case 'clr': if (eng.hasEntry || eng.error) eng.clearEntry(); else eng.clear(); break
      case 'bs': eng.backspace(); break
      case 'lp': eng.openParen(); break
      case 'rp': eng.closeParen(); break
      case 'radix':
        arith.radix = Number(arg) as Radix
        if (eng.entry !== null && !eng.evaluated && !eng.error) eng.setEntryValue(eng.value)
        break
      case 'word': {
        const i = WORDS.findIndex(([, b]) => b === arith.bits)
        setBits(WORDS[(i + 1) % WORDS.length][1])
        break
      }
      case 'wordset': setBits(Number(arg)); break
      case 'keypad': bitMode = arg === 'bits'; break
      case 'bit': eng.setEntryValue(arith.wrap(eng.value ^ (1n << BigInt(arg)))); break
      case 'pop': popup = popup === arg ? null : (arg as 'bitwise' | 'shift'); break
      case 'shift': shift = Number(arg); drawKeypad(); break
      case 'ms': if (!eng.error) { memory.unshift(eng.value); eng.commit() } break
      case 'mflyout': overlay = !overlay; break
      case 'mclear': memory.length = 0; overlay = false; break
      case 'mpick': if (memory[Number(arg)] !== undefined) eng.setValue(memory[Number(arg)]); overlay = false; break
      case 'mitem': {
        const i = Number(arg2)
        if (arg === 'mc') memory.splice(i, 1)
        else if (!eng.error) memory[i] = arith.wrap(arg === 'm+' ? memory[i] + eng.value : memory[i] - eng.value)
        break
      }
    }
    drawPopup()
    render()
  }

  root.addEventListener('click', (e) => {
    const target = e.target as HTMLElement
    const b = target.closest<HTMLElement>('[data-a]')
    if (b && !(b as HTMLButtonElement).disabled) {
      e.preventDefault()
      act(b.dataset.a!)
    } else if (overlay && !target.closest('.overlay')) {
      overlay = false
      render()
    } else if (popup && !target.closest('.popup')) {
      popup = null
      drawPopup()
    }
  })

  const KEYS: Record<string, string> = {
    '+': 'b:+', '-': 'b:-', '*': 'b:×', '/': 'b:÷', '%': 'b:pmod', '(': 'lp', ')': 'rp', '&': 'b:and', '|': 'b:or',
    '^': 'b:xor', '~': 'u:not', '<': 'b:lsh', '>': 'b:rsh', Enter: 'eq', '=': 'eq', Escape: 'c', Delete: 'ce',
    Backspace: 'bs', F9: 'neg', F5: 'radix:16', F6: 'radix:10', F7: 'radix:8', F8: 'radix:2',
    F12: 'wordset:64', F2: 'wordset:32', F3: 'wordset:16', F4: 'wordset:8',
  }

  function key(e: KeyboardEvent): boolean {
    let a: string | undefined
    if (e.ctrlKey) a = e.key.toLowerCase() === 'm' ? 'ms' : undefined
    else if (e.altKey) return false
    else if (/^[0-9a-fA-F]$/.test(e.key)) a = 'd:' + e.key.toUpperCase()
    else a = KEYS[e.key]
    if (!a) return false
    const digit = /^d:(.)$/.exec(a)
    if (!digit || parseInt(digit[1], 16) < arith.radix) act(a)
    return true
  }

  drawKeypad()
  drawPopup()
  render()
  const onResize = () => fit(resultEl, eng.error ? 30 : 46, 16)
  window.addEventListener('resize', onResize)
  return { key, destroy: () => window.removeEventListener('resize', onResize) }
}
