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
import { ModelApiHost, type ModelApiHostDeps } from '../../src/core/backends/modelapi/ModelApiHost'
import { ModelApiClient } from '../../src/core/backends/modelapi/client'
import type { StoredSession } from '../../src/core/backends/modelapi/sessionStore'
import { canDeleteMuseSession } from '../../src/core/backends/musecode/MuseCodeHost'
import { fileContextIo } from '../../src/host/backend/contextIo'
import { createFileSessionStore } from '../../src/host/backend/fileSessionStore'
import { createToolIo } from '../../src/host/backend/toolIo'
import { MODEL_API_BASE_URL, SETTING_DEFAULTS } from '../../src/shared/constants'
import { Usd } from '../../src/shared/usd'
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

// A deleted Model API conversation stays deleted, proven through the real
// host against the real file store: a live conversation saves (the rename
// below queues a real write and the delete lands while it is still in
// flight), the delete drains that save and removes the file, the host no
// longer lists the id, and the live handle is stopped — resuming or forking
// the deleted id refuses instead of bringing a session back. The provider
// client below is the product's own, constructed but never called: no turn
// runs, so any network use would fail loudly through its missing key.
describe('ModelApiHost.deleteSession keeps a deleted conversation deleted', () => {
  let directory = ''
  let ids = 0

  beforeAll(async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'muse-host-session-delete-'))
  })
  afterAll(async () => {
    await removeFolder(directory)
  })

  function makeHost(): {
    readonly host: ModelApiHost
    readonly store: ReturnType<typeof createFileSessionStore>
  } {
    const log = {
      trace: () => undefined,
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined,
    }
    const store = createFileSessionStore({
      directory,
      log,
      retentionDays: () => 0,
      now: () => Date.now(),
      sleep: () => Promise.resolve(),
    })
    const client = new ModelApiClient({
      fetch: globalThis.fetch,
      baseUrl: MODEL_API_BASE_URL,
      apiKey: () => Promise.resolve(undefined),
      sleep: () => Promise.resolve(),
      now: () => Date.now(),
      random: () => 0.5,
      log,
    })
    const deps: ModelApiHostDeps = {
      client,
      workspaceRoot: directory,
      platform: process.platform,
      io: createToolIo({
        platform: process.platform,
        listFiles: () => Promise.resolve([]),
        systemRoot: undefined,
        env: () => ({}),
        searchWorkerPath: path.join(directory, 'searchWorker.js'),
        log: () => undefined,
        unsavedFiles: () => [],
      }),
      contextIo: fileContextIo,
      newId: () => `test-session-${String((ids += 1))}`,
      now: () => Date.now(),
      log,
      personalSkillsRoot: undefined,
      personalAgentsRoot: undefined,
      isWorkspaceTrusted: () => true,
      isConfidentialWorkspace: () => false,
      confirmContributorModel: () => Promise.resolve(false),
      describeEnvironment: () => Promise.reject(new Error('sessionDelete test runs no turn')),
      isPaidFeatureOn: () => false,
      notePaidUse: () => undefined,
      allowsPaidUse: () => Promise.resolve(false),
      isPaidUseRemembered: () => false,
      noteSubagentUsage: () => undefined,
      noteReviewerUsage: () => undefined,
      promptCacheRetention: () => SETTING_DEFAULTS.modelApiPromptCacheRetention,
      sessionBudgetUsd: () => Usd.from(0).toAmount(),
      showReplyUsage: () => false,
      memory: undefined,
      getAccountId: () => Promise.resolve('session-delete-test-account'),
      store,
    }
    return { host: new ModelApiHost(deps), store }
  }

  it('drains the in-flight save, removes the file, and stops the live handle', async () => {
    const { host, store } = makeHost()
    const live = await host.startSession({
      workspaceRoot: directory,
      modelId: 'muse-spark-test-1',
      approvalMode: 'promptUnmatched',
    })
    const sessionId = live.sessionId
    // Queue a real save and delete before it must have finished: the removal
    // has to win over the write, not race it.
    await live.rename('Parser fix')
    await host.deleteSession(sessionId)
    await host.flush()

    expect(await store.load(sessionId)).toBeUndefined()
    const listed = await host.listSessions({ workspaceRoot: directory, limit: 50 })
    expect(listed.sessions.map((record) => record.sessionId)).not.toContain(sessionId)

    // The live handle is stopped with the conversation: neither resume nor
    // fork may bring a session back for the deleted id.
    await expect(host.resumeSession(sessionId, 'muse-spark-test-1')).rejects.toThrow()
    await expect(host.forkSession(sessionId, 'muse-spark-test-1')).rejects.toThrow()

    // Touching the stopped handle afterwards writes nothing back.
    await live.rename('A rename after the delete')
    await host.flush()
    expect(await store.load(sessionId)).toBeUndefined()

    // Deleting again resolves: the removal stays idempotent.
    await expect(host.deleteSession(sessionId)).resolves.toBeUndefined()
    await host.flush()
    expect(await store.load(sessionId)).toBeUndefined()
    expect(await readdir(directory)).not.toContain(`${sessionId}.json`)
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
