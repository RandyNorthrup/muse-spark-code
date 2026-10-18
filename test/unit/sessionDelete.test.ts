// History's Delete, proven against the real session store on the real file
// system: a saved conversation lists, `remove` takes its file for good, and
// the list no longer names it; removing an id that is already gone resolves.
// The Muse Code side stays refused wherever the CLI cannot answer
// `session/delete` (PLAN.md D26): the version gate pins that refusal to the
// measured probes (1.4.4's `methodNotFound`, 1.4.10's probe and schema
// export of 2026-10-18).

import { mkdtemp, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { canDeleteMuseSession } from '../../src/core/backends/musecode/MuseCodeHost'
import type { StoredSession } from '../../src/core/backends/modelapi/sessionStore'
import { createFileSessionStore } from '../../src/host/backend/fileSessionStore'
import { removeFolder } from './helpers/temporaryFolders'

// A conversation as the product saves it, kept minimal: the store validates
// the shape, so only a shape the product itself accepts reaches the file.
const session: StoredSession = {
  version: 1,
  sessionId: 's1',
  workspaceRoot: '/ws',
  modelId: 'muse-spark-1.3',
  approvalMode: 'promptUnmatched',
  effort: 'high',
  name: 'Parser fix',
  createdAt: '2026-09-22T10:00:00.000Z',
  lastActivityAt: '2026-09-22T10:05:00.000Z',
  turnIds: [],
  firstPrompt: 'fix the parser',
  todos: [],
  replay: [],
  transcript: [],
  outputs: {},
  usage: { inputTokens: 0, outputTokens: 0, cachedTokens: 0, reasoningTokens: 0 },
}

describe('History delete against the real session store', () => {
  let directory = ''
  const store = () =>
    createFileSessionStore({
      directory,
      log: {
        trace: () => undefined,
        info: () => undefined,
        warn: () => undefined,
        error: () => undefined,
      },
      retentionDays: () => 0,
      now: () => Date.now(),
      sleep: () => Promise.resolve(),
    })

  beforeAll(async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'muse-session-delete-'))
  })
  afterAll(async () => {
    await removeFolder(directory)
  })

  it('lists a saved conversation, then loses its file and its row on remove', async () => {
    const sessions = store()
    await sessions.save(session)
    const before = await sessions.list()
    expect(before.map((header) => header.sessionId)).toContain('s1')
    expect(await sessions.load('s1')).toBeDefined()

    await sessions.remove('s1')

    const after = await sessions.list()
    expect(after.map((header) => header.sessionId)).not.toContain('s1')
    expect(await sessions.load('s1')).toBeUndefined()
    expect(await readdir(directory)).not.toContain('s1.json')
  })

  it('resolves removing an id that is already gone', async () => {
    await expect(store().remove('never-saved')).resolves.toBeUndefined()
  })
})

describe('canDeleteMuseSession', () => {
  it('opens Delete only where the CLI serves session/delete and the reader is injected', () => {
    const rows: [version: string, hasReader: boolean, expected: boolean][] = [
      ['1.4.0', true, true],
      ['1.4.3', true, true],
      ['1.4.3-R5018.1', true, true],
      ['1.4.4', true, false],
      ['1.4.4-R5419.1', true, false],
      ['1.4.10', true, false],
      ['1.4.10-R6427.1', true, false],
      ['1.3.0', true, false],
      ['not-a-version', true, false],
      ['', true, false],
      ['1.4.3', false, false],
      ['1.4.10', false, false],
    ]
    for (const [version, hasReader, expected] of rows) {
      expect(canDeleteMuseSession(version, hasReader)).toBe(expected)
    }
  })
})
