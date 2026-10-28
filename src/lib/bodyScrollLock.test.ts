import { describe, expect, it } from 'vitest'
import { lockBodyScroll } from './bodyScrollLock'

describe('nested focus/modal scroll locks', () => {
  it.each([true, false])('restores the original overflow after either release order (%s)', outerFirst => {
    const body = { style: { overflow: 'auto' } }
    const outer = lockBodyScroll(body), modal = lockBodyScroll(body)
    expect(body.style.overflow).toBe('hidden')
    const first = outerFirst ? outer : modal, last = outerFirst ? modal : outer
    first()
    expect(body.style.overflow).toBe('hidden')
    first()
    last()
    expect(body.style.overflow).toBe('auto')
  })
  it('supports a later independent lock after cleanup', () => {
    const body = { style: { overflow: '' } }
    lockBodyScroll(body)()
    body.style.overflow = 'scroll'
    lockBodyScroll(body)()
    expect(body.style.overflow).toBe('scroll')
  })
})
