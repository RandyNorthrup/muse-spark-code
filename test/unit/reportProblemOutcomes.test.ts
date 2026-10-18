// The problem-report export paths (src/host/support/reportProblem.ts) are
// kept failures: an editor operation that throws still answers with its
// fixed reason — copied-or-not, opened-or-not, saved-or-not — never a
// throw, and never the operation's own words.
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, it } from 'vitest'
import { sealReportDraft } from '../../src/core/support/problemReport'
import {
  copyProblemReport,
  openProblemReportIssue,
  saveProblemReport,
  type ReportEditorIo,
} from '../../src/host/support/reportProblem'

async function editorRefusal(): Promise<never> {
  // The real refusal: reading a file that is not there fails with ENOENT.
  await readFile(path.join(tmpdir(), `no-such-editor-${String(process.pid)}`))
  throw new Error('the refusal did not refuse')
}

function refusingIo(): ReportEditorIo {
  return {
    writeClipboard: () => editorRefusal(),
    openExternal: () => editorRefusal(),
    saveText: () => editorRefusal(),
    openIssueReporter: () => Promise.resolve(),
  }
}

it('a refused copy answers copyFailed', async () => {
  const draft = sealReportDraft('title', 'body')
  await expect(copyProblemReport(draft, refusingIo())).resolves.toEqual({
    ok: false,
    reason: 'copyFailed',
  })
})

it('a refused browser answers openFailed, never pretending', async () => {
  const draft = sealReportDraft('title', 'body')
  await expect(openProblemReportIssue(draft, refusingIo())).resolves.toEqual({
    ok: false,
    reason: 'openFailed',
  })
})

it('a refused save answers saveFailed', async () => {
  const draft = sealReportDraft('title', 'body')
  await expect(saveProblemReport(draft, refusingIo())).resolves.toEqual({
    ok: false,
    reason: 'saveFailed',
  })
})

it('working operations answer ok', async () => {
  const draft = sealReportDraft('title', 'body')
  const io: ReportEditorIo = {
    writeClipboard: () => Promise.resolve(),
    openExternal: () => Promise.resolve(true),
    saveText: () => Promise.resolve(true),
    openIssueReporter: () => Promise.resolve(),
  }
  await expect(copyProblemReport(draft, io)).resolves.toEqual({ ok: true })
  await expect(saveProblemReport(draft, io)).resolves.toEqual({ ok: true })
})
