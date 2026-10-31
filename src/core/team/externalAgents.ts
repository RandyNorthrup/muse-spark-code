// External ACP agents the orchestrator slot and the pools offer (D250,
// amending D75): the five presets and any agent the person added by command
// (`museSpark.teamExternalAgents`). Pure launch facts only — which command
// starts the agent, which command the person signs in with, and who pays.
// This module is a leaf on purpose: the panel's offers read it without
// carrying the worker runners. Starting the agent, finding it on the PATH
// and speaking ACP to it live in the host; no credential file is ever read
// here.

import type { TeamAgentPays, TeamAgentRef } from '../../shared/team'
import { teamExternalAgentSettingSchema } from '../../shared/externalAgentSetting'

/** An external agent preset (D75's list, D250's offers). */
export type ExternalPresetId = 'claude' | 'codex' | 'gemini' | 'copilot' | 'own'

/**
The presets' launch facts: the command the host finds on the PATH and the
arguments it starts with (lane W's captured table, research §4.6), the
vendor's own name, and the agent's own CLI the person signs in with.
Claude's adapter starts with `--hide-claude-auth`, so its sign-in stays
Claude Code's own `claude`.
*/
export const EXTERNAL_PRESET_LAUNCH: Readonly<
  Record<
    ExternalPresetId,
    {
      readonly command: string
      readonly defaultArgs: readonly string[]
      readonly label: string
      readonly signInCommand: string
    }
  >
> = {
  claude: {
    command: 'claude-agent-acp',
    defaultArgs: ['--hide-claude-auth'],
    label: 'Claude Code',
    signInCommand: 'claude',
  },
  codex: { command: 'codex-acp', defaultArgs: [], label: 'Codex', signInCommand: 'codex' },
  gemini: {
    command: 'gemini',
    defaultArgs: ['--acp'],
    label: 'Gemini CLI',
    signInCommand: 'gemini',
  },
  copilot: {
    command: 'copilot',
    defaultArgs: ['--acp'],
    label: 'Copilot',
    signInCommand: 'copilot',
  },
  own: {
    command: 'muse-spark-code-acp',
    defaultArgs: [],
    label: 'Muse Spark Code',
    signInCommand: 'muse-spark-code-acp',
  },
}

/** One external agent, preset or added by command. */
export interface ExternalAgent {
  /** Stable per agent: a preset id, or the person's name for their own entry. */
  readonly agentId: string
  /** Display only, e.g. "Claude Code". */
  readonly label: string
  /** The command the host finds on the PATH. */
  readonly command: string
  readonly args: readonly string[]
  /** The agent's own CLI the person signs in with, named in the sign-in sentence. */
  readonly signInCommand: string
  /**
  The model the stored ref names: the person's chosen model where they set
  one, else the agent id itself, standing for the agent's own default (the
  session reports the model it actually runs once connected).
  */
  readonly model: string
  readonly pays: TeamAgentPays
  /** A preset's id where this agent is one; a custom agent has none. */
  readonly preset?: ExternalPresetId
}

/** The five presets as offerable agents, in D250's order. Every preset spends its own plan's limits, never our key (D75: "paid however that CLI is paid"). */
export function externalAgentPresets(): readonly ExternalAgent[] {
  return (Object.keys(EXTERNAL_PRESET_LAUNCH) as ExternalPresetId[]).map((id) => {
    const launch = EXTERNAL_PRESET_LAUNCH[id]
    return {
      agentId: id,
      label: launch.label,
      command: launch.command,
      args: launch.defaultArgs,
      signInCommand: launch.signInCommand,
      model: id,
      pays: 'subscription',
      preset: id,
    }
  })
}

export {
  teamExternalAgentSettingSchema,
  type TeamExternalAgentSetting,
} from '../../shared/externalAgentSetting'

/**
The person's own agents from the raw setting value: an entry that does not
parse, or repeats a name already taken (a preset's included), is left out —
the setting is the person's text, and a broken row must not break the
panel. First entry wins per name.
*/
export function customExternalAgents(raw: unknown): readonly ExternalAgent[] {
  if (!Array.isArray(raw)) return []
  const taken = new Set<string>(Object.keys(EXTERNAL_PRESET_LAUNCH))
  const agents: ExternalAgent[] = []
  for (const entry of raw) {
    const parsed = teamExternalAgentSettingSchema.safeParse(entry)
    if (!parsed.success || taken.has(parsed.data.name)) continue
    taken.add(parsed.data.name)
    agents.push({
      agentId: parsed.data.name,
      label: parsed.data.name,
      command: parsed.data.command,
      args: parsed.data.args ?? [],
      signInCommand: parsed.data.command,
      model: parsed.data.model ?? parsed.data.name,
      pays: parsed.data.pays ?? 'subscription',
    })
  }
  return agents
}

/** Every external agent on offer: the presets, then the person's own. */
export function allExternalAgents(rawCustom: unknown): readonly ExternalAgent[] {
  return [...externalAgentPresets(), ...customExternalAgents(rawCustom)]
}

/** The stored ref an offer of this agent carries. */
export function externalAgentRef(agent: ExternalAgent): TeamAgentRef {
  return { kind: 'external', agentId: agent.agentId, model: agent.model, pays: agent.pays }
}

/** The offer ref for an external agent: `external:<agentId>`. */
export function externalOfferRef(agentId: string): string {
  return `external:${agentId}`
}

/**
The agent a stored external ref names, from the presets and the person's
setting: undefined when the entry is gone (the setting changed), so the
caller refuses in words instead of starting another agent.
*/
export function resolveExternalAgent(
  ref: Pick<TeamAgentRef, 'agentId' | 'model'>,
  rawCustom: unknown,
): ExternalAgent | undefined {
  const agent = allExternalAgents(rawCustom).find((row) => row.agentId === ref.agentId)
  if (agent === undefined) return undefined
  // The stored ref's model is the person's saved choice; the catalogue row
  // only supplies the launch facts.
  return agent.model === ref.model ? agent : { ...agent, model: ref.model }
}

/** Whether the ref's model stands for the agent's own default (no explicit choice). */
export function isExternalDefaultModel(agent: ExternalAgent): boolean {
  return agent.model === agent.agentId
}
