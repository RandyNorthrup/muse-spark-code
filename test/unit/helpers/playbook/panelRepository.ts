// A real git repository and a real journal folder for the panel governor's
// tests (M116, C-M116-6): the policy, its journal, git and the repository's
// own hooks are all the production ones. Only the process runner is a plain
// `spawnSync`, as in playbookPolicyFixture: the Windows job and the POSIX
// supervisor have suites of their own.
import { execFileSync, spawnSync, type SpawnSyncOptions } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  PLAYBOOK_FINDING_CLASSES,
  REVIEW_FINDINGS_LANGUAGE,
} from '../../../../src/shared/constants'
import type { AgentEvent } from '../../../../src/shared/agentEvents'
import type { PlaybookModule, PlaybookWhyNote } from '../../../../src/shared/playbook'
import type { ReviewBlock } from '../../../../src/shared/reviewFindings'
import { withoutCredentials } from '../../../../src/core/credentialEnvironment'
import type {
  PlaybookHookAdmission,
  PlaybookHookEffect,
} from '../../../../src/core/orchestration/playbook/outcomes'
import type { PanelGovernorEvents } from '../../../../src/runtime/playbook/governor'
import { gitWorkspace } from './gitWorkspace'

/**
A counted review is dozens of real git processes, and a governed round
about sixty with the repository's own hooks, each a process tree of its
own; Windows starts each several times slower. No fake stands in for them.

These tests wait on nothing but that work: the governor's are synchronous
calls with no timer in them, and the window's poll for the decision itself
(`eventually`), so this is a ceiling on real work and never a wait.
Measured 2026-10-11: the slowest governed round took 9 s on Linux, 15 s on
Windows, and 80 to 92 s on the Windows rig while a review ran on it beside
the suite (428 s for the file against 59 to 70 s). Twice that worst case.
*/
export const GOVERNED_ROUND_TIMEOUT_MS = 180_000

export const PANEL_FILES = {
  store: 'src/core/schedules/store.ts',
  clock: 'src/core/schedules/clock.ts',
  panel: 'src/webview/panel/view.tsx',
  notes: 'docs/notes.md',
} as const

const gitEnvironment = (): NodeJS.ProcessEnv => ({
  ...withoutCredentials(process.env),
  GIT_AUTHOR_NAME: 'Fixture',
  GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
  GIT_COMMITTER_NAME: 'Fixture',
  GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
})

/** One committed repository, copied for each test that needs its own. */
export function panelRepositoryTemplate(): { readonly directory: string; remove(): void } {
  const directory = mkdtempSync(path.join(tmpdir(), 'm116-panel-template-'))
  const git = (args: string[]) =>
    execFileSync('git', args, { cwd: directory, env: gitEnvironment(), stdio: 'pipe' })
  git(['init', '--initial-branch=main'])
  let line = 0
  for (const file of Object.values(PANEL_FILES)) {
    mkdirSync(path.join(directory, path.dirname(file)), { recursive: true })
    // Unlike content per file: the policy takes like content for moved code.
    line += 1
    writeFileSync(
      path.join(directory, file),
      Array.from(
        { length: 8 },
        (_, index) => `${file} baseline ${String(line)}-${String(index)}`,
      ).join('\n'),
    )
  }
  git(['add', '.'])
  git(['commit', '-m', 'baseline'])
  return {
    directory,
    remove: () => {
      rmSync(directory, { recursive: true, force: true })
    },
  }
}

export interface RecordedPanelEvents extends PanelGovernorEvents {
  readonly notes: { readonly sessionId: string; readonly note: PlaybookWhyNote }[]
  readonly offers: { readonly sessionId: string; readonly module: PlaybookModule }[]
  readonly hookOutputs: string[]
  readonly failures: string[]
}

export function recordedPanelEvents(): RecordedPanelEvents {
  const notes: RecordedPanelEvents['notes'] = []
  const offers: RecordedPanelEvents['offers'] = []
  const hookOutputs: string[] = []
  const failures: string[] = []
  return {
    notes,
    offers,
    hookOutputs,
    failures,
    note: (sessionId, note) => {
      notes.push({ sessionId, note })
    },
    offerRedesign: (sessionId, module) => {
      offers.push({ sessionId, module })
    },
    hookOutput: (_sessionId, output) => {
      hookOutputs.push(output)
    },
    failure: (sessionId) => {
      failures.push(sessionId)
    },
  }
}

/** A copy of the template with its three hooks passing, and a journal folder beside it. */
export function panelRepository(template: string) {
  const root = mkdtempSync(path.join(tmpdir(), 'm116-panel-'))
  const workspace = path.join(root, 'workspace')
  const dataFolder = path.join(root, 'data')
  cpSync(template, workspace, { recursive: true, preserveTimestamps: true })
  const { git, hook } = gitWorkspace(workspace, gitEnvironment())
  for (const name of ['pre-commit', 'commit-msg', 'pre-push']) hook(name, 'exit 0')
  const effects: PlaybookHookEffect[] = []
  const hookAdmission: PlaybookHookAdmission = {
    admit: (effect) => {
      effects.push(effect)
      return true
    },
    runContained: (effect, options: SpawnSyncOptions) =>
      spawnSync(effect.command, [...effect.args], { ...options, encoding: 'buffer' }),
  }
  return {
    root,
    workspace,
    dataFolder,
    git,
    hook,
    hookAdmission,
    /** Every git and hook call the policy asked admission for. */
    effects,
    write: (file: string, content: string) => {
      writeFileSync(path.join(workspace, file), content)
    },
    /** Commits everything, as a child agent's work would. */
    commit: (message: string) => {
      git(['add', '.'])
      git(['commit', '-m', message])
      return git(['rev-parse', 'HEAD'])
    },
    remove: () => {
      rmSync(root, { recursive: true, force: true })
    },
  }
}

export type PanelRepository = ReturnType<typeof panelRepository>

/** A review block that covers every class, as the charter asks. */
export function coveredReview(
  findings: ReviewBlock['findings'],
  resolution?: ReviewBlock['resolution'],
): ReviewBlock {
  return {
    findings,
    coverage: [...PLAYBOOK_FINDING_CLASSES],
    ...(resolution !== undefined && { resolution }),
  }
}

/** The reviewer's finished reply holding `block`, as the session reports it. */
export function reviewReply(turnId: string, block: ReviewBlock | string): AgentEvent {
  return {
    type: 'itemCompleted',
    item: {
      itemId: `${turnId}-reply`,
      turnId,
      kind: 'agentMessage',
      status: 'completed',
      text: `Summary first.\n\n\`\`\`${REVIEW_FINDINGS_LANGUAGE}\n${typeof block === 'string' ? block : JSON.stringify(block)}\n\`\`\``,
    },
  }
}

export function turnEnd(turnId: string, terminal = 'completed'): AgentEvent {
  return { type: 'turnCompleted', turnId, terminal }
}
