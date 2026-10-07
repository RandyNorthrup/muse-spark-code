// The git facts for the Model API prompt's environment section (PLAN.md
// D15): branch, how many entries `git status` lists and the latest commit
// subjects, gathered once per session. Metadata only, never file contents.
// Never rejects: outside a repository, without git, or in a repository with
// no commit yet the section says so instead. Not in Restricted Mode (D24):
// git reads the repository's own `.git/config`, and `core.fsmonitor` or
// `core.hooksPath` there would run a program the workspace chose.

import {
  RecordingScope,
  recordProjection,
  type ContentRead,
} from '../../core/context/recordingReader'
import { contentHash } from '../../core/schedules/provenance'
import type { EnvironmentFacts } from '../../core/backends/modelapi/instructions'
import { ENVIRONMENT_RECENT_COMMITS, UI_TEXT } from '../../shared/constants'
import { failureForLog } from '../../core/backends/musecode/logText'
import { metadataGit } from '../git'
import type { Logger } from '../logger'

export interface EnvironmentDeps {
  readonly runGit: (args: readonly string[], cwd: string) => Promise<string>
  readonly workspaceRoot: string | undefined
  readonly isWorkspaceTrusted: () => boolean
  readonly log: Logger
  readonly now: () => number
}

const LINE_BREAK = /\r?\n/

function nonEmptyLines(text: string): readonly string[] {
  return text.split(LINE_BREAK).filter((line) => line.trim() !== '')
}

async function recentCommits(
  run: (args: readonly string[]) => Promise<string>,
): Promise<readonly string[]> {
  try {
    return nonEmptyLines(await run(['log', '--oneline', `-${String(ENVIRONMENT_RECENT_COMMITS)}`]))
  } catch {
    // A repository before its first commit has a branch but no log.
    return []
  }
}

export async function describeEnvironment(deps: EnvironmentDeps): Promise<EnvironmentFacts> {
  const root = deps.workspaceRoot
  if (root === undefined || !deps.isWorkspaceTrusted()) {
    return { git: undefined }
  }
  const startedAt = deps.now()
  try {
    const inputs: ContentRead[] = []
    const value = await (async () => {
      const git = await metadataGit(async (args, cwd) => {
        const bytes = await deps.runGit(args, cwd)
        inputs.push({
          bytes,
          source: {
            kind: 'git',
            root: cwd,
            args,
            contentHash: contentHash(bytes),
          },
        })
        return bytes
      }, root)
      const run = async (args: readonly string[]) => {
        if (!deps.isWorkspaceTrusted()) {
          throw new Error(UI_TEXT.checkpointFailed)
        }
        return await git(args)
      }
      // Together, not one after another (M39): each may take up to git's own
      // timeout, and the first Model API turn waits for them.
      const [branchText, status, commits] = await Promise.all([
        run(['rev-parse', '--abbrev-ref', 'HEAD']),
        run(['status', '--porcelain']),
        recentCommits(run),
      ])
      return {
        branch: branchText.trim(),
        changedFiles: nonEmptyLines(status).length,
        recentCommits: commits,
      }
    })()
    const recorded = RecordingScope.build(recordProjection, { inputs, project: () => value })
    deps.log.trace(`Git facts for the prompt in ${String(deps.now() - startedAt)} ms`)
    return {
      git: recorded.value,
      recording: recorded.scope,
    }
  } catch (error: unknown) {
    // Outside a repository, without git, or git timing out: the log says
    // which (M39); the prompt only says there are no git facts.
    const reason = failureForLog(error)
    deps.log.info(`No git facts for the prompt: ${reason}`)
    return { git: undefined }
  }
}
