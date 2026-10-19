// Glyph codepoints from the real app (CalculatorIcons.ttf / Segoe Fluent Icons), see src/Calculator/Views/*.xaml
export const G = {
  nav: '', history: '', trash: '', back: '', settings: '', chevron: '',
  onTop: '', exitOnTop: '',
  percent: '', div: '', mul: '', minus: '', plus: '', eq: '', negate: '',
  recip: '', sqr: '', sqrt: '', cube: '', cbrt: '', xpowy: '', yroot: '',
  pow10: '', pow2: '', logy: '', epow: '', pi: '', fact: '', abs: '',
  floor: '', ceil: '', dms: '', deg: '', shift: '', trig: '', func: '',
  mc: '', mr: '', ms: '', mplus: '', mminus: '', mlist: '',
  bitwise: '', bitshift: '', lsh: '', rsh: '', fullKeypad: '', bitFlip: '',
  convNegate: '', graph: '', equations: '',
}

export const icon = (cp: string, cls = ''): string => `<span class="i ${cls}">${cp}</span>`

export function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
}

/** Adds digit grouping to the integer part of a plain number string (keeps exponent and trailing '.'). */
export function group(s: string, size = 3, sep = ','): string {
  const m = /^(-?)([0-9A-F]+)(.*)$/.exec(s)
  if (!m || size <= 0) return s
  const re = new RegExp(`\\B(?=([0-9A-F]{${size}})+(?![0-9A-F]))`, 'g')
  return m[1] + m[2].replace(re, sep) + m[3]
}

/** Shrinks font size until the text fits its box, like the real results display. */
export function fit(el: HTMLElement, max: number, min: number): void {
  let size = max
  el.style.fontSize = size + 'px'
  while (el.scrollWidth > el.clientWidth && size > min) {
    size -= 2
    el.style.fontSize = size + 'px'
  }
}

export function historyHtml<T>(items: { expr: string; result: T }[], fmt: (v: T) => string): string {
  if (!items.length) return `<p class="empty">There’s no history yet.</p>`
  return items.map((h, i) => `<button class="list-item" data-a="hpick:${i}">
      <span class="li-expr">${esc(h.expr)}</span><span class="li-val">${esc(fmt(h.result))}</span></button>`).join('')
}

export function memoryHtml<T>(items: T[], fmt: (v: T) => string): string {
  if (!items.length) return `<p class="empty">There’s nothing saved in memory.</p>`
  return items.map((v, i) => `<div class="list-item mem-item" data-a="mpick:${i}">
      <span class="li-val">${esc(fmt(v))}</span>
      <span class="mem-ops"><button data-a="mitem:mc:${i}">MC</button><button data-a="mitem:m+:${i}">M+</button><button data-a="mitem:m-:${i}">M-</button></span>
    </div>`).join('')
}

export interface View {
  key?(e: KeyboardEvent): boolean
  destroy?(): void
}
