import { fork, type ChildProcess } from 'node:child_process'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { build, type Plugin } from 'esbuild'

export async function bundleScheduleWorker(
  entryPoint: string,
  outfile: string,
  plugins: Plugin[] = [],
): Promise<void> {
  await build({
    entryPoints: [entryPoint],
    outfile,
    bundle: true,
    format: 'cjs',
    platform: 'node',
    target: 'node22',
    logLevel: 'silent',
    plugins,
  })
}

export interface ScheduleForkWorker {
  child: ChildProcess
  exit: Promise<number | null>
}

export function forkScheduleWorker(worker: string, args: string[]): ScheduleForkWorker {
  const child = fork(worker, args, {
    silent: true,
    env: { SystemRoot: process.env['SystemRoot'], TMPDIR: tmpdir() },
  })
  const exit = new Promise<number | null>((resolve) => child.once('exit', resolve))
  return { child, exit }
}

export interface QueuedScheduleWorker<Message> extends ScheduleForkWorker {
  next: () => Promise<Message>
}

export function queueForkWorkerMessages<Message>(
  worker: ScheduleForkWorker,
  parse: (input: unknown) => Message,
  exitMessage: string,
): QueuedScheduleWorker<Message> {
  const messages: Message[] = []
  const waiters: ReturnType<typeof Promise.withResolvers<Message>>[] = []
  let stderr = ''
  worker.child.stderr?.on('data', (chunk: Buffer) => {
    stderr += chunk.toString()
  })
  worker.child.on('exit', () => {
    for (const waiter of waiters) waiter.reject(new Error(`${exitMessage}: ${stderr}`))
  })
  worker.child.on('message', (input: unknown) => {
    const parsed = parse(input)
    const waiter = waiters.shift()
    if (waiter === undefined) messages.push(parsed)
    else waiter.resolve(parsed)
  })
  return {
    ...worker,
    next: () => {
      const queued = messages.shift()
      if (queued !== undefined) return Promise.resolve(queued)
      const waiter = Promise.withResolvers<Message>()
      waiters.push(waiter)
      return waiter.promise
    },
  }
}

export async function stopForkWorkers(
  children: ChildProcess[],
  exits: Iterable<Promise<number | null>>,
  root: string,
): Promise<void> {
  for (const child of children)
    if (child.exitCode === null && child.signalCode === null) child.kill()
  await Promise.all(exits)
  await rm(root, { recursive: true, force: true })
}
