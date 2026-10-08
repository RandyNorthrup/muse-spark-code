import { randomBytes } from 'node:crypto'
import { mkdir, mkdtemp, readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { ReportJournal } from '../../../src/host/support/reportJournal'
import { buildFlightRecord } from '../../../src/core/support/flightRecorder'
import { createReportProblemHandler } from '../../../src/host/conversation/reportProblemHandler'
import { VaultScrubService } from '../../../src/core/vault/scrub'
import { REDACTED_MARK, REPORT_STORAGE_DIR } from '../../../src/shared/constants'
import type { HostToWebviewMessage } from '../../../src/shared/protocol'
import type { SecretScrubPort } from '../../../src/shared/redact'
import { REPORT_FACTS } from '../helpers/reportFacts'
import { FakeLogOutputChannel } from '../helpers/fakes'
import { removeFolder } from '../helpers/temporaryFolders'

function dialog(vaultScrub: SecretScrubPort) {
  const posted: HostToWebviewMessage[] = [],
    clipboard = vi.fn(() => Promise.resolve()),
    errors = vi.fn(),
    log = new FakeLogOutputChannel()
  const handler = createReportProblemHandler({
    vaultScrub,
    post: (message) => {
      posted.push(message)
    },
    noticeError: errors,
    log,
    onReportWebviewError: () => undefined,
    io: {
      writeClipboard: clipboard,
      openExternal: () => Promise.resolve(true),
      saveText: () => Promise.resolve(true),
      openIssueReporter: () => Promise.resolve(),
    },
    source: {
      readFacts: () => Promise.resolve(REPORT_FACTS),
      readJournal: () => Promise.resolve({ entries: [], recordingUnavailable: false }),
      readScrub: () => ({ workspaceRoots: [], homeDir: '', extraLiterals: [] }),
      nowMs: () => 0,
      canUseVscodeReporter: () => Promise.resolve(true),
    },
  })
  const drafts = () => posted.filter((message) => message.type === 'reportDraft')
  return { ...handler, posted, clipboard, errors, log, drafts }
}

describe('vault report and journal scrub', () => {
  it.each([false, true])(
    'drops a journal record containing a generated vault value (stored earlier: %s)',
    async (wasStoredEarlier) => {
      const root = path.resolve(import.meta.dirname, '../../../temp')
      await mkdir(root, { recursive: true })
      const dir = await mkdtemp(path.join(root, 'm109t-journal-'))
      onTestFinished(() => removeFolder(dir))
      const secret = `0.1.0-${randomBytes(8).toString('hex')}`,
        service = new VaultScrubService()
      expect(
        buildFlightRecord(
          { kind: 'toolCallFailed', code: 'TypeError', ext: secret, host: '1.99.0' },
          0,
        ).ok,
      ).toBe(true)
      await service.unlock(() => Promise.resolve(wasStoredEarlier ? [] : [Buffer.from(secret)]))
      const journal = new ReportJournal({
        globalStorageDir: dir,
        instance: 'test',
        ext: secret,
        host: '1.99.0',
        pid: 100,
        now: () => 0,
        isAlive: () => true,
        log: new FakeLogOutputChannel(),
        vaultScrub: service,
      })
      try {
        await journal.startup()
        await journal.record({ kind: 'toolCallFailed', code: 'TypeError' })
        const files = await readdir(path.join(dir, REPORT_STORAGE_DIR))
        const raw = await Promise.all(
          files.map((file) => readFile(path.join(dir, REPORT_STORAGE_DIR, file), 'utf8')),
        )
        if (wasStoredEarlier) {
          expect(raw.join('')).toContain(secret)
          await service.unlock(() => Promise.resolve([Buffer.from(secret)]))
        } else expect(raw.join('')).not.toContain(secret)
        const merged = await journal.readMerged()
        expect(merged.entries).toEqual([])
        const kept = await readdir(path.join(dir, REPORT_STORAGE_DIR))
        const safe = await Promise.all(
          kept.map((file) => readFile(path.join(dir, REPORT_STORAGE_DIR, file), 'utf8')),
        )
        expect(safe.join('')).not.toContain(secret)
      } finally {
        await journal.shutdown()
        service.lock()
      }
    },
  )
  it('keeps only the newest report revision when an older scrub completes late', async () => {
    const pending = Promise.withResolvers<string>(),
      started = Promise.withResolvers<undefined>()
    const t = dialog({
      scrub: (text) => {
        if (text.includes('DELAYED')) {
          started.resolve(undefined)
          return pending.promise
        }
        return Promise.resolve(text)
      },
    })
    await t.handle({ type: 'openReport' })
    const old = t.handle({
      type: 'updateReport',
      revision: 1,
      description: 'DELAYED',
      includeFacts: false,
      includeEvents: false,
      removedEventIndexes: [],
    })
    await started.promise
    await t.handle({
      type: 'updateReport',
      revision: 2,
      description: 'LATEST',
      includeFacts: false,
      includeEvents: false,
      removedEventIndexes: [],
    })
    pending.resolve('OLD SCRUB RESULT')
    await old
    expect(t.drafts().at(-1)?.revision).toBe(2)
    expect(t.drafts()).toHaveLength(2)
  })
  it('re-scrubs before export and requires a fresh preview when a newly stored value matches', async () => {
    const secret = randomBytes(32).toString('hex')
    let isVaulted = false
    const t = dialog({
      scrub: (text) =>
        Promise.resolve(isVaulted ? text.replaceAll(secret, () => REDACTED_MARK) : text),
    })
    await t.handle({ type: 'openReport' })
    await t.handle({
      type: 'updateReport',
      revision: 1,
      description: secret,
      includeFacts: false,
      includeEvents: false,
      removedEventIndexes: [],
    })
    const preview = t.drafts().at(-1)
    if (preview === undefined) throw new Error('no report preview')
    isVaulted = true
    await t.handle({ type: 'exportReport', via: 'copy', hash: preview.hash })
    expect(t.clipboard).not.toHaveBeenCalled()
    expect(t.drafts().at(-1)?.text).not.toContain(secret)
    expect(
      t.posted.some((message) => message.type === 'reportExported' && message.reason === 'stale'),
    ).toBe(true)
  })
  it('refuses export after Lock and logs only a fixed failure class', async () => {
    const service = new VaultScrubService()
    await service.unlock(() => Promise.resolve([randomBytes(32)]))
    const t = dialog(service)
    await t.handle({ type: 'openReport' })
    const preview = t.drafts().at(-1)
    if (preview === undefined) throw new Error('no report preview')
    service.lock()
    await t.handle({ type: 'exportReport', via: 'copy', hash: preview.hash })
    expect(t.clipboard).not.toHaveBeenCalled()
    expect(t.errors).toHaveBeenCalledOnce()
    expect(t.log.error.mock.calls[0]?.[0]).toBe('problem report failed (Error)')
  })
})
