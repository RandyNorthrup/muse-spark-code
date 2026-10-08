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
  'ready-write',
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
  let isRepeatedFailure = false
  let active = 0
  let groups = ''
  let isImmediateProbe = false
  let isBootoutHeld = false
  let isReadyWriteBroken = false
  const printedPids = new Set<string>()
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
    if (jobs.get(args[1] ?? '')?.ready === true) return 'retirement-print'
    return site === 'ready-write' && printedPids.has(args[1] ?? '') ? 'ready-write' : 'ready-print'
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
      jobs.set(`${args[1] ?? ''}/${config.label}`, { ...config, ready: isImmediateProbe })
      if (isImmediateProbe) {
        // Reclamation stress tests need ready/exited jobs, not 328 real poll
        // sleeps. Native cases and the site table retain the full handshake.
        await Promise.all([
          writeFile(
            path.join(config.directory, 'ready.json'),
            JSON.stringify({ pid: 2, coalition: 1, query: query(config.label, true) }),
          ),
          writeFile(
            path.join(config.directory, 'result.json'),
            '{"exitCode":0,"stdout":"","failure":"none"}',
          ),
        ])
      }
      return ''
    }
    if (current === 'count') return JSON.stringify({ active })
    if (current === 'ps') return groups
    const job = jobs.get(args[1] ?? '')
    if (job === undefined) {
      throw Object.assign(new Error('fake launchd job missing'), {
        exitCode: current === 'bootout' ? 3 : 113,
      })
    }
    if (current === 'bootout') {
      if (isBootoutHeld) throw Object.assign(new Error('bootout pressure'), { code: 'ENOMEM' })
      jobs.delete(args[1] ?? '')
      return ''
    }
    if (current === 'ready-print' && isReadyWriteBroken) {
      if (printedPids.has(args[1] ?? '')) return 'state = exited\n'
      printedPids.add(args[1] ?? '')
      return 'pid = 2\n'
    }
    if (current === 'ready-print' && site === 'ready-write' && isArmed) {
      printedPids.add(args[1] ?? '')
      return 'pid = 2\n'
    }
    if (current === 'ready-print' || current === 'ready-write') {
      await writeFile(
        path.join(job.directory, 'ready.json'),
        JSON.stringify({ pid: 2, coalition: 1, query: query(job.label, true) }),
      )
      job.ready = true
    }
    let isActivated = isImmediateProbe
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
    const shouldFail = isArmed && (!isInjected || isRepeatedFailure) && current === site
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
        .catch((error: unknown) => {
          if (typeof error === 'object' && error !== null && 'exitCode' in error)
            child.emit('close', error.exitCode)
          else child.emit('error', error)
        })
    }
    return child
  })
  return {
    directory,
    uid: owner.uid,
    spawn,
    calls,
    jobs,
    injected,
    ready: () => {
      phase = 'ready'
      isArmed = true
    },
    disableFailure: () => {
      isArmed = false
    },
    repeatFailure: () => {
      isArmed = true
      isRepeatedFailure = true
    },
    failReadyWrites: (shouldFail: boolean) => {
      isReadyWriteBroken = shouldFail
    },
    holdBootout: (shouldHold: boolean) => {
      isBootoutHeld = shouldHold
    },
    membership: (count: number, processGroups = '') => {
      active = count
      groups = processGroups
    },
    immediateProbes: () => {
      isImmediateProbe = true
    },
    clean: () => rm(directory, { recursive: true, force: true }),
  }
}
