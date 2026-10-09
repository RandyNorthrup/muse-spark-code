// A client of the lazy facade, like any other governed command: the launcher
// and its policy stay in the first-use resourceGovernor bundle, so this runner
// may ride in every bundle that builds a helper.
import { spawnResourceProcess } from './resources/admission'
import { CLI_OUTPUT_MAX_BYTES, PROCESS_TABLE_TIMEOUT_MS } from '../shared/constants'

/** Bootstrap tier: the compiler builds the containment helper it cannot yet use. */
export async function runBootstrap(
  file: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv,
  options: { signal?: AbortSignal; input?: string; cwd?: string; timeoutMs?: number } = {},
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
    const read = (bytes: Buffer, shouldKeep: boolean) => {
      size += bytes.length
      if (size > CLI_OUTPUT_MAX_BYTES) {
        isOutputTooLarge = true
        stop()
      } else if (shouldKeep) output.push(bytes)
    }
    root.stdout.on('data', (bytes: Buffer) => {
      read(bytes, true)
    })
    root.stderr.on('data', (bytes: Buffer) => {
      read(bytes, false)
    })
    root.stdin.on('error', stop)
    root.once('error', stop)
    root.once('close', (code) => {
      signal.removeEventListener('abort', stop)
      void (async () => {
        await stopping
        if (isFailed || code !== 0) {
          throw Object.assign(new Error('Bootstrap command failed'), {
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
