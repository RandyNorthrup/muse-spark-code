// The vault Add/Edit flow never ends on a mistyped answer: a Target that is
// not JSON or not a binding, a bad date, name, label, address or fingerprint
// asks again with the reason, keeps the typed text, and keeps everything
// typed before it. Expires takes YYYY-MM-DD or YYYY-MM-DDTHH:MM only and
// never a moment that has passed (src/shared/vaultExpiry.ts).
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

/** The item's own Expires prompt, where empty means no expiry. */
function itemExpiryPrompt(): string {
  return `${UI_TEXT.vault.expiresPrompt} ${UI_TEXT.vault.expiresNone}`
}

/** A new Named Secret whose Expires box gets `answers` in turn; `boxes` are those boxes. */
async function addSecretExpiring(
  ...answers: string[]
): Promise<{ expiresAt: number | null; boxes: SeenInput[] }> {
  const seam = secretTarget(
    ['secret', 'custom', ...SECRET_PICKS],
    ['w190-test', 'Tonight label', '[]', ...answers, 'v'],
  )
  const result = await editVaultItem(seam.native)
  if (result === null || !('metadata' in result)) throw new Error('unreachable')
  const first = 3
  return {
    expiresAt: result.metadata.dates.expiresAt,
    boxes: seam.seenInputs.slice(first, first + answers.length),
  }
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

/** Edits settings only of a secret stored with `expiresAt`, answering Expires with `answers`. */
async function editExpiredSecret(
  expiresAt: number,
  ...answers: string[]
): Promise<{
  expiresAt: number | null
  prefill: string | undefined
  retry: SeenInput | undefined
}> {
  const existing = currentSecret()
  const seam = scriptSeam(
    ['w190-test', 'Tonight label', ...answers],
    ['keep', 'askEveryTime', 'keep', 'keep', 'keep', 'keep', 'metadata'],
  )
  const result = await editVaultItem(seam.native, {
    ...existing,
    dates: { ...existing.dates, expiresAt },
  })
  if (result === null || 'material' in result) throw new Error('unreachable')
  return {
    expiresAt: result.dates.expiresAt,
    prefill: seam.seenInputs[2]?.value,
    retry: seam.seenInputs[3],
  }
}

/**
A login's required Expires (OAuth, session), from its first box on: answered
empty, then a loose word, then 2027-01-15T00:00:00.000Z. Its prompt has no
empty clause, empty and the word each ask again, and the instant is stored.
*/
function expectRequiredExpiry(boxes: readonly SeenInput[], material: unknown): void {
  const prompt = UI_TEXT.vault.expiresPrompt
  expect(boxes.map((box) => box.prompt)).toEqual([
    prompt,
    `${UI_TEXT.vault.fieldMissing} ${prompt}`,
    `${UI_TEXT.vault.expiresInvalid} ${prompt}`,
  ])
  expect(material).toMatchObject({ expiresAt: Date.UTC(2027, 0, 15) })
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

  it('asks a loose date again with the two shapes and keeps the typed text', async () => {
    // Each of these once became a date: "1" as 2001-01-01, "12/1" as
    // 2001-12-01, 2026-02-30 as 2026-03-02.
    const loose = ['1', '12/1', 'next tuesday', '2026-02-30']
    const { expiresAt, boxes } = await addSecretExpiring(...loose, '')
    expect(expiresAt).toBeNull()
    expect(boxes[0]?.prompt).toBe(itemExpiryPrompt())
    expect(boxes[0]?.prompt).toContain('YYYY-MM-DD')
    for (const [at, typed] of loose.entries()) {
      expect(boxes[at + 1]?.prompt).toBe(`${UI_TEXT.vault.expiresInvalid} ${itemExpiryPrompt()}`)
      expect(boxes[at + 1]?.value).toBe(typed)
    }
  })

  it('asks a date that has already passed again with its own sentence', async () => {
    // The seam's clock reads 2023-11-14T22:13:20Z: that very moment has passed too.
    const passed = ['2023-01-01', '2023-11-14T22:13:20.000Z']
    const { expiresAt, boxes } = await addSecretExpiring(...passed, '2027-01-15')
    expect(expiresAt).toBe(new Date(2027, 0, 15).getTime())
    for (const [at, typed] of passed.entries()) {
      expect(boxes[at + 1]?.prompt).toBe(`${UI_TEXT.vault.expiresPassed} ${itemExpiryPrompt()}`)
      expect(boxes[at + 1]?.value).toBe(typed)
    }
  })

  it('stores a day as the start of that local day and a time as that local time', async () => {
    const dayOnly = await addSecretExpiring('2027-01-15')
    const day = new Date(dayOnly.expiresAt ?? NaN)
    expect([day.getFullYear(), day.getMonth(), day.getDate(), day.getHours()]).toEqual([
      2027, 0, 15, 0,
    ])
    expect(day.getTime()).toBe(new Date(2027, 0, 15).getTime())
    const { expiresAt } = await addSecretExpiring('2027-01-15T09:30')
    expect(expiresAt).toBe(new Date(2027, 0, 15, 9, 30).getTime())
    const withSeconds = await addSecretExpiring('2027-01-15T09:30:45.250')
    expect(withSeconds.expiresAt).toBe(new Date(2027, 0, 15, 9, 30, 45, 250).getTime())
  })

  it('stores a time with a zone as that exact instant', async () => {
    const utc = await addSecretExpiring('2027-01-15T09:30:00.000Z')
    expect(utc.expiresAt).toBe(Date.UTC(2027, 0, 15, 9, 30))
    const india = await addSecretExpiring('2027-01-15T09:30+05:30')
    expect(india.expiresAt).toBe(Date.UTC(2027, 0, 15, 4, 0))
  })

  it('lets an edit keep an expired item’s stored date, and no other passed one', async () => {
    const stored = 1_600_000_000_000
    const prefill = new Date(stored).toISOString()
    const kept = await editExpiredSecret(stored, prefill)
    expect(kept.prefill).toBe(prefill)
    expect(kept.expiresAt).toBe(stored)
    const changed = await editExpiredSecret(stored, '2020-01-01', '')
    expect(changed.retry?.prompt).toBe(`${UI_TEXT.vault.expiresPassed} ${itemExpiryPrompt()}`)
    expect(changed.retry?.value).toBe('2020-01-01')
    expect(changed.expiresAt).toBeNull()
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
        '',
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
    expectRequiredExpiry(seam.seenInputs.slice(10), result.material)
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
        '',
        'soon',
        '2027-01-15T00:00:00.000Z',
      ],
      ['session', 'custom', ...SECRET_PICKS],
    )
    const result = await editVaultItem(seam.native)
    if (result === null || !('metadata' in result)) throw new Error('unreachable')
    expect(result.metadata.kind).toBe('session')
    expect(seam.seenInputs[6]?.prompt).toContain(UI_TEXT.vault.originHttpsInvalid)
    expectRequiredExpiry(seam.seenInputs.slice(7), result.material)
  })
})
