// Three real scheduler/backend processes share one durable claim store.
import { appendFileSync } from 'node:fs'
import process from 'node:process'
import * as z from 'zod/mini'
import { createScheduleEngine } from '../../src/runtime/schedules/engine'
import {
  createNodeScheduleFs,
  createNodeScheduleQueue,
} from '../../src/runtime/schedules/nodeScheduleFs'
import { workspaceKey } from '../../src/runtime/dataFolder'
import { MuseCodeHost } from '../../src/core/backends/musecode/MuseCodeHost'
import { createScheduleDeliveryBinding } from '../../src/host/schedules/deliveryBinding'
import { FakeLogOutputChannel } from '../unit/helpers/fakes'
import { fakeMspHost } from '../unit/helpers/fakeMsp'
import { memoryToolIo } from '../unit/helpers/fakeToolIo'
import { fakeSchedule, quietScheduleDelivery } from '../unit/helpers/schedules/fixtures'
import { FakeScheduleBackground } from '../unit/helpers/schedules/background'

const [dataDir, cwd, receipt, holder] = z
  .tuple([z.string(), z.string(), z.string(), z.enum(['window-1', 'window-2', 'acp'])])
  .parse(process.argv.slice(2))
const protocol = fakeMspHost()
const host = new MuseCodeHost(protocol.host, new FakeLogOutputChannel())
protocol.server.handle('session/start', () => ({
  session: { sessionId: 'session-1', modelId: 'muse-spark-1.3', status: 'idle' },
  viewCursor: '',
}))
protocol.server.handle('session/setApprovalMode', (params) => ({
  commandId: params['commandId'],
  status: 'accepted',
}))
const opening = host.startSession({
  workspaceRoot: cwd,
  modelId: 'muse-spark-1.3',
  approvalMode: 'promptUnmatched',
})
const boundSession: { value?: Awaited<typeof opening> } = {}
const unpublish = () => undefined
const clock = { isCompletionReleased: false, nowMs: 0 }
const complete = () => {
  protocol.server.notify('turn/completed', {
    sessionId: 'session-1',
    turnId: 'scheduled-1',
    terminal: 'completed',
    viewCursor: 'v',
  })
}
protocol.server.handle('turn/start', (params) => {
  const run = boundSession.value?.getScheduledRun()
  if (run === undefined) throw new Error('missing process-bound unattended authority')
  appendFileSync(receipt, `${JSON.stringify({ holder, runId: run.context.runId })}\n`)
  process.send?.({ phase: 'admitted', holder })
  if (clock.isCompletionReleased) queueMicrotask(complete)
  return {
    commandId: params['commandId'],
    turnId: 'scheduled-1',
    status: 'accepted',
    disposition: 'started',
    startedNewTurn: true,
  }
})
const lifetime = new AbortController()
const dispatchBarrier = Promise.withResolvers<undefined>()
const queue = createNodeScheduleQueue(dataDir)

const engine = createScheduleEngine({
  fs: createNodeScheduleFs(dataDir),
  queue: {
    ...queue,
    serialize: async (target, work) => {
      process.send?.({ phase: 'contending', holder })
      await dispatchBarrier.promise
      await queue.serialize(target, work)
    },
  },
  now: () => clock.nowMs,
  delivery: (authority) =>
    createScheduleDeliveryBinding(
      {
        workspaceRoot: cwd,
        platform: process.platform,
        dialect: process.platform === 'win32' ? 'powershell' : 'bash',
        io: memoryToolIo({}, cwd),
        signal: lifetime.signal,
        isActive: () => !lifetime.signal.aborted,
        host: () => Promise.resolve(host),
        ...quietScheduleDelivery(cwd),
        publish: () => unpublish,
        findLive: () =>
          boundSession.value === undefined
            ? undefined
            : { agent: boundSession.value, status: 'idle' },
      },
      authority,
    ),
  backgroundEntry: new FakeScheduleBackground(),
})

async function start() {
  boundSession.value = await opening
  const release = await engine.runtime.holdWorkspace(cwd)
  await engine.pollWorkspace(workspaceKey(cwd))
  process.send?.({ phase: 'ready', holder })
  process.on('message', (input: unknown) => {
    const message = z.enum(['poll', 'dispatch', 'complete', 'close']).parse(input)
    void (async () => {
      if (message === 'dispatch') {
        dispatchBarrier.resolve(undefined)
        return
      }
      if (message === 'complete') {
        clock.isCompletionReleased = true
        if (boundSession.value?.getScheduledRun() !== undefined) complete()
        return
      }
      if (message === 'close') {
        await release()
        await engine.runtime.close()
        lifetime.abort()
        await host.close()
        process.disconnect()
        return
      }
      clock.nowMs = fakeSchedule().nextFireAtMs ?? 0
      await engine.scheduler.poll(workspaceKey(cwd))
      process.send?.({ phase: 'settled', holder })
    })().catch(fail)
  })
}
async function fail(error: unknown): Promise<void> {
  process.stderr.write(String(error))
  process.exitCode = 1
  try {
    await engine.runtime.close()
    lifetime.abort()
    await host.close()
  } finally {
    if (process.connected) process.disconnect()
  }
}
void start().catch(fail)
