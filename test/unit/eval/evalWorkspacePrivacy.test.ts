// Real filesystem setup failures, with an owned parent and offline transports.
import { existsSync, mkdtempSync, realpathSync } from 'node:fs'
import type * as FileSystem from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { runPairedEval, type EvalRunDeps } from '../../../src/core/eval/runner'
import type { EvalTask } from '../../../src/core/eval/tasks'
import { evalWorkspaceFailureForReport } from '../../../src/core/eval/workspace'
import { fileContextIo } from '../../../src/host/backend/contextIo'
import { EVAL_TURN_NOT_RUN } from '../../../src/shared/constants'
import { memoryToolIo } from '../helpers/fakeToolIo'
import {
  FAKE_MODEL_API_ACCOUNT_ID,
  fakeModelApi,
  fakeModelApiClientSettings,
} from '../helpers/fakeModelApi'
import { FakeLogOutputChannel } from '../helpers/fakes'
import { removeFolder } from '../helpers/temporaryFolders'

const setup = vi.hoisted(() => ({
  parent: '',
  roots: new Array<string>(),
  missingParent: false,
  failCanonical: false,
}))

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof FileSystem>()
  return {
    ...actual,
    mkdtemp: async (prefix: string) => {
      const parent = setup.missingParent ? path.join(setup.parent, 'missing-parent') : setup.parent
      const root = await actual.mkdtemp(path.join(parent, path.basename(prefix)))
      setup.roots.push(root)
      return root
    },
    realpath: async (target: string) =>
      await actual.realpath(
        setup.failCanonical ? path.join(target, 'missing-canonical-target') : target,
      ),
  }
})

beforeAll(() => {
  setup.parent = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'muse-eval-private-')))
})

afterEach(async () => {
  setup.missingParent = false
  setup.failCanonical = false
  await Promise.all(setup.roots.splice(0).map((root) => removeFolder(root)))
})

afterAll(async () => {
  await removeFolder(setup.parent)
})

const TASK: EvalTask = {
  id: 'creation-error',
  title: 'Workspace setup',
  split: 'accept',
  prompt: 'Unused because workspace creation fails.',
  files: [{ path: 'source.js', content: 'export const value = 1\n' }],
  verify: '',
}

async function failedCreation(task = TASK) {
  const api = fakeModelApi()
  const log = new FakeLogOutputChannel()
  const deps: EvalRunDeps = {
    fetch: api.fetch,
    client: fakeModelApiClientSettings(log),
    toolIo: () => memoryToolIo({}, setup.parent),
    contextIo: fileContextIo,
    platform: process.platform,
    accountId: FAKE_MODEL_API_ACCOUNT_ID,
    log,
    now: Date.now,
    newId: () => 'unused',
    generatedAt: '2026-09-30T00:00:00.000Z',
  }
  const report = await runPairedEval([task], [{ name: 'baseline' }], deps)
  const result = report.arms[0]?.results[0]
  expect(result).toMatchObject({
    passed: false,
    terminal: EVAL_TURN_NOT_RUN,
    attempts: 0,
    requests: 0,
  })
  expect(JSON.stringify(report)).not.toContain(setup.parent)
  expect(JSON.stringify(report)).not.toContain('missing-parent')
  expect(JSON.stringify(report)).not.toContain('missing-canonical-target')
  expect(api.requests).toHaveLength(0)
  return result
}

describe('eval workspace failure privacy', () => {
  it('reports only the standard error code when allocation fails before a root exists', async () => {
    setup.missingParent = true
    const result = await failedCreation()
    expect(result?.failures).toEqual(['the workspace could not be made: ENOENT'])
    expect(setup.roots).toEqual([])
  })

  it('removes the allocated folder when canonical resolution fails before returning it', async () => {
    setup.failCanonical = true
    const result = await failedCreation()
    expect(result?.failures).toEqual(['the workspace could not be made: ENOENT'])
    expect(setup.roots).toHaveLength(1)
    expect(setup.roots.every((root) => !existsSync(root))).toBe(true)
  })

  it('removes partial fixtures and reports no path after a native mkdir failure', async () => {
    const result = await failedCreation({
      ...TASK,
      files: [
        { path: 'blocked', content: 'a regular file' },
        { path: 'blocked/child.js', content: 'unreachable' },
      ],
    })
    expect(result?.failures).toHaveLength(1)
    expect(result?.failures[0]).toMatch(/^the workspace could not be made: E[A-Z]+$/u)
    expect(setup.roots).toHaveLength(1)
    expect(setup.roots.every((root) => !existsSync(root))).toBe(true)
  })

  it('keeps malformed error metadata and raw causes out of the report boundary', () => {
    const message = path.join(setup.parent, 'private-profile-path')
    const cause = new Error(message)
    const failure = Object.assign(new Error(message, { cause }), { code: message })
    expect(evalWorkspaceFailureForReport(failure)).toBe('an unrecognized value')
    expect(evalWorkspaceFailureForReport(message)).toBe('an unknown failure')
  })
})
