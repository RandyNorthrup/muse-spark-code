import { describe, expect, it, vi } from 'vitest'
import { MuseCodeHost } from '../../../src/core/backends/musecode/MuseCodeHost'
import { MuseCodeBackendManager } from '../../../src/host/backend/museCodeBackendManager'
import type { AgentEvent } from '../../../src/shared/agentEvents'
import { FakeLogOutputChannel } from '../../unit/helpers/fakes'
import { fakePanelRuntime } from '../../unit/helpers/runtimePanel'
import { fakeMspHost } from '../../unit/helpers/fakeMsp'
import { sideSessionStarted } from '../../unit/helpers/reviewerCapture'
import {
  WORKFLOW_REVISIONS,
  WORKFLOW_COMPLETED,
  WORKFLOW_RUN_ID,
} from '../../unit/helpers/workflowFixtures'
import { engineFixtures } from './fixtures'

const fixtures = engineFixtures()
async function setup() {
  const workspace = await fixtures.folder('m104-pb-workflow-')
  const log = new FakeLogOutputChannel()
  const wire = fakeMspHost()
  const host = new MuseCodeHost(wire.host, log)
  fixtures.own({ dispose: () => host.close() })
  wire.server.handle('session/start', (params) =>
    sideSessionStarted('workflow-session', params['workspaceRoot'], params['modelId']),
  )
  const launch = vi.spyOn(MuseCodeBackendManager.prototype, 'ensureHost').mockResolvedValue(host)
  const runtime = fakePanelRuntime({
    options: {
      backend: 'museCode',
      trustWorkspace: true,
      museBinary: '',
      shellSandbox: 'auto',
      canBypass: false,
      allowsContributorModels: false,
      paidFeatures: [],
      isVerbose: false,
    },
    distDir: workspace,
    homeDir: workspace,
    log,
    runGit: () => Promise.reject(new Error('fixture forbids Git')),
  })
  fixtures.own({ dispose: runtime.close })
  const selected = await runtime.backend.hostFor(workspace)
  const session = await selected.startSession({
    workspaceRoot: workspace,
    modelId: 'muse-spark-1.3',
    approvalMode: 'promptUnmatched',
  })
  const events: AgentEvent[] = []
  const stop = session.onEvent((event) => {
    events.push(event)
  })
  return { wire, events, session, stop, runtime, launch }
}
describe('F18 captured workflows through the portable backend', () => {
  it('keeps all seven real run revisions, child usage and reconciled results', async () => {
    const rig = await setup()
    for (const item of WORKFLOW_REVISIONS) {
      const method = item.revision === 1 ? 'item/started' : 'item/updated'
      rig.wire.server.notify(item.status === 'completed' ? 'item/completed' : method, {
        sessionId: rig.session.sessionId,
        item,
      })
    }
    await vi.waitFor(() => {
      expect(rig.events).toHaveLength(WORKFLOW_REVISIONS.length)
    })
    const snapshots = rig.events.flatMap((event) => ('item' in event ? [event.item] : []))
    expect(snapshots.map((item) => item.workflowRunId)).toEqual(
      WORKFLOW_REVISIONS.map(() => WORKFLOW_RUN_ID),
    )
    expect(snapshots.at(-1)).toMatchObject({
      children: WORKFLOW_COMPLETED.children,
      message: WORKFLOW_COMPLETED.message,
      entryId: WORKFLOW_COMPLETED.entryId,
      status: WORKFLOW_COMPLETED.status,
    })
    expect(snapshots[3]?.children).toEqual(WORKFLOW_REVISIONS[3]?.children)
    expect(rig.launch).toHaveBeenCalledOnce()
    rig.stop()
    rig.session.dispose()
  })
  it('retains open-ended status values and refuses malformed captured rows', async () => {
    const rig = await setup()
    rig.wire.server.notify('item/updated', {
      sessionId: rig.session.sessionId,
      item: {
        ...WORKFLOW_COMPLETED,
        status: 'future-status',
        children: [{ childId: 'future-child', status: 'future-child-status' }],
      },
    })
    await vi.waitFor(() => {
      expect(rig.events).toHaveLength(1)
    })
    expect(rig.events[0]).toMatchObject({
      item: {
        status: 'future-status',
        children: [{ childId: 'future-child', status: 'future-child-status' }],
      },
    })
    rig.wire.server.notify('item/updated', {
      sessionId: rig.session.sessionId,
      item: { ...WORKFLOW_COMPLETED, children: {} },
    })
    await vi.waitFor(() => {
      expect(rig.wire.server.requestsFor('session/start')).toHaveLength(1)
    })
    await new Promise<undefined>((resolve) => {
      setImmediate(resolve, undefined)
    })
    expect(rig.events).toHaveLength(1)
    rig.stop()
    rig.session.dispose()
  })
})
