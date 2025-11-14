import { describe, it, expect } from 'vitest'

describe('Basic Test Suite', () => {
  it('should always pass', () => {
    expect(true).toBe(true)
  })

  it('should perform basic arithmetic', () => {
    expect(2 + 2).toBe(4)
  })

  it('should check string equality', () => {
    expect('hello').toBe('hello')
  })
})