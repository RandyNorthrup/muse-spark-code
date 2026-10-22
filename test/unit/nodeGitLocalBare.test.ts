import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { scripted } from './helpers/recordCalls'
import { createNodeGitMethods, type NodeGitPagePort } from '../../src/runtime/node/web/git'
import { nodeActionDigest } from '../../src/runtime/node/listenerMethods'
import { nodeMethods, type NodeMethodParams } from '../../src/shared/hostApi/nodeMethods'

const runFile = promisify(execFile)
const destination = {
  host: 'fixture.invalid',
  port: 22,
  user: 'git',
  repository: 'fixture.git',
  hostKeyDigest: 'a'.repeat(64),
}
const state = { directory: '', writer: '', work: '', bare: '' }
async function git(args: string[], signal?: AbortSignal) {
  const output = await runFile(
    'git',
    [
      '-c',
      'user.name=Fixture',
      '-c',
      'user.email=fixture@example.invalid',
      '-c',
      'core.hooksPath=',
      ...args,
    ],
    {
      signal,
      env: {
        PATH: process.env['PATH'],
        HOME: state.directory,
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_CONFIG_GLOBAL: path.join(state.directory, 'empty-config'),
        GIT_TERMINAL_PROMPT: '0',
      },
    },
  )
  return output.stdout.trim()
}
async function commit(repo: string, text: string) {
  await writeFile(path.join(repo, 'file.txt'), text)
  await git(['-C', repo, 'add', '--', 'file.txt'])
  await git(['-C', repo, 'commit', '-m', 'fixture'])
  return await git(['-C', repo, 'rev-parse', 'HEAD'])
}
beforeAll(async () => {
  state.directory = await mkdtemp(path.join(tmpdir(), 'm110-u1-bare-'))
  state.writer = path.join(state.directory, 'writer')
  state.work = path.join(state.directory, 'work')
  state.bare = path.join(state.directory, 'remote.git')
  await writeFile(path.join(state.directory, 'empty-config'), '')
  await git(['init', '--initial-branch=main', state.writer])
  await commit(state.writer, 'seed')
  await git(['clone', '--bare', state.writer, state.bare])
  await git(['clone', state.bare, state.work])
})
afterAll(async () => {
  if (state.directory !== '') await rm(state.directory, { recursive: true, force: true })
})

// Local-only semantic adapter. This exercises U1 with real Git data, without
// an SSH server, credential, or claiming N's isolated deploy-key socket works.
const inspect: NodeGitPagePort['inspect'] = async () => ({
  branch: 'refs/heads/main',
  head: await git(['-C', state.work, 'rev-parse', 'HEAD']),
  changes: [],
  remotes: [{ name: 'origin', destination }],
  nextCursor: null,
})
function fixture() {
  const run = scripted<Parameters<NodeGitPagePort['run']>, Promise<unknown>>(
    async (method, input, signal) => {
      if (method !== 'node/git/push' && method !== 'node/git/pull' && method !== 'node/git/fetch')
        throw new Error('unsupported local fixture method')
      const params = nodeMethods[method].params.parse(input)
      if (method === 'node/git/push')
        await git(
          [
            '-C',
            state.work,
            'push',
            '--',
            state.bare,
            `${params.expectedHead ?? ''}:${params.ref}`,
          ],
          signal,
        )
      else {
        await git(['-C', state.work, 'fetch', '--no-tags', '--', state.bare, params.ref], signal)
        if (method === 'node/git/pull')
          await git(['-C', state.work, 'merge', '--ff-only', '--no-edit', 'FETCH_HEAD'], signal)
      }
      const head = await git(['-C', state.work, 'rev-parse', 'HEAD'], signal)
      return { head, changed: head !== params.expectedHead }
    },
  )
  const reports: unknown[] = []
  const methods = createNodeGitMethods({
    inspect,
    run,
    report: (error: unknown) => {
      reports.push(error)
    },
  })
  return { methods, run, reports }
}
function params(
  method: 'node/git/push' | 'node/git/pull' | 'node/git/fetch',
  head: string,
): NodeMethodParams<'node/git/push'> {
  const input = {
    workspaceId: 'repo',
    remote: 'origin',
    destination,
    ref: 'refs/heads/main',
    expectedHead: head,
    stepUpId: 'fixture-proof',
    actionDigest: '0'.repeat(64),
  }
  return { ...input, actionDigest: nodeActionDigest(method, input) }
}
describe('M110-U1 local bare Git fixture', () => {
  it('pushes an exact approved commit, fetches, and fast-forward pulls through the semantic port', async () => {
    const { methods, run } = fixture()
    const head = await commit(state.work, 'from page')
    await methods.push(params('node/git/push', head), new AbortController().signal)
    expect(await git(['--git-dir', state.bare, 'rev-parse', 'refs/heads/main'])).toBe(head)
    await git(['-C', state.writer, 'fetch', '--', state.bare, 'refs/heads/main'])
    await git(['-C', state.writer, 'merge', '--ff-only', '--no-edit', 'FETCH_HEAD'])
    const incoming = await commit(state.writer, 'incoming')
    await git(['-C', state.writer, 'push', '--', state.bare, `${incoming}:refs/heads/main`])
    expect(
      await methods.fetch(params('node/git/fetch', head), new AbortController().signal),
    ).toEqual({ head, changed: false })
    expect(await methods.pull(params('node/git/pull', head), new AbortController().signal)).toEqual(
      { head: incoming, changed: true },
    )
    expect(await readFile(path.join(state.work, 'file.txt'), 'utf8')).toBe('incoming')
    expect(run.calls).toHaveLength(3)
  })
  it('H14 preserves a newer local commit when the approved head is stale', async () => {
    const { methods, run, reports } = fixture()
    const stale = await git(['-C', state.work, 'rev-parse', 'HEAD'])
    const newer = await commit(state.work, 'competing local commit')
    await expect(
      methods.pull(params('node/git/pull', stale), new AbortController().signal),
    ).rejects.toThrow()
    expect(run.calls).toHaveLength(0)
    expect(await git(['-C', state.work, 'rev-parse', 'HEAD'])).toBe(newer)
    // A typed refusal is routine, not a failure: nothing is reported.
    expect(reports).toHaveLength(0)
  })
  it('reports a faulted runner with the raw error and refuses typed unavailable', async () => {
    const { methods, run, reports } = fixture()
    run.once(() => Promise.reject(new Error('faulted runner')))
    await expect(
      methods.status({ workspaceId: 'repo', cursor: null }, new AbortController().signal),
    ).rejects.toThrow()
    expect(reports).toHaveLength(1)
  })
})
