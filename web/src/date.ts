import type { View } from './ui.ts'

const DAY = 86_400_000
const opts = Array.from({ length: 1000 }, (_, i) => `<option>${i}</option>`).join('')
const plural = (n: number, one: string, many: string) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`
const toInput = (t: number) => new Date(t).toISOString().slice(0, 10)
const fromInput = (s: string) => {
  const [y, m, d] = s.split('-').map(Number)
  return Date.UTC(y, m - 1, d)
}

/** Calendar add with month-end clamping, like Windows.Globalization.Calendar. */
function add(t: number, years: number, months: number, days: number): number {
  const d = new Date(t)
  const r = new Date(0)
  r.setUTCFullYear(d.getUTCFullYear() + years, d.getUTCMonth() + months, 1)
  const dim = new Date(Date.UTC(r.getUTCFullYear(), r.getUTCMonth() + 1, 0)).getUTCDate()
  r.setUTCDate(Math.min(d.getUTCDate(), dim) + days)
  return r.getTime()
}

export function diffText(a: number, b: number): [string, string] {
  if (a > b) [a, b] = [b, a]
  if (a === b) return ['Same dates', '']
  let years = 0, months = 0
  while (add(a, years + 1, 0, 0) <= b) years++
  while (add(a, years, months + 1, 0) <= b) months++
  let days = Math.round((b - add(a, years, months, 0)) / DAY)
  const weeks = Math.floor(days / 7)
  days %= 7
  const parts = [
    years && plural(years, 'year', 'years'), months && plural(months, 'month', 'months'),
    weeks && plural(weeks, 'week', 'weeks'), days && plural(days, 'day', 'days'),
  ].filter(Boolean)
  const total = plural(Math.round((b - a) / DAY), 'day', 'days')
  const main = parts.join(', ')
  return [main, main === total ? '' : total]
}

export function mountDate(root: HTMLElement, header: HTMLElement): View {
  const today = toInput(Date.now())
  header.innerHTML = ''
  root.innerHTML = `<div class="date-calc">
    <select class="combo mode"><option value="diff">Difference between dates</option><option value="add">Add or subtract days</option></select>
    <div class="pane diff">
      <label class="lbl">From<input type="date" class="from" value="${today}"></label>
      <label class="lbl">To<input type="date" class="to" value="${today}"></label>
      <div class="lbl">Difference</div>
      <div class="date-result"></div>
      <div class="date-sub"></div>
    </div>
    <div class="pane add" hidden>
      <label class="lbl">From<input type="date" class="afrom" value="${today}"></label>
      <div class="radios">
        <label class="radio"><input type="radio" name="dop" value="1" checked><span>Add</span></label>
        <label class="radio"><input type="radio" name="dop" value="-1"><span>Subtract</span></label>
      </div>
      <div class="ymd">
        <label class="lbl">Years<select class="combo y">${opts}</select></label>
        <label class="lbl">Months<select class="combo m">${opts}</select></label>
        <label class="lbl">Days<select class="combo d">${opts}</select></label>
      </div>
      <div class="lbl">Date</div>
      <div class="date-result add-result"></div>
    </div>
  </div>`

  const $ = <E extends HTMLElement>(s: string) => root.querySelector(s) as E
  function render(): void {
    const mode = $<HTMLSelectElement>('.mode').value
    $('.diff').hidden = mode !== 'diff'
    $('.add').hidden = mode !== 'add'
    const from = $<HTMLInputElement>('.from').value, to = $<HTMLInputElement>('.to').value
    const [main, sub] = from && to ? diffText(fromInput(from), fromInput(to)) : ['', '']
    $('.diff .date-result').textContent = main
    $('.date-sub').textContent = sub
    const afrom = $<HTMLInputElement>('.afrom').value
    if (!afrom) return
    const sign = Number(root.querySelector<HTMLInputElement>('input[name=dop]:checked')!.value)
    const num = (c: string) => sign * Number($<HTMLSelectElement>(c).value)
    const r = new Date(add(fromInput(afrom), num('.y'), num('.m'), num('.d')))
    const y = r.getUTCFullYear()
    $('.add-result').textContent = y < 1601 || y > 9999 ? 'Date out of Bound'
      : r.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' })
  }
  root.addEventListener('input', render)
  root.addEventListener('change', render)
  render()
  return {}
}
