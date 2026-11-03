// D261 and D262: which records of the providers file share a provider, as the
// refusal fallback's account rule reads it. Real files, the product's own reader
// (what `exec --team` runs) and the real move policy: a refused task never moves
// to another account of its provider, and a file that cannot be read keeps that so.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { readProvidersFile } from '../../../src/core/providers/providersFile'
import { planRefusalMove, refusalAccountOf } from '../../../src/core/team/teamPool'
import {
  presetFromRead,
  providerPresetOf,
  PROVIDERS_UNREADABLE,
} from '../../../src/host/team/providerPreset'
import { PROVIDERS_FILE_VERSION } from '../../../src/shared/constants'

const scratchRoots: string[] = []

function scratch(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'provider-preset-'))
  scratchRoots.push(root)
  return root
}

afterEach(() => {
  for (const root of scratchRoots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/** Two accounts of one service, as the person adds them. */
function twoAccounts(): string {
  const file = path.join(scratch(), 'providers.json')
  writeFileSync(
    file,
    JSON.stringify({
      v: PROVIDERS_FILE_VERSION,
      providers: [
        { id: 'work', preset: 'openrouter', auth: 'apiKey', models: ['model-a'] },
        { id: 'home', preset: 'openrouter', auth: 'apiKey', models: ['model-b'] },
      ],
    }),
  )
  return file
}

function entry(id: string, model: string) {
  return {
    id,
    agent: { kind: 'engine', agentId: id, model, pays: 'local' as const },
  }
}

/** The move a refusal on `work/model-a` makes, with these presets. */
function moveAfterRefusal(serviceOf: (record: string) => string | undefined) {
  const refuser = entry('refuser', 'work/model-a')
  const accountOf = (agent: (typeof refuser)['agent']) => refusalAccountOf(agent, serviceOf)
  return planRefusalMove({
    entries: [
      refuser,
      entry('other-account', 'home/model-b'),
      entry('same-account', 'work/model-c'),
    ],
    tried: new Set(['refuser']),
    authorModels: [],
    hasHeadroom: () => true,
    isSameModel: (left, right) => left === right,
    isConsented: () => true,
    isUnattended: false,
    refusedAccount: accountOf(refuser.agent),
    accountOf: (candidate) => accountOf(candidate.agent),
  })
}

const SKIPPED_OTHER_ACCOUNT = {
  kind: 'move',
  entry: { id: 'same-account' },
  skipped: [
    { entryId: 'refuser', reason: 'tried' },
    { entryId: 'other-account', reason: 'otherAccount' },
  ],
}

describe('the account rule over the providers file (D261, D262)', () => {
  it('exec --team: two records of one preset are one provider, so another account is skipped', async () => {
    const read = await readProvidersFile(twoAccounts())
    expect(read.ok).toBe(true)
    expect(moveAfterRefusal((record) => presetFromRead(read, record))).toMatchObject(
      SKIPPED_OTHER_ACCOUNT,
    )
    expect(presetFromRead(read, 'home')).toBe('openrouter')
  })

  it('the window: the same answer from the same file', () => {
    const file = twoAccounts()
    const warnings: string[] = []
    const log = {
      warn: (text: string) => {
        warnings.push(text)
      },
    }
    expect(moveAfterRefusal((record) => providerPresetOf(file, record, log))).toMatchObject(
      SKIPPED_OTHER_ACCOUNT,
    )
    expect(warnings).toEqual([])
  })

  it('a missing file leaves each record its own provider, on both roads', async () => {
    const file = path.join(scratch(), 'none.json')
    const log = { warn: () => undefined }
    expect(providerPresetOf(file, 'home', log)).toBeUndefined()
    expect(presetFromRead(await readProvidersFile(file), 'home')).toBeUndefined()
  })

  it('a file that cannot be read never reads as no preset: another account stays skipped', async () => {
    const folder = path.join(scratch(), 'a-folder.json')
    mkdirSync(folder)
    const malformed = path.join(scratch(), 'malformed.json')
    writeFileSync(malformed, '{ not json')
    const noList = path.join(scratch(), 'no-list.json')
    writeFileSync(noList, '{"v":1}')
    for (const file of [folder, malformed, noList]) {
      const warnings: string[] = []
      const log = {
        warn: (text: string) => {
          warnings.push(text)
        },
      }
      expect(providerPresetOf(file, 'home', log)).toBe(PROVIDERS_UNREADABLE)
      expect(warnings).toHaveLength(1)
      expect(moveAfterRefusal((record) => providerPresetOf(file, record, log))).toMatchObject(
        SKIPPED_OTHER_ACCOUNT,
      )
    }
    for (const file of [folder, malformed]) {
      const read = await readProvidersFile(file)
      expect(presetFromRead(read, 'home')).toBe(PROVIDERS_UNREADABLE)
      expect(moveAfterRefusal((record) => presetFromRead(read, record))).toMatchObject(
        SKIPPED_OTHER_ACCOUNT,
      )
    }
  })
})
