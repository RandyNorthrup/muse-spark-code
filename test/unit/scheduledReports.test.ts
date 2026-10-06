import { describe, expect, it, vi } from 'vitest'
import { ScheduledReportRunner } from '../../src/core/reporting/destinations/runner'
import {
  openReportSchedule,
  saveReportSchedule,
} from '../../src/core/reporting/destinations/scheduleRequest'
import { scheduledReportActionSchema } from '../../src/core/reporting/destinations/types'
import { UI_TEXT } from '../../src/shared/constants'
import {
  ADDRESS,
  CONNECTION,
  OCCURRENCE,
  deliveryPayload,
  reportAction,
  runnerRig,
} from './helpers/reporting/destinations'

const post = {
  type: 'post' as const,
  id: 'post',
  target: { repository: 'owner/project', number: 12, kind: 'statusIssue' as const },
}
const browser = { type: 'browser' as const, id: 'browser', storage: 'node' as const }
describe('scheduled report occurrence runner', () => {
  it('uses occurrence asOf and exact manual bytes, with no paid/model dependency', async () => {
    const rig = runnerRig()
    const runner = new ScheduledReportRunner(rig.ports)
    const action = reportAction([browser])
    action.options.asOf = '2026-01-01T00:00:00Z'
    action.options.network = true
    expect(await runner.run('one', OCCURRENCE, action)).toEqual({
      browser: { status: 'delivered', attempts: 1 },
    })
    expect(rig.ports.generation.generate).toHaveBeenCalledWith({
      ...action.options,
      asOf: OCCURRENCE,
      network: false,
    })
    expect(rig.records.get(OCCURRENCE)?.payload).toEqual(deliveryPayload())
    expect(rig.browser.publishHtml).toHaveBeenCalledWith(
      'one',
      OCCURRENCE,
      deliveryPayload().html,
      'node',
    )
  })
  it('freezes the document before delivery and never recollects or duplicates a completed fire', async () => {
    const rig = runnerRig()
    const runner = new ScheduledReportRunner(rig.ports)
    const action = reportAction([post])
    await runner.run('one', OCCURRENCE, action)
    expect(rig.records.get(OCCURRENCE)?.outcomes['post']?.status).toBe('delivered')
    await runner.run('one', OCCURRENCE, action)
    expect(rig.ports.generation.generate).toHaveBeenCalledTimes(1)
    expect(rig.postPort.publish).toHaveBeenCalledTimes(1)
    expect(rig.records.get(OCCURRENCE)?.payload.attachment).toBe(deliveryPayload().attachment)
  })
  it('resumes a deferred browser using frozen bytes when the user returns', async () => {
    const rig = runnerRig()
    const runner = new ScheduledReportRunner(rig.ports)
    rig.browser.hasActiveSession.mockResolvedValue(false)
    const action = reportAction([browser])
    const deliveryResult1 = await runner.run('one', OCCURRENCE, action)
    expect(deliveryResult1['browser']?.status).toBe('deferred')
    expect(rig.browser.open).not.toHaveBeenCalled()
    rig.browser.hasActiveSession.mockResolvedValue(true)
    const deliveryResult2 = await runner.run('one', OCCURRENCE, action)
    expect(deliveryResult2['browser']?.status).toBe('delivered')
    expect(rig.ports.generation.generate).toHaveBeenCalledTimes(1)
  })
  it('bounds retries to three known pre-dispatch failures', async () => {
    const rig = runnerRig()
    rig.postPort.publish.mockResolvedValue({ status: 'retryable' })
    const deliveryResult3 = await new ScheduledReportRunner(rig.ports).run(
      'one',
      OCCURRENCE,
      reportAction([post]),
    )
    expect(deliveryResult3['post']).toEqual({ status: 'failed', attempts: 3 })
    expect(rig.postPort.publish).toHaveBeenCalledTimes(3)
    expect(rig.ports.sleep).toHaveBeenCalledTimes(2)
  })
  it('does not retry an uncertain reply, an exception, or a malformed receipt', async () => {
    for (const reply of ['uncertain', 'exception', 'malformed']) {
      const rig = runnerRig()
      if (reply === 'exception')
        rig.postPort.publish.mockRejectedValue(new Error('account credential detail'))
      else rig.postPort.publish.mockResolvedValue({ status: reply })
      const runner = new ScheduledReportRunner(rig.ports)
      const action = reportAction([post])
      const deliveryResult4 = await runner.run('one', OCCURRENCE, action)
      expect(deliveryResult4['post']?.status).toBe('uncertain')
      await runner.run('one', OCCURRENCE, action)
      expect(rig.postPort.publish).toHaveBeenCalledTimes(1)
      expect(rig.ports.sleep).not.toHaveBeenCalled()
    }
  })
  it('persists uncertainty before dispatch so a crash cannot duplicate a send', async () => {
    const rig = runnerRig()
    rig.postPort.publish.mockImplementation(() => {
      expect(rig.records.get(OCCURRENCE)?.outcomes['post']).toEqual({
        status: 'uncertain',
        attempts: 0,
      })
      return Promise.resolve({ status: 'delivered' })
    })
    const result = await new ScheduledReportRunner(rig.ports).run(
      'one',
      OCCURRENCE,
      reportAction([post]),
    )
    expect(result['post']?.status).toBe('delivered')
  })
  it('denies an agent grant before generation and checks destination authority again after a wait', async () => {
    const rig = runnerRig()
    const authorize = vi.spyOn(rig.ports.authority, 'authorize')
    authorize.mockResolvedValue({ allowed: false, roots: [], network: false, creator: 'agent' })
    const deliveryResult5 = await new ScheduledReportRunner(rig.ports).run(
      'one',
      OCCURRENCE,
      reportAction([post]),
    )
    expect(deliveryResult5['post']?.status).toBe('refused')
    expect(rig.ports.generation.generate).not.toHaveBeenCalled()
    expect(rig.postPort.publish).not.toHaveBeenCalled()
    authorize.mockResolvedValue({ allowed: true, roots: [], network: false, creator: 'agent' })
    rig.postPort.publish.mockResolvedValue({ status: 'retryable' })
    vi.spyOn(rig.ports, 'sleep').mockImplementation(() => {
      authorize.mockResolvedValue({ allowed: false, roots: [], network: false, creator: 'agent' })
      return Promise.resolve()
    })
    const deliveryResult6 = await new ScheduledReportRunner(rig.ports).run(
      'one',
      OCCURRENCE,
      reportAction([post]),
    )
    expect(deliveryResult6['post']).toEqual({ status: 'refused', attempts: 1 })
    expect(rig.postPort.publish).toHaveBeenCalledTimes(1)
  })
  it('refuses unverified agent email and ungranted save roots', async () => {
    const rig = runnerRig()
    const email = { type: 'email' as const, id: 'email', address: ADDRESS, connection: CONNECTION }
    const runner = new ScheduledReportRunner(rig.ports)
    expect(await runner.prepare('one', reportAction([email]))).toBe(false)
    expect(rig.ports.generation.generate).not.toHaveBeenCalled()
    const deliveryResult7 = await runner.run('one', OCCURRENCE, reportAction([email]))
    expect(deliveryResult7['email']?.status).toBe('failed')
    expect(rig.mail.port.send).not.toHaveBeenCalled()
    const save = {
      type: 'save' as const,
      id: 'save',
      root: 'C:/outside',
      storage: 'local' as const,
      template: '{kind}.{ext}',
      retention: 1,
    }
    const deliveryResult8 = await runner.run('two', '2026-10-07T00:00:00Z', reportAction([save]))
    expect(deliveryResult8['save']?.status).toBe('failed')
  })
  it('rejects changed action identity and mismatched generator scope/time', async () => {
    const rig = runnerRig()
    const runner = new ScheduledReportRunner(rig.ports)
    await runner.run('one', OCCURRENCE, reportAction([post]))
    await expect(runner.run('one', OCCURRENCE, reportAction([browser]))).rejects.toThrow()
    const fresh = runnerRig()
    vi.spyOn(fresh.ports.generation, 'generate').mockResolvedValue(
      deliveryPayload('2026-10-05T00:00:00Z').document,
    )
    await expect(
      new ScheduledReportRunner(fresh.ports).run('one', OCCURRENCE, reportAction([post])),
    ).rejects.toThrow()
    expect(fresh.postPort.publish).not.toHaveBeenCalled()
  })
  it('rejects a malformed frozen occurrence before it can suppress or dispatch delivery', async () => {
    const rig = runnerRig()
    const runner = new ScheduledReportRunner(rig.ports)
    rig.browser.hasActiveSession.mockResolvedValue(false)
    const action = reportAction([browser])
    await runner.run('one', OCCURRENCE, action)
    const record = rig.records.get(OCCURRENCE)!
    rig.records.set(OCCURRENCE, {
      ...record,
      outcomes: { ...record.outcomes, browser: { status: 'delivered', attempts: -1 } },
    })
    await expect(runner.run('one', OCCURRENCE, action)).rejects.toThrow(
      UI_TEXT.reportUi.generationFailed,
    )
    expect(rig.browser.open).not.toHaveBeenCalled()
  })
  it('validates schedule actions and opens the common editor for --schedule', async () => {
    const action = reportAction([post])
    const port = {
      openReportSchedule: vi.fn(() => Promise.resolve()),
      saveReportSchedule: vi.fn(() => Promise.resolve()),
    }
    expect(await openReportSchedule(action.options, [], port)).toBe('ignored')
    expect(port.openReportSchedule).not.toHaveBeenCalled()
    expect(await openReportSchedule(action.options, ['--schedule'], port)).toBe('opened')
    expect(port.openReportSchedule).toHaveBeenCalledWith(action.options)
    await saveReportSchedule(action, port)
    expect(port.saveReportSchedule).toHaveBeenCalledWith(action)
    await expect(saveReportSchedule({ ...action, type: 'prompt' }, port)).rejects.toThrow()
    expect(scheduledReportActionSchema.safeParse(reportAction([post, post])).success).toBe(false)
    expect(scheduledReportActionSchema.safeParse(reportAction([])).success).toBe(false)
  })
  it('never quotes unknown action keys in a generation failure', async () => {
    const rig = runnerRig()
    const canary = 'ghp_' + 'a'.repeat(36)
    const malformed = { ...reportAction([post]), [canary]: 'source text' }
    await expect(
      new ScheduledReportRunner(rig.ports).run('one', OCCURRENCE, malformed),
    ).rejects.toThrow(UI_TEXT.reportUi.generationFailed)
    expect(rig.postPort.publish).not.toHaveBeenCalled()
  })
})
