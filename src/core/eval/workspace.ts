// One M75 task's folders (PLAN.md D49): a fresh folder under the system's
// temporary folder per task and arm, holding the workspace (the fixture
// files, nothing else) and, beside it, the verifier the model never sees.
// The verifier runs as its own Node process with an empty environment, so
// nothing from the run's environment (the Model API key above all) reaches
// the code the model wrote.

import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
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
import { EVAL_VERIFY_PRELUDE, isEvalPath, type EvalTask } from './tasks'

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
 * A fresh folder under `parent` (the system's temporary folder) holding the
 * task's fixture files, and nothing else.
 */
export async function createEvalWorkspace(task: EvalTask, parent = tmpdir()): Promise<EvalFolders> {
  // The canonical path: the host confines the tools to it (D24), and on
  // macOS the temporary folder is reached through a link.
  const root = await realpath(await mkdtemp(path.join(parent, EVAL_TEMP_PREFIX)))
  const workspace = path.join(root, EVAL_WORKSPACE_DIR)
  try {
    await mkdir(workspace)
    for (const file of task.files) {
      if (!isEvalPath(file.path)) {
        throw new Error(`the fixture path ${file.path} leaves the workspace`)
      }
      const target = path.join(workspace, ...file.path.split('/'))
      await mkdir(path.dirname(target), { recursive: true })
      await writeFile(target, file.content)
    }
  } catch (error: unknown) {
    await removeEvalWorkspace(root)
    throw error
  }
  return { root, workspace }
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
  await writeFile(script, `${EVAL_VERIFY_PRELUDE}${task.verify}\n`)
  return await new Promise<EvalVerdict>((resolve) => {
    execFile(
      process.execPath,
      [script, folders.workspace],
      // An empty environment. On Windows, libuv adds back only what a
      // process needs to start (PATH, SYSTEMROOT, TEMP, the profile's
      // folders), never a variable of the run's own.
      { cwd: folder, env: {}, timeout: timeoutMs, windowsHide: true },
      (error, stdout, stderr) => {
        if (error === null) {
          resolve({ passed: true, detail: '' })
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
  })
}
