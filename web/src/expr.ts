export interface Scope { x: number; y: number; vars: Record<string, number>; angle: number }
export type Fn = (s: Scope) => number
export type Rel = '=' | '<' | '>' | '<=' | '>='
export interface Equation { kind: 'explicit' | 'implicit'; rel: Rel; f: Fn; vars: string[] }

interface Tok { t: 'num' | 'id' | 'fn' | 'op'; v: string }

const FUNCS = ['arcsinh', 'arccosh', 'arctanh', 'arcsin', 'arccos', 'arctan', 'asinh', 'acosh', 'atanh', 'asin', 'acos', 'atan',
  'sinh', 'cosh', 'tanh', 'sech', 'csch', 'coth', 'sin', 'cos', 'tan', 'sec', 'csc', 'cot', 'sqrt', 'cbrt', 'abs', 'ln', 'log',
  'exp', 'floor', 'ceil', 'round', 'sign', 'min', 'max']

function fact(n: number): number {
  if (n < 0 || !Number.isInteger(n)) return NaN
  let r = 1
  for (let i = 2; i <= n && r < Infinity; i++) r *= i
  return r
}

function tokenize(src: string): Tok[] {
  const s = src.replace(/×/g, '*').replace(/÷/g, '/').replace(/−/g, '-').replace(/≤/g, '<=').replace(/≥/g, '>=')
    .replace(/²/g, '^2').replace(/³/g, '^3').replace(/π/g, 'pi').replace(/√/g, 'sqrt')
  const out: Tok[] = []
  let i = 0
  while (i < s.length) {
    const c = s[i]
    if (/\s/.test(c)) { i++; continue }
    const rest = s.slice(i)
    const num = /^(\d+\.?\d*|\.\d+)/.exec(rest)
    if (num) { out.push({ t: 'num', v: num[0] }); i += num[0].length; continue }
    const word = /^[a-zA-Z]+/.exec(rest)
    if (word) {
      let w = word[0]
      i += w.length
      while (w) {
        const f = FUNCS.find((n) => w.startsWith(n))
        if (f) { out.push({ t: 'fn', v: f }); w = w.slice(f.length) }
        else if (w.startsWith('pi')) { out.push({ t: 'id', v: 'pi' }); w = w.slice(2) }
        else { out.push({ t: 'id', v: w[0] }); w = w.slice(1) }
      }
      continue
    }
    const op = /^(<=|>=|[-+*/^(),|!=<>])/.exec(rest)
    if (!op) throw new Error(`Unexpected "${c}"`)
    out.push({ t: 'op', v: op[0] })
    i += op[0].length
  }
  return out
}

class Parser {
  private i = 0
  readonly vars = new Set<string>()
  private readonly toks: Tok[]
  constructor(toks: Tok[]) { this.toks = toks }

  private peek(): Tok | undefined { return this.toks[this.i] }
  private isOp(v: string): boolean { const t = this.peek(); return !!t && t.t === 'op' && t.v === v }
  private expect(v: string): void {
    if (!this.isOp(v)) throw new Error(`Expected "${v}"`)
    this.i++
  }

  parse(): Fn {
    const f = this.expr()
    if (this.i < this.toks.length) throw new Error(`Unexpected "${this.toks[this.i].v}"`)
    return f
  }

  private expr(): Fn {
    let a = this.term()
    while (this.isOp('+') || this.isOp('-')) {
      const op = this.toks[this.i++].v, l = a, r = this.term()
      a = op === '+' ? (s) => l(s) + r(s) : (s) => l(s) - r(s)
    }
    return a
  }

  private term(): Fn {
    let a = this.unary()
    for (;;) {
      const t = this.peek()
      if (this.isOp('*') || this.isOp('/')) {
        const op = this.toks[this.i++].v, l = a, r = this.unary()
        a = op === '*' ? (s) => l(s) * r(s) : (s) => l(s) / r(s)
      } else if (t && (t.t !== 'op' || t.v === '(')) {
        const l = a, r = this.power()
        a = (s) => l(s) * r(s)
      } else return a
    }
  }

  private unary(): Fn {
    if (this.isOp('-')) { this.i++; const a = this.unary(); return (s) => -a(s) }
    if (this.isOp('+')) { this.i++; return this.unary() }
    return this.power()
  }

  private power(): Fn {
    const base = this.postfix()
    if (!this.isOp('^')) return base
    this.i++
    const e = this.unary()
    return (s) => Math.pow(base(s), e(s))
  }

  private postfix(): Fn {
    let a = this.primary()
    while (this.isOp('!')) { this.i++; const b = a; a = (s) => fact(b(s)) }
    return a
  }

  private primary(): Fn {
    const t = this.toks[this.i++]
    if (!t) throw new Error('Incomplete expression')
    if (t.t === 'num') { const v = Number(t.v); return () => v }
    if (t.t === 'op' && t.v === '(') { const e = this.expr(); this.expect(')'); return e }
    if (t.t === 'op' && t.v === '|') { const e = this.expr(); this.expect('|'); return (s) => Math.abs(e(s)) }
    if (t.t === 'id') {
      if (t.v === 'pi') return () => Math.PI
      if (t.v === 'e') return () => Math.E
      if (t.v === 'x') return (s) => s.x
      this.vars.add(t.v)
      if (t.v === 'y') return (s) => s.y
      const name = t.v
      return (s) => s.vars[name] ?? 0
    }
    if (t.t === 'fn') {
      const args: Fn[] = []
      if (this.isOp('(')) {
        this.i++
        args.push(this.expr())
        while (this.isOp(',')) { this.i++; args.push(this.expr()) }
        this.expect(')')
      } else {
        args.push(this.power())
      }
      return call(t.v, args)
    }
    throw new Error(`Unexpected "${t.v}"`)
  }
}

function call(name: string, args: Fn[]): Fn {
  const a = args[0]
  const trig = (f: (v: number) => number): Fn => (s) => f(a(s) * s.angle)
  const inv = (f: (v: number) => number): Fn => (s) => f(a(s)) / s.angle
  switch (name.replace(/^arc/, 'a')) {
    case 'sin': return trig(Math.sin)
    case 'cos': return trig(Math.cos)
    case 'tan': return trig(Math.tan)
    case 'sec': return trig((v) => 1 / Math.cos(v))
    case 'csc': return trig((v) => 1 / Math.sin(v))
    case 'cot': return trig((v) => 1 / Math.tan(v))
    case 'asin': return inv(Math.asin)
    case 'acos': return inv(Math.acos)
    case 'atan': return inv(Math.atan)
    case 'sinh': return (s) => Math.sinh(a(s))
    case 'cosh': return (s) => Math.cosh(a(s))
    case 'tanh': return (s) => Math.tanh(a(s))
    case 'sech': return (s) => 1 / Math.cosh(a(s))
    case 'csch': return (s) => 1 / Math.sinh(a(s))
    case 'coth': return (s) => 1 / Math.tanh(a(s))
    case 'asinh': return (s) => Math.asinh(a(s))
    case 'acosh': return (s) => Math.acosh(a(s))
    case 'atanh': return (s) => Math.atanh(a(s))
    case 'sqrt': return (s) => Math.sqrt(a(s))
    case 'cbrt': return (s) => Math.cbrt(a(s))
    case 'abs': return (s) => Math.abs(a(s))
    case 'ln': return (s) => Math.log(a(s))
    case 'log': return args.length > 1 ? (s) => Math.log(args[1](s)) / Math.log(a(s)) : (s) => Math.log10(a(s))
    case 'exp': return (s) => Math.exp(a(s))
    case 'floor': return (s) => Math.floor(a(s))
    case 'ceil': return (s) => Math.ceil(a(s))
    case 'round': return (s) => Math.round(a(s))
    case 'sign': return (s) => Math.sign(a(s))
    case 'min': return (s) => Math.min(...args.map((f) => f(s)))
    case 'max': return (s) => Math.max(...args.map((f) => f(s)))
  }
  throw new Error(`Unknown function ${name}`)
}

function parseSide(src: string): { f: Fn; vars: Set<string> } {
  if (!src.trim()) throw new Error('Incomplete expression')
  const p = new Parser(tokenize(src))
  return { f: p.parse(), vars: p.vars }
}

export function parseEquation(src: string): Equation {
  const s = src.replace(/^\s*[a-z]\s*\(\s*x\s*\)\s*=/i, 'y=')
  const m = /<=|>=|≤|≥|=|<|>/.exec(s)
  const varsOf = (sets: Set<string>[]) => [...new Set(sets.flatMap((v) => [...v]))].filter((v) => v !== 'y').sort()
  if (!m) {
    const { f, vars } = parseSide(s)
    return { kind: vars.has('y') ? 'implicit' : 'explicit', rel: '=', f, vars: varsOf([vars]) }
  }
  const rel = m[0].replace('≤', '<=').replace('≥', '>=') as Rel
  const lhs = s.slice(0, m.index), rhs = s.slice(m.index + m[0].length)
  const L = parseSide(lhs), R = parseSide(rhs)
  const vars = varsOf([L.vars, R.vars])
  if (rel === '=' && lhs.trim() === 'y' && !R.vars.has('y')) return { kind: 'explicit', rel, f: R.f, vars }
  if (rel === '=' && rhs.trim() === 'y' && !L.vars.has('y')) return { kind: 'explicit', rel, f: L.f, vars }
  return { kind: 'implicit', rel, f: (sc) => L.f(sc) - R.f(sc), vars }
}
