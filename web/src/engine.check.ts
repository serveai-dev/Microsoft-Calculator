import assert from 'node:assert/strict'
import { Engine, DecArith, ProgArith, D, formatNumber, type Arith } from './engine.ts'
import { parseEquation } from './expr.ts'
import { diffText } from './date.ts'
import { formatResult } from './converter.ts'

function run<T>(arith: Arith<T>, precedence: boolean, keys: string): Engine<T> {
  const e = new Engine(arith, precedence)
  for (const k of keys.split(' ')) {
    if (/^[0-9A-F]$/.test(k)) e.digit(k)
    else if (k === '.') e.dot()
    else if (k === '=') e.equals()
    else if (k === '(') e.openParen()
    else if (k === ')') e.closeParen()
    else if (k === '%') e.percent()
    else if (k === 'neg') e.negate()
    else if (k === 'exp') e.exp()
    else if (k === 'bs') e.backspace()
    else if (k.startsWith('u:')) e.unary(k.slice(2))
    else e.binary(k)
  }
  return e
}
const std = (keys: string) => run(new DecArith(16), false, keys)
const sci = (keys: string) => run(new DecArith(32), true, keys)

// Standard: immediate execution
assert.equal(std('2 + 3 × 4 =').display, '20')
assert.equal(std('2 + 3 × 4 =').expression, '2 + 3 × 4 =')
assert.equal(std('2 + 3 ×').display, '5')
assert.equal(std('1 ÷ 3 =').display, '0.3333333333333333')
assert.equal(std('2 ÷ 3 =').display, '0.6666666666666667')
assert.equal(std('. 1 + . 2 =').display, '0.3')
assert.equal(std('5 + 3 = =').display, '11')
assert.equal(std('5 + =').display, '10')
assert.equal(std('1 ÷ 0 =').display, 'Cannot divide by zero')
assert.equal(std('0 ÷ 0 =').display, 'Result is undefined')
assert.equal(std('9 u:sqrt').expression, '√(9)')
assert.equal(std('3 u:sqr u:sqr').expression, 'sqr(sqr(3))')
assert.equal(std('5 0 + 1 0 %').display, '5')
assert.equal(std('5 0 × 1 0 %').display, '0.1')
assert.equal(std('5 0 %').display, '0')
assert.equal(std('1 u:negate').display, '-1')
assert.equal(std('9 9 9 9 9 9 9 9 9 9 9 9 9 9 9 9 + 1 =').display, '1.e+16')
assert.equal(std('1 2 3 bs').display, '12')
assert.equal(std('5 + ×').expression, '5 ×')

// Scientific: precedence, parens, functions
assert.equal(sci('2 + 3 × 4 =').display, '14')
assert.equal(sci('2 + 3 × 4 =').expression, '2 + 3 × 4 =')
assert.equal(sci('( 2 + 3 ) × 4 =').display, '20')
assert.equal(sci('( 2 + 3 ) × 4 =').expression, '(2 + 3) × 4 =')
assert.equal(sci('2 pow 1 0 =').display, '1024')
assert.equal(sci('1 ÷ 3 =').display, '0.33333333333333333333333333333333')
assert.equal(sci('3 0 u:sin').display, '0.5')
assert.equal(sci('3 0 u:sin').expression, 'sin₀(30)')
assert.equal(sci('1 8 0 u:sin').display, '0')
assert.equal(sci('9 0 u:tan').display, 'Invalid input')
assert.equal(sci('5 u:fact').display, '120')
assert.equal(sci('8 root 3 =').display, '2')
assert.equal(sci('8 logy 2 =').display, '3')
assert.equal(sci('1 exp 5 =').display, '100000')
assert.equal(sci('1 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 + 1 =').display, '10000000000000000001')
assert.equal(sci('7 neg mod 3 =').display, '2')
assert.equal(formatNumber(new D('0.000333333'), 16), '0.000333333')
assert.equal(formatNumber(new D(1).div(3000), 16), '3.333333333333333e-4')
assert.equal(formatNumber(new D(1).div(300), 16), '0.0033333333333333')
assert.equal(formatNumber(new D('0.001'), 16), '0.001')

// Programmer: BigInt, word sizes, precedence
const p = new ProgArith()
assert.equal(run(p, true, '5 and 3 =').display, '1')
assert.equal(run(p, true, '1 lsh 4 + 1 =').display, '17')
assert.equal(run(p, true, '7 ÷ 2 =').display, '3')
p.radix = 16
assert.equal(run(p, true, 'F F + 1 =').display, '100')
assert.equal(run(p, true, '0 - 1 =').display, 'FFFFFFFFFFFFFFFF')
p.bits = 8
assert.equal(run(p, true, 'F F + 1 =').display, '0')
p.radix = 10
assert.equal(run(p, true, '1 2 7 + 1 =').display, '-128')

// Graphing parser
const sc = (x: number, y = 0, vars: Record<string, number> = {}) => ({ x, y, vars, angle: 1 })
assert.equal(parseEquation('y=x^2').f(sc(3)), 9)
assert.equal(parseEquation('2x+1').f(sc(3)), 7)
assert.equal(parseEquation('-x^2').f(sc(3)), -9)
assert.equal(parseEquation('f(x)=sin(pi/2)').f(sc(0)), 1)
assert.deepEqual(parseEquation('y=ax^2+b').vars, ['a', 'b'])
assert.equal(parseEquation('x^2+y^2=1').kind, 'implicit')
assert.equal(parseEquation('y>x').rel, '>')
assert.equal(parseEquation('3!').f(sc(0)), 6)

// Date difference and converter rounding (UnitConverter.cpp)
assert.deepEqual(diffText(Date.UTC(2026, 0, 31), Date.UTC(2026, 0, 31)), ['Same dates', ''])
assert.deepEqual(diffText(Date.UTC(2025, 0, 1), Date.UTC(2026, 2, 20)), ['1 year, 2 months, 2 weeks, 5 days', '443 days'])
assert.equal(formatResult(3.280839895013123, 1), '3.28084')
assert.equal(formatResult(1609.344, 1), '1609.344')

console.log('engine checks passed')
