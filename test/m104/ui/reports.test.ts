import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import {
  createPortableReports,
  type PortableReportDeps,
} from '../../../src/host/support/portableReports'
import { createReportProblemHandler } from '../../../src/host/support/reportEntry'
import { EN } from '../../../src/shared/l10n/en'
import type { HostToWebviewMessage } from '../../../src/shared/protocol'
import { REPORT_FACTS } from '../../unit/helpers/reportFacts'
import { fakeServices } from './services'

async function fixture() {
  const root = path.resolve('temp')
  await mkdir(root, { recursive: true })
  const folder = await mkdtemp(path.join(root, 'm104-pc-reports-'))
  onTestFinished(() => rm(folder, { recursive: true, force: true }))
  const f = fakeServices()
  const own = vi.fn<(dispose: () => Promise<void>) => void>()
  const saveText = vi.fn<PortableReportDeps['saveText']>(() => Promise.resolve(true))
  const deps: PortableReportDeps = {
    host: f.host,
    own,
    saveText,
    journal: {
      globalStorageDir: folder,
      instance: 'pc-window',
      ext: '0.14.3',
      host: '1.99.0',
      pid: 1001,
      log: f.log,
      isAlive: () => false,
      extensionRoot: folder,
      now: () => 1_769_000_000_000,
    },
    readFacts: () => Promise.resolve(REPORT_FACTS),
    readScrub: () => ({ workspaceRoots: [folder], homeDir: '/synthetic-home', extraLiterals: [] }),
  }
  const panel = await createPortableReports(deps)
  onTestFinished(panel.dispose)
  const messages: HostToWebviewMessage[] = []
  const handler = createReportProblemHandler(
    {
      ...panel.reports,
      post: (message) => {
        messages.push(message)
      },
      noticeError: vi.fn(),
      log: f.log,
      onReportWebviewError: panel.reports.recordWebviewError,
    },
    EN,
    'en',
  )
  function draft() {
    const found = messages.findLast((message) => message.type === 'reportDraft')
    if (found?.type !== 'reportDraft') throw new Error('NO_REPORT_DRAFT')
    return found
  }
  return { ...f, panel, handler, messages, draft, deps, saveText, own }
}

describe('portable report journal and exact exports', () => {
  it('registers cleanup before startup, journals sanitized facts and exports the sealed preview', async () => {
    const f = await fixture()
    expect(f.own).toHaveBeenCalledOnce()
    f.panel.reports.record('errorNotice', 'unknown')
    f.panel.reports.recordWebviewError({
      kind: 'reactBoundary',
      source: 'render',
      code: 'TypeError',
      frames: [],
    })
    await f.handler.handle({ type: 'openReport' })
    const draft = f.draft()
    expect(draft.canUseVscodeReporter).toBe(false)
    expect(draft.recordingUnavailable).toBe(false)
    expect(draft.items.filter((item) => item.kind === 'event')).toHaveLength(2)
    await f.handler.handle({ type: 'exportReport', via: 'copy', hash: draft.hash })
    expect(f.requests.at(-1)).toEqual({ method: 'ui/clipboard', params: { text: draft.text } })
    await f.handler.handle({ type: 'exportReport', via: 'save', hash: draft.hash })
    expect(f.saveText).toHaveBeenCalledExactlyOnceWith(draft.text)
  })

  it('answers copy/save/open failures and cancellation, with no false export success', async () => {
    const f = await fixture()
    await f.handler.handle({ type: 'openReport' })
    const hash = f.draft().hash
    f.responses.set('ui/clipboard', () => Promise.reject(new Error('private host detail')))
    await f.handler.handle({ type: 'exportReport', via: 'copy', hash })
    expect(f.messages.at(-1)).toMatchObject({
      type: 'reportExported',
      ok: false,
      reason: 'copyFailed',
    })
    f.saveText.mockImplementation(() => Promise.resolve(false))
    await f.handler.handle({ type: 'exportReport', via: 'save', hash })
    expect(f.messages.at(-1)).toMatchObject({ ok: false, reason: 'cancelled' })
    f.saveText.mockImplementation(() => Promise.reject(new Error('private host detail')))
    await f.handler.handle({ type: 'exportReport', via: 'save', hash })
    expect(f.messages.at(-1)).toMatchObject({ ok: false, reason: 'saveFailed' })
    f.responses.set('ui/openExternal', () => Promise.reject(new Error('private host detail')))
    await f.handler.handle({ type: 'exportReport', via: 'issue', hash })
    expect(f.messages.at(-1)).toMatchObject({ ok: false, reason: 'openFailed' })
    expect(JSON.stringify(f.messages)).not.toContain('private host detail')
  })

  it('refuses stale exports and offers a consumed crash marker once', async () => {
    const f = await fixture()
    await f.handler.handle({ type: 'openReport' })
    await f.handler.handle({ type: 'exportReport', via: 'copy', hash: '0'.repeat(64) })
    expect(f.requests).toHaveLength(0)
    expect(f.messages.at(-1)).toMatchObject({ ok: false, reason: 'stale' })
    const next = await createPortableReports({
      ...f.deps,
      journal: { ...f.deps.journal, instance: 'next-window' },
    })
    onTestFinished(next.dispose)
    expect(next.offerReport).toBe(true)
    const third = await createPortableReports({
      ...f.deps,
      journal: { ...f.deps.journal, instance: 'third-window', isAlive: () => true },
    })
    onTestFinished(third.dispose)
    expect(third.offerReport).toBe(false)
  })
})
