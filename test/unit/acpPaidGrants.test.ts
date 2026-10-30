// "Allow always" grants in the ACP agent lapse per start (M58, D48, D62):
// a feature started without its flag asks again next time. Automatic
// compaction is on by default, so its grant counts as flagged while it is
// on, and an explicit `--no-auto-compaction` start lapses it too — even
// when `--auto-compaction` was passed beside it (RVMSM101). The real
// file-backed grant store runs in a temporary folder.
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { AcpPaidUse } from '../../src/acp/paid'
import type { CoreLogger } from '../../src/core/logging'
import { paidGrantFile } from '../../src/runtime/paidGrants'
import { ACP_PAID_FEATURES } from '../../src/shared/constants'
import { Usd } from '../../src/shared/usd'

const folder = mkdtempSync(path.join(tmpdir(), 'acp-paid-grants-'))
afterAll(() => {
  rmSync(folder, { recursive: true, force: true })
})

const log: CoreLogger = {
  trace: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
}
const noSleep = (): Promise<void> => Promise.resolve()
const workspace = '/work/project'

function store(name: string) {
  return paidGrantFile({ file: path.join(folder, name), log, sleep: noSleep })
}

describe('ACP paid grants lapse with the start flags', () => {
  it('keeps the compaction grant while compaction is default-on, forgets unflagged search', async () => {
    const grants = store('on.json')
    await grants.add(workspace, ['autoCompaction', 'webSearch'])
    const paid = new AcpPaidUse({
      flagged: [],
      canRemember: () => true,
      grants,
      log,
    })
    await paid.forgetUnflagged()
    expect(grants.read(workspace).has('autoCompaction')).toBe(true)
    expect(grants.read(workspace).has('webSearch')).toBe(false)
  })

  it('lapses the compaction grant on a --no-auto-compaction start, even with the on flag beside it', async () => {
    const grants = store('off.json')
    await grants.add(workspace, ['autoCompaction'])
    const paid = new AcpPaidUse({
      flagged: ['autoCompaction'],
      autoCompactionOff: true,
      canRemember: () => true,
      grants,
      log,
    })
    await paid.forgetUnflagged()
    expect(grants.read(workspace).has('autoCompaction')).toBe(false)
  })
})

describe('Ask again for a use billed to another account', () => {
  it('revokes the account consent: its durable epoch advances and the next use asks again', async () => {
    const accountFolder = path.join(folder, 'account-consent')
    const paid = new AcpPaidUse({
      flagged: ['imageGeneration'],
      canRemember: () => true,
      grants: store('account.json'),
      log,
      billing: () => ({ provider: 'meta', account: 'second-account' }),
      accountFolder: () => accountFolder,
      dailyBudgetUsd: () => Usd.from(0).toAmount(),
      sleep: noSleep,
    })
    const answers = ['always', 'once'] as const
    let asked = 0
    paid.attach(() => {
      const answer = answers[asked] ?? 'deny'
      asked += 1
      return Promise.resolve(answer)
    })
    const use = () =>
      paid.allows(
        workspace,
        'session-1',
        {
          feature: 'imageGeneration',
          kind: 'generate',
          path: 'out.png',
          sources: [],
          prompt: 'a cat',
        },
        false,
      )
    const epochs = () =>
      readdirSync(accountFolder, { recursive: true }).filter(
        (name) => typeof name === 'string' && /^epoch-[1-9]/u.test(path.basename(name)),
      )
    expect(await use()).toBe(true)
    expect(await use()).toBe(true)
    expect(asked).toBe(1)
    await paid.forget(workspace, 'session-1')
    // The revocation the account store fences on (its epoch marker), not
    // only the feature generation: VS Code's Ask again revokes it too.
    expect(epochs()).toHaveLength(1)
    expect(await use()).toBe(true)
    expect(asked).toBe(2)
  })
})

describe('ACP paid features without a flag', () => {
  it('keeps subagents off with every flag passed: headless offers no subagent tool (RLTESTDRIVE item 4)', () => {
    const paid = new AcpPaidUse({
      flagged: [...ACP_PAID_FEATURES],
      canRemember: () => true,
      grants: store('all.json'),
      log,
    })
    for (const feature of ACP_PAID_FEATURES) expect(paid.isOn(feature)).toBe(true)
    // Child tasks are paid and headless has no one to consent, so the
    // agent has no subagents flag: the built-in explore/second-opinion
    // agents and custom agents (roles) cannot run headless, by design.
    expect(paid.isOn('subagents')).toBe(false)
  })
})
