// Custom agents for the Model API backend (M76, PLAN.md D49): specialised
// agents with their own prompt, tools, model or effort, and permissions. An
// agent is `<root>/<id>/AGENT.md` with YAML-style front matter (`name`,
// `description`; optional `tools` as a comma-separated allowlist, `model`,
// `effort`, `permission-mode`) above a Markdown body holding the agent's own
// prompt. Project agents live in the workspace's `.agents/agents`, personal
// ones in the managed `muse/agents` root under the config home; a file agent
// shadows a built-in or personal one with the same id. The model runs one
// through `subagent_spawn` with `agent` set to its id, so a run beyond the
// user's own turn is a paid subagent use like any child (D45, D48).
//
// The folder is the extension's own: the CLI names no agent folder
// (`muse --help`, `muse skills --help` and `muse serve --help` list none, and
// its binary's strings hold `.agents/skills`, `.agents/memory` and
// `.agents/plans` but no agent folder, re-checked 2026-09-30 on 1.4.0),
// recorded in PLAN.md D13. A repository's agent files load only in a trusted
// workspace and can only narrow the tools and permissions the session
// already has; a model one names passes the same checks as the user's own
// choice. Muse Code reads its own agents, which the Agent map already shows;
// this backend never sends it one.
//
// An agent file is untrusted input (PLAN.md D49): it is read within a size
// cap, parsed with zod, every field is bounded and free of characters that
// hide, and a file whose front matter the line reader cannot take whole (a
// YAML list, an indented value, a repeated key) is refused rather than
// guessed at, because what it cannot read could have been a narrowing.

import path from 'node:path'
import * as z from 'zod/mini'
import {
  AGENT_DESCRIPTION_MAX_CHARS,
  AGENT_FILE_MAX_BYTES,
  AGENT_FILE_NAME,
  AGENT_ID_PATTERN,
  AGENT_MAX_FILES,
  AGENT_MODEL_MAX_CHARS,
  AGENT_NAME_MAX_CHARS,
  AGENT_TOOL_NAME_PATTERN,
  AGENT_TOOLS_MAX,
  type AgentSource,
  BUILTIN_AGENT_EXPLORE_ID,
  BUILTIN_AGENT_SECOND_OPINION_ID,
  DEFAULT_EFFORT,
  EFFORT_LEVELS,
  type EffortLevel,
  EXPLORE_AGENT_TOOLS,
  MODEL_TEXT,
  PERMISSION_MODES,
  type PermissionMode,
  PERSONAL_AGENTS_DIR_SEGMENTS,
  PROJECT_AGENTS_DIR_SEGMENTS,
  SECOND_OPINION_AGENT_EFFORT,
} from '../../shared/constants'
import { effortLevelsFor } from '../../shared/effort'
import { type ApprovalMode, mspApprovalMode } from '../../shared/permissionModes'
import type { ContextIo } from './contextFiles'
import {
  type CatalogKind,
  type CatalogParse,
  type CatalogRoot,
  loadCatalogFiles,
  splitFrontMatter,
} from './catalogFiles'
import type { PersonalSkillsRootInput } from './skills'

export interface AgentDefinition {
  /** The directory name (or built-in id): the selector `subagent_spawn` takes as `agent`. */
  readonly id: string
  readonly name: string
  readonly description: string
  /** The agent's own prompt, run as the child's instructions. */
  readonly body: string
  readonly source: AgentSource
  /** The tools the agent may use; undefined runs with the session's own set. */
  readonly tools: readonly string[] | undefined
  /** The model the agent runs on; undefined keeps the session's model. */
  readonly model: string | undefined
  /** The effort the agent runs at; undefined keeps the session's effort. */
  readonly effort: EffortLevel | undefined
  /** The most the agent may do; undefined keeps the session's approval mode. */
  readonly approvalMode: ApprovalMode | undefined
  /** The UI policy, which distinguishes Manual from Edit automatically. */
  readonly permissionMode?: PermissionMode | undefined
}

export type AgentRoot = CatalogRoot<'project' | 'user'>

export interface AgentsLoad {
  readonly agents: readonly AgentDefinition[]
  readonly warnings: readonly string[]
}

export interface ParsedAgentFile {
  readonly name: string
  readonly description: string
  readonly body: string
  readonly tools: readonly string[] | undefined
  readonly model: string | undefined
  readonly effort: EffortLevel | undefined
  readonly approvalMode: ApprovalMode | undefined
  readonly permissionMode?: PermissionMode | undefined
}

export type AgentFileParse =
  | { readonly ok: true; readonly agent: ParsedAgentFile }
  | { readonly ok: false; readonly reason: string }

/**
 * A custom agent's narrowed run (M76): the resolved agent id and where its
 * file came from, its prompt, the offered tools the child keeps (undefined
 * keeps the session's own set), the effort it runs at, and the most it may
 * do (undefined keeps the session's approval mode). Plain data, so a stored
 * or forked child keeps the narrowing it was spawned with.
 */
export interface AgentRuntime {
  readonly id: string
  readonly source: AgentSource
  readonly prompt: string
  readonly toolAllowlist?: readonly string[] | undefined
  readonly effort: EffortLevel
  readonly approvalMode?: ApprovalMode | undefined
  readonly permissionMode?: PermissionMode | undefined
}

const PERMISSION_MODE_KEY = 'permission-mode'
const LIST_SEPARATOR = ','
// Control characters (other than a tab) and format characters (a direction
// override, a zero-width character): text the model would read that no one
// reviewing the file sees.
const HIDDEN_CHARACTER = /[\p{Cc}\p{Cf}]/u

const AGENT_CATALOG: CatalogKind = {
  kind: 'agent',
  fileName: AGENT_FILE_NAME,
  maxBytes: AGENT_FILE_MAX_BYTES,
  idPattern: AGENT_ID_PATTERN,
  maxEntries: AGENT_MAX_FILES,
}

/** One visible line of bounded length: a name, a description, a model id. */
function boundedLine(maxChars: number) {
  return z.string().check(
    z.trim(),
    z.minLength(1),
    z.maxLength(maxChars),
    z.refine((value) => !HIDDEN_CHARACTER.test(value.replaceAll('\t', ' '))),
  )
}

const agentFrontMatter = z.object({
  name: boundedLine(AGENT_NAME_MAX_CHARS),
  description: boundedLine(AGENT_DESCRIPTION_MAX_CHARS),
  tools: z.optional(z.string().check(z.trim(), z.minLength(1))),
  model: z.optional(boundedLine(AGENT_MODEL_MAX_CHARS)),
  effort: z.optional(z.enum(EFFORT_LEVELS)),
  [PERMISSION_MODE_KEY]: z.optional(z.enum(PERMISSION_MODES)),
})

/**
 * The allowlist a `tools` line names: each entry a function name, at most
 * AGENT_TOOLS_MAX, none empty. A list that is not a list of names (YAML
 * brackets, a sentence) is refused, never read as "all tools".
 */
function toolsOf(value: string | undefined): readonly string[] | 'invalid' | undefined {
  if (value === undefined) {
    return undefined
  }
  const tools = value.split(LIST_SEPARATOR).map((tool) => tool.trim())
  const isValid =
    tools.length <= AGENT_TOOLS_MAX && tools.every((tool) => AGENT_TOOL_NAME_PATTERN.test(tool))
  return isValid ? [...new Set(tools)] : 'invalid'
}

function sortedUnique(keys: readonly string[]): string {
  return [...new Set(keys)].toSorted((a, b) => a.localeCompare(b, 'en')).join(', ')
}

/** Splits an AGENT.md into its front matter (validated with zod) and body. */
export function parseAgentFile(text: string): AgentFileParse {
  const split = splitFrontMatter(text)
  if (!split.ok) {
    return split
  }
  if (split.ignoredLines.length > 0) {
    return {
      ok: false,
      reason:
        'front matter has a line that is not "key: value" (lists and indented values are not supported)',
    }
  }
  if (split.duplicateKeys.length > 0) {
    return { ok: false, reason: `front matter repeats ${sortedUnique(split.duplicateKeys)}` }
  }
  const parsed = agentFrontMatter.safeParse(Object.fromEntries(split.fields))
  if (!parsed.success) {
    const keys = parsed.error.issues.map((issue) => issue.path.map(String).join('.'))
    return {
      ok: false,
      reason: `front matter has an invalid ${sortedUnique(keys) || 'shape'}`,
    }
  }
  const { data } = parsed
  const tools = toolsOf(data.tools)
  if (tools === 'invalid') {
    return { ok: false, reason: 'front matter has an invalid tools' }
  }
  const permissionMode = data[PERMISSION_MODE_KEY]
  return {
    ok: true,
    agent: {
      name: data.name,
      description: data.description,
      body: split.body,
      tools,
      model: data.model,
      effort: data.effort,
      approvalMode: permissionMode === undefined ? undefined : mspApprovalMode(permissionMode),
      ...(permissionMode !== undefined && { permissionMode }),
    },
  }
}

function pathModule(platform: NodeJS.Platform): path.PlatformPath {
  return platform === 'win32' ? path.win32 : path.posix
}

/** The workspace's project agent root. */
export function projectAgentsRoot(workspaceRoot: string, platform: NodeJS.Platform): string {
  return pathModule(platform).join(workspaceRoot, ...PROJECT_AGENTS_DIR_SEGMENTS)
}

/** The managed personal agent root (`$XDG_CONFIG_HOME/muse/agents`, else `~/.config/muse/agents`). */
export function personalAgentsRoot(input: PersonalSkillsRootInput): string {
  const p = pathModule(input.platform)
  const configHome = input.xdgConfigHome ?? p.join(input.homeDir, '.config')
  return p.join(configHome, ...PERSONAL_AGENTS_DIR_SEGMENTS)
}

/** The agents the extension ships: Explore reads without writing, Second opinion consults at high effort. */
export function builtinAgents(): readonly AgentDefinition[] {
  return [
    {
      id: BUILTIN_AGENT_EXPLORE_ID,
      name: 'Explore',
      description: MODEL_TEXT.exploreAgentDescription,
      body: MODEL_TEXT.exploreAgentPrompt,
      source: 'builtin',
      tools: EXPLORE_AGENT_TOOLS,
      model: undefined,
      effort: undefined,
      approvalMode: undefined,
    },
    {
      id: BUILTIN_AGENT_SECOND_OPINION_ID,
      name: 'Second opinion',
      description: MODEL_TEXT.secondOpinionAgentDescription,
      body: MODEL_TEXT.secondOpinionAgentPrompt,
      source: 'builtin',
      tools: undefined,
      model: undefined,
      effort: SECOND_OPINION_AGENT_EFFORT,
      approvalMode: undefined,
    },
  ]
}

export interface AgentsLoaderDeps {
  readonly io: ContextIo
  readonly platform: NodeJS.Platform
}

function parseCatalogFile(text: string): CatalogParse<Omit<AgentDefinition, 'id' | 'source'>> {
  const parsed = parseAgentFile(text)
  return parsed.ok
    ? { ok: true, name: parsed.agent.name, entry: parsed.agent }
    : { ok: false, reason: parsed.reason }
}

/**
 * Every valid agent: the built-ins first, then the files in root order with
 * ids sorted within a root. A file agent shadows a built-in or personal one
 * with the same id.
 */
export async function loadAgents(
  deps: AgentsLoaderDeps,
  roots: readonly AgentRoot[],
): Promise<AgentsLoad> {
  const load = await loadCatalogFiles(deps, roots, AGENT_CATALOG, parseCatalogFile)
  const warnings = [...load.warnings]
  const files: AgentDefinition[] = load.entries.map((entry) => ({
    id: entry.id,
    source: entry.source,
    ...entry.entry,
  }))
  const keptBuiltins = builtinAgents().filter((builtin) => {
    const file = files.find((agent) => agent.id === builtin.id)
    if (file === undefined) {
      return true
    }
    warnings.push(
      `builtin agent ${builtin.id} skipped: the ${file.source} agent with the same id takes precedence`,
    )
    return false
  })
  return { agents: [...keptBuiltins, ...files], warnings }
}

/** The model a spawn with this agent runs on: the agent's, else the session's. */
export function resolveAgentModel(sessionModel: string, agentModel: string | undefined): string {
  return agentModel ?? sessionModel
}

/**
 * The approval mode a spawn with this agent runs under: the agent's when it
 * narrows the session's, else the session's. A repository's file can never
 * widen what the session already has. Least to most permissive: reads only,
 * reads with edits and commands asking, edits running with commands asking,
 * everything running.
 */
const APPROVAL_NARROWING: readonly ApprovalMode[] = [
  'denyUnmatched',
  'promptUnmatched',
  'onRequest',
  'allowAll',
]

export function narrowApprovalMode(
  sessionMode: ApprovalMode,
  agentMode: ApprovalMode | undefined,
): ApprovalMode {
  if (agentMode === undefined) {
    return sessionMode
  }
  return APPROVAL_NARROWING.indexOf(agentMode) <= APPROVAL_NARROWING.indexOf(sessionMode)
    ? agentMode
    : sessionMode
}

/**
 * The tools a spawn with this agent is offered: the agent's allowlist met
 * with what the session offers. Undefined runs with the session's own set.
 */
export function narrowTools(
  sessionTools: readonly string[],
  agentTools: readonly string[] | undefined,
): readonly string[] | undefined {
  if (agentTools === undefined) {
    return undefined
  }
  const allowed = new Set(agentTools)
  return sessionTools.filter((tool) => allowed.has(tool))
}

/**
 * The effort a spawn with this agent runs at: the agent's when the model
 * serves it, else the highest tier it serves; without one the session
 * default, dropped the same way when the model does not serve it (D10).
 */
export function resolveAgentEffort(
  modelId: string,
  agentEffort: EffortLevel | undefined,
): EffortLevel {
  const served = effortLevelsFor(modelId)
  const wanted = agentEffort ?? DEFAULT_EFFORT
  return served.includes(wanted) ? wanted : (served.at(-1) ?? DEFAULT_EFFORT)
}
