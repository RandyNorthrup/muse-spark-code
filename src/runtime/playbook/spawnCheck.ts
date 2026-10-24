// The headless check spawn (M116, PLAN.md D213): one shell line in the
// workspace, its output straight to the person's terminal, killed as a
// tree on the check's own time cap. The interpreter resolves outside the
// workspace (a planted shell there never runs) and the child's PATH
// cannot resolve into the workspace either. Throws only before the
// spawn; everything after answers through the result.
import { workspaceChildEnvironment } from '../../core/execGuard'
import { spawnGuarded } from '../../core/guardedChildProcess'
import { callerStop } from '../../core/timeouts'
import { shellArguments, shellInterpreter } from '../../host/backend/toolIo'
import { killTree, treeSpawnOptions } from '../../host/processTree'
import { CLI_EXIT } from '../../shared/constants'

export interface SpawnCheckDeps {
  readonly platform: NodeJS.Platform
  /** `%SystemRoot%`; undefined off Windows. */
  readonly systemRoot: string | undefined
  readonly workspaceRoot: string
  readonly env: NodeJS.ProcessEnv
  readonly fileExists: (filePath: string) => boolean
  readonly realpath: (filePath: string) => string
  readonly log: (message: string) => void
}

/**
Windows PowerShell reports a `-Command`'s last statement, so a native check
that exits 3 would come back as PowerShell's 1. `$?` is read first, before
any statement can reset it (probed on Windows PowerShell 5.1: read after an
assignment it is always true), then `$LASTEXITCODE`: a success stays 0, a
native failure keeps its own code, and anything else fails as 1. Output is
untouched. bash already exits with the check's code.
*/
const POWERSHELL_EXIT_TRAILER =
  '; $__checkOk=$?; $__checkCode=$LASTEXITCODE; $__checkExit=1; if ($__checkCode) { $__checkExit=$__checkCode }; if ($__checkOk) { exit 0 } else { exit $__checkExit }'

export type SpawnCheckResult =
  | { readonly ok: true; readonly code: number }
  | { readonly ok: false; readonly reason: 'timeout' | 'unavailable' }

export function spawnCheckLine(
  line: string,
  timeoutMs: number,
  deps: SpawnCheckDeps,
): Promise<SpawnCheckResult> {
  const interpreter = shellInterpreter(deps.platform, deps.systemRoot, deps.env, deps.fileExists, {
    workspaceRoot: deps.workspaceRoot,
    realpath: deps.realpath,
  })
  if (interpreter === undefined) {
    deps.log('no shell interpreter outside the workspace')
    return Promise.resolve({ ok: false, reason: 'unavailable' })
  }
  const startedAt = Date.now()
  const stop = callerStop(undefined, timeoutMs)
  const command = deps.platform === 'win32' ? `${line}${POWERSHELL_EXIT_TRAILER}` : line
  const child = spawnGuarded(interpreter, shellArguments(deps.platform, command), {
    cwd: deps.workspaceRoot,
    env: workspaceChildEnvironment(deps.platform, deps.env, {
      workspaceRoot: deps.workspaceRoot,
      realpath: deps.realpath,
    }),
    stdio: 'inherit',
    ...treeSpawnOptions(deps.platform),
  })
  return new Promise<SpawnCheckResult>((resolve) => {
    let isSettled = false
    let isTimedOut = false
    const finish = (result: SpawnCheckResult): void => {
      if (isSettled) return
      isSettled = true
      if (stop !== undefined) stop.removeEventListener('abort', onTimeout)
      resolve(result)
    }
    // Best-effort tree teardown: the outcome is the timeout either way,
    // and both landings settle so a failed teardown never rejects unhandled.
    const timedOut = (): void => {
      finish({ ok: false, reason: 'timeout' })
    }
    const onTimeout = (): void => {
      isTimedOut = true
      void killTree(
        child,
        { platform: deps.platform, systemRoot: deps.systemRoot, log: deps.log },
        startedAt,
      )
        .then(timedOut)
        .catch(timedOut)
    }
    stop?.addEventListener('abort', onTimeout, { once: true })
    if (stop?.aborted === true) onTimeout()
    child.on('error', () => {
      if (isTimedOut) return
      deps.log('the check could not start')
      finish({ ok: false, reason: 'unavailable' })
    })
    child.on('exit', (code) => {
      // Past the timeout the exit belongs to the teardown: only its
      // landing answers, once the tree is confirmed gone.
      if (!isTimedOut) finish({ ok: true, code: code ?? CLI_EXIT.failure })
    })
  })
}
