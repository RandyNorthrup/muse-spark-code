// M88 lane P: deferred send refuses while the session cannot take a
// message, and sends nothing then. Driven against the real controller
// (helpers/conversationPanel.ts); the run's own steps and the turn-end
// advance are lane A's, proven through `sequenceStart` there.
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { conversationPanel, modelApiRig } from './helpers/conversationPanel'
import { removeFolder } from './helpers/temporaryFolders'

describe('deferred send refusals', () => {
  let directory = ''

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'muse-deferred-send-'))
  })
  afterEach(async () => {
    await removeFolder(directory)
  })

  it('reports notLoaded with no session, and sends nothing', async () => {
    const rig = modelApiRig(directory)
    const panel = conversationPanel({ rig, directory })
    expect(panel.controller.canSendNow('s1')).toBe('notLoaded')
    const outcome = await panel.controller.sendAsUser('Step one', {
      sessionId: 's1',
      runId: 'run-1',
    })
    expect(outcome).toEqual({ verdict: 'notLoaded' })
    expect(panel.posted).toEqual([])
  })

  it('takes and releases a turn-end listener without disturbing the panel', () => {
    const rig = modelApiRig(directory)
    const panel = conversationPanel({ rig, directory })
    // The rig runs no turn, so no end can arrive here: subscribing and
    // releasing must be silent. The runner's read of a real end is
    // proven where the run can end (sequencePanel.test.ts).
    const release = panel.controller.onTurnSettled(() => {
      throw new Error('no turn ends on the panel rig')
    })
    release()
    expect(panel.posted).toEqual([])
  })
})
