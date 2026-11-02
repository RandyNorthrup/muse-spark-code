// C-M115-9: the native panel's schedule hold through its real code only:
// the hold state, the real lazy bundle loader and real Model API sessions
// (local store only, never a turn). Certified editor delivery is off
// (SCHEDULE_EDITOR_DELIVERY_CERTIFICATION), so a hold today degrades to
// a warning plus the conversation notice, never a failed open; the live
// delivery cases ride that certification when it lands.
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AgentSession } from '../../src/core/agent/agentBackend'
import { panelSchedulesLoader } from '../../src/runtime/panel/panelBundle'
import { createPanelScheduleHold } from '../../src/runtime/panel/panelSchedules'
import {
  DEFAULT_MODEL_ID,
  RUNTIME_PANEL_SCHEDULES_BUNDLE_FILE,
  UI_TEXT,
} from '../../src/shared/constants'
import { modelApiRig, type ModelApiRig } from './helpers/conversationPanel'
import { removeFolder } from './helpers/temporaryFolders'
import { warningLogger } from './helpers/collectingLogger'

function recordingOwner() {
  const notices: { session: unknown; text: string }[] = []
  return {
    notices,
    owner: {
      scheduleNotice: (session: unknown, text: string) => {
        notices.push({ session, text })
      },
      settleScheduledQuestion: () => Promise.resolve(),
    },
  }
}

describe('the native schedule hold without certified delivery', () => {
  let directory = ''
  let rig: ModelApiRig | undefined

  beforeAll(() => {
    directory = mkdtempSync(path.join(tmpdir(), 'panel-schedules-'))
    rig = modelApiRig(directory)
  })

  afterAll(async () => {
    await removeFolder(directory)
  })

  async function startSession(): Promise<AgentSession> {
    if (rig === undefined) throw new Error('rig unavailable')
    return await rig.host.startSession({
      workspaceRoot: directory,
      modelId: DEFAULT_MODEL_ID,
      approvalMode: 'promptUnmatched',
    })
  }

  it('degrades a hold whose bundle cannot load to a warning and a notice', async () => {
    const warnings: string[] = []
    const { notices, owner } = recordingOwner()
    let loads = 0
    const hold = createPanelScheduleHold({
      log: warningLogger(warnings),
      load: () => {
        loads += 1
        // The real lazy loader over a folder with no bundle in it: its
        // own refusal, not an invented one.
        panelSchedulesLoader(
          path.join(directory, RUNTIME_PANEL_SCHEDULES_BUNDLE_FILE),
          warningLogger(warnings),
        )()
        return Promise.reject(new Error('the loader must refuse first'))
      },
    })
    const session = await startSession()
    await hold.hold(directory, session, 'modelApi', owner)
    expect(loads).toBe(1)
    expect(hold.isHeld).toBe(false)
    expect(warnings.some((line) => line.startsWith('MHP_SCHEDULE_HOLD_FAILED'))).toBe(true)
    expect(notices).toEqual([
      { session: undefined, text: UI_TEXT.scheduleV2.runtime.hostUnavailable },
    ])
    await hold.close()
  })

  it('refuses holds after close without loading again', async () => {
    const warnings: string[] = []
    const { notices, owner } = recordingOwner()
    let loads = 0
    const hold = createPanelScheduleHold({
      log: warningLogger(warnings),
      load: () => {
        loads += 1
        return Promise.reject(new Error('must not load after close'))
      },
    })
    await hold.close()
    const session = await startSession()
    await expect(hold.hold(directory, session, 'modelApi', owner)).rejects.toThrow(
      UI_TEXT.scheduleV2.runtime.unavailable,
    )
    expect(loads).toBe(0)
    expect(hold.isHeld).toBe(false)
    expect(notices).toEqual([])
  })
})
