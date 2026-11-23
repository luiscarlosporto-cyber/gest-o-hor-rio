import { describe, expect, it } from 'vitest'
import { notificationId } from './native'

describe('app Android', () => {
  it('cada aviso tem um número estável e positivo para a notificação', () => {
    const a = notificationId('shift:2026-11-24:N')
    expect(a).toBe(notificationId('shift:2026-11-24:N'))
    expect(a).not.toBe(notificationId('shift:2026-11-25:N'))
    expect(a).toBeGreaterThan(0)
    expect(a).toBeLessThan(2 ** 31)
  })
})
