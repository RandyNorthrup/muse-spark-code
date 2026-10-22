import { createHash } from 'node:crypto'
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { createNodeFileMethods, type NodeFileWorkspacePort } from '../../src/runtime/node/web/files'
import { createNodeGitMethods, type NodeGitPagePort } from '../../src/runtime/node/web/git'
import { NodeListenerError } from '../../src/runtime/node/listenerGuard'
import { nodeActionDigest } from '../../src/runtime/node/listenerMethods'
import { NODE_HTTP_STATUS, UI_TEXT } from '../../src/shared/constants'
import { nodeMethodErrorSchema, type NodeMethodResult } from '../../src/shared/hostApi/nodeMethods'
import { nodeErrorCode } from './helpers/nodeErrorCode'

const signal = () => new AbortController().signal
const digest = (data: string | Uint8Array) => createHash('sha256').update(data).digest('hex')
const byName = (left: string, right: string) => (left < right ? -1 : Number(left > right))

function fileFaultPort() {
  const reports: unknown[] = []
  const port = {
    root: () => Promise.reject(new TypeError('faulted workspace lookup')),
    replace: () => Promise.reject(new Error('faulted publication')),
    report: (error: unknown) => {
      reports.push(error)
    },
  } satisfies NodeFileWorkspacePort
  return { port, reports }
}
const reportNames = (reports: readonly unknown[]) =>
  reports.map((error) => (error instanceof Error ? error.name : null))

function fileCases(methods: ReturnType<typeof createNodeFileMethods>) {
  const file = { workspaceId: 'repo', path: 'src/example.txt' }
  const upload = {
    workspaceId: 'repo',
    path: 'binary.dat',
    expectedDigest: null,
    data: Buffer.from([0, 255]).toString('base64'),
    digest: digest(Buffer.from([0, 255])),
  }
  return [
    ['list', () => methods.list({ workspaceId: 'repo', directory: null, cursor: null }, signal())],
    [
      'search',
      () => methods.search({ workspaceId: 'repo', query: 'example', cursor: null }, signal()),
    ],
    ['read', () => methods.read(file, signal())],
    ['download', () => methods.download(file, signal())],
    ['write', () => methods.write({ ...file, expectedDigest: null, text: 'faulted' }, signal())],
    ['upload', () => methods.upload(upload, signal())],
  ] as const
}

const gitDestination = {
  host: 'git.example.invalid',
  port: 22,
  user: 'git',
  repository: 'owner/repo.git',
  hostKeyDigest: 'a'.repeat(64),
}
const gitStatus = {
  branch: 'refs/heads/main',
  head: 'b'.repeat(40),
  changes: [{ path: 'file.txt', kind: 'modified' }],
  nextCursor: null,
  remotes: [{ name: 'origin', destination: gitDestination }],
} satisfies NodeMethodResult<'node/git/status'>

function gitNetworkParams(method: 'node/git/fetch' | 'node/git/pull' | 'node/git/push') {
  const input = {
    workspaceId: 'repo',
    remote: 'origin',
    destination: gitDestination,
    ref: 'refs/heads/main',
    expectedHead: gitStatus.head,
    stepUpId: 'verified-proof',
    actionDigest: '0'.repeat(64),
  }
  return { ...input, actionDigest: nodeActionDigest(method, input) }
}

function gitCases(methods: ReturnType<typeof createNodeGitMethods>) {
  return [
    ['status', () => methods.status({ workspaceId: 'repo', cursor: null }, signal())],
    ['diff', () => methods.diff({ workspaceId: 'repo', path: null, staged: false }, signal())],
    ['branches', () => methods.branches({ workspaceId: 'repo', cursor: null }, signal())],
    ['stage', () => methods.stage({ workspaceId: 'repo', paths: ['file.txt'] }, signal())],
    [
      'commit',
      () =>
        methods.commit(
          { workspaceId: 'repo', expectedHead: gitStatus.head, message: 'faulted' },
          signal(),
        ),
    ],
    [
      'branch',
      () =>
        methods.branch(
          { workspaceId: 'repo', expectedHead: gitStatus.head, name: 'faulted' },
          signal(),
        ),
    ],
    ['fetch', () => methods.fetch(gitNetworkParams('node/git/fetch'), signal())],
    ['pull', () => methods.pull(gitNetworkParams('node/git/pull'), signal())],
    ['push', () => methods.push(gitNetworkParams('node/git/push'), signal())],
  ] as const
}

/** The walk covers the whole handler table: an added handler without a
fault case fails here before it can leak a raw error. */
async function expectTypedWalk(
  methods: object,
  cases: readonly (readonly [string, () => Promise<unknown>])[],
): Promise<void> {
  expect(cases.map(([name]) => name).toSorted(byName)).toEqual(
    Object.keys(methods).toSorted(byName),
  )
  for (const [name, invoke] of cases) {
    await expect(invoke(), `handler ${name}`).rejects.toBeInstanceOf(NodeListenerError)
  }
}

describe('M110-U3 typed handler boundary', () => {
  it('throws only NodeListenerError from every file handler when the port faults', async () => {
    const { port, reports } = fileFaultPort()
    const methods = createNodeFileMethods(port)
    await expectTypedWalk(methods, fileCases(methods))
    // Every unexpected port failure is reported once with the raw error:
    // the lookups fault as TypeErrors, the publications as Errors.
    expect(reportNames(reports)).toEqual([
      'TypeError',
      'TypeError',
      'TypeError',
      'TypeError',
      'Error',
      'Error',
    ])
  })

  it('throws only NodeListenerError from every git handler when the port faults', async () => {
    const reports: unknown[] = []
    const faults = {
      inspect: () => Promise.reject(new TypeError('faulted inspection')),
      run: () => Promise.reject(new Error('faulted runner')),
      report: (error: unknown) => {
        reports.push(error)
      },
    } satisfies NodeGitPagePort
    const methods = createNodeGitMethods(faults)
    await expectTypedWalk(methods, gitCases(methods))
    // status, diff, branches and stage reach the runner; the commit,
    // branch and network handlers fault earlier at inspection.
    expect(reportNames(reports)).toEqual([
      'Error',
      'Error',
      'Error',
      'Error',
      'TypeError',
      'TypeError',
      'TypeError',
      'TypeError',
      'TypeError',
    ])
  })

  it('refuses non-UTF-8 bytes on read as typed notText, not unavailable', async () => {
    const root = await realpath(await mkdtemp(path.join(tmpdir(), 'm110-u3-nottext-')))
    try {
      await writeFile(path.join(root, 'binary.dat'), Buffer.from([255]))
      const reports: unknown[] = []
      const methods = createNodeFileMethods({
        root: (workspaceId: string) =>
          workspaceId === 'repo'
            ? Promise.resolve(root)
            : Promise.reject(new Error('unknown workspace')),
        replace: () => Promise.reject(new Error('unexpected publication')),
        report: (error: unknown) => {
          reports.push(error)
        },
      })
      let failure: unknown = 'resolved'
      try {
        await methods.read({ workspaceId: 'repo', path: 'binary.dat' }, signal())
      } catch (error: unknown) {
        failure = error
      }
      expect(failure).toBeInstanceOf(NodeListenerError)
      if (!(failure instanceof NodeListenerError)) throw new Error('expected a typed refusal')
      expect(failure.code).toBe('notText')
      expect(
        await nodeErrorCode(methods.read({ workspaceId: 'repo', path: 'binary.dat' }, signal())),
      ).toBe('notText')
      expect(failure.message).toBe(UI_TEXT.nodeErrors.notText)
      // A typed refusal is routine, not a failure: nothing is reported.
      expect(reports).toHaveLength(0)
      expect(NODE_HTTP_STATUS.notText).toBe(415)
      // The browser maps the typed code back to its message; without the
      // enum entry it would scrub to `unavailable` (RVM110U1 P2 #4 class).
      expect(nodeMethodErrorSchema.safeParse({ code: 'notText' }).success).toBe(true)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('keeps the typed refusals distinct from a plain Error at the listener', async () => {
    const { port, reports } = fileFaultPort()
    const methods = createNodeFileMethods(port)
    // A faulted lookup is an internal failure, still typed: the listener
    // maps it to 503 unavailable instead of leaking the TypeError.
    expect(
      await nodeErrorCode(
        methods.list({ workspaceId: 'repo', directory: null, cursor: null }, signal()),
      ),
    ).toBe('unavailable')
    expect(reports).toHaveLength(1)
    expect(NODE_HTTP_STATUS.unavailable).toBe(503)
  })
})
