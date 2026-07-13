export interface AccountIdentity {
  id: string
  provider: string
  email: string | null
  createdAt: string | null
}

interface IdentityLike {
  id?: unknown
  provider?: unknown
  email?: unknown
  identity_data?: unknown
  created_at?: unknown
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null
}

export function normalizeAccountIdentity(identity: IdentityLike): AccountIdentity {
  const identityData = asRecord(identity.identity_data)
  const provider = stringValue(identity.provider) ?? 'unknown'

  return {
    id: stringValue(identity.id) ?? `${provider}:${stringValue(identityData.email) ?? 'unknown'}`,
    provider,
    email: stringValue(identity.email) ?? stringValue(identityData.email),
    createdAt: stringValue(identity.created_at),
  }
}

export function normalizeAccountIdentities(identities: IdentityLike[] | null | undefined): AccountIdentity[] {
  return (identities ?? []).map(normalizeAccountIdentity)
}

export function hasAuthProvider(identities: AccountIdentity[], provider: string): boolean {
  return identities.some(identity => identity.provider.toLowerCase() === provider.toLowerCase())
}

export function formatAuthProviderLabel(provider: string): string {
  switch (provider.toLowerCase()) {
    case 'email':
      return 'Email/password'
    case 'google':
      return 'Google'
    default:
      return provider
  }
}
