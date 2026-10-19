import UNITS from './units.json' with { type: 'json' }
import { G, icon, esc, group, fit, type View } from './ui.ts'

interface Unit { name: string; abbr: string; source: boolean; target: boolean; whimsical: boolean; factor?: number }
type Conv = (v: number) => number

const NEGATIVE = new Set(['Temperature', 'Power', 'Angle'])
// UnitConverter.cpp constants
const MAX_DIGITS = 15, OPTIMAL_DIGITS = 7, OPTIMAL_DECIMAL = 1e-6, MIN_DECIMAL = 1e-14

const TO_C: Record<string, Conv> = { Celsius: (v) => v, Fahrenheit: (v) => (v - 32) * 0.5555555555555556, Kelvin: (v) => v - 273.15 }
const FROM_C: Record<string, Conv> = { Celsius: (v) => v, Fahrenheit: (v) => v * 1.8 + 32, Kelvin: (v) => v + 273.15 }

function converter(from: Unit, to: Unit): Conv {
  if (from.factor === undefined || to.factor === undefined) return (v) => FROM_C[to.name](TO_C[from.name](v))
  const ratio = from.factor / to.factor
  return (v) => v * ratio
}

const trim = (s: string) => (s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s)
const wholeDigits = (v: number) => (v === 0 ? 1 : Math.floor(1 + Math.max(0, Math.log10(Math.abs(v)))))

/** Port of UnitConverter::Calculate rounding. */
export function formatResult(v: number, inputDigits: number): string {
  const pre = wholeDigits(v)
  if (pre > MAX_DIGITS || (v !== 0 && Math.abs(v) < MIN_DECIMAL)) {
    const [m, e] = v.toExponential(MAX_DIGITS - 1).split('e')
    return `${trim(m)}e${e}`
  }
  let precision = MAX_DIGITS
  if (Math.abs(v) >= OPTIMAL_DECIMAL) {
    const n = Math.max(OPTIMAL_DIGITS, Math.min(MAX_DIGITS, inputDigits))
    precision = n > pre ? n - pre : 0
  }
  return trim(v.toFixed(precision))
}

/** Port of UnitConverter::CalculateSuggested ("About equal to"). */
function suggestions(value: number, from: Unit, to: Unit, units: Unit[], negative: boolean): string[] {
  const conv = units.filter((u) => u !== from && u !== to).map((u) => {
    const v = converter(from, u)(value)
    return { u, v, mag: Math.log10(v) }
  })
  conv.sort((a, b) => (Math.abs(a.mag) === Math.abs(b.mag) ? b.mag - a.mag : Math.abs(a.mag) - Math.abs(b.mag)))
  const round = (v: number) => trim(v.toFixed(Math.abs(v) < 100 ? 2 : Math.abs(v) < 1000 ? 1 : 0))
  const out = conv.filter((c) => !c.u.whimsical).map((c) => ({ ...c, s: round(c.v) }))
    .filter((c) => Number(c.s) !== 0 || negative).map((c) => `${group(c.s)} ${c.u.abbr}`)
  const whim = conv.filter((c) => c.u.whimsical).map((c) => ({ ...c, s: round(c.v) })).find((c) => Number(c.s) !== 0)
  const top = out.slice(0, 3)
  return whim ? [...top, `${group(whim.s)} ${whim.u.abbr}`] : top
}

// ---------- Currency ----------

interface Rates { base: string; rates: Record<string, number>; updated: number }
const RATES_KEY = 'calc.rates'
const currencyName = new Intl.DisplayNames(['en-US'], { type: 'currency' })

function loadCachedRates(): Rates | null {
  try {
    return JSON.parse(localStorage.getItem(RATES_KEY) ?? 'null')
  } catch {
    return null
  }
}

async function fetchRates(): Promise<Rates> {
  // ponytail: free open.er-api.com feed instead of the private Bing endpoint the real app uses
  const res = await fetch('https://open.er-api.com/v6/latest/USD')
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const data = await res.json()
  if (data.result !== 'success') throw new Error('bad response')
  const r: Rates = { base: 'USD', rates: data.rates, updated: data.time_last_update_unix * 1000 }
  try { localStorage.setItem(RATES_KEY, JSON.stringify(r)) } catch { /* storage unavailable */ }
  return r
}

function currencyUnits(r: Rates): Unit[] {
  return Object.keys(r.rates).sort().map((code) => ({
    name: `${currencyName.of(code) ?? code} (${code})`, abbr: code, source: code === 'USD', target: code === 'EUR',
    whimsical: false, factor: 1 / r.rates[code],
  }))
}

const currencyFormat = (code: string) => new Intl.NumberFormat('en-US', { style: 'currency', currency: code })
const symbolOf = (code: string) => currencyFormat(code).formatToParts(0).find((p) => p.type === 'currency')?.value ?? code
const fractionOf = (code: string) => currencyFormat(code).resolvedOptions().maximumFractionDigits ?? 2

// ---------- View ----------

export function mountConverter(root: HTMLElement, header: HTMLElement, category: string): View {
  const currency = category === 'Currency'
  const negative = NEGATIVE.has(category)
  let rates = currency ? loadCachedRates() : null
  let status = ''
  const catalog = UNITS as Record<string, Unit[]>
  let units: Unit[] = currency ? (rates ? currencyUnits(rates) : []) : catalog[category].filter((u) => !u.whimsical)
  const sel = [Math.max(0, units.findIndex((u) => u.source)), Math.max(0, units.findIndex((u) => u.target))]
  let active = 0
  let entry = '1'
  let freshEntry = false

  header.innerHTML = ''
  root.innerHTML = `<div class="converter">
    <div class="conv-values">
      ${[0, 1].map((i) => `<button class="cv" data-a="focus:${i}"><span class="cv-num"></span></button>
        <select class="combo unit" data-i="${i}"></select>`).join('')}
    </div>
    <div class="supp"></div>
    <div class="keypad k3 conv-keys">
      <button class="op ghost" disabled></button><button class="op" data-a="ce">CE</button><button class="op" data-a="bs">${icon(G.back)}</button>
      ${'789456123'.split('').map((d) => `<button class="num" data-a="d:${d}">${d}</button>`).join('')}
      ${negative ? `<button class="num" data-a="neg">${icon(G.convNegate)}</button>` : '<button class="num ghost" disabled></button>'}
      <button class="num" data-a="d:0">0</button><button class="num" data-a="dot">.</button>
    </div>
  </div>`

  const supp = root.querySelector<HTMLElement>('.supp')!
  const selects = [...root.querySelectorAll<HTMLSelectElement>('select.unit')]
  const nums = [...root.querySelectorAll<HTMLElement>('.cv-num')]

  function fillSelects(): void {
    const opts = units.map((u, i) => `<option value="${i}">${esc(u.name)}</option>`).join('')
    selects.forEach((s, i) => { s.innerHTML = opts; s.value = String(sel[i]) })
  }

  function render(): void {
    const value = Number(entry) || 0
    const from = units[sel[active]], to = units[sel[1 - active]]
    let out = ''
    if (from && to) {
      const v = converter(from, to)(value)
      out = currency ? v.toFixed(fractionOf(to.abbr)) : formatResult(v, entry.replace(/[-.]/g, '').length)
    }
    const show = (s: string, u?: Unit) => (currency && u ? `${symbolOf(u.abbr)} ` : '') + group(s)
    nums[active].textContent = show(entry, from)
    nums[1 - active].textContent = show(out, to)
    root.querySelectorAll('.cv').forEach((b, i) => b.classList.toggle('active', i === active))
    nums.forEach((n) => fit(n, 46, 18))
    if (currency) {
      const f = units[sel[0]], t = units[sel[1]]
      const when = rates ? new Date(rates.updated) : null
      supp.innerHTML = f && t ? `<div>1 ${esc(f.abbr)} = ${converter(f, t)(1).toFixed(4)} ${esc(t.abbr)}</div>
        <div class="muted">${when ? `Updated ${when.toLocaleDateString('en-US')} ${when.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}` : ''}</div>
        <button class="link" data-a="refresh">Update rates</button><div class="muted">${esc(status)}</div>`
        : `<div class="muted">${esc(status || 'Loading currency rates…')}</div>`
    } else {
      const list = suggestions(value, from, to, catalog[category], negative)
      supp.innerHTML = list.length ? `<div class="muted">About equal to</div>${list.map((s) => `<div>${esc(s)}</div>`).join('')}` : ''
    }
  }

  async function refresh(): Promise<void> {
    status = 'Updating…'
    render()
    try {
      rates = await fetchRates()
      const codes = [units[sel[0]]?.abbr ?? 'USD', units[sel[1]]?.abbr ?? 'EUR']
      units = currencyUnits(rates)
      codes.forEach((c, i) => { sel[i] = Math.max(0, units.findIndex((u) => u.abbr === c)) })
      fillSelects()
      status = ''
    } catch {
      status = 'Failed to update rates. Check your connection.'
    }
    render()
  }

  function act(a: string): void {
    const [cmd, arg] = a.split(':')
    const fraction = currency && units[sel[active]] ? fractionOf(units[sel[active]].abbr) : Infinity
    switch (cmd) {
      case 'd': {
        const cur = freshEntry ? '0' : entry
        const next = cur === '0' ? arg : cur === '-0' ? '-' + arg : cur + arg
        const dec = next.split('.')[1]
        if (next.replace(/[-.]/g, '').length > MAX_DIGITS || (dec !== undefined && dec.length > fraction)) return
        entry = next
        freshEntry = false
        break
      }
      case 'dot':
        if (freshEntry) { entry = '0'; freshEntry = false }
        if (!entry.includes('.') && fraction > 0) entry += '.'
        break
      case 'bs':
        freshEntry = false
        entry = entry.slice(0, -1)
        if (entry === '' || entry === '-') entry = '0'
        break
      case 'ce': entry = '0'; freshEntry = false; break
      case 'neg': if (entry !== '0') entry = entry.startsWith('-') ? entry.slice(1) : '-' + entry; break
      case 'focus': {
        const i = Number(arg)
        if (i === active) return
        entry = nums[i].textContent!.replace(/[^\d.\-e+]/g, '') || '0'
        active = i
        freshEntry = true
        break
      }
      case 'refresh': void refresh(); return
    }
    render()
  }

  root.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-a]')
    if (b && !(b as HTMLButtonElement).disabled) act(b.dataset.a!)
  })
  root.addEventListener('change', (e) => {
    const s = e.target as HTMLSelectElement
    if (!s.matches('select.unit')) return
    sel[Number(s.dataset.i)] = Number(s.value)
    render()
  })

  function key(e: KeyboardEvent): boolean {
    if (e.ctrlKey || e.altKey || (e.target as HTMLElement).matches('select')) return false
    const a = /^[0-9]$/.test(e.key) ? 'd:' + e.key
      : ({ '.': 'dot', ',': 'dot', Backspace: 'bs', Escape: 'ce', Delete: 'ce', F9: negative ? 'neg' : '' } as Record<string, string>)[e.key]
    if (!a) return false
    act(a)
    return true
  }

  fillSelects()
  render()
  if (currency && (!rates || Date.now() - rates.updated > 86_400_000)) void refresh()
  return { key }
}
