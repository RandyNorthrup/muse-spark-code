// RLF-MACLIVE F2: the ACP usage read covers Muse Code sessions. A Muse
// Code turn's journaled records feed the snapshot through the real chain:
// the rig's wire mapper, session deltas, recording and on-disk journal,
// plus the real daily-ledger reader for budgets.
import { describe, expect, it } from 'vitest'
import { readAcpUsage } from '../../src/acp/accounting'
import { createAcpAccounting } from '../../src/runtime/acpAccounting'
import { readRuntimeDailyBudget } from '../../src/runtime/runtimeAccountingEntry'
import {
  createMuseJournalRig,
  MUSE_JOURNAL_NOW,
  MUSE_JOURNAL_SESSION,
  MUSE_TOKEN_USAGE_FRAMES,
  registerMuseJournalCleanup,
} from './helpers/museJournalRig'

registerMuseJournalCleanup()

async function museCodeAccounting(isHistoryOn: boolean) {
  const rig = await createMuseJournalRig(
    'muse-spark-1.3-contributor',
    'muse-acp-usage-',
    'acp-usage-test',
  )
  const accounting = createAcpAccounting({
    recording: rig.recording,
    isEnabled: () => isHistoryOn,
    runtime: {
      readUsageBudgets: () =>
        readRuntimeDailyBudget({ dataFolder: rig.dataFolder, now: () => MUSE_JOURNAL_NOW }),
    },
    dataFolder: rig.dataFolder,
    now: () => MUSE_JOURNAL_NOW,
    sleep: () => Promise.resolve(),
  })
  return { rig, accounting }
}

describe('ACP usage read over Muse Code journal records', () => {
  it('snapshots the session with plan-priced requests and no settled dollars', async () => {
    const { rig, accounting } = await museCodeAccounting(true)
    rig.feed(MUSE_TOKEN_USAGE_FRAMES)
    await rig.recording.flush()
    const snapshot = await readAcpUsage(accounting, MUSE_JOURNAL_SESSION)
    expect(snapshot.available).toBe(true)
    // Both completions journaled; neither settles dollars on a subscription.
    expect(snapshot.session.requests).toBe(2)
    expect(snapshot.session.planRequests).toBe(2)
    expect(snapshot.session.settledUsd).toBe('0')
    expect(snapshot.session.tokens.input).toBeGreaterThan(0)
    expect(snapshot.session.tokens.output).toBeGreaterThan(0)
    expect(snapshot.session.unknownRequests).toBe(0)
  })

  it('refuses the read where history is disabled', async () => {
    const { rig, accounting } = await museCodeAccounting(false)
    rig.feed(MUSE_TOKEN_USAGE_FRAMES)
    await rig.recording.flush()
    await expect(readAcpUsage(accounting, MUSE_JOURNAL_SESSION)).rejects.toThrow(
      'Usage history unavailable',
    )
  })
})
