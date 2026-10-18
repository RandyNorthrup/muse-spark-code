import { describe, expect, it } from 'vitest'
import type { CoreLogger } from '../../src/core/logging'
import { configuredTransportLog } from '../../src/core/providers/configured'
import { silentWaitNotices } from '../../src/core/providers/subscriptions/registry'

function probe(): { log: CoreLogger; lines: { level: string; message: string }[] } {
  const lines: { level: string; message: string }[] = []
  const log: CoreLogger = {
    trace: (message: string) => {
      lines.push({ level: 'trace', message })
    },
    info: (message: string) => {
      lines.push({ level: 'info', message })
    },
    warn: (message: string) => {
      lines.push({ level: 'warn', message })
    },
    error: (message: string) => {
      lines.push({ level: 'error', message })
    },
  }
  return { log, lines }
}

const sleep = (ms: number): Promise<void> =>
  new Promise((done) => {
    setTimeout(done, ms)
  })

describe('indefinite provider waits say so', () => {
  it('notices an unnamed wait on the host log and stops when told', async () => {
    const { log, lines } = probe()
    const waits = silentWaitNotices(log, undefined, 10)
    waits.notice({ key: 'modelReply' })
    await sleep(50)
    expect(lines.length).toBeGreaterThan(0)
    expect(lines.every((line) => line.level === 'info')).toBe(true)
    expect(lines[0]?.message).toContain('Still waiting')
    waits.stop()
    const count = lines.length
    await sleep(30)
    expect(lines.length).toBe(count)
  })

  it('stays silent when the provider named its own idle', async () => {
    const { log, lines } = probe()
    const waits = silentWaitNotices(log, 1000, 10)
    waits.notice({ key: 'modelReply' })
    await sleep(40)
    waits.stop()
    expect(lines).toEqual([])
  })

  it('stays silent when no log was named', async () => {
    const waits = silentWaitNotices(undefined, undefined, 10)
    waits.notice({ key: 'providerAnswer' })
    await sleep(30)
    waits.stop()
  })

  it('routes transport notices to the host log but keeps timing out', () => {
    const { log, lines } = probe()
    const transportLog = configuredTransportLog(log)
    transportLog.info('waiting')
    transportLog.warn('retrying')
    transportLog.error('failed')
    transportLog.trace('timed')
    expect(lines).toEqual([
      { level: 'info', message: 'waiting' },
      { level: 'warn', message: 'retrying' },
      { level: 'error', message: 'failed' },
    ])
  })

  it('drops every transport line when no log was named', () => {
    const transportLog = configuredTransportLog(undefined)
    transportLog.info('waiting')
    transportLog.warn('retrying')
    transportLog.error('failed')
    transportLog.trace('timed')
  })
})
