import { describe, it, expect } from 'vitest'
import {
  REFERENCE_BUDGET,
  budgetScaleFor,
  scaleValueToBudget,
} from '../../../src/utils/budgetScaling.js'

describe('budgetScaling', () => {
  it('uses $200 as the reference budget', () => {
    expect(REFERENCE_BUDGET).toBe(200)
  })

  describe('budgetScaleFor', () => {
    it('returns 1.0 at the reference budget', () => {
      expect(budgetScaleFor(200)).toBe(1)
    })

    it('scales linearly with budget', () => {
      expect(budgetScaleFor(400)).toBe(2)
      expect(budgetScaleFor(600)).toBe(3)
      expect(budgetScaleFor(100)).toBe(0.5)
      expect(budgetScaleFor(2000)).toBe(10)
    })

    it('falls back to 1.0 for missing or invalid budgets', () => {
      expect(budgetScaleFor(undefined)).toBe(1)
      expect(budgetScaleFor(null)).toBe(1)
      expect(budgetScaleFor(0)).toBe(1)
      expect(budgetScaleFor(-50)).toBe(1)
    })
  })

  describe('scaleValueToBudget', () => {
    it('leaves values unchanged at the reference budget', () => {
      expect(scaleValueToBudget(10, 200)).toBe(10)
      expect(scaleValueToBudget(62, 200)).toBe(62)
    })

    it('scales and rounds to whole dollars', () => {
      expect(scaleValueToBudget(10, 600)).toBe(30)
      expect(scaleValueToBudget(10, 400)).toBe(20)
      expect(scaleValueToBudget(15, 300)).toBe(23) // 15 * 1.5 = 22.5 -> 23
    })

    it('falls back to the unscaled value for invalid budgets', () => {
      expect(scaleValueToBudget(25, undefined)).toBe(25)
    })
  })
})
