// The vault Add/Edit flow never ends on a mistyped answer: a Target that is
// not JSON or not a binding, a bad date, name, label, address or fingerprint
// asks again with the reason, keeps the typed text, and keeps everything
// typed before it.
import { describe, expect, it } from 'vitest'
import * as z from 'zod/mini'
import { UI_TEXT } from '../../../src/shared/constants'
import { editVaultItem, type VaultNativeInput } from '../../../src/host/vault/vaultNativeEditor'
import {
  vaultBindingSchema,
  vaultItemMetadataSchema,
  type VaultItemMetadata,
} from '../../../src/shared/vault'

interface SeenInput {
  readonly prompt: string
  readonly value: string | undefined
  readonly answer: string | undefined
}

function scriptSeam(
  inputs: (string | undefined)[],
  picks: (string | undefined)[],
): { native: VaultNativeInput; seenInputs: SeenInput[]; seenPicks: string[][] } {
  const seenInputs: SeenInput[] = []
  const seenPicks: string[][] = []
  let atInput = 0
  let atPick = 0
  return {
    seenInputs,
    seenPicks,
    native: {
      input: (options: { prompt: string; password: boolean; value?: string }) => {
        const answer = inputs[atInput++]
        seenInputs.push({ prompt: options.prompt, value: options.value, answer })
        return Promise.resolve(answer)
      },
      pick: (options: readonly { label: string; id: string }[]) => {
        seenPicks.push(options.map((option) => option.id))
        return Promise.resolve(picks[atPick++])
      },
      sshKey: () => Promise.resolve(null),
      now: () => 1_700_000_000_000,
    },
  }
}

const FINGERPRINT = `SHA256:${'C'.repeat(43)}`
const SECRET_PICKS = ['askEveryTime', 'keep', 'keep', 'keep', 'keep']

function secretTarget(picks: string[], inputs: string[]): ReturnType<typeof scriptSeam> {
  return scriptSeam(inputs, picks)
}

function currentSecret(): VaultItemMetadata {
  return vaultItemMetadataSchema.parse({
    id: 'a'.repeat(32),
    name: 'w190-test',
    handle: 'secret://w190-test',
    label: 'Tonight label',
    kind: 'secret',
    bindings: [],
    requirePresence: false,
    hidden: false,
    firstParty: false,
    policy: { mode: 'askEveryTime', unattendedAllowed: false, allowDisclosure: false },
    dates: { createdAt: 1_700_000_000_000, rotatedAt: null, expiresAt: null, lastUsedAt: null },
    publicKey: null,
    fingerprint: null,
  })
}

describe('the vault Add flow survives mistyped answers', () => {
  it('asks a plain Target answer again with the reason and then completes', async () => {
    const seam = secretTarget(
      ['secret', 'custom', ...SECRET_PICKS],
      ['w190-test', 'Tonight label', 'W190_TEST', '[]', '', 'the-secret-value'],
    )
    const result = await editVaultItem(seam.native)
    expect(result).not.toBeNull()
    if (result === null || !('metadata' in result)) throw new Error('unreachable')
    expect(result.metadata.name).toBe('w190-test')
    expect(result.metadata.label).toBe('Tonight label')
    expect(result.metadata.bindings).toEqual([])
    const retry = seam.seenInputs[3]
    expect(retry?.prompt).toContain(UI_TEXT.vault.targetNotJson)
    expect(retry?.value).toBe('W190_TEST')
  })

  it('names the field of a schema-invalid binding', async () => {
    const valid = JSON.stringify([
      {
        kind: 'ssh',
        host: 'ssh.example.com',
        remoteUser: 'deploy',
        hostKeyFingerprint: FINGERPRINT,
        forwarding: false,
      },
    ])
    const seam = secretTarget(
      ['secret', 'custom', ...SECRET_PICKS],
      ['w190-test', 'Tonight label', '[{"kind":"ssh","host":"ssh.example.com"}]', valid, '', 'v'],
    )
    const result = await editVaultItem(seam.native)
    if (result === null || !('metadata' in result)) throw new Error('unreachable')
    expect(result.metadata.bindings).toHaveLength(1)
    expect(seam.seenInputs[3]?.prompt).toContain('hostKeyFingerprint')
  })

  it('takes a guided SSH binding through the picker', async () => {
    const seam = secretTarget(
      ['secret', 'ssh', 'change', 'done', ...SECRET_PICKS],
      ['w190-test', 'Tonight label', 'ssh.example.com', 'deploy', FINGERPRINT, '', 'v'],
    )
    const result = await editVaultItem(seam.native)
    if (result === null || !('metadata' in result)) throw new Error('unreachable')
    expect(z.safeParse(vaultBindingSchema, result.metadata.bindings[0]).success).toBe(true)
    expect(result.metadata.bindings[0]).toEqual({
      kind: 'ssh',
      host: 'ssh.example.com',
      remoteUser: 'deploy',
      hostKeyFingerprint: FINGERPRINT,
      forwarding: true,
    })
  })

  it('asks an invalid Expires again and keeps the typed date', async () => {
    const seam = secretTarget(
      ['secret', 'custom', ...SECRET_PICKS],
      ['w190-test', 'Tonight label', '[]', 'not-a-date', '', 'v'],
    )
    const result = await editVaultItem(seam.native)
    if (result === null || !('metadata' in result)) throw new Error('unreachable')
    expect(result.metadata.dates.expiresAt).toBeNull()
    const retry = seam.seenInputs[4]
    expect(retry?.prompt).toContain(UI_TEXT.vault.expiresInvalid)
    expect(retry?.value).toBe('not-a-date')
  })

  it('asks an invalid name and label again without losing them', async () => {
    const seam = secretTarget(
      ['secret', 'custom', ...SECRET_PICKS],
      ['My Secret', 'w190-test', '', 'Tonight label', '[]', '', 'v'],
    )
    const result = await editVaultItem(seam.native)
    if (result === null || !('metadata' in result)) throw new Error('unreachable')
    expect(result.metadata.name).toBe('w190-test')
    expect(result.metadata.label).toBe('Tonight label')
    expect(seam.seenInputs[1]?.prompt).toContain(UI_TEXT.vault.nameInvalid)
    expect(seam.seenInputs[1]?.value).toBe('My Secret')
    expect(seam.seenInputs[3]?.prompt).toContain(UI_TEXT.vault.fieldMissing)
  })

  it('ends every guided binding kind in a binding the schema accepts', async () => {
    const kinds: {
      pick: string
      fields: string[]
      forwarding: string | null
      kind: string
    }[] = [
      { pick: 'ssh', fields: ['h', 'u', FINGERPRINT], forwarding: 'keep', kind: 'ssh' },
      { pick: 'sshAnyHost', fields: ['u'], forwarding: 'keep', kind: 'sshAnyHost' },
      { pick: 'sshSign', fields: [FINGERPRINT], forwarding: null, kind: 'sshSign' },
      { pick: 'git', fields: ['git.example.com', 'team/repo'], forwarding: null, kind: 'git' },
      { pick: 'origin', fields: ['https://app.example.com'], forwarding: null, kind: 'origin' },
      { pick: 'disclosure', fields: [], forwarding: null, kind: 'disclosure' },
    ]
    for (const guided of kinds) {
      const picks = ['secret', guided.pick]
      if (guided.forwarding !== null) picks.push(guided.forwarding)
      picks.push('done', ...SECRET_PICKS)
      const seam = secretTarget(picks, ['w190-test', 'Tonight label', ...guided.fields, '', 'v'])
      const result = await editVaultItem(seam.native)
      if (result === null || !('metadata' in result)) throw new Error('unreachable')
      expect(result.metadata.bindings).toHaveLength(1)
      const binding = result.metadata.bindings[0]
      expect(z.safeParse(vaultBindingSchema, binding).success).toBe(true)
      expect(binding?.kind).toBe(guided.kind)
    }
  })

  it('keeps the current targets and earlier entries when editing settings only', async () => {
    const existing = currentSecret()
    const seam = scriptSeam(
      ['w190-test', 'Tonight label', ''],
      ['keep', 'askEveryTime', 'keep', 'keep', 'keep', 'keep', 'metadata'],
    )
    const result = await editVaultItem(seam.native, existing)
    expect(result).not.toBeNull()
    if (result === null || 'material' in result) throw new Error('unreachable')
    const metadata = vaultItemMetadataSchema.parse(result)
    expect(metadata.name).toBe('w190-test')
    expect(metadata.label).toBe('Tonight label')
    expect(metadata.bindings).toEqual([])
  })

  it('asks an invalid API origin again', async () => {
    const seam = scriptSeam(
      [
        'w190-test',
        'Tonight label',
        '[]',
        '',
        'api-secret',
        'not-an-origin',
        'https://a.example.com',
      ],
      ['apiKey', 'custom', ...SECRET_PICKS, 'bearer'],
    )
    const result = await editVaultItem(seam.native)
    if (result === null || !('metadata' in result)) throw new Error('unreachable')
    expect(result.metadata.kind).toBe('apiKey')
    expect(seam.seenInputs[6]?.prompt).toContain(UI_TEXT.vault.originInvalid)
    expect(seam.seenInputs[6]?.value).toBe('not-an-origin')
  })

  it('asks invalid web-login addresses again', async () => {
    const seam = scriptSeam(
      [
        'w190-test',
        'Tonight label',
        '[]',
        '',
        'not an origin',
        'https://a.example.com',
        'user',
        'pw',
        '',
      ],
      ['webLogin', 'custom', ...SECRET_PICKS],
    )
    const result = await editVaultItem(seam.native)
    if (result === null || !('metadata' in result)) throw new Error('unreachable')
    expect(result.metadata.kind).toBe('webLogin')
    expect(seam.seenInputs[5]?.prompt).toContain(UI_TEXT.vault.originsInvalid)
  })

  it('asks an invalid OAuth issuer, resource and expiry again', async () => {
    const seam = scriptSeam(
      [
        'w190-test',
        'Tonight label',
        '[]',
        '',
        'access',
        '',
        'notaurl',
        'https://login.example.com',
        'notaurl',
        'https://app.example.com/api',
        'whenever',
        '2027-01-15T00:00:00.000Z',
      ],
      ['oauth', 'custom', ...SECRET_PICKS],
    )
    const result = await editVaultItem(seam.native)
    if (result === null || !('metadata' in result)) throw new Error('unreachable')
    expect(result.metadata.kind).toBe('oauth')
    expect(seam.seenInputs[7]?.prompt).toContain(UI_TEXT.vault.issuerInvalid)
    expect(seam.seenInputs[9]?.prompt).toContain(UI_TEXT.vault.resourceInvalid)
    expect(seam.seenInputs[11]?.prompt).toContain(UI_TEXT.vault.expiresInvalid)
  })

  it('asks an invalid session origin and expiry again', async () => {
    const seam = scriptSeam(
      [
        'w190-test',
        'Tonight label',
        '[]',
        '',
        'cookie-bytes',
        'notaurl',
        'https://app.example.com',
        'soon',
        '2027-01-15T00:00:00.000Z',
      ],
      ['session', 'custom', ...SECRET_PICKS],
    )
    const result = await editVaultItem(seam.native)
    if (result === null || !('metadata' in result)) throw new Error('unreachable')
    expect(result.metadata.kind).toBe('session')
    expect(seam.seenInputs[6]?.prompt).toContain(UI_TEXT.vault.originHttpsInvalid)
    expect(seam.seenInputs[8]?.prompt).toContain(UI_TEXT.vault.expiresInvalid)
  })
})
