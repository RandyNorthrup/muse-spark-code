import { ChildProcess, type SpawnOptions } from 'node:child_process'
import { access, lstat, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { PassThrough } from 'node:stream'
import { vi } from 'vitest'
import * as z from 'zod/mini'
import { DEVICE_LIMITS } from '../../../src/shared/constants'

export const darwinSpawnSites = [
  'aqua',
  'compile',
  'self-test',
  'initial-query',
  'bootstrap',
  'ready-print',
  'retirement-print',
  'count',
  'ps',
  'bootout',
  'query',
  'active-print',
] as const
type DarwinSpawnSite = (typeof darwinSpawnSites)[number]
interface DarwinSpawnFailure {
  name: string
  delivery: 'throw' | 'error' | 'exit' | 'signal' | 'timeout' | 'stdout' | 'stderr'
  code: string
  kind: 'spawn' | 'exit' | 'timeout' | 'output'
  detail: 'capacity' | 'helper'
  retryable: boolean
}
export const darwinSpawnFailures: DarwinSpawnFailure[] = [
  ...['ENOMEM', 'EAGAIN', 'EMFILE', 'ENFILE'].flatMap((code): DarwinSpawnFailure[] =>
    ['throw', 'error'].map((delivery) => ({
      name: `${delivery} ${code}`,
      delivery: delivery === 'throw' ? 'throw' : 'error',
      code,
      kind: 'spawn',
      detail: 'capacity',
      retryable: true,
    })),
  ),
  ...['ENOENT', 'EACCES', 'ENOEXEC', 'ENOTDIR', 'ELOOP', 'ENAMETOOLONG', 'E2BIG', 'EINVAL'].map(
    (code): DarwinSpawnFailure => ({
      name: `error ${code}`,
      delivery: 'error',
      code,
      kind: 'spawn',
      detail: 'helper',
      retryable: false,
    }),
  ),
  ...['EIO', 'ETXTBSY', 'UNKNOWN'].map((code): DarwinSpawnFailure => ({
    name: `throw ${code}`,
    delivery: 'throw',
    code,
    kind: 'spawn',
    detail: 'helper',
    retryable: true,
  })),
  {
    name: 'nonzero exit',
    delivery: 'exit',
    code: '',
    kind: 'exit',
    detail: 'helper',
    retryable: false,
  },
  {
    name: 'signal exit',
    delivery: 'signal',
    code: '',
    kind: 'exit',
    detail: 'helper',
    retryable: true,
  },
  {
    name: 'timeout',
    delivery: 'timeout',
    code: '',
    kind: 'timeout',
    detail: 'capacity',
    retryable: true,
  },
  {
    name: 'stdout overflow',
    delivery: 'stdout',
    code: '',
    kind: 'output',
    detail: 'helper',
    retryable: false,
  },
  {
    name: 'stderr overflow',
    delivery: 'stderr',
    code: '',
    kind: 'output',
    detail: 'helper',
    retryable: false,
  },
]
const configSchema = z.object({ directory: z.string(), label: z.string() })

/** Fake launchd/filesystem handshake; every process still crosses injected spawn. */
export async function darwinSpawnFixture(site: DarwinSpawnSite, failure: DarwinSpawnFailure) {
  const directory = await mkdtemp(path.join(tmpdir(), 'm100-darwin-spawn-'))
  const owner = await lstat(directory)
  const calls: DarwinSpawnSite[] = []
  const jobs = new Map<string, { directory: string; label: string; ready: boolean }>()
  let phase: 'preparing' | 'ready' = 'preparing'
  let isArmed = site !== 'query' && site !== 'active-print'
  let isInjected = false
  const { promise: injected, resolve: notify } = Promise.withResolvers<undefined>()
  const query = (label = 'transport', isAwake = false) => ({
    context: { session: owner.uid, station: 'gui', desktop: label },
    power: 'unknown',
    sleepInhibited: isAwake,
    activeProcesses: 0,
    cpu100ns: 0,
    peakMemoryBytes: 0,
  })
  const classify = (file: string, args: readonly string[]): DarwinSpawnSite => {
    const programFile = file.replaceAll('\\', '/')
    if (programFile === '/usr/bin/clang') return 'compile'
    if (programFile === '/bin/ps') return 'ps'
    if (args[0] === '--self-test') return 'self-test'
    if (args[0] === '--count') return 'count'
    if (args[0] === '--query') return phase === 'preparing' ? 'initial-query' : 'query'
    if (args[0] === 'bootstrap') return 'bootstrap'
    if (args[0] === 'bootout') return 'bootout'
    if (args[1] === `gui/${String(owner.uid)}`) return 'aqua'
    if (
      phase === 'ready' &&
      site === 'active-print' &&
      isArmed &&
      !isInjected &&
      jobs.get(args[1] ?? '')?.ready === true
    )
      return 'active-print'
    return jobs.get(args[1] ?? '')?.ready === true ? 'retirement-print' : 'ready-print'
  }
  const output = async (current: DarwinSpawnSite, args: readonly string[]) => {
    if (current === 'aqua') return 'session = Aqua\n'
    if (current === 'compile') {
      const file = args[args.indexOf('-o') + 1]
      if (file === undefined) throw new Error('missing compiler output')
      await writeFile(file, 'fake helper')
      return ''
    }
    if (current === 'self-test')
      return JSON.stringify({
        jobProbe: true,
        query: true,
        power: 'unknown',
        scheduler: 'untested',
      })
    if (current === 'initial-query' || current === 'query') return JSON.stringify(query())
    if (current === 'bootstrap') {
      const plist = args[2]
      if (plist === undefined) throw new Error('missing job plist')
      const config = configSchema.parse(
        JSON.parse(await readFile(path.join(path.dirname(plist), 'request.json'), 'utf8')),
      )
      jobs.set(`${args[1] ?? ''}/${config.label}`, { ...config, ready: false })
      return ''
    }
    if (current === 'count') return '{"active":0}'
    if (current === 'ps') return ''
    const job = jobs.get(args[1] ?? '')
    if (job === undefined) {
      if (current === 'bootout') return ''
      throw new Error('fake launchd job missing')
    }
    if (current === 'bootout') {
      jobs.delete(args[1] ?? '')
      return ''
    }
    if (current === 'ready-print') {
      await writeFile(
        path.join(job.directory, 'ready.json'),
        JSON.stringify({ pid: 2, coalition: 1, query: query(job.label, true) }),
      )
      job.ready = true
    }
    let isActivated = false
    for (const name of ['go', 'stop']) {
      try {
        await access(path.join(job.directory, name))
        isActivated = true
      } catch {
        /* Still held. */
      }
    }
    if (isActivated) {
      await writeFile(
        path.join(job.directory, 'result.json'),
        '{"exitCode":0,"stdout":"","failure":"none"}',
      )
      return 'state = exited\n'
    }
    return 'pid = 2\n'
  }
  const spawn = vi.fn((file: string, args: readonly string[], _options: SpawnOptions) => {
    const current = classify(file, args)
    calls.push(current)
    const shouldFail = isArmed && !isInjected && current === site
    if (shouldFail) {
      isInjected = true
      notify(undefined)
    }
    if (shouldFail && failure.delivery === 'throw')
      throw Object.assign(new Error('injected spawn failure'), { code: failure.code })
    const child = new ChildProcess()
    const stdout = new PassThrough()
    const stderr = new PassThrough()
    // Node may return before creating pipes on EMFILE/ENFILE; the error event
    // must win over absent streams, not turn pressure into a helper refusal.
    child.stdout = shouldFail && failure.delivery === 'error' ? null : stdout
    child.stderr = shouldFail && failure.delivery === 'error' ? null : stderr
    vi.spyOn(child, 'kill').mockImplementation(() => {
      queueMicrotask(() => child.emit('close', null))
      return true
    })
    if (shouldFail) {
      queueMicrotask(() => {
        switch (failure.delivery) {
          case 'error': {
            child.emit(
              'error',
              Object.assign(new Error('injected spawn failure'), { code: failure.code }),
            )
            child.emit('close', -1)

            break
          }
          case 'exit': {
            child.emit('close', 1)
            break
          }
          case 'signal': {
            child.emit('close', null)
            break
          }
          case 'stdout':
          case 'stderr': {
            const stream = failure.delivery === 'stdout' ? stdout : stderr
            stream.write(Buffer.alloc(DEVICE_LIMITS.frameBytes + 1, 'x'))
            break
          }
        }
      })
    } else {
      void output(current, args)
        .then((answer) => {
          stdout.end(answer)
          child.emit('close', 0)
        })
        .catch((error: unknown) => child.emit('error', error))
    }
    return child
  })
  return {
    directory,
    uid: owner.uid,
    spawn,
    calls,
    injected,
    ready: () => {
      phase = 'ready'
      isArmed = true
    },
    disableFailure: () => {
      isArmed = false
    },
    clean: () => rm(directory, { recursive: true, force: true }),
  }
}
