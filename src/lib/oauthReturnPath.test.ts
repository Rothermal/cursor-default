import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { consumeOAuthReturnPath, saveOAuthReturnPath } from './oauthReturnPath'

function createLocalStorageStub(): Storage {
  const values = new Map<string, string>()

  return {
    get length() {
      return values.size
    },
    clear: () => values.clear(),
    getItem: (key: string) => values.get(key) ?? null,
    key: (index: number) => Array.from(values.keys())[index] ?? null,
    removeItem: (key: string) => {
      values.delete(key)
    },
    setItem: (key: string, value: string) => {
      values.set(key, value)
    },
  }
}

beforeEach(() => {
  vi.stubGlobal('window', {
    localStorage: createLocalStorageStub(),
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('OAuth return path helpers', () => {
  it('stores and consumes a safe hash-router path once', () => {
    saveOAuthReturnPath('/settings/account')

    expect(consumeOAuthReturnPath()).toBe('/settings/account')
    expect(consumeOAuthReturnPath()).toBeNull()
  })

  it('preserves a team invite path through authentication', () => {
    const invitePath = `/invite/${'a'.repeat(64)}`

    saveOAuthReturnPath(invitePath)

    expect(consumeOAuthReturnPath()).toBe(invitePath)
  })

  it('rejects unsafe paths', () => {
    saveOAuthReturnPath('//example.com')

    expect(consumeOAuthReturnPath()).toBeNull()
  })
})
