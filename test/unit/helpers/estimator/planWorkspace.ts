// A real plan workspace for snapshot-source tests: a temp root holding a
// real PLAN.md and a real git repository. Reads run through the real
// filesystem and the machine's own git binary; only `gh` has no real
// positive path offline, so cases supply their own runGh (the honest empty
// answer, or malformed bytes asserting refusal) while readPlanFile and
// runGit stay real.

import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { PlanSnapshotSourceIo } from '../../../../src/host/estimator/planSnapshotSource'

export interface PlanWorkspace {
  readonly root: string
  readonly io: PlanSnapshotSourceIo
  readonly git: (args: readonly string[]) => Promise<string>
  readonly cleanup: () => Promise<void>
}

function runGitIn(root: string) {
  return (args: readonly string[], signal?: AbortSignal): Promise<string> =>
    new Promise((resolve, reject) => {
      execFile(
        'git',
        [...args],
        { cwd: root, encoding: 'utf8', ...(signal !== undefined && { signal }) },
        (error, stdout, stderr) => {
          if (error === null) resolve(stdout)
          else reject(new Error(`git ${args.join(' ')} failed: ${stderr || error.message}`))
        },
      )
    })
}

/** A real repository shaped like the M112 workspace: lane 0 merged into the
 * origin default, lane Q still open. All state is real git objects; the
 * origin refs are crafted locally (no network), as forged store files are
 * crafted elsewhere. */
export async function m112Repo(git: (args: readonly string[]) => Promise<string>): Promise<void> {
  await git(['branch', '-M', 'main'])
  await git(['branch', 'm112/0', 'main'])
  await git(['checkout', '-b', 'm112/q'])
  await git(['commit', '--allow-empty', '-m', 'q work'])
  await git(['update-ref', 'refs/remotes/origin/main', 'main'])
  await git(['symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main'])
}

export async function planWorkspace(
  plan: string,
  init?: (git: (args: readonly string[]) => Promise<string>, root: string) => Promise<void>,
  options: { repo?: boolean } = {},
): Promise<PlanWorkspace> {
  const root = await mkdtemp(path.join(tmpdir(), 'm117-plan-'))
  await writeFile(path.join(root, 'PLAN.md'), plan)
  const git = runGitIn(root)
  if (options.repo ?? true) {
    await git(['init'])
    await git(['config', 'user.email', 'vector@example.com'])
    await git(['config', 'user.name', 'vector'])
    await git(['commit', '--allow-empty', '-m', 'init'])
  }
  if (init !== undefined) await init(git, root)
  const readPlanFile = (file: string, signal?: AbortSignal): Promise<string> =>
    readFile(file, signal === undefined ? 'utf8' : { encoding: 'utf8', signal })
  return {
    root,
    io: {
      readPlanFile,
      runGit: git,
      runGh: () => Promise.reject(new Error('no gh on a plan workspace')),
    },
    git,
    cleanup: () => rm(root, { recursive: true, force: true }),
  }
}
