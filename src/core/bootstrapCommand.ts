// A client of the lazy facade, like any other governed command: the launcher
// and its policy stay in the first-use resourceGovernor bundle, so this runner
// may ride in every bundle that builds a helper.
import { spawnResourceProcess } from './resources/launcher'
import { CLI_OUTPUT_MAX_BYTES, PROCESS_TABLE_TIMEOUT_MS } from '../shared/constants'

/**
 * Bootstrap tier: the compiler builds the containment helper it cannot yet use.
 * A failure always names its exit code, signal and whether it was stopped;
 * `isOutputReported` adds the bounded stdout and stderr (csc writes its
 * diagnostics to stdout), for callers whose output is public, like compilers.
 */
export async function runBootstrap(
  file: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv,
  options: {
    signal?: AbortSignal
    input?: string
    cwd?: string
    timeoutMs?: number
    isOutputReported?: boolean
  } = {},
): Promise<string> {
  const deadline = AbortSignal.timeout(options.timeoutMs ?? PROCESS_TABLE_TIMEOUT_MS)
  const signal =
    options.signal === undefined ? deadline : AbortSignal.any([options.signal, deadline])
  const { child: root, stop: stopTree } = await spawnResourceProcess('bootstrap', file, args, {
    env,
    cwd: options.cwd,
    signal,
  })
  return await new Promise<string>((resolve, reject) => {
    const output: Buffer[] = []
    const errors: Buffer[] = []
    let size = 0
    let isFailed = false
    let isOutputTooLarge = false
    let stopping: Promise<void> | undefined
    const stop = () => {
      isFailed = true
      stopping ??= stopTree()
      void stopping.catch(reject)
    }
    signal.addEventListener('abort', stop, { once: true })
    if (signal.aborted) stop()
    const read = (bytes: Buffer, kept: Buffer[] | undefined) => {
      size += bytes.length
      if (size > CLI_OUTPUT_MAX_BYTES) {
        isOutputTooLarge = true
        stop()
      } else kept?.push(bytes)
    }
    root.stdout.on('data', (bytes: Buffer) => {
      read(bytes, output)
    })
    root.stderr.on('data', (bytes: Buffer) => {
      read(bytes, options.isOutputReported === true ? errors : undefined)
    })
    root.stdin.on('error', stop)
    root.once('error', stop)
    root.once('close', (code, exitSignal) => {
      signal.removeEventListener('abort', stop)
      void (async () => {
        await stopping
        if (isFailed || code !== 0) {
          const metadata = `code=${String(code)}, killed=${String(isFailed)}, signal=${String(exitSignal)}`
          const detail =
            options.isOutputReported === true
              ? `\n${Buffer.concat(output).toString('utf8')}${Buffer.concat(errors).toString('utf8')}`
              : ''
          throw Object.assign(new Error(`Bootstrap command failed (${metadata})${detail}`), {
            code: isOutputTooLarge ? 'outputLimit' : 'commandFailed',
          })
        }
        return Buffer.concat(output).toString('utf8')
      })()
        .then(resolve)
        .catch(reject)
    })
    root.stdin.end(options.input)
  })
}
