import Decimal from 'decimal.js'

export const D = Decimal.clone({ precision: 48, rounding: Decimal.ROUND_HALF_UP, maxE: 9999, minE: -9999, toExpNeg: -9999, toExpPos: 9999 })
export type Dec = Decimal

export class CalcError extends Error {}
export const ERR = {
  div0: 'Cannot divide by zero',
  undef: 'Result is undefined',
  invalid: 'Invalid input',
  overflow: 'Overflow',
}

// Expression symbols and precedence mirror CalcManager (CEngineStrings.resw, scicomm.cpp NPrecedenceOfOp)
export const SYM: Record<string, string> = {
  '+': '+', '-': '-', '×': '×', '÷': '÷', mod: 'Mod', pow: '^', root: 'yroot', logy: 'log base',
  pmod: '%', and: 'AND', or: 'OR', xor: 'XOR', nand: 'NAND', nor: 'NOR', lsh: 'Lsh', rsh: 'Rsh', rshl: 'Rsh',
}
const PREC: Record<string, number> = {
  or: 0, xor: 0, and: 1, nand: 1, nor: 1, '+': 2, '-': 2,
  lsh: 3, rsh: 3, rshl: 3, mod: 3, pmod: 3, '÷': 3, '×': 3, pow: 4, root: 4, logy: 4,
}

export interface Arith<T> {
  zero: T
  parse(entry: string): T
  format(v: T): string
  binary(op: string, a: T, b: T): T
  unary(op: string, v: T): T
  label(op: string): string
  canEnter(entry: string): boolean
}

export interface HistoryItem<T> { expr: string; result: T }
const MAX_HISTORY = 20

function join(tokens: string[]): string {
  return tokens.join(' ').replace(/\( /g, '(').replace(/ \)/g, ')')
}

export class Engine<T> {
  value: T
  entry: string | null = '0'
  operandText: string | null = null
  error: string | null = null
  exprOverride: string | null = null
  evaluated = false
  private tokens: string[] = []
  private vals: T[] = []
  private ops: string[] = []
  private parens: number[] = []
  private opPending = false
  private last: { op: string; b: T } | null = null
  readonly arith: Arith<T>
  readonly precedence: boolean
  readonly history: HistoryItem<T>[]

  constructor(arith: Arith<T>, precedence: boolean, history: HistoryItem<T>[] = []) {
    this.arith = arith
    this.precedence = precedence
    this.history = history
    this.value = arith.zero
  }

  get expression(): string {
    if (this.exprOverride !== null) return this.exprOverride
    return join(this.operandText === null ? this.tokens : [...this.tokens, this.operandText])
  }
  get display(): string { return this.error ?? this.entry ?? this.arith.format(this.value) }
  get openParens(): number { return this.parens.length }
  get hasEntry(): boolean { return this.entry !== null && this.entry !== '0' }

  clear(): void {
    this.value = this.arith.zero
    this.entry = '0'
    this.operandText = this.error = this.exprOverride = this.last = null
    this.evaluated = this.opPending = false
    this.tokens = []; this.vals = []; this.ops = []; this.parens = []
  }

  clearEntry(): void {
    if (this.error || this.evaluated) return this.clear()
    this.entry = '0'
    this.value = this.arith.zero
    this.operandText = null
    this.opPending = false
  }

  private fresh(): void {
    if (this.error || this.evaluated) this.clear()
  }

  private setEntry(s: string): void {
    this.entry = s
    this.operandText = null
    this.value = this.arith.parse(s)
    this.opPending = false
  }

  /** Keep a computed value as the current operand when continuing after '='. */
  private keepValue(): void {
    if (this.evaluated) {
      const v = this.value
      this.clear()
      this.value = v
      this.entry = null
    }
  }

  digit(d: string): void {
    this.fresh()
    const cur = this.entry ?? '0'
    const ei = cur.indexOf('e')
    let next: string
    if (ei >= 0) {
      const exp = cur.slice(ei + 2)
      const digits = (exp === '0' ? '' : exp) + d
      if (digits.length > 4) return
      next = cur.slice(0, ei + 2) + digits
    } else {
      next = cur === '0' ? d : cur === '-0' ? '-' + d : cur + d
      if (!this.arith.canEnter(next)) return
    }
    this.setEntry(next)
  }

  dot(): void {
    this.fresh()
    const cur = this.entry ?? '0'
    if (cur.includes('.') || cur.includes('e')) return
    this.setEntry(cur + '.')
  }

  exp(): void {
    this.fresh()
    const cur = this.entry ?? '0'
    if (cur.includes('e')) return
    this.setEntry(cur + (cur.includes('.') ? '' : '.') + 'e+0')
  }

  backspace(): void {
    if (this.error) return this.clear()
    if (this.evaluated) { this.exprOverride = ''; return }
    if (this.entry === null) return
    let s = /e[+-]0$/.test(this.entry) ? this.entry.slice(0, -3) : this.entry.slice(0, -1)
    if (/e[+-]$/.test(s)) s += '0'
    if (s === '' || s === '-') s = '0'
    this.setEntry(s)
  }

  negate(): void {
    if (this.error) return
    if (this.entry !== null && !this.evaluated) {
      const e = this.entry
      if (e.includes('e')) this.setEntry(e.includes('e+') ? e.replace('e+', 'e-') : e.replace('e-', 'e+'))
      else if (e !== '0') this.setEntry(e.startsWith('-') ? e.slice(1) : '-' + e)
      return
    }
    this.unary('negate')
  }

  /** Ends number entry so the next digit starts a new number (MS, M+, M-). */
  commit(): void {
    if (this.entry !== null && !this.error) this.entry = null
  }

  setValue(v: T): void {
    this.fresh()
    this.entry = null
    this.operandText = null
    this.value = v
    this.opPending = false
  }

  /** Replaces the current operand with an editable value (programmer bit toggling, base change). */
  setEntryValue(v: T): void {
    if (this.error) return
    this.keepValue()
    this.setEntry(this.arith.format(v))
  }

  unary(op: string): void {
    if (this.error) return
    this.keepValue()
    const text = this.operandText ?? this.arith.format(this.value)
    this.operandText = `${this.arith.label(op)}(${text})`
    this.entry = null
    this.opPending = false
    try {
      this.value = this.arith.unary(op, this.value)
    } catch (e) {
      this.fail(e)
    }
  }

  percent(): void {
    if (this.error) return
    this.keepValue()
    const a = this.arith
    const op = this.ops[this.ops.length - 1]
    const left = op && op !== '(' ? this.vals[this.vals.length - 1] : a.zero
    try {
      const pct = a.binary('÷', this.value, a.parse('100'))
      this.value = op === '×' || op === '÷' ? pct : a.binary('×', left, pct)
    } catch (e) {
      return this.fail(e)
    }
    this.operandText = a.format(this.value)
    this.entry = null
    this.opPending = false
  }

  binary(op: string): void {
    if (this.error) return
    this.keepValue()
    if (this.opPending) {
      this.ops[this.ops.length - 1] = op
      this.tokens[this.tokens.length - 1] = SYM[op]
      return
    }
    this.tokens.push(this.operandText ?? this.arith.format(this.value))
    this.vals.push(this.value)
    if (!this.reduce(PREC[op])) return
    this.ops.push(op)
    this.tokens.push(SYM[op])
    this.value = this.vals[this.vals.length - 1]
    this.entry = null
    this.operandText = null
    this.opPending = true
  }

  openParen(): void {
    if (this.error) return
    if (this.evaluated) this.clear()
    this.parens.push(this.tokens.length)
    this.tokens.push('(')
    this.ops.push('(')
    this.entry = '0'
    this.value = this.arith.zero
    this.operandText = null
    this.opPending = false
  }

  closeParen(): void {
    if (this.error || !this.parens.length) return
    const inner = this.operandText ?? this.arith.format(this.value)
    this.vals.push(this.value)
    if (!this.reduce(-Infinity)) return
    this.ops.pop()
    const group = this.tokens.splice(this.parens.pop()!)
    this.operandText = join([...group, inner]) + ')'
    this.value = this.vals.pop()!
    this.entry = null
    this.opPending = false
  }

  equals(): void {
    if (this.error) return this.clear()
    const a = this.arith
    if (this.evaluated) {
      if (!this.last) return
      const { op, b } = this.last
      this.exprOverride = `${a.format(this.value)} ${SYM[op]} ${a.format(b)} =`
      try {
        this.value = a.binary(op, this.value, b)
      } catch (e) {
        return this.fail(e)
      }
      return this.record()
    }
    const hadOp = this.tokens.length > 0
    const parts = [...this.tokens, this.operandText ?? a.format(this.value), ...this.parens.map(() => ')')]
    this.exprOverride = join(parts) + ' ='
    this.vals.push(this.value)
    while (this.ops.length) {
      if (!this.reduce(-Infinity)) return
      this.ops.pop()
    }
    this.value = this.vals.pop()!
    this.tokens = []; this.parens = []; this.vals = []
    this.entry = this.operandText = null
    this.opPending = false
    this.evaluated = true
    if (hadOp) this.record()
  }

  recall(item: HistoryItem<T>): void {
    this.clear()
    this.value = item.result
    this.exprOverride = item.expr
    this.entry = null
    this.evaluated = true
  }

  private record(): void {
    this.evaluated = true
    this.history.unshift({ expr: this.exprOverride ?? '', result: this.value })
    if (this.history.length > MAX_HISTORY) this.history.pop()
  }

  private reduce(minPrec: number): boolean {
    try {
      while (this.ops.length) {
        const op = this.ops[this.ops.length - 1]
        if (op === '(' || (this.precedence && PREC[op] < minPrec)) break
        this.ops.pop()
        const b = this.vals.pop()!
        const a = this.vals.pop()!
        this.vals.push(this.arith.binary(op, a, b))
        this.last = { op, b }
      }
      return true
    } catch (e) {
      this.fail(e)
      return false
    }
  }

  private fail(e: unknown): void {
    if (!(e instanceof CalcError)) throw e
    if (this.exprOverride === null) this.exprOverride = this.expression
    this.error = e.message
    this.entry = null
  }
}

// ---------- Decimal arithmetic (Standard / Scientific) ----------

export type Angle = 'DEG' | 'RAD' | 'GRAD'
const PI = D.acos(-1)
const ONE = new D(1)
const ANGLE_SUB: Record<Angle, string> = { DEG: '₀', RAD: 'ᵣ', GRAD: '₉' }
const LABELS: Record<string, string> = {
  negate: 'negate', sqr: 'sqr', cube: 'cube', sqrt: '√', cbrt: 'cuberoot', recip: '1/', pow10: '10^', pow2: '2^',
  exp: 'e^', ln: 'ln', log: 'log', abs: 'abs', floor: 'floor', ceil: 'ceil', fact: 'fact', dms: 'dms', degrees: 'degrees',
}

/** Port of ratpak NumberToString (conv.cpp) for NumberFormat::Float / Scientific. */
export function formatNumber(v: Dec, precision: number, forceSci = false): string {
  if (v.isNaN()) return 'NaN'
  if (v.isZero()) return forceSci ? '0.e+0' : '0'
  const parts = (abs: Dec) => {
    const [m, e] = abs.toExponential().split('e')
    return { digits: m.replace('.', '').replace(/0+$/, '') || '0', exponent: Number(e) + 1 }
  }
  let { digits, exponent } = parts(v.abs().toSignificantDigits(precision))
  let sci = forceSci || exponent > precision
  if (!sci && digits.length - exponent > precision) {
    if (exponent >= -2) ({ digits, exponent } = parts(v.abs().toDecimalPlaces(precision)))
    else sci = true
  }
  let s: string
  if (sci) {
    const eout = exponent - 1
    s = `${digits[0]}.${digits.slice(1)}e${eout < 0 ? '-' : '+'}${Math.abs(eout)}`
  } else if (exponent <= 0) {
    s = '0.' + '0'.repeat(-exponent) + digits
  } else if (digits.length <= exponent) {
    s = digits + '0'.repeat(exponent - digits.length)
  } else {
    s = digits.slice(0, exponent) + '.' + digits.slice(exponent)
  }
  return (v.isNeg() ? '-' : '') + s
}

function check(r: Dec): Dec {
  if (r.isNaN()) throw new CalcError(ERR.invalid)
  if (!r.isFinite()) throw new CalcError(ERR.overflow)
  return r
}

function snap(r: Dec): Dec {
  return r.abs().lt('1e-40') ? new D(0) : r
}

function pow(a: Dec, b: Dec): Dec {
  if (a.isZero() && b.isNeg()) throw new CalcError(ERR.div0)
  if (a.isNeg() && !b.isInteger()) {
    const inv = ONE.div(b)
    if (inv.isInteger() && inv.mod(2).abs().eq(1)) return check(a.neg().pow(b).neg())
    throw new CalcError(ERR.invalid)
  }
  return check(a.pow(b))
}

function gamma(z: number): number {
  if (z < 0.5) return Math.PI / (Math.sin(Math.PI * z) * gamma(1 - z))
  const c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
    -176.61503916999185, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7]
  z -= 1
  let x = c[0]
  for (let i = 1; i < 9; i++) x += c[i] / (z + i)
  const t = z + 7.5
  return Math.sqrt(2 * Math.PI) * Math.pow(t, z + 0.5) * Math.exp(-t) * x
}

function fact(x: Dec): Dec {
  if (x.isInteger()) {
    if (x.isNeg()) throw new CalcError(ERR.invalid)
    if (x.gt(3248)) throw new CalcError(ERR.overflow)
    let r = new D(1)
    for (let i = 2, n = x.toNumber(); i <= n; i++) r = r.times(i)
    return r
  }
  const g = gamma(x.toNumber() + 1)
  if (!Number.isFinite(g)) throw new CalcError(Number.isNaN(g) ? ERR.invalid : ERR.overflow)
  return new D(g)
}

export class DecArith implements Arith<Dec> {
  zero: Dec = new D(0)
  angle: Angle = 'DEG'
  fe = false
  readonly digits: number

  constructor(digits: number) { this.digits = digits }

  parse(s: string): Dec { return new D(s) }
  format(v: Dec): string { return formatNumber(v, this.digits, this.fe) }

  canEnter(s: string): boolean {
    return s.replace(/^-/, '').replace(/^0\./, '.').replace('.', '').length <= this.digits
  }

  label(op: string): string {
    if (LABELS[op]) return LABELS[op]
    const inv = op.startsWith('a')
    const base = inv ? op.slice(1) : op
    if (base.endsWith('h')) return base + (inv ? '⁻¹' : '')
    return base + ANGLE_SUB[this.angle] + (inv ? '⁻¹' : '')
  }

  binary(op: string, a: Dec, b: Dec): Dec {
    switch (op) {
      case '+': return check(a.plus(b))
      case '-': return check(a.minus(b))
      case '×': return check(a.times(b))
      case '÷':
        if (b.isZero()) throw new CalcError(a.isZero() ? ERR.undef : ERR.div0)
        return check(a.div(b))
      case 'mod':
        if (b.isZero()) throw new CalcError(a.isZero() ? ERR.undef : ERR.div0)
        return check(a.minus(b.times(a.div(b).floor())))
      case 'pow': return pow(a, b)
      case 'root':
        if (b.isZero()) throw new CalcError(ERR.invalid)
        if (a.isNeg() && b.isInteger() && b.mod(2).abs().eq(1)) return check(a.neg().pow(ONE.div(b)).neg())
        return pow(a, ONE.div(b))
      case 'logy':
        if (a.lte(0) || b.lte(0) || b.eq(1)) throw new CalcError(ERR.invalid)
        return check(a.ln().div(b.ln()))
    }
    throw new Error('unknown op ' + op)
  }

  private toRad(x: Dec): Dec {
    if (this.angle === 'DEG') return x.mod(360).times(PI).div(180)
    if (this.angle === 'GRAD') return x.mod(400).times(PI).div(200)
    return x
  }

  private fromRad(r: Dec): Dec {
    if (this.angle === 'DEG') return r.times(180).div(PI)
    if (this.angle === 'GRAD') return r.times(200).div(PI)
    return r
  }

  unary(op: string, x: Dec): Dec {
    const bad = (): never => { throw new CalcError(ERR.invalid) }
    switch (op) {
      case 'negate': return x.neg()
      case 'sqr': return check(x.times(x))
      case 'cube': return check(x.pow(3))
      case 'sqrt': return x.isNeg() ? bad() : x.sqrt()
      case 'cbrt': return x.cbrt()
      case 'recip':
        if (x.isZero()) throw new CalcError(ERR.div0)
        return ONE.div(x)
      case 'pow10': return check(new D(10).pow(x))
      case 'pow2': return check(new D(2).pow(x))
      case 'exp': return check(x.exp())
      case 'ln': return x.lte(0) ? bad() : x.ln()
      case 'log': return x.lte(0) ? bad() : x.log(10)
      case 'abs': return x.abs()
      case 'floor': return x.floor()
      case 'ceil': return x.ceil()
      case 'fact': return fact(x)
      case 'dms': {
        const a = x.abs(), d = a.floor(), mf = a.minus(d).times(60), m = mf.floor()
        const r = d.plus(m.div(100)).plus(mf.minus(m).times(60).div(10000))
        return x.isNeg() ? r.neg() : r
      }
      case 'degrees': {
        const a = x.abs(), d = a.floor(), mf = a.minus(d).times(100), m = mf.floor()
        const r = d.plus(m.div(60)).plus(mf.minus(m).times(100).div(3600))
        return x.isNeg() ? r.neg() : r
      }
    }
    return snap(check(this.trig(op, x)))
  }

  private trig(op: string, x: Dec): Dec {
    const bad = (): never => { throw new CalcError(ERR.invalid) }
    const nz = (v: Dec) => (v.isZero() ? bad() : v)
    switch (op) {
      case 'sinh': return x.sinh()
      case 'cosh': return x.cosh()
      case 'tanh': return x.tanh()
      case 'sech': return ONE.div(x.cosh())
      case 'csch': return ONE.div(nz(x.sinh()))
      case 'coth': return ONE.div(nz(x.tanh()))
      case 'asinh': return x.asinh()
      case 'acosh': return x.lt(1) ? bad() : x.acosh()
      case 'atanh': return x.abs().gte(1) ? bad() : x.atanh()
      case 'asech': return x.lte(0) || x.gt(1) ? bad() : ONE.div(x).acosh()
      case 'acsch': return ONE.div(nz(x)).asinh()
      case 'acoth': return x.abs().lte(1) ? bad() : ONE.div(x).atanh()
      case 'asin': return x.abs().gt(1) ? bad() : this.fromRad(x.asin())
      case 'acos': return x.abs().gt(1) ? bad() : this.fromRad(x.acos())
      case 'atan': return this.fromRad(x.atan())
      case 'asec': return x.abs().lt(1) ? bad() : this.fromRad(ONE.div(x).acos())
      case 'acsc': return x.abs().lt(1) ? bad() : this.fromRad(ONE.div(x).asin())
      case 'acot': return this.fromRad(x.isZero() ? PI.div(2) : ONE.div(x).atan())
    }
    const r = this.toRad(x)
    const s = snap(r.sin()), c = snap(r.cos())
    switch (op) {
      case 'sin': return s
      case 'cos': return c
      case 'tan': return s.div(nz(c))
      case 'sec': return ONE.div(nz(c))
      case 'csc': return ONE.div(nz(s))
      case 'cot': return c.div(nz(s))
    }
    throw new Error('unknown op ' + op)
  }
}

// ---------- BigInt arithmetic (Programmer) ----------

export type Radix = 16 | 10 | 8 | 2

export class ProgArith implements Arith<bigint> {
  zero = 0n
  radix: Radix = 10
  bits = 64
  carry = 0n

  wrap(v: bigint): bigint { return BigInt.asIntN(this.bits, v) }
  unsigned(v: bigint): bigint { return BigInt.asUintN(this.bits, v) }

  private raw(s: string): bigint {
    const neg = s.startsWith('-')
    let v = 0n
    for (const ch of neg ? s.slice(1) : s) v = v * BigInt(this.radix) + BigInt(parseInt(ch, 16))
    return neg ? -v : v
  }

  parse(s: string): bigint { return this.wrap(this.raw(s)) }

  format(v: bigint, radix: Radix = this.radix): string {
    return radix === 10 ? this.wrap(v).toString() : this.unsigned(v).toString(radix).toUpperCase()
  }

  canEnter(s: string): boolean {
    if ([...s.replace(/^-/, '')].some((ch) => !(parseInt(ch, 16) < this.radix))) return false
    const v = this.raw(s)
    if (this.radix !== 10) return v < 1n << BigInt(this.bits)
    const lim = 1n << BigInt(this.bits - 1)
    return v < lim && v >= -lim
  }

  label(op: string): string {
    return ({ negate: 'negate', not: 'NOT', rol: 'RoL', ror: 'RoR', rolc: 'RoL', rorc: 'RoR' } as Record<string, string>)[op]
  }

  binary(op: string, a: bigint, b: bigint): bigint {
    switch (op) {
      case '+': return this.wrap(a + b)
      case '-': return this.wrap(a - b)
      case '×': return this.wrap(a * b)
      case '÷':
        if (b === 0n) throw new CalcError(a === 0n ? ERR.undef : ERR.div0)
        return this.wrap(a / b)
      case 'pmod':
        if (b === 0n) throw new CalcError(a === 0n ? ERR.undef : ERR.div0)
        return this.wrap(a % b)
      case 'and': return this.wrap(a & b)
      case 'or': return this.wrap(a | b)
      case 'xor': return this.wrap(a ^ b)
      case 'nand': return this.wrap(~(a & b))
      case 'nor': return this.wrap(~(a | b))
    }
    if (b < 0n) throw new CalcError(ERR.invalid)
    const bits = BigInt(this.bits)
    const n = b >= bits ? bits : b
    switch (op) {
      case 'lsh': return this.wrap(a << n)
      case 'rsh': return this.wrap(a >> n)
      case 'rshl': return this.wrap(this.unsigned(a) >> n)
    }
    throw new Error('unknown op ' + op)
  }

  unary(op: string, v: bigint): bigint {
    const u = this.unsigned(v), top = BigInt(this.bits - 1)
    switch (op) {
      case 'negate': return this.wrap(-v)
      case 'not': return this.wrap(~v)
      case 'rol': return this.wrap((u << 1n) | (u >> top))
      case 'ror': return this.wrap((u >> 1n) | ((u & 1n) << top))
      case 'rolc': {
        const c = this.carry
        this.carry = u >> top
        return this.wrap((u << 1n) | c)
      }
      case 'rorc': {
        const c = this.carry
        this.carry = u & 1n
        return this.wrap((u >> 1n) | (c << top))
      }
    }
    throw new Error('unknown op ' + op)
  }
}
