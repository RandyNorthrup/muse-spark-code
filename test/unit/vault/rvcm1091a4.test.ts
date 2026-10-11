// Generated-only public framing regressions for RVCM1091A4 finding 1.
import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { VAULT_RESET_WORD } from '../../../src/shared/constants'
import { encodeVaultJson, VaultError } from '../../../src/core/vault/crypto'
import { item } from '../helpers/vault/fixtures'
import { lockedVault, managementFixture } from './managementFixture'
import { jsonRecord } from './storeFixtures'

function setField(root: object, field: string, value: unknown): void {
  const parts = field.split('.')
  const last = parts.pop()
  let current: unknown = root
  for (const part of parts) {
    if (current === null || typeof current !== 'object') throw new Error('generated field')
    current = Reflect.get(current, part)
  }
  if (last === undefined || current === null || typeof current !== 'object')
    throw new Error('generated field')
  Reflect.set(current, last, value)
}

function refreshDigest(snapshot: Record<string, unknown>): void {
  const { document, slots } = snapshot
  if (
    document === null ||
    typeof document !== 'object' ||
    slots === null ||
    typeof slots !== 'object'
  )
    throw new Error('generated snapshot')
  Reflect.set(
    slots,
    'documentDigest',
    createHash('sha256').update(encodeVaultJson(document)).digest('hex'),
  )
}

const short = Buffer.alloc(1).toString('base64')
const noncanonical = 'AB==' // Schema-valid base64 whose unused padding bits are not zero.
const damage: readonly (readonly [string, unknown])[] = [
  ['slots.mac', ''],
  ['slots.mac', short],
  ['slots.mac', Buffer.alloc(32).toString('base64')],
  ['slots.mac', 'not-base64'],
  ['slots.mac', `${Buffer.alloc(32).toString('base64').slice(0, -2)}B=`],
  ['document.v', 1],
  ['slots.v', 1],
  ['document.vaultId', 'b'.repeat(32)],
  ['slots.vaultId', 'b'.repeat(32)],
  ['document.vaultId', 'invalid-id'],
  ['document.generation', 0],
  ['document.generation', Number.MAX_SAFE_INTEGER + 1],
  ['slots.generation', 0],
  ['document.index.generation', 0],
  ['document.index.generation', 1],
  ['document.items.0.id', 'invalid-id'],
  ['document.items.0.block.generation', 0],
  ['document.items.0.block.generation', Number.MAX_SAFE_INTEGER],
  ['document.index.ciphertext', short],
  ['document.items.0.block.ciphertext', short],
  ['document.items.0.block.ciphertext', Buffer.alloc(6).toString('base64')],
  ['slots.documentDigest', '0'.repeat(64)],
  ['slots.auditHead', 'invalid-digest'],
  ['slots.previousDigest', 'invalid-digest'],
  ['slots.records.0.v', 2],
  ['slots.records.0.id', 'invalid-id'],
  ['slots.records.0.vaultId', 'b'.repeat(32)],
  ['slots.records.0.lastGeneration', 0],
  ['slots.records.0.auditGeneration', 1],
  ['slots.records.0.auditHead', '1'.repeat(64)],
  ['slots.records.0.provider', 'recovery'],
  ['slots.records.0.keyReference', ''],
  ['slots.records.1.wrappedKey', short],
  ...['document.index', 'document.items.0.block', 'slots.records.0', 'slots.records.1'].flatMap(
    (prefix) =>
      ['nonce', 'tag'].flatMap((field): [string, unknown][] => [
        [`${prefix}.${field}`, short],
        [`${prefix}.${field}`, noncanonical],
        [`${prefix}.${field}`, 'not-base64'],
      ]),
  ),
  ...[
    'document.index.ciphertext',
    'document.items.0.block.ciphertext',
    'slots.records.0.wrappedKey',
    'slots.records.1.wrappedKey',
  ].flatMap((field): [string, unknown][] => [
    [field, noncanonical],
    [field, ''],
    [field, 'not-base64'],
  ]),
]

async function generatedState(isPending: boolean, isBeforeAnchor = false) {
  const f = managementFixture()
  const code = await lockedVault(f)
  await f.broker.unlock(null)
  if (isPending) f.files.fail = 'vault.v1'
  if (isBeforeAnchor) vi.spyOn(f.anchor, 'advance').mockRejectedValueOnce(new VaultError('io'))
  const write = f.repository.current().write({
    ...item(),
    material: { kind: 'secret', value: Buffer.alloc(1) },
  })
  if (isPending) await expect(write).rejects.toThrow()
  else await write
  f.files.fail = null
  f.broker.lock()
  const document = f.files.data.get('vault.v1')
  const slots = f.files.data.get('slots.v1')
  const pending = f.files.data.get('pending.v1')
  if (document === undefined || slots === undefined || (isPending && pending === undefined))
    throw new Error('missing generated files')
  const intent = pending === undefined ? null : jsonRecord(pending)
  const snapshot =
    intent === null
      ? { document: jsonRecord(document), slots: jsonRecord(slots) }
      : intent['snapshot']
  if (snapshot === null || typeof snapshot !== 'object' || Array.isArray(snapshot))
    throw new Error('generated snapshot')
  const mutable: Record<string, unknown> = Object.fromEntries(Object.entries(snapshot))
  const install = () => {
    if (intent === null) {
      const { document, slots } = mutable
      if (
        document === null ||
        typeof document !== 'object' ||
        slots === null ||
        typeof slots !== 'object'
      )
        throw new Error('generated pair')
      f.files.data.set('vault.v1', encodeVaultJson(document))
      f.files.data.set('slots.v1', encodeVaultJson(slots))
    } else f.files.data.set('pending.v1', encodeVaultJson({ ...intent, snapshot: mutable }))
  }
  return { f, code, snapshot: mutable, intent, install }
}

async function assertUnopenable(g: Awaited<ReturnType<typeof generatedState>>): Promise<void> {
  try {
    await expect(g.f.broker.unlock(null)).rejects.toThrow()
    await expect(g.f.management.recover(g.code)).rejects.toThrow()
    const state = await g.f.management.snapshot()
    expect(state.status.reason).toBe('vaultLost')
    const challenge = await g.f.management.resetBegin()
    await g.f.management.resetConfirm(challenge.resetId, VAULT_RESET_WORD)
    expect(await g.f.anchor.vaultId()).toBeNull()
  } finally {
    g.code.fill(0)
  }
}

async function assertProtectedAndRecover(g: Awaited<ReturnType<typeof generatedState>>) {
  const state = await g.f.management.snapshot()
  expect(state.status.reason).not.toBe('vaultLost')
  await expect(g.f.management.resetBegin()).rejects.toMatchObject({ reason: 'invalid' })
  await g.f.management.recover(g.code)
  const items = await g.f.repository.current().list()
  expect(items).toHaveLength(1)
  return items
}

describe.each([false, true])('RVCM1091A4 framing (pending=%s)', (isPending) => {
  it.each(damage)('F1: impossible %s (%j) reaches Reset', async (field, value) => {
    const g = await generatedState(isPending)
    setField(g.snapshot, field, value)
    if (field.startsWith('document.')) refreshDigest(g.snapshot)
    g.install()
    await assertUnopenable(g)
  })

  it('F1: duplicate slot IDs reach Reset', async () => {
    const g = await generatedState(isPending)
    const [first] = await g.f.unlock.records()
    if (first === undefined) throw new Error('generated slot')
    setField(g.snapshot, 'slots.records.1.id', first.id)
    g.install()
    await assertUnopenable(g)
  })

  it.each([short, noncanonical, 'not-base64'])(
    'F1: impossible KDF salt %s reaches Reset',
    async (salt) => {
      const g = await generatedState(isPending)
      setField(g.snapshot, 'slots.records.1.tier', 'passphrase')
      setField(g.snapshot, 'slots.records.1.provider', 'passphrase')
      setField(g.snapshot, 'slots.records.1.kdf', { kind: 'scrypt', salt, N: 131_072, r: 8, p: 1 })
      g.install()
      await assertUnopenable(g)
    },
  )

  it('F1: a valid locked pair or complete intent still refuses Reset and opens with the code', async () => {
    const g = await generatedState(isPending)
    try {
      const items = await assertProtectedAndRecover(g)
      const [first] = items
      if (first === undefined) throw new Error('missing generated item')
      const restored = await g.f.repository.current().read(first.id)
      expect(restored.material).toEqual({ kind: 'secret', value: Buffer.alloc(1) })
    } finally {
      g.code.fill(0)
    }
  })

  it('F1: key-dependent authentication failure alone cannot authorize Reset', async () => {
    const g = await generatedState(isPending)
    setField(g.snapshot, 'document.index.tag', Buffer.alloc(16).toString('base64'))
    refreshDigest(g.snapshot)
    g.install()
    try {
      await expect(g.f.broker.unlock(null)).rejects.toThrow()
      await expect(g.f.management.recover(g.code)).rejects.toThrow()
      const state = await g.f.management.snapshot()
      expect(state.status.reason).not.toBe('vaultLost')
      await expect(g.f.management.resetBegin()).rejects.toMatchObject({ reason: 'invalid' })
    } finally {
      g.code.fill(0)
    }
  })

  it.each(['generation', 'auditGeneration', 'auditHead', 'stateDigest'] as const)(
    'F1: unmatched protected anchor %s reaches Reset',
    async (field) => {
      const g = await generatedState(isPending)
      const id = await g.f.anchor.vaultId()
      if (id === null) throw new Error('missing generated anchor')
      const state = await g.f.anchor.minimum(id)
      if (state === null) throw new Error('missing generated state')
      const value =
        field === 'generation' || field === 'auditGeneration' ? state[field] + 1 : '1'.repeat(64)
      g.f.anchor.states.set(id, { ...state, [field]: value })
      await assertUnopenable(g)
    },
  )
})

describe('RVCM1091A4 intent history', () => {
  it('F1: a complete intent at its exact prior anchor stays protected and recovers', async () => {
    const g = await generatedState(true, true)
    try {
      await assertProtectedAndRecover(g)
    } finally {
      g.code.fill(0)
    }
  })
  it.each([
    ['mac', ''],
    ['mac', short],
    ['mac', 'not-base64'],
    ['mac', noncanonical],
    ['prior.generation', 2],
    ['prior.auditGeneration', 1],
    ['prior.auditHead', '1'.repeat(64)],
    ['prior.stateDigest', '1'.repeat(64)],
    ['restoreDigest', 'invalid-digest'],
    ['snapshot.slots.previousDigest', '1'.repeat(64)],
  ])('F1: impossible pending %s (%j) reaches Reset', async (field, value) => {
    const g = await generatedState(true)
    if (g.intent === null) throw new Error('missing generated intent')
    setField(g.intent, field, value)
    g.install()
    await assertUnopenable(g)
  })

  it('F1: duplicate document item IDs reach Reset', async () => {
    const g = await generatedState(true)
    const { document } = g.snapshot
    if (document === null || typeof document !== 'object') throw new Error('generated document')
    const items: unknown = Reflect.get(document, 'items')
    if (!Array.isArray(items)) throw new Error('generated items')
    setField(g.snapshot, 'document.items', [...items, ...items])
    refreshDigest(g.snapshot)
    g.install()
    await assertUnopenable(g)
  })
})
