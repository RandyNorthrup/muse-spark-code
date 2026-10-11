// The shape every best-of-N and session-board suite's fake AgentHost shares
// (M77): the trivial members live here once, suites add their sessions,
// starts and counts. The manager-config tail and the run's final update get
// the same treatment.

import { expect, vi } from 'vitest'
import type {
  AgentHost,
  AgentSession,
  HostInfo,
  ListSessionsOptions,
  SessionPage,
  StartSessionOptions,
} from '../../../src/core/agent/agentBackend'
import type { BestOfNManagerDeps } from '../../../src/host/bestOfN/bestOfNManager'
import type { Logger } from '../../../src/host/logger'
import type { BestOfNRun } from '../../../src/shared/bestOfN'
import { BestOfNCoordinator } from '../../../src/core/bestOfN/bestOfNCoordinator'
import { FAKE_MODEL_API_ACCOUNT_ID } from './fakeModelApi'

function unscripted(name: string): () => Promise<never> {
  return () => Promise.reject(new Error(`${name} is not scripted`))
}

function returnedVoid(): void {
  // The fake below unsubscribes with no work to do.
}

/** Awaits the last update with the exact status a suite is exercising. */
export async function awaitRunStatus(
  updates: readonly BestOfNRun[],
  status: BestOfNRun['status'],
): Promise<void> {
  await vi.waitFor(() => {
    expect(updates.at(-1)?.status).toBe(status)
  })
}

/** Awaits a best-of-N run's final update. */
export async function awaitCompletedRun(updates: readonly BestOfNRun[]): Promise<void> {
  await vi.waitFor(() => {
    expect(updates.at(-1)?.status).toBe('completed')
  })
}

export function bestOfNObjectOutput(args: readonly string[]): string {
  if (args.includes('--absolute-git-dir')) return '/repo/app/.git'
  return args.includes('rev-parse') || args.includes('write-tree') ? 'a'.repeat(40) : ''
}

/** Existing command assertions remain about the Git subcommand, after owned location flags. */
export function bestOfNCommandArgs(args: readonly string[]): readonly string[] {
  return args.filter((arg) => !arg.startsWith('--git-dir=') && !arg.startsWith('--work-tree='))
}

/** The manager-config tail the best-of-N suites share. */
export function bestOfNManagerBase(
  updates: BestOfNRun[],
  log: Logger,
): Pick<
  BestOfNManagerDeps,
  | 'modelId'
  | 'wireApprovalMode'
  | 'isTrusted'
  | 'realPath'
  | 'onUpdate'
  | 'log'
  | 'coordinator'
  | 'getAccountId'
  | 'hasDirtyEditors'
  | 'contextId'
  | 'newRunId'
  | 'openWorktree'
> {
  return {
    coordinator: new BestOfNCoordinator(),
    openWorktree: () => Promise.resolve(),
    getAccountId: () => Promise.resolve(FAKE_MODEL_API_ACCOUNT_ID),
    hasDirtyEditors: () => false,
    contextId: () => 'conversation-1',
    newRunId: () => `bon-${(1_000_000).toString(36)}-1`,
    modelId: () => 'muse-spark-1.3',
    wireApprovalMode: () => 'onRequest',
    isTrusted: () => true,
    realPath: (absolutePath: string) => Promise.resolve(absolutePath),
    onUpdate: (run) => {
      updates.push(run)
    },
    log,
  }
}

/**
 * A fake AgentHost's trivial members. Suites add their sessions (through
 * `startSession` and `listSessions`), their count and their close.
 */
export abstract class FakeAgentHost implements AgentHost {
  public readonly info: HostInfo = {
    kind: 'modelApi',
    serverName: 'fake',
    serverVersion: '0',
    grantedCapabilities: [],
    canEditSessions: true,
  }
  public readSession = unscripted('readSession')
  public readSessionOutput = unscripted('readSessionOutput')
  public resumeSession = unscripted('resumeSession')
  public forkSession = unscripted('forkSession')

  public abstract startSession(options: StartSessionOptions): Promise<AgentSession>
  public abstract listSessions(options: ListSessionsOptions): Promise<SessionPage>
  public abstract get sessionCount(): number
  public abstract close(): Promise<void>

  public onExit(): () => void {
    return returnedVoid
  }

  public listModels(): Promise<[]> {
    return Promise.resolve([])
  }

  public onSessionListEvent(): () => void {
    return returnedVoid
  }

  public readUsage(): Promise<undefined> {
    return Promise.resolve(undefined)
  }

  public onUsageChanged(): () => void {
    return returnedVoid
  }
}
