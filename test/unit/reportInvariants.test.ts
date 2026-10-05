// Report a problem leaves the SoL-Pi gains alone (M93, PLAN.md D72): the
// recorder and the report observe failures after they happen and never
// touch a request. Golden: the Model API requests of the same scripted turns
// are byte-identical with nothing recorded and with failures recorded and a
// report built between the turns. And the request path imports none of the
// report's modules, so no later change can make it read them by accident.

import { mkdir, mkdtemp, readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it, onTestFinished } from 'vitest'
import { ModelApiHost, ModelApiSession } from '../../src/core/backends/modelapi/ModelApiHost'
import { ModelApiClient } from '../../src/core/backends/modelapi/client'
import { buildProblemReportDraft } from '../../src/core/support/problemReport'
import { ReportJournal } from '../../src/host/support/reportJournal'
import { ReportRecorder } from '../../src/host/support/reportRecorder'
import { FakeLogOutputChannel } from './helpers/fakes'
import { fakeModelApi, fakeModelApiClientSettings } from './helpers/fakeModelApi'
import { memoryToolIo } from './helpers/fakeToolIo'
import { fakeModelApiHostDeps } from './helpers/modelApiHostDeps'
import { REPORT_FACTS } from './helpers/reportFacts'
import { watchSessionTurns } from './helpers/sessionTurns'
import { removeFolder } from './helpers/temporaryFolders'

const ROOT = '/ws'
const REPO = path.resolve(import.meta.dirname, '../..')
const NOW = 1_769_000_000_000
/** An id the fake Model API minted (`fc_12`, `msg_3`…). */
const SERVER_ITEM_ID = /\b(call|fc|msg|resp|rs|ws)_\d+\b/g

/** Two scripted turns (a failing tool call, then an answer); `between` runs between them. */
async function requestBodies(between: () => Promise<void>): Promise<string> {
  const api = fakeModelApi()
  const log = new FakeLogOutputChannel()
  const io = memoryToolIo({ 'notes.txt': 'hello\n' }, ROOT)
  const client = new ModelApiClient({ ...fakeModelApiClientSettings(log), fetch: api.fetch })
  const host = new ModelApiHost(fakeModelApiHostDeps({ client, workspaceRoot: ROOT, io, log }))
  const session = await host.startSession({
    workspaceRoot: ROOT,
    modelId: 'muse-spark-1.3',
    approvalMode: 'onRequest',
  })
  if (!(session instanceof ModelApiSession)) {
    throw new TypeError('expected the Model API session')
  }
  const { turnDone } = watchSessionTurns(session)
  api.script(
    {
      calls: [
        { name: 'read_file', arguments: JSON.stringify({ path: 'missing.txt' }), callId: 'c1' },
      ],
    },
    { text: 'There is no such file.' },
    { text: 'Done.' },
  )
  await session.sendTurn([{ type: 'text', text: 'read missing.txt' }])
  await turnDone()
  await between()
  await session.sendTurn([{ type: 'text', text: 'thanks' }])
  await turnDone()
  // The fake server numbers its items across the whole process; those ids are
  // its own, echoed back, so they are compared by place, not by number.
  return JSON.stringify(api.responseBodies()).replaceAll(SERVER_ITEM_ID, '$1_n')
}

describe('SoL-Pi invariants under the report workflow (M93)', () => {
  it('sends the same request bytes with recording and a report between turns', async () => {
    await mkdir(path.join(REPO, 'temp'), { recursive: true })
    const dir = await mkdtemp(path.join(REPO, 'temp', 'report-golden-'))
    onTestFinished(() => removeFolder(dir))
    const recorder = new ReportRecorder({
      journal: new ReportJournal({
        globalStorageDir: dir,
        instance: 'golden',
        ext: '0.12.1',
        host: '1.99.0',
        pid: 1001,
        log: new FakeLogOutputChannel(),
        isAlive: () => true,
      }),
      extensionRoot: REPO,
      now: () => NOW,
    })
    await recorder.startup()
    const plain = await requestBodies(() => Promise.resolve())
    const reported = await requestBodies(async () => {
      recorder.record('toolCallFailed', 'unknown')
      recorder.recordError('errorNotice', new TypeError('read failed'))
      const journal = await recorder.readJournal()
      const draft = buildProblemReportDraft({
        description: 'The read failed.',
        includeFacts: true,
        includeEvents: true,
        facts: REPORT_FACTS,
        events: journal.entries,
        recordingUnavailable: journal.recordingUnavailable,
        nowMs: NOW,
        scrub: { workspaceRoots: [ROOT], homeDir: '', extraLiterals: [] },
      })
      expect(draft.text).toContain('Recent events (2):')
    })
    expect(reported).toBe(plain)
    await recorder.shutdown()
  })

  it('keeps the request path free of the report modules', async () => {
    const report =
      /support\/(?:flightRecorder|problemReport|journalEvents)|support\/report|stackFrames/
    const folders = ['src/core/backends', 'src/core/agent']
    for (const folder of folders) {
      const names = await readdir(path.join(REPO, folder), { recursive: true })
      const files = names.filter((name) => name.endsWith('.ts'))
      for (const file of files) {
        const source = await readFile(path.join(REPO, folder, file), 'utf8')
        expect(source, `${folder}/${file}`).not.toMatch(report)
      }
    }
  })
})
