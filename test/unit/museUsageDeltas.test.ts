import { describe, expect, it, vi } from 'vitest'
import { MuseCodeHost, MuseUsageDeltas } from '../../src/core/backends/musecode/MuseCodeHost'
import type { UsageRecording } from '../../src/core/usage/recording'
import { FakeLogOutputChannel } from './helpers/fakes'
import { fakeMspHost, fakeInitializeResult, settle } from './helpers/fakeMsp'

function setup(isNew: boolean) {
  const port: UsageRecording = {
    note: vi.fn(),
    limit: vi.fn(),
    today: () => Promise.resolve([]),
    flush: () => Promise.resolve(),
  }
  const deltas = new MuseUsageDeltas(port, 'session', 'muse-spark-1.3', isNew, () => 100)
  const report = (inputTokens: number, outputTokens: number) => {
    deltas.receive({ type: 'tokenUsage', inputTokens, outputTokens })
  }
  const finish = () => {
    deltas.receive({ type: 'turnCompleted', turnId: 'turn', terminal: 'completed' })
  }
  return { port, deltas, report, finish }
}
describe('Muse Code journal deltas', () => {
  it('records usage snapshots once per observation and keeps reported window lengths', async () => {
    const t = setup(false)
    const handle = fakeMspHost(fakeInitializeResult)
    const host = new MuseCodeHost(handle.host, new FakeLogOutputChannel(), undefined, t.port)
    const usage = {
      observedAtMs: 100,
      tier: 'opaque',
      window: { usedPercent: 110, resetsAtMs: 200, windowDurationMins: 300 },
      weekly: { usedPercent: 20, resetsAtMs: 500 },
    }
    handle.server.notify('usage/changed', usage)
    handle.server.notify('usage/changed', usage)
    await settle()
    expect(t.port.limit).toHaveBeenCalledExactlyOnceWith({
      backend: 'museCode',
      provider: 'museCode',
      source: 'museCode',
      observedAt: 100,
      windows: [
        { id: 'window', usedPercent: 110, resetsAt: 200, windowMins: 300 },
        { id: 'weekly', usedPercent: 20, resetsAt: 500 },
      ],
    })
    await host.close()
  })
  it('uses replayed cumulative reports only as a baseline', () => {
    const t = setup(false)
    t.deltas.receive({ type: 'tokenUsage', inputTokens: 1000, outputTokens: 200 }, true)
    t.deltas.receive({ type: 'tokenUsage', inputTokens: 1500, outputTokens: 300 }, true)
    t.deltas.receive({ type: 'turnCompleted', turnId: 'old', terminal: 'completed' }, true)
    expect(t.port.note).not.toHaveBeenCalled()
    t.report(1600, 320)
    t.finish()
    expect(t.port.note).toHaveBeenCalledWith(
      { input_tokens: 100, output_tokens: 20 },
      expect.anything(),
    )
  })
  it('journals each reported delta immediately and ignores duplicate completion', () => {
    const t = setup(true)
    t.deltas.receive({ type: 'turnStarted', turnId: 'turn' })
    t.report(100, 20)
    expect(t.port.note).toHaveBeenCalledExactlyOnceWith(
      { input_tokens: 100, output_tokens: 20 },
      expect.objectContaining({ pricing: { kind: 'plan' }, kind: 'turn', outcome: 'incomplete' }),
    )
    t.report(150, 30)
    t.report(150, 30)
    t.finish()
    t.finish()
    expect(t.port.note).toHaveBeenCalledTimes(2)
    expect(t.port.note).toHaveBeenLastCalledWith(
      { input_tokens: 50, output_tokens: 10 },
      expect.objectContaining({ outcome: 'incomplete' }),
    )
    t.report(200, 40)
    t.finish()
    expect(t.port.note).toHaveBeenLastCalledWith(
      { input_tokens: 50, output_tokens: 10 },
      expect.anything(),
    )
  })
  it('keeps reported tokens when Muse Code exits before turn completion', async () => {
    const tap = setup(true).port
    const handle = fakeMspHost(fakeInitializeResult)
    handle.server.handle('session/start', (params) => ({
      session: { sessionId: 'new-session', modelId: params['modelId'], status: 'idle' },
      viewCursor: '',
    }))
    const host = new MuseCodeHost(handle.host, new FakeLogOutputChannel(), undefined, tap)
    const session = await host.startSession({
      workspaceRoot: '/workspace',
      modelId: 'muse-spark-1.3',
      approvalMode: 'promptUnmatched',
    })
    handle.server.notify('turn/started', {
      sessionId: session.sessionId,
      turnId: 'turn',
      viewCursor: 'v',
    })
    handle.server.notify('session/tokenUsage', {
      sessionId: session.sessionId,
      cumulative: { promptTokens: 100, outputTokens: 20 },
    })
    await settle()
    expect(tap.note).toHaveBeenCalledExactlyOnceWith(
      { input_tokens: 100, output_tokens: 20 },
      expect.objectContaining({ outcome: 'incomplete' }),
    )
    handle.exit(1)
    await settle()
    await host.close()
    expect(tap.note).toHaveBeenCalledOnce()
  })
  it('takes the first resumed report as a baseline and never replays historical spend', () => {
    const t = setup(false)
    t.report(1000, 200)
    t.finish()
    expect(t.port.note).not.toHaveBeenCalled()
    t.report(1100, 220)
    t.finish()
    expect(t.port.note).toHaveBeenCalledWith(
      { input_tokens: 100, output_tokens: 20 },
      expect.anything(),
    )
  })
  it('rebaselines counters that decrease rather than writing negative usage', () => {
    const t = setup(false)
    t.report(1000, 200)
    t.report(100, 20)
    t.finish()
    expect(t.port.note).not.toHaveBeenCalled()
    t.report(150, 25)
    t.finish()
    expect(t.port.note).toHaveBeenCalledWith(
      { input_tokens: 50, output_tokens: 5 },
      expect.anything(),
    )
  })
})
