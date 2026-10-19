// One M75 task's folders (PLAN.md D49): a fresh folder under the system's
// temporary folder per task and arm, holding the workspace (the fixture
// files, nothing else) and, beside it, the verifier the model never sees.
// The verifier runs as its own Node process with none of the run's
// environment (the Model API key above all), so nothing from it reaches the
// code the model wrote; the guard's own safety variables still apply.

import { randomUUID } from 'node:crypto'
import * as z from 'zod/mini'
import path from 'node:path'
import {
  EVAL_REMOVE_RETRIES,
  EVAL_REMOVE_RETRY_DELAY_MS,
  EVAL_ROOT_MASK,
  EVAL_TEMP_PREFIX,
  EVAL_VERIFY_DETAIL_MAX_CHARS,
  EVAL_VERIFY_PREFIX,
  EVAL_VERIFY_FILE,
  EVAL_VERIFY_TIMEOUT_MS,
  EVAL_WORKSPACE_DIR,
} from '../../shared/constants'
import { noWorkspaceChildEnvironment } from '../execGuard'
import { realpathSync } from 'node:fs'
import { mkdir, mkdtemp, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'
import { EVAL_VERIFY_PRELUDE, isEvalPath, type EvalTask } from './tasks'
import { wireWordForLog } from '../logging'
import { execFileGuarded } from '../guardedChildProcess'

export interface EvalFolders {
  /** The task's own temporary folder; removing it removes everything. */
  readonly root: string
  /** The workspace the turn runs in. */
  readonly workspace: string
}

export interface EvalVerdict {
  readonly passed: boolean
  /** Why it failed: the end of the verifier's output, stack frames left out. */
  readonly detail: string
}

/**
A fresh folder under `parent` (the system's temporary folder) holding the
task's fixture files, and nothing else.
*/
export async function createEvalWorkspace(task: EvalTask, parent = tmpdir()): Promise<EvalFolders> {
  // The canonical path: the host confines the tools to it (D24), and on
  // macOS the temporary folder is reached through a link.
  let root: string | undefined
  try {
    root = await mkdtemp(path.join(parent, EVAL_TEMP_PREFIX))
    root = await realpath(root)
    const workspace = path.join(root, EVAL_WORKSPACE_DIR)
    await mkdir(workspace)
    for (const file of task.files) {
      if (!isEvalPath(file.path)) {
        throw new Error('the fixture path leaves the workspace')
      }
      const target = path.join(workspace, ...file.path.split('/'))
      await mkdir(path.dirname(target), { recursive: true })
      await writeFile(target, file.content)
    }
    return { root, workspace }
  } catch (error: unknown) {
    if (root !== undefined) await removeEvalWorkspace(root)
    throw error
  }
}

/** Before a folder is returned, error messages cannot be safely masked by its root. */
export function evalWorkspaceFailureForReport(error: unknown): string {
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string'
  )
    return wireWordForLog(error.code)
  return error instanceof Error ? wireWordForLog(error.name) : 'an unknown failure'
}

/** A workspace's files, relative with forward slashes (the tools' `listFiles`). */
export async function listWorkspaceFiles(workspace: string): Promise<readonly string[]> {
  const entries = await readdir(workspace, { recursive: true, withFileTypes: true })
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) =>
      path.relative(workspace, path.join(entry.parentPath, entry.name)).split(path.sep).join('/'),
    )
}

export function removeEvalWorkspace(root: string): Promise<void> {
  return rm(root, {
    recursive: true,
    force: true,
    maxRetries: EVAL_REMOVE_RETRIES,
    retryDelay: EVAL_REMOVE_RETRY_DELAY_MS,
  })
}

/** The failure's text: no stack frames, no temporary path, bounded. */
function detailOf(output: string, root: string): string {
  const rootUrl = pathToFileURL(root).href
  const lines = output
    .replaceAll(rootUrl, () => EVAL_ROOT_MASK)
    .replaceAll(root, () => EVAL_ROOT_MASK)
    .split(/\r?\n/u)
    .filter((line) => !line.trimStart().startsWith('at ') && line.trim() !== '')
  return lines.join('\n').slice(-EVAL_VERIFY_DETAIL_MAX_CHARS)
}

const completionSchema = z.strictObject({ token: z.string(), assertions: z.number() })

/** Runs the task's verifier over the workspace as it is now. */
export async function runEvalVerifier(
  task: EvalTask,
  folders: EvalFolders,
  timeoutMs = EVAL_VERIFY_TIMEOUT_MS,
): Promise<EvalVerdict> {
  // A fresh folder of its own: whatever a shell command left beside the
  // workspace cannot be in it or stand in its way.
  const folder = await mkdtemp(path.join(folders.root, EVAL_VERIFY_PREFIX))
  const script = path.join(folder, EVAL_VERIFY_FILE)
  const token = randomUUID()
  await writeFile(script, `${EVAL_VERIFY_PRELUDE}${task.verify}\ncomplete()\n`)
  return await new Promise<EvalVerdict>((resolve) => {
    const child = execFileGuarded(
      process.execPath,
      [script, folders.workspace],
      // No variable of the run's own. On Windows, libuv adds back only
      // what a process needs to start (PATH, SYSTEMROOT, TEMP, the
      // profile's folders), and the guard sets its own
      // `NoDefaultCurrentDirectoryInExePath` (the verifier runs
      // model-written files, so its own bare-name lookups skip its
      // working directory too).
      {
        cwd: folder,
        env: noWorkspaceChildEnvironment(process.platform, {}, realpathSync),
        timeout: timeoutMs,
        killSignal: 'SIGKILL',
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        if (error === null) {
          const hasFinished = stdout.split(/\r?\n/u).some((line) => {
            let value: unknown
            try {
              value = JSON.parse(line)
            } catch {
              return false
            }
            const report = completionSchema.safeParse(value).data
            return report?.token === token && report.assertions === task.assertions
          })
          resolve({
            passed: hasFinished,
            detail: hasFinished
              ? ''
              : 'the verifier exited without completing its declared assertions',
          })
          return
        }
        if (error.killed === true) {
          const late = `the verifier did not finish within ${String(timeoutMs)} ms`
          resolve({ passed: false, detail: late })
          return
        }
        // The assertion is on stderr; what the model's code printed to
        // stdout is the fallback, so it can never crowd the assertion out.
        const failure = detailOf(stderr, folders.root)
        const printed = detailOf(stdout, folders.root)
        const silent = `the verifier exited with code ${String(error.code)} and no output`
        resolve({ passed: false, detail: failure || printed || silent })
      },
    )
    // execFile provides a private stdin pipe, closed before solution imports.
    child.stdin?.end(token)
  })
}
