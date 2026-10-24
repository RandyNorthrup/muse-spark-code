import nodePath from 'node:path'
import { existsSync, realpathSync } from 'node:fs'
import { processGitPath } from '../../../host/git'
import { runTreeSync } from '../../../host/processTree'
import { workspaceChildEnvironment } from '../../execGuard'
import { withoutCredentials } from '../../credentialEnvironment'
import { withoutHostVariables } from '../../hostVariables'
import {
  GIT_OUTPUT_MAX_BYTES,
  GIT_TIMEOUT_MS,
  PLAYBOOK_CONTENT_SIMILARITY_PERCENT,
} from '../../../shared/constants'
import { UI_TEXT } from '../../../shared/l10n/text'
import type { PlaybookHookAdmission } from './outcomes'
import { modulePath } from './modules'

/** Git supplies similarity-based rename evidence even when moved code changed
bytes. Hashes separately cover untracked moves and copies. Never consult an
agent's claim about identity. Both staged and unstaged moves are inspected. */
export function renamedFiles(
  workspace: string,
  admission: PlaybookHookAdmission,
): { from: string; to: string }[] {
  if (!existsSync(nodePath.join(workspace, '.git'))) return []
  // git resolved outside the workspace (links followed): a `git` planted in
  // the repository never runs (D24).
  const git = processGitPath(workspace)
  if (git === undefined) throw new Error(UI_TEXT.playbookUnavailable)
  const renames: { from: string; to: string }[] = []
  for (const args of [['diff', '--cached'], ['diff'], ['log', '--all', '--format=']]) {
    const effect = {
      kind: 'git' as const,
      cwd: workspace,
      command: git,
      args: [
        ...args,
        '--no-ext-diff',
        '--no-textconv',
        '--name-status',
        '-z',
        `--find-renames=${String(PLAYBOOK_CONTENT_SIMILARITY_PERCENT)}%`,
        '--',
      ],
    }
    if (!admission.admit(effect) || (process.platform === 'win32' && !admission.runContained))
      throw new Error(UI_TEXT.playbookUnavailable)
    const options = {
      cwd: workspace,
      // The guarded child PATH for the workspace, so git's own bare-name
      // helpers never run a planting. No editor host variable reaches it
      // either (`core/hostVariables`, the list the shell tools use).
      env: workspaceChildEnvironment(
        process.platform,
        withoutHostVariables(withoutCredentials(process.env), process.platform),
        {
          workspaceRoot: workspace,
          realpath: realpathSync,
        },
      ),
      encoding: 'buffer' as const,
      timeout: GIT_TIMEOUT_MS,
      maxBuffer: GIT_OUTPUT_MAX_BYTES,
      windowsHide: true,
    }
    const result =
      admission.runContained === undefined
        ? runTreeSync(effect.command, effect.args, options)
        : admission.runContained(effect, options)
    if (result.status !== 0 || result.error) throw new Error(UI_TEXT.playbookUnavailable)
    const fields = result.stdout.toString('utf8').split('\0')
    for (let index = 0; index < fields.length - 1; index += 1) {
      const status = (fields[index] ?? '').trim()
      if (!status) continue
      const from = fields[++index]
      if (!from) throw new Error(UI_TEXT.playbookUnavailable)
      if (/^[RC]\d+$/u.test(status)) {
        const to = fields[++index]
        if (!to) throw new Error(UI_TEXT.playbookUnavailable)
        renames.push({ from: modulePath(from), to: modulePath(to) })
      } else if (!/^[ADMTUXB]$/u.test(status)) throw new Error(UI_TEXT.playbookUnavailable)
    }
  }
  return renames
}
