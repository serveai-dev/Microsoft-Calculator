import './styles.css'
import { mountCalc } from './calc.ts'
import { mountProgrammer } from './programmer.ts'
import { mountDate } from './date.ts'
import { mountConverter } from './converter.ts'
import { mountGraphing } from './graphing.ts'
import { G, icon, type View } from './ui.ts'

type Mount = (root: HTMLElement, header: HTMLElement) => View
interface Mode { id: string; name: string; glyph: string; group: 'Calculator' | 'Converter' | 'Settings'; mount: Mount }

// Glyphs and order from src/Calculator.ViewModels/Common/NavCategory.cs
const CONVERTERS: [string, string, string][] = [
  ['Currency', 'Currency', ''], ['Volume', 'Volume', ''], ['Length', 'Length', ''],
  ['Weight', 'Weight and mass', ''], ['Temperature', 'Temperature', ''], ['Energy', 'Energy', ''],
  ['Area', 'Area', ''], ['Speed', 'Speed', ''], ['Time', 'Time', ''], ['Power', 'Power', ''],
  ['Data', 'Data', ''], ['Pressure', 'Pressure', ''], ['Angle', 'Angle', ''],
]

const MODES: Mode[] = [
  { id: 'standard', name: 'Standard', glyph: '', group: 'Calculator', mount: (r, h) => mountCalc(r, h, 'standard') },
  { id: 'scientific', name: 'Scientific', glyph: '', group: 'Calculator', mount: (r, h) => mountCalc(r, h, 'scientific') },
  { id: 'graphing', name: 'Graphing', glyph: '', group: 'Calculator', mount: mountGraphing },
  { id: 'programmer', name: 'Programmer', glyph: '', group: 'Calculator', mount: mountProgrammer },
  { id: 'date', name: 'Date calculation', glyph: '', group: 'Calculator', mount: mountDate },
  ...CONVERTERS.map(([id, name, glyph]): Mode => ({ id: id.toLowerCase(), name, glyph, group: 'Converter', mount: (r, h) => mountConverter(r, h, id) })),
  { id: 'settings', name: 'Settings', glyph: G.settings, group: 'Settings', mount: mountSettings },
]
const TITLES: Record<string, string> = { date: 'Date Calculation' }

const store = {
  get(k: string): string | null { try { return localStorage.getItem('calc.' + k) } catch { return null } },
  set(k: string, v: string): void { try { localStorage.setItem('calc.' + k, v) } catch { /* storage unavailable */ } },
}

let pipWindow: Window | null = null

// ---------- Theme ----------

function syncTheme(doc: Document): void {
  const t = document.documentElement.dataset.theme
  if (t) doc.documentElement.dataset.theme = t
  else delete doc.documentElement.dataset.theme
}

function applyTheme(t: string): void {
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t
  else delete document.documentElement.dataset.theme
  if (pipWindow) syncTheme(pipWindow.document)
}

function mountSettings(root: HTMLElement, header: HTMLElement): View {
  header.innerHTML = ''
  const theme = store.get('theme') ?? 'system'
  const opt = (v: string, label: string) =>
    `<label class="radio"><input type="radio" name="theme" value="${v}" ${theme === v ? 'checked' : ''}><span>${label}</span></label>`
  root.innerHTML = `<div class="settings">
    <h2>Appearance</h2>
    <div class="card">
      <div class="card-head">${icon('')}<div><div>App theme</div><div class="muted">Select which app theme to display</div></div></div>
      <div class="radios col">${opt('light', 'Light')}${opt('dark', 'Dark')}${opt('system', 'Use system setting')}</div>
    </div>
    <h2>About</h2>
    <div class="card">
      <div class="card-head">${icon('')}<div><div>Calculator</div><div class="muted">Web edition 1.0.0</div></div></div>
      <p class="muted">A web port of Microsoft Calculator. The original is open source under the MIT License.</p>
      <a class="link" href="https://github.com/microsoft/calculator" target="_blank" rel="noopener noreferrer">github.com/microsoft/calculator</a>
    </div>
  </div>`
  root.addEventListener('change', (e) => {
    const t = (e.target as HTMLInputElement).value
    store.set('theme', t)
    applyTheme(t)
  })
  return {}
}

// ---------- Shell ----------

const app = document.getElementById('app')!
const view = document.getElementById('view')!
const hdrExtra = document.getElementById('hdr-extra')!
const title = document.getElementById('title')!
const drawer = document.getElementById('drawer')!
const scrim = document.getElementById('scrim')!
const navBtn = document.getElementById('nav-btn')!
const onTopBtn = document.getElementById('ontop') as HTMLButtonElement
let current: View = {}

drawer.innerHTML = `<button class="hdr-btn" data-close title="Close Navigation">${icon(G.nav)}</button>
  <div class="nav-scroll">
    ${(['Calculator', 'Converter'] as const).map((g) => `<div class="nav-group">${g}</div>` + MODES.filter((m) => m.group === g)
      .map((m) => `<button class="nav-item" data-mode="${m.id}">${icon(m.glyph)}<span>${m.name}</span></button>`).join('')).join('')}
  </div>
  <button class="nav-item" data-mode="settings">${icon(G.settings)}<span>Settings</span></button>`

function setDrawer(open: boolean): void {
  drawer.hidden = scrim.hidden = !open
  if (open) drawer.querySelector<HTMLElement>('.nav-item.on')?.focus()
}

function show(id: string): void {
  const mode = MODES.find((m) => m.id === id) ?? MODES[0]
  if (pipWindow && mode.id !== 'standard') pipWindow.close()
  current.destroy?.()
  // Fresh children so listeners from the previous mode are dropped with them
  const root = document.createElement('div')
  root.className = 'view-root'
  const hdr = document.createElement('div')
  hdr.className = 'hdr-extra-inner'
  view.replaceChildren(root)
  hdrExtra.replaceChildren(hdr)
  title.textContent = TITLES[mode.id] ?? mode.name
  onTopBtn.hidden = mode.id !== 'standard'
  drawer.querySelectorAll('.nav-item').forEach((b) => b.classList.toggle('on', b.getAttribute('data-mode') === mode.id))
  app.dataset.mode = mode.id
  current = mode.mount(root, hdr)
  if (mode.id !== 'settings') store.set('mode', mode.id)
  setDrawer(false)
}

navBtn.addEventListener('click', () => setDrawer(drawer.hidden))
scrim.addEventListener('click', () => setDrawer(false))
drawer.addEventListener('click', (e) => {
  const t = e.target as HTMLElement
  if (t.closest('[data-close]')) return setDrawer(false)
  const item = t.closest<HTMLElement>('[data-mode]')
  if (item) show(item.dataset.mode!)
})

// ---------- Keep on top (Document Picture-in-Picture) ----------

interface DocumentPip { requestWindow(o: { width: number; height: number }): Promise<Window> }

function setOnTopIcon(): void {
  onTopBtn.innerHTML = icon(pipWindow ? G.exitOnTop : G.onTop)
  onTopBtn.title = pipWindow ? 'Back to full view' : 'Keep on top'
}

async function toggleOnTop(): Promise<void> {
  if (pipWindow) return pipWindow.close()
  const dpip = (window as unknown as { documentPictureInPicture?: DocumentPip }).documentPictureInPicture
  if (!dpip) {
    alert('Keep on top needs Microsoft Edge or Google Chrome.')
    return
  }
  const pip = await dpip.requestWindow({ width: 320, height: 400 })
  const doc = pip.document
  const base = doc.createElement('base')
  base.href = location.href
  doc.head.append(base)
  document.head.querySelectorAll('style, link[rel=stylesheet]').forEach((n) => doc.head.append(n.cloneNode(true)))
  syncTheme(doc)
  doc.title = 'Calculator'
  app.classList.add('compact')
  doc.body.append(app)
  pipWindow = pip
  setOnTopIcon()
  pip.addEventListener('keydown', onKey)
  pip.addEventListener('resize', () => window.dispatchEvent(new Event('resize')))
  pip.addEventListener('pagehide', () => {
    app.classList.remove('compact')
    document.body.append(app)
    pipWindow = null
    setOnTopIcon()
    window.dispatchEvent(new Event('resize'))
  })
  window.dispatchEvent(new Event('resize'))
}
onTopBtn.addEventListener('click', () => void toggleOnTop())

// ---------- Keyboard ----------

const ALT_MODES = ['standard', 'scientific', 'graphing', 'programmer', 'date']

function onKey(e: KeyboardEvent): void {
  if (e.altKey && /^[1-5]$/.test(e.key)) {
    e.preventDefault()
    show(ALT_MODES[Number(e.key) - 1])
    return
  }
  if (e.key === 'Escape' && !drawer.hidden) return setDrawer(false)
  const t = e.target as HTMLElement
  if (t.matches?.('input:not([type=radio]):not([type=range]), select, textarea')) return
  if (current.key?.(e)) e.preventDefault()
}
window.addEventListener('keydown', onKey)

applyTheme(store.get('theme') ?? 'system')
navBtn.innerHTML = icon(G.nav)
setOnTopIcon()
show(store.get('mode') ?? 'standard')
