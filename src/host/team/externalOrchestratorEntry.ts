// The external orchestrator bundle (`dist/externalOrchestrator.js`,
// PLAN.md D250): loaded only when a conversation's stored orchestrator is
// an external ACP agent, so activation and single-lead conversations never
// carry the ACP client (D6). The factory installs the caller's language
// table, finds the agent's command, and hands back its host.

import { statSync } from 'node:fs'
import path from 'node:path'
import { setUiText } from '../../shared/l10n/text'
import type { UiText } from '../../shared/l10n/en'
import { fill } from '../../shared/l10n/text'
import { UI_TEXT } from '../../shared/constants'
import type { ExternalAgent } from '../../core/team/externalAgents'
import { ExternalOrchestratorHost, type ExternalOrchestratorDeps } from './externalOrchestrator'
import { findAcpPresetCommand } from './acpProcess'

/** What the extension supplies: the pick, and this window's own facts (the host resolves the command). */
export type ExternalOrchestratorEntryDeps = Omit<ExternalOrchestratorDeps, 'command'>

function isMissingCandidate(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    (error.code === 'ENOENT' || error.code === 'ENOTDIR')
  )
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile()
  } catch (error: unknown) {
    // A missing candidate is "not this one"; any other failure keeps its kind.
    if (isMissingCandidate(error)) return false
    throw error
  }
}

/** The agent's executable: on the PATH, or the command itself as a file. */
function resolveCommand(
  agent: ExternalAgent,
  platform: NodeJS.Platform,
  baseEnv: NodeJS.ProcessEnv,
): string | undefined {
  const pathEntries = (baseEnv['PATH'] ?? '').split(path.delimiter)
  return (
    findAcpPresetCommand(agent, platform, pathEntries, isFile) ??
    (isFile(agent.command) ? agent.command : undefined)
  )
}

/** Whether the offers may show this agent at all: its command exists here. */
export function isExternalAgentInstalled(
  agent: ExternalAgent,
  platform: NodeJS.Platform,
  baseEnv: NodeJS.ProcessEnv,
): boolean {
  return resolveCommand(agent, platform, baseEnv) !== undefined
}

/**
The picked agent's host. A command not found on the PATH refuses here in
words (teamExternalNotInstalled), before any conversation starts.
*/
export function createExternalOrchestrator(
  table: UiText,
  locale: string,
  deps: ExternalOrchestratorEntryDeps,
): ExternalOrchestratorHost {
  setUiText(table, locale)
  const command = resolveCommand(deps.agent, deps.platform, deps.baseEnv)
  if (command === undefined)
    throw new Error(
      fill(UI_TEXT.teamExternalNotInstalled, {
        agent: deps.agent.label,
        command: deps.agent.command,
      }),
    )
  const { agent, bridge, log, platform, baseEnv, newId, now } = deps
  return new ExternalOrchestratorHost({
    agent,
    command,
    bridge,
    log,
    platform,
    baseEnv,
    newId,
    now,
  })
}
