import { describe, expect, it } from 'vitest'
import { evaluateAmount, isAmountExpression } from './amountExpression'

describe('evaluateAmount', () => {
  it('legge i numeri semplici come prima', () => {
    expect(evaluateAmount('12,50')).toBe(1250)
    expect(evaluateAmount('12.5')).toBe(1250)
    expect(evaluateAmount('1.234,56')).toBe(123456)
    expect(evaluateAmount('€ 10')).toBe(1000)
  })

  it('somma, sottrae, moltiplica e divide con le precedenze', () => {
    expect(evaluateAmount('10 + 2,5')).toBe(1250)
    expect(evaluateAmount('10 - 2,5')).toBe(750)
    expect(evaluateAmount('3 * 2,5')).toBe(750)
    expect(evaluateAmount('10 / 4')).toBe(250)
    expect(evaluateAmount('2 + 3 * 4')).toBe(1400)
    expect(evaluateAmount('(2 + 3) * 4')).toBe(2000)
    expect(evaluateAmount('100 / 3')).toBe(3333)
    expect(evaluateAmount('5 × 2 ÷ 4 − 1')).toBe(150)
    expect(evaluateAmount('-5 + 10')).toBe(500)
  })

  it('restituisce NaN per espressioni non valide', () => {
    expect(evaluateAmount('')).toBeNaN()
    expect(evaluateAmount('10 +')).toBeNaN()
    expect(evaluateAmount('10 / 0')).toBeNaN()
    expect(evaluateAmount('(2 + 3')).toBeNaN()
    expect(evaluateAmount('abc')).toBeNaN()
  })

  it('riconosce le espressioni', () => {
    expect(isAmountExpression('12,50')).toBe(false)
    expect(isAmountExpression('-12,50')).toBe(false)
    expect(isAmountExpression('12 + 3')).toBe(true)
  })
})
