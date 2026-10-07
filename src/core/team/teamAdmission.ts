// Team admission slots (M96 lane A, PLAN.md D75): per-entry, per-agent,
// per-role, global, process, depth and shell-command slots.
//
// The check and the increment are one synchronous step, so twenty tasks made
// ready at once never pass a cap together inside a window (lane K's race
// drill). Other windows publish advisory hints; only budgets are shared
// through the claim journal.
// No `vscode` here.

import { TEAM_MAX_DEPTH } from '../../shared/constants'
import type { TeamAgentKind } from './teamPool'

/** Which slot refused: each limit refuses with its own reason. */
export type TeamAdmissionReason =
  'entry' | 'agent' | 'role' | 'global' | 'process' | 'depth' | 'shell'

/** Child exit and group shutdown do not prove detached descendants retired. */
export type TeamRetirement =
  'terminal' | 'directChildExited' | 'processGroupEnded' | 'descendantsProvedGone' | 'userContinued'

export type TeamAdmissionResult =
  | { readonly admitted: true; readonly release: (retirement: TeamRetirement) => boolean }
  | { readonly admitted: false; readonly reason: TeamAdmissionReason }

/** Every limit admission reads, resolved by the caller (settings, ceilings, intensity). */
export interface TeamAdmissionLimits {
  /** `museSpark.teamMaxWorkers`: workers at once in this window. */
  readonly globalLimit: number
  /** `museSpark.teamMaxProcessWorkers`: Muse Code and external workers at once. */
  readonly processLimit: number
  /** Engine workers' shell commands at once (`TEAM_MAX_CONCURRENT_COMMANDS`). */
  readonly shellLimit: number
  /** Delegation depth, never more than `TEAM_MAX_DEPTH`. */
  readonly maxDepth: number
  /** Per-agent running caps: each agent's ceiling, lowered where the user did. */
  readonly agentLimit: (agentKey: string) => number
  /** Per-entry `concurrent` caps. */
  readonly entryLimit: (entryId: string) => number
  /** Per-role running caps, from the intensity level (custom roles keep theirs). */
  readonly roleLimit: (roleId: string) => number
}

/** Engine workers' shell commands at once: half the logical CPUs, at least 1 (D75). */
export function teamShellCommandSlots(cpuCount: number): number {
  return Math.max(1, Math.floor(cpuCount / 2))
}

/**
 * The window's slot counters. Selection checks headroom first; admission is
 * the atomic gate at start: one synchronous check-and-increment per task.
 */
export class TeamAdmission {
  private static take(counts: Map<string, number>, key: string): void {
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }

  private static give(counts: Map<string, number>, key: string): void {
    const left = (counts.get(key) ?? 0) - 1
    if (left <= 0) {
      counts.delete(key)
    } else {
      counts.set(key, left)
    }
  }

  private readonly entryRunning = new Map<string, number>()
  private readonly agentRunning = new Map<string, number>()
  private readonly roleRunning = new Map<string, number>()
  private globalRunning = 0
  private processRunning = 0
  private shellRunning = 0

  public constructor(private readonly limits: TeamAdmissionLimits) {}

  /** Running tasks on an entry: what selection reads for headroom. */
  public runningByEntry(entryId: string): number {
    return this.entryRunning.get(entryId) ?? 0
  }

  /** Running tasks on an agent, across every role and conversation in this window. */
  public runningByAgent(agentKey: string): number {
    return this.agentRunning.get(agentKey) ?? 0
  }

  public runningGlobal(): number {
    return this.globalRunning
  }

  public runningProcess(): number {
    return this.processRunning
  }

  /**
   * Starts a task's slot, or refuses with the first slot that has no room.
   * Synchronous: nothing interleaves between the check and the increment.
   */
  public admitTask(task: {
    readonly entryId: string
    readonly agentKey: string
    readonly agentKind: TeamAgentKind
    readonly roleId: string
    /** 1 for the orchestrator's tasks, 2 for a delegating worker's. */
    readonly depth: number
  }): TeamAdmissionResult {
    if (
      !Number.isSafeInteger(task.depth) ||
      task.depth < 1 ||
      task.depth > Math.min(this.limits.maxDepth, TEAM_MAX_DEPTH)
    ) {
      return { admitted: false, reason: 'depth' }
    }
    if (this.globalRunning >= this.limits.globalLimit) {
      return { admitted: false, reason: 'global' }
    }
    if (task.agentKind !== 'engine' && this.processRunning >= this.limits.processLimit) {
      return { admitted: false, reason: 'process' }
    }
    if ((this.roleRunning.get(task.roleId) ?? 0) >= this.limits.roleLimit(task.roleId)) {
      return { admitted: false, reason: 'role' }
    }
    if ((this.agentRunning.get(task.agentKey) ?? 0) >= this.limits.agentLimit(task.agentKey)) {
      return { admitted: false, reason: 'agent' }
    }
    if ((this.entryRunning.get(task.entryId) ?? 0) >= this.limits.entryLimit(task.entryId)) {
      return { admitted: false, reason: 'entry' }
    }
    TeamAdmission.take(this.entryRunning, task.entryId)
    TeamAdmission.take(this.agentRunning, task.agentKey)
    TeamAdmission.take(this.roleRunning, task.roleId)
    this.globalRunning += 1
    if (task.agentKind !== 'engine') {
      this.processRunning += 1
    }
    let isReleased = false
    return {
      admitted: true,
      release: (retirement) => {
        if (isReleased || !canRetire(retirement, task.agentKind === 'engine')) {
          return false
        }
        isReleased = true
        TeamAdmission.give(this.entryRunning, task.entryId)
        TeamAdmission.give(this.agentRunning, task.agentKey)
        TeamAdmission.give(this.roleRunning, task.roleId)
        this.globalRunning -= 1
        if (task.agentKind !== 'engine') {
          this.processRunning -= 1
        }
        return true
      },
    }
  }

  /**
   * One engine shell command's slot. Commands past the limit wait for a
   * slot (lane K); admission here only says whether one is free now.
   */
  public acquireShell(): TeamAdmissionResult {
    if (this.shellRunning >= this.limits.shellLimit) {
      return { admitted: false, reason: 'shell' }
    }
    this.shellRunning += 1
    let isReleased = false
    return {
      admitted: true,
      release: (retirement) => {
        if (isReleased || !canRetire(retirement, false)) {
          return false
        }
        isReleased = true
        this.shellRunning -= 1
        return true
      },
    }
  }
}

function canRetire(retirement: TeamRetirement, isEngine: boolean): boolean {
  return (
    retirement === 'descendantsProvedGone' ||
    retirement === 'userContinued' ||
    (isEngine && retirement === 'terminal')
  )
}
