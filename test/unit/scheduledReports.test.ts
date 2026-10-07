import { describe, expect, it, vi } from 'vitest'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import * as atomic from '../../src/host/fsAtomic'
import { ReportSaveRefusedError } from '../../src/core/reporting/destinations/save'
import { finalizeReport } from '../../src/core/reporting/render/canonical'
import { EN } from '../../src/shared/l10n/en'
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
async function deferredOccurrence() {
  const rig = runnerRig()
  const runner = new ScheduledReportRunner(rig.ports)
  const action = reportAction([browser])
  rig.browser.hasActiveSession.mockResolvedValue(false)
  await runner.run('one', OCCURRENCE, action)
  return { rig, runner, action, record: rig.records.get(OCCURRENCE)! }
}
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
  it('resumes persisted rendered bytes after the installed locale table changes', async () => {
    const { rig, runner, action, record } = await deferredOccurrence()
    const frozen = structuredClone(record.payload)
    vi.spyOn(rig.ports.locale, 'textForLocale').mockImplementation(() => ({
      ...EN,
      reportKinds: { ...EN.reportKinds, project: 'Changed installed title' },
    }))
    rig.browser.hasActiveSession.mockResolvedValue(true)
    await runner.run('one', OCCURRENCE, action)
    expect(rig.browser.publishHtml).toHaveBeenCalledWith('one', OCCURRENCE, frozen.html, 'node')
    expect(rig.records.get(OCCURRENCE)?.payload).toEqual(frozen)
  })
  it.each(['format', 'locale', 'theme'])(
    'refuses frozen payload metadata mismatching action %s',
    async (field) => {
      const { rig, runner, action, record } = await deferredOccurrence()
      const payload = { ...record.payload }
      switch (field) {
        case 'format': {
          payload.format = 'html'
          break
        }
        case 'locale': {
          payload.locale = 'de'
          break
        }
        case 'theme': {
          {
            payload.theme = { ...payload.theme, background: '#0a0b0c' }
            // No default
          }
          break
        }
      }
      rig.records.set(OCCURRENCE, { ...record, payload })
      await expect(runner.run('one', OCCURRENCE, action)).rejects.toThrow(
        UI_TEXT.reportUi.generationFailed,
      )
      expect(rig.browser.publishHtml).not.toHaveBeenCalled()
    },
  )
  it.each(['constructor', 'toString', 'hasOwnProperty'])(
    'dispatches schema-valid destination id %s',
    async (id) => {
      const rig = runnerRig()
      const action = reportAction([{ ...post, id }])
      expect(scheduledReportActionSchema.safeParse(action).success).toBe(true)
      const runner = new ScheduledReportRunner(rig.ports)
      const outcomes = await runner.run('one', OCCURRENCE, action)
      expect(Object.hasOwn(outcomes, id)).toBe(true)
      expect(outcomes[id]).toEqual({ status: 'delivered', attempts: 1 })
      await runner.run('one', OCCURRENCE, action)
      expect(rig.postPort.publish).toHaveBeenCalledTimes(1)
    },
  )
  it('rejects unknown persisted destination ids before dispatch', async () => {
    const { rig, runner, action, record } = await deferredOccurrence()
    rig.records.set(OCCURRENCE, {
      ...record,
      outcomes: { missing: { status: 'delivered', attempts: 1 } },
    })
    await expect(runner.run('one', OCCURRENCE, action)).rejects.toThrow(
      UI_TEXT.reportUi.generationFailed,
    )
    expect(rig.browser.publishHtml).not.toHaveBeenCalled()
  })
  it('generates and resumes a legitimate redacted workspace scope', async () => {
    const rig = runnerRig()
    const redaction = { workspaceRoot: 'C:/work/project' }
    const document = structuredClone(deliveryPayload().document)
    document.header.scope = String.raw`C:\work\project`
    vi.spyOn(rig.ports.generation, 'generate').mockResolvedValue(
      finalizeReport(document, redaction),
    )
    const action = reportAction([browser])
    action.options.scope = String.raw`C:\work\project`
    const runner = new ScheduledReportRunner({ ...rig.ports, redaction })
    rig.browser.hasActiveSession.mockResolvedValue(false)
    const deferred = await runner.run('one', OCCURRENCE, action)
    expect(deferred['browser']?.status).toBe('deferred')
    expect(rig.records.get(OCCURRENCE)?.payload.document.header.scope).toBe('./')
    rig.browser.hasActiveSession.mockResolvedValue(true)
    const delivered = await runner.run('one', OCCURRENCE, action)
    expect(delivered['browser']?.status).toBe('delivered')
    const fresh = runnerRig()
    await expect(
      new ScheduledReportRunner({ ...fresh.ports, redaction }).run('one', OCCURRENCE, action),
    ).rejects.toThrow()
    expect(fresh.browser.publishHtml).not.toHaveBeenCalled()
  })
  it.each(['revoked', 'roots removed'])(
    'records refused when the workspace grant is revoked after report staging (%s)',
    async (change) => {
      const root = await mkdtemp(path.join(os.tmpdir(), 'm113-q-run-save-'))
      const rig = runnerRig()
      const authorize = vi.spyOn(rig.ports.authority, 'authorize')
      authorize.mockResolvedValue({ allowed: true, roots: [root], network: false, creator: 'user' })
      const original = atomic.writeFileIfUnchanged
      const write = vi
        .spyOn(atomic, 'writeFileIfUnchanged')
        .mockImplementation((file, expected, content, options) =>
          original(file, expected, content, {
            ...options,
            staged: () => {
              authorize.mockResolvedValue({
                allowed: change !== 'revoked',
                roots: [],
                network: false,
                creator: 'user',
              })
              return Promise.resolve()
            },
          }),
        )
      try {
        const action = reportAction([
          {
            type: 'save',
            id: 'save',
            root,
            storage: 'local',
            template: '{kind}.{ext}',
            retention: 1,
          },
        ])
        const result = await new ScheduledReportRunner(rig.ports).run('one', OCCURRENCE, action)
        expect(result['save']?.status).toBe('refused')
        expect(rig.records.get(OCCURRENCE)?.outcomes['save']?.status).toBe('refused')
        expect(await readdir(root)).toEqual([])
      } finally {
        write.mockRestore()
        await rm(root, { recursive: true, force: true })
      }
    },
  )
  it('binds save effects to the serialized owner generation on local and node storage', async () => {
    for (const storage of ['local', 'node'] as const) {
      const root = await mkdtemp(path.join(os.tmpdir(), 'report-owner-generation-'))
      try {
        const rig = runnerRig()
        const assertion = vi.fn(() => {
          throw new ReportSaveRefusedError()
        })
        vi.spyOn(rig.ports, 'saveExclusive').mockImplementation(
          async (_schedule, _destination, actionKey, work) => {
            expect(actionKey).toMatch(/^[a-f0-9]{64}$/)
            return await work(assertion)
          },
        )
        vi.spyOn(rig.ports, 'nodeSave').mockImplementation(
          (_schedule, _destination, _payload, _roots, admission) => {
            admission.assertCurrent()
            return Promise.resolve()
          },
        )
        vi.spyOn(rig.ports.authority, 'authorize').mockResolvedValue({
          allowed: true,
          roots: [root],
          network: false,
          creator: 'user',
        })
        const action = reportAction([
          {
            type: 'save',
            id: 'save',
            root,
            storage,
            template: '{kind}.{ext}',
            retention: 1,
          },
        ])
        const result = await new ScheduledReportRunner(rig.ports).run('one', OCCURRENCE, action)
        expect(result['save']?.status).toBe('refused')
        expect(assertion).toHaveBeenCalled()
      } finally {
        await rm(root, { recursive: true, force: true })
      }
    }
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
  it('sanitizes unknown action keys and broker exceptions at interactive schedule save', async () => {
    const canary = 'ghp_' + 'a'.repeat(36)
    const port = {
      openReportSchedule: vi.fn(() => Promise.resolve()),
      saveReportSchedule: vi.fn(() => Promise.resolve()),
    }
    const malformed = { ...reportAction([post]), [canary]: 'input' }
    await expect(saveReportSchedule(malformed, port)).rejects.toThrow(
      UI_TEXT.reportUi.generationFailed,
    )
    expect(port.saveReportSchedule).not.toHaveBeenCalled()
    port.saveReportSchedule.mockRejectedValue(new Error(canary))
    await expect(saveReportSchedule(reportAction([post]), port)).rejects.toThrow(
      UI_TEXT.reportUi.generationFailed,
    )
  })
  it('sanitizes editor and interactive preparation failures', async () => {
    const rig = runnerRig()
    const canary = 'ghp_' + 'a'.repeat(36)
    const action = reportAction([post])
    const port = {
      openReportSchedule: vi.fn(() => Promise.reject(new Error(canary))),
      saveReportSchedule: vi.fn(() => Promise.resolve()),
    }
    await expect(openReportSchedule(action.options, ['--schedule'], port)).rejects.toThrow(
      UI_TEXT.reportUi.generationFailed,
    )
    vi.spyOn(rig.ports.generation, 'generate').mockRejectedValue(new Error(canary))
    await expect(new ScheduledReportRunner(rig.ports).prepare('one', action)).rejects.toThrow(
      UI_TEXT.reportUi.generationFailed,
    )
    expect(rig.postPort.previewAndConfirm).not.toHaveBeenCalled()
  })
})
