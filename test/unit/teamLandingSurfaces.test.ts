// A team's landing on the other surfaces (CC-WINLAND): a headless run and an ACP session reach the
// same checked landing, each with its own journal folder and its own way of asking, and the
// engine's governed git carries it. A real lander killed mid-landing, a real ACP team entry, a real
// exec team, real repositories, the contained launcher as the agent process configures it.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import * as acp from '@agentclientprotocol/sdk/unstable'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createAcpTeam } from '../../src/acp/acpTeamEntry'
import type { AcpTeamPort } from '../../src/acp/teamPort'
import { configureResources } from '../../src/core/resources/admission'
import { applyTeamMerge } from '../../src/core/team/teamMerge'
import { processTeamGit } from '../../src/core/team/workers/workerOpsEntry'
import { workspaceKey } from '../../src/runtime/dataFolder'
import { createExecTeam } from '../../src/runtime/exec/execTeamEntry'
import { runtimeWindowsJob } from '../../src/runtime/resources/jobs'
import { storedTeamSnapshotFile } from '../../src/runtime/teamSnapshotFile'
import {
  ACP_SESSIONS_SUBFOLDER,
  ACP_TEAM_STORAGE_FOLDER,
  EXEC_TEAM_LANDING_FOLDER,
  UI_TEXT,
} from '../../src/shared/constants'
import { Usd } from '../../src/shared/usd'
import { createWindowIdentity } from '../../src/host/team/windowIdentity'
import { createLocalAcpAgent } from './helpers/acpLocalAgentDeps'
import { silentCoreLog } from './helpers/memoryLogs'
import {
  buildLander,
  hasFile,
  landingFixturesIn,
  startLander,
  type LanderBuild,
} from './helpers/teamLander'
import {
  fixtureGit,
  landingRunGit,
  landingStatuses,
  landingTask,
  productLandingPorts,
  type LandingFixture,
} from './helpers/teamLandingFixture'

const BATCH = ['a.txt', 'b.txt', 'c.txt', 'd.txt']
const LEAD = 'probe-custom/custom-model'
const WORKER = 'probe-offable/offable-model'

const shared: { lander?: LanderBuild; dispose?: () => void; folders: string[] } = { folders: [] }

async function scratch(prefix: string): Promise<string> {
  const folder = await realpath(await mkdtemp(path.join(tmpdir(), prefix)))
  shared.folders.push(folder)
  return folder
}

beforeAll(async () => {
  shared.lander = await buildLander()
  const jobs = await scratch('muse-landing-jobs-')
  // As the agent process configures it: the engine's git is governed and contained.
  shared.dispose = configureResources({
    inspect: () => ({}),
    onError: () => undefined,
    ...(process.platform === 'win32' && {
      windowsJob: runtimeWindowsJob(jobs, path.resolve('.')),
    }),
  })
}, 180_000)

afterAll(async () => {
  await shared.lander?.dispose()
  shared.dispose?.()
  for (const folder of shared.folders.splice(0))
    await rm(folder, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}, 120_000)

/** Kills a window under the lock, its second file staged, with its journal in `storage`. */
async function deadWindowIn(fixture: LandingFixture, storage: string): Promise<void> {
  const lander = shared.lander
  if (lander === undefined) throw new Error('the lander did not build')
  await mkdir(storage, { recursive: true })
  const running = await startLander(
    lander,
    { ...fixture, storage: await realpath(storage) },
    createWindowIdentity(1000),
    { file: 'b.txt', atRename: true },
  )
  await running.stopped()
  await running.kill()
}

async function batchOf(root: string): Promise<readonly string[]> {
  const read = await Promise.all(BATCH.map((file) => readFile(path.join(root, file), 'utf8')))
  return read.map((text) => text.trim())
}

/** The stored team either surface reads: a lead and a worker it can dispatch to. */
async function writeStoredTeam(dataFolder: string, cwd: string): Promise<void> {
  const file = storedTeamSnapshotFile(dataFolder, cwd)
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(
    file,
    JSON.stringify({
      roles: [
        {
          role: 'engineering',
          workspace: 'own-branch',
          pool: [
            {
              id: 'e1',
              concurrent: 1,
              caps: [],
              agent: { kind: 'engine', agentId: 'probe', model: WORKER, pays: 'local' },
            },
          ],
        },
      ],
      intensity: 'balanced',
    }),
  )
}

const oneHeadlessRun = async (dataFolder: string, cwd: string): Promise<void> => {
  const team = await createExecTeam(
    {
      dataFolder,
      cwd,
      platform: process.platform,
      provider: undefined,
      defaultPays: 'key',
      budgetUsd: Usd.from(1).toAmount(),
      refusalFallback: false,
      providersFile: path.join(dataFolder, 'providers.json'),
      signal: new AbortController().signal,
      now: () => Date.now(),
      log: silentCoreLog(),
      readFile: async (file, maxBytes) => {
        const bytes = await readFile(file)
        return bytes.subarray(0, maxBytes)
      },
      listModels: () => Promise.resolve([LEAD, WORKER]),
      startWorker: () => Promise.reject(new Error('no worker in this suite')),
      onWritten: () => undefined,
      secretLiterals: () => [],
      lowerWorkerCap: () => undefined,
    },
    UI_TEXT,
    'en',
  )
  try {
    await team.prepare(LEAD)
  } finally {
    await team.close()
  }
}

/**
One agent run over the workspace, a real editor on the other end: a session, and `turns` of a
turn that needs no model. `answer` is the person's. Returns what they were asked.
*/
const oneAcpRun = async (dataFolder: string, repo: string, answer: string, turns = 1) => {
  const asked: (readonly string[])[] = []
  const home = await scratch('muse-landing-acp-home-')
  const log = silentCoreLog()
  let team: AcpTeamPort | undefined
  const { agent } = createLocalAcpAgent(home, log, (rig, deps) => {
    team = createAcpTeam(
      {
        dataFolder,
        platform: process.platform,
        log,
        backendKind: 'modelApi',
        isTrusted: () => true,
        listWorkerModels: async () => {
          const listed = await rig.host.listModels()
          return listed.map((model) => model.modelId)
        },
        startWorker: () => Promise.reject(new Error('no worker in this suite')),
        paid: () => deps.paid,
      },
      UI_TEXT,
      'en',
    )
    return { team }
  })
  try {
    await acp
      .client({ name: 'landing' })
      .onRequest('session/request_permission', (context) => {
        asked.push(context.params.options.map((option) => option.name))
        return { outcome: { outcome: 'selected', optionId: answer } }
      })
      .connectWith(agent, async (editor) => {
        await editor.request('initialize', {
          protocolVersion: acp.PROTOCOL_VERSION,
          clientCapabilities: {},
        })
        const { sessionId } = await editor.request('session/new', { cwd: repo, mcpServers: [] })
        // session/new has answered and nobody was asked: the editor could not have answered.
        expect(asked).toEqual([])
        for (let turn = 0; turn < turns; turn += 1)
          await editor.request('session/prompt', {
            sessionId,
            prompt: [{ type: 'text', text: '/agents' }],
          })
        await editor.request('session/close', { sessionId })
      })
  } finally {
    await team?.dispose()
  }
  return asked
}

/** A real repository at the base, the worker's commit beside it, and `onDisk` in the tree. */
const mergedOver = async (onDisk: string, theirs: string | undefined) => {
  const repo = await scratch('muse-landing-eol-')
  const file = path.join(repo, 'file.txt')
  await fixtureGit(repo, ['init', '-b', 'main'])
  await writeFile(file, 'one\ntwo\nthree\n')
  await fixtureGit(repo, ['add', '-A'])
  await fixtureGit(repo, ['commit', '-m', 'base'])
  const baseOut = await fixtureGit(repo, ['rev-parse', 'HEAD'])
  if (theirs === undefined) await rm(file)
  else await writeFile(file, theirs)
  await fixtureGit(repo, ['add', '-A'])
  await fixtureGit(repo, ['commit', '-m', 'work'])
  const headOut = await fixtureGit(repo, ['rev-parse', 'HEAD'])
  await fixtureGit(repo, ['checkout', '-q', baseOut.trim()])
  await writeFile(file, onDisk)
  const result = await applyTeamMerge(
    { runGit: landingRunGit, realPath: realpath },
    {
      repositoryRoot: repo,
      baseCommit: baseOut.trim(),
      branchHead: headOut.trim(),
      agentRefs: [],
    },
    { platform: process.platform },
  )
  return {
    written: result.written,
    text: (await hasFile(file)) ? await readFile(file, 'utf8') : undefined,
  }
}

const WORK = 'one\ntwo\nTHREE\n'

describe('a headless run', () => {
  const fixtureFor = landingFixturesIn('asCreated')

  it('settles at start what a dead run left, and never under a lock it finds', async () => {
    const fixture = await fixtureFor('task-exec', BATCH)
    const data = await scratch('muse-landing-exec-')
    await writeStoredTeam(data, fixture.root)
    const key = createHash('sha256')
      .update(await realpath(fixture.root))
      .digest('hex')
    // Beside the person's own data: a run's folder goes with the run.
    const storage = path.join(data, EXEC_TEAM_LANDING_FOLDER, key)
    await deadWindowIn(fixture, storage)
    const lock = path.join(fixture.root, '.git', 'index.lock')

    await oneHeadlessRun(data, fixture.root)
    expect(await landingStatuses(storage)).toEqual(['open'])
    expect(await batchOf(fixture.root)).toEqual(['after', 'before', 'before', 'before'])
    expect(await hasFile(lock)).toBe(true)

    await rm(lock)
    await oneHeadlessRun(data, fixture.root)
    expect(await landingStatuses(storage)).toEqual(['recovered'])
    expect(await batchOf(fixture.root)).toEqual(['before', 'before', 'before', 'before'])
  }, 180_000)
})

describe('an ACP session', () => {
  const fixtureFor = landingFixturesIn('asCreated')

  it('asks at the first turn about a dead run: Keep leaves it, Recover settles it', async () => {
    const fixture = await fixtureFor('task-acp', BATCH)
    const data = await scratch('muse-landing-acp-')
    await writeStoredTeam(data, fixture.root)
    const storage = path.join(
      data,
      ACP_SESSIONS_SUBFOLDER,
      workspaceKey(fixture.root),
      ACP_TEAM_STORAGE_FOLDER,
    )
    await deadWindowIn(fixture, storage)
    await rm(path.join(fixture.root, '.git', 'index.lock'))
    const words = [UI_TEXT.teamTraffic.recover, UI_TEXT.teamTraffic.keep]

    // Asked once in a run, however many turns it takes.
    expect(await oneAcpRun(data, fixture.root, 'discard', 2)).toEqual([words])
    expect(await landingStatuses(storage)).toEqual(['open'])
    expect(await batchOf(fixture.root)).toEqual(['after', 'before', 'before', 'before'])

    expect(await oneAcpRun(data, fixture.root, 'merge')).toEqual([words])
    expect(await landingStatuses(storage)).toEqual(['recovered'])
    expect(await batchOf(fixture.root)).toEqual(['before', 'before', 'before', 'before'])

    // Settled once: the next run has nothing to ask.
    expect(await oneAcpRun(data, fixture.root, 'merge')).toEqual([])
  }, 240_000)
})

describe("a checkout's line endings in the merge", () => {
  it.each([
    ['an untouched CRLF checkout', 'one\r\ntwo\r\nthree\r\n', 'one\r\ntwo\r\nTHREE\r\n'],
    ["the person's own edit in it", 'ONE\r\ntwo\r\nthree\r\n', 'ONE\r\ntwo\r\nTHREE\r\n'],
    ['an LF checkout, as it always was', 'one\ntwo\nthree\n', WORK],
  ])('merges %s and keeps its line endings', async (_name, onDisk, expected) => {
    expect(await mergedOver(onDisk, WORK)).toEqual({ written: ['file.txt'], text: expected })
  })

  it('writes nothing when the checkout already holds the work', async () => {
    expect(await mergedOver('one\r\ntwo\r\nTHREE\r\n', WORK)).toEqual({
      written: [],
      text: 'one\r\ntwo\r\nTHREE\r\n',
    })
  })

  it("carries out the worker's removal over a CRLF checkout", async () => {
    expect(await mergedOver('one\r\ntwo\r\nthree\r\n', undefined)).toEqual({
      written: ['file.txt'],
      text: undefined,
    })
  })

  it.each([
    ['mixed line endings', 'one\r\ntwo\nthree\r\n', WORK],
    ['a worker that wrote CRLF itself', 'one\r\ntwo\r\nthree\r\n', 'one\r\ntwo\r\nTHREE\r\n'],
  ])('refuses rather than rewrites %s', async (_name, onDisk, theirs) => {
    await expect(mergedOver(onDisk, theirs)).rejects.toThrow('Conflicts need the task copy')
  })
})

describe('the governed git', () => {
  const fixtureFor = landingFixturesIn('asCreated')
  const signal = new AbortController().signal
  const land = async (fixture: LandingFixture) => {
    const task = landingTask(fixture)
    return await productLandingPorts(
      fixture,
      undefined,
      processTeamGit(process.platform),
    ).merges.merge(
      { ...task, outcome: { ...task.outcome, folder: await realpath(fixture.workerCopy) } },
      signal,
      { allowProtected: false },
    )
  }

  it('carries a landing through its contained launcher', async () => {
    const fixture = await fixtureFor('task-governed', BATCH)
    expect(await land(fixture)).toMatchObject({ status: 'merged' })
    expect(await batchOf(fixture.root)).toEqual(['after', 'after', 'after', 'after'])
    expect(await landingStatuses(fixture.storage)).toEqual(['landed'])
  }, 180_000)

  it("lands over a person's tree with core.autocrlf and their line endings", async () => {
    const fixture = await fixtureFor('task-crlf', BATCH)
    await fixtureGit(fixture.root, ['config', 'core.autocrlf', 'true'])
    // Checked out under that setting, as the person's own tree came to be: git calls it clean.
    for (const file of BATCH) await rm(path.join(fixture.root, file))
    const git = (...args: readonly string[]) =>
      execFileSync('git', args, { cwd: fixture.root, encoding: 'utf8' })
    git('checkout', '--', '.')
    expect(await readFile(path.join(fixture.root, 'a.txt'), 'utf8')).toBe('before\r\n')
    expect(git('status', '--porcelain')).toBe('')
    expect(await land(fixture)).toMatchObject({ status: 'merged' })
    expect(await batchOf(fixture.root)).toEqual(['after', 'after', 'after', 'after'])
    expect(await landingStatuses(fixture.storage)).toEqual(['landed'])
    // The landed files are in the person's line endings, and git sees exactly the batch.
    expect(await readFile(path.join(fixture.root, 'a.txt'), 'utf8')).toBe('after\r\n')
    expect(git('status', '--porcelain')).toBe(BATCH.map((file) => ` M ${file}\n`).join(''))
  }, 180_000)
})
