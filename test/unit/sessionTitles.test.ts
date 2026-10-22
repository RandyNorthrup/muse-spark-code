// Every surface that shows a Muse Code session shows the person's words
// (sessionRecords.ts reads them out of Muse Code's derived title). Muse
// Code's own answers are the live capture of 2026-10-20
// (test/fixtures/session-titles/msp-1.4.11-echo-titles.json: Muse Code
// 1.4.11, `serve --provider echo`, zero model calls, ten first turns sent
// through the product's MuseCodeHost.sendTurn with parts from its own
// builders). The real MuseCodeHost reads them over the SDK's real Connection,
// served by the replay transport, which answers only with recorded frames;
// the real ACP agent then lists them to a real ACP client.
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import * as acp from '@agentclientprotocol/sdk'
import { Connection } from '@muse-code/sdk'
import { afterEach, describe, expect, it } from 'vitest'
import * as z from 'zod/mini'
import { createAcpAgent } from '../../src/acp/agent'
import { AcpPaidUse } from '../../src/acp/paid'
import type { SessionListEvent, SessionRecord } from '../../src/core/agent/agentBackend'
import { toSessionRow } from '../../src/core/agent/sessionRows'
import { MuseCodeHost } from '../../src/core/backends/musecode/MuseCodeHost'
import { sessionEnvelopeSchema } from '../../src/core/backends/musecode/sessionRecords'
import { buildSessionBoard } from '../../src/core/sessionBoard'
import { paidGrantFile } from '../../src/runtime/paidGrants'
import { stderrLogger } from '../../src/runtime/stderrLog'
import { MSP_KNOWN_SCHEMA_FINGERPRINTS, UI_TEXT } from '../../src/shared/constants'
import { type Answer, refuseUnscripted, ReplayWire } from './helpers/museReplay'
import { titleCapture as capture, recordedAnswer as recorded } from './helpers/sessionTitleCapture'

const LONG_TURN = capture.frames.find(
  (row) =>
    row.frame.method === 'turn/start' &&
    row.frame.params?.['sessionId'] ===
      capture.provenance.sessions.find((entry) => entry.label === 'long')?.sessionId,
)?.frame.params?.['displayText']
/** Each captured session's first turn as the person wrote it (the sent turns' own words). */
const WORDS: Readonly<Record<string, string | undefined>> = {
  defect: 'In one short sentence, say hello and include the word WRESTONE.',
  'attachment-only': undefined,
  'file-reference-selection': 'Why does this throw?',
  'git-draft': 'Write a commit message for my changes.',
  'handoff-brief': '# Goal Ship the parser fix. # Todo list - [ ] add the test',
  'plan-brief': 'Implement the plan in docs/plan.md, attached below.',
  'typed-tags': 'Rename <harness_note> to <muse_note> where a < b > c',
  long: typeof LONG_TURN === 'string' ? LONG_TURN : 'no long turn in the capture',
  'acp-attached': 'Explain this file and keep it short.',
  scheduled: 'Summarise the open issues.',
}
const labelOf = (sessionId: string) =>
  capture.provenance.sessions.find((entry) => entry.sessionId === sessionId)?.label ?? sessionId

const initializeSchema = z.object({ schema: z.object({ fingerprint: z.string() }) })

const log = stderrLogger(() => undefined, 'warn')
const hosts: { host: MuseCodeHost; wire: ReplayWire }[] = []
const folders: string[] = []
afterEach(async () => {
  for (const { host, wire } of hosts.splice(0)) {
    wire.finish()
    await host.close()
  }
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true })
})

/** The real host over the replay transport: recorded answers only, anything else refused loudly. */
function replayHost(): { host: MuseCodeHost; wire: ReplayWire } {
  const wire = new ReplayWire()
  const served: Readonly<Record<string, Record<string, unknown>>> = {
    'model/list': recorded('model/list'),
    'session/list': recorded('session/list'),
    'session/read': recorded('session/read'),
    'session/resume': recorded('session/resume'),
  }
  wire.answer = (method): Answer => {
    const result = served[method]
    return result === undefined ? refuseUnscripted(method) : { result }
  }
  const connection = new Connection(wire.transport())
  const host = new MuseCodeHost(
    {
      connection,
      initializeResult: recorded('initialize'),
      exited: Promise.withResolvers<{ code: number | null; signal: string | null }>().promise,
      close: async () => {
        wire.finish()
        await connection.close()
      },
    },
    log,
  )
  const live = { host, wire }
  hosts.push(live)
  return live
}

const byName = (left: string, right: string) => left.localeCompare(right)

function expectPersonsWords(records: readonly SessionRecord[]): void {
  expect(records.map((record) => labelOf(record.sessionId)).toSorted(byName)).toEqual(
    Object.keys(WORDS).toSorted(byName),
  )
  for (const record of records) {
    const words = WORDS[labelOf(record.sessionId)]
    expect(record.title, labelOf(record.sessionId)).toBe(words)
    expect(record.firstUserPrompt, labelOf(record.sessionId)).toBe(words)
  }
}

describe('Muse Code session titles, end to end', () => {
  it('lists every session under the person’s words: History, the board and the rows', async () => {
    const { host } = replayHost()
    const page = await host.listSessions({ workspaceRoot: '<capture-workspace>', limit: 50 })
    expectPersonsWords(page.sessions)
    const rows = page.sessions.map((record) => toSessionRow(record))
    const board = buildSessionBoard({
      sessions: page.sessions.map((record) => ({
        sessionId: record.sessionId,
        ...(record.title !== undefined && { title: record.title }),
        backend: 'museCode',
        status: 'idle',
      })),
      worktrees: [],
      approvalsPending: new Set(),
      platform: process.platform,
    })
    // A message that was only an attachment shows the panel's own wording.
    for (const row of [...rows, ...board]) {
      expect(row.title, labelOf(row.sessionId)).toBe(
        WORDS[labelOf(row.sessionId)] ?? UI_TEXT.untitledConversation,
      )
    }
  })

  it('reads the person’s words in every list-changed notification', async () => {
    const { host, wire } = replayHost()
    const changed: SessionRecord[] = []
    host.onSessionListEvent((event: SessionListEvent) => {
      if (event.type === 'changed') changed.push(event.record)
    })
    const notes = capture.frames.filter((row) => row.frame.method === 'session/listChanged')
    for (const row of notes) wire.release(row.frame)
    // A session/list after the notifications: answered in order, so every
    // notification has been delivered once it returns.
    await host.listSessions({ workspaceRoot: '<capture-workspace>', limit: 50 })
    expect(changed).toHaveLength(notes.length)
    expectPersonsWords(changed)
  })

  it('reads the person’s words in the read and resume envelopes', async () => {
    const read = sessionEnvelopeSchema.parse(recorded('session/read'))
    expect(read.session.title).toBe(WORDS['defect'])
    expect(read.session.firstUserPrompt).toBe(WORDS['defect'])
    const { host } = replayHost()
    const resumed = await host.resumeSession(read.session.sessionId, 'muse-spark-1.3')
    expect(resumed.record.title).toBe(WORDS['defect'])
    expect(toSessionRow(resumed.record).title).toBe(WORDS['defect'])
  })

  it('lists the person’s words to an ACP client', async () => {
    const { host } = replayHost()
    const folder = mkdtempSync(path.join(tmpdir(), 'session-titles-'))
    folders.push(folder)
    const agent = createAcpAgent({
      backend: {
        kind: 'museCode',
        readiness: () => Promise.resolve({ state: 'ready' }),
        hostFor: () => Promise.resolve(host),
      },
      version: '0.19.0',
      options: { canBypass: false, allowsContributorModels: false, initialMode: 'manual' },
      signIn: {
        id: 'login',
        name: 'Muse Code',
        description: 'Muse Code',
        args: [],
        command: 'muse login',
      },
      defaultCwd: folder,
      paid: new AcpPaidUse({
        flagged: [],
        canRemember: () => false,
        grants: paidGrantFile({
          file: path.join(folder, 'paid-grants.json'),
          log,
          sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
        }),
        log,
      }),
      log,
      questions: 'decline',
    })
    const listed = await acp
      .client({ name: 'session-titles' })
      .connectWith(agent, async (editor) => {
        await editor.request('initialize', {
          protocolVersion: acp.PROTOCOL_VERSION,
          clientCapabilities: {},
        })
        return await editor.request('session/list', { cwd: folder })
      })
    expect(listed.sessions).toHaveLength(capture.provenance.sessions.length)
    for (const session of listed.sessions) {
      expect(session.title, labelOf(session.sessionId)).toBe(
        WORDS[labelOf(session.sessionId)] ?? UI_TEXT.untitledConversation,
      )
    }
  })

  it('serves a schema the map knows, labelled with the capture’s build', () => {
    const init = initializeSchema.parse(recorded('initialize'))
    expect(MSP_KNOWN_SCHEMA_FINGERPRINTS[init.schema.fingerprint]).toBe(capture.provenance.cli)
  })
})
