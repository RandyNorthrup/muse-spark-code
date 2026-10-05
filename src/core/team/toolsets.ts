// Lane R (M96, PLAN.md D75): the one definition behind every role's tools.
//
// The built-in AGENT.md files' `tools` lines, the charter's "You may" line,
// the panel's checklist and call admission are all generated from or checked
// against `TEAM_ROLE_TOOLSETS` and `TEAM_TOOL_GROUP_TOOLS`, so they cannot
// drift. A worker's tools are its role's groups met with what the session
// offers and the paid gates allow (M76's narrowing).

import {
  TEAM_DELEGATE_TOOLS,
  TEAM_DIAGNOSTICS_TOOL,
  TEAM_MODEL_TEXT,
  TEAM_READ_ONLY_COMMANDS,
  TEAM_TOOL_GROUPS,
  TEAM_TOOL_GROUP_TOOLS,
  TEAM_TOOL_GROUP_WORDS,
  type TeamToolGroup,
} from '../../shared/constants'

/**
 * The session names a canonical team tool may be offered under. Only the
 * diagnostics tool needs aliases today: `getDiagnostics` in process and
 * `mcp__ide__getDiagnostics` over MCP (src/core/diagnostics.ts). Muse Code
 * and external agents get the nearest of their own tools (lane W); that
 * mapping lives with the worker, never here.
 */
const TEAM_TOOL_ALIASES: Readonly<Record<string, readonly string[]>> = {
  [TEAM_DIAGNOSTICS_TOOL]: ['getDiagnostics', 'mcp__ide__getDiagnostics'],
}

/** What the role asks for: its groups, and the write globs bound to them. */
export interface TeamToolsetSpec {
  readonly groups: readonly TeamToolGroup[]
  /** The role's `write-paths`; undefined writes nowhere or the whole branch. */
  readonly writePaths?: readonly string[] | undefined
}

/** What the session offers a worker: its tools, the paid gates, and its `delegates`. */
export interface TeamToolsetSession {
  readonly offered: readonly string[]
  readonly webSearchAllowed: boolean
  readonly imagesAllowed: boolean
  readonly delegates: readonly string[]
}

/** A role's tools met with the session: the exact set call admission holds. */
export interface ResolvedTeamToolset {
  /** Canonical tool names, in `TEAM_TOOL_GROUPS` order, each once. */
  readonly tools: readonly string[]
  /** The groups that kept at least one offered tool, in table order. */
  readonly groups: readonly TeamToolGroup[]
  /** The charter's "You may" line, without its `You may: ` lead. */
  readonly youMay: string
}

/** A panel checklist row: one group and the tools it holds. */
export interface TeamToolChecklistRow {
  readonly group: TeamToolGroup
  readonly tools: readonly string[]
}

/** The panel's checklist: every group with its tools, in table order. */
export function teamToolChecklist(): readonly TeamToolChecklistRow[] {
  return TEAM_TOOL_GROUPS.map((group) => ({ group, tools: TEAM_TOOL_GROUP_TOOLS[group] }))
}

/** Whether the session offers a canonical tool, under its own name or an alias. */
function isToolOffered(offered: ReadonlySet<string>, tool: string): boolean {
  return offered.has(tool) || (TEAM_TOOL_ALIASES[tool] ?? []).some((alias) => offered.has(alias))
}

/** A canonical tool met with the session: the name the session offers, or undefined. */
function meetTool(offered: ReadonlySet<string>, tool: string): string | undefined {
  return offered.has(tool)
    ? tool
    : (TEAM_TOOL_ALIASES[tool] ?? []).find((alias) => offered.has(alias))
}

/** The groups an allowlist of tool names touches: a group is kept by one tool. */
export function groupsForTools(tools: readonly string[]): TeamToolGroup[] {
  const wanted = new Set(tools)
  return TEAM_TOOL_GROUPS.filter((group) =>
    TEAM_TOOL_GROUP_TOOLS[group].some(
      (tool) =>
        wanted.has(tool) || (TEAM_TOOL_ALIASES[tool] ?? []).some((alias) => wanted.has(alias)),
    ),
  )
}

/** `a, b and c`: the read-only commands as the charter names them. */
function commandList(commands: readonly string[]): string {
  return commands.length <= 2
    ? commands.join(' and ')
    : `${commands.slice(0, -1).join(', ')} and ${commands.at(-1) ?? ''}`
}

/** One group's plain words for the "You may" line, from the one definition. */
export function groupWords(
  group: TeamToolGroup,
  writePaths: readonly string[] | undefined,
): string {
  if (group === 'readOnlyShell') {
    return `run read-only shell commands (${commandList(TEAM_READ_ONLY_COMMANDS)})`
  }
  return group === 'write' && writePaths !== undefined
    ? `create and edit files inside ${writePaths.join(', ')}`
    : TEAM_TOOL_GROUP_WORDS[group]
}

/** The "You may" list for kept groups: each group's words, joined. */
export function describeToolsForCharter(
  groups: readonly TeamToolGroup[],
  writePaths: readonly string[] | undefined,
  tools?: readonly string[],
): string {
  if (tools === undefined) {
    return groups.map((group) => groupWords(group, writePaths)).join('; ')
  }
  const offered = new Set(tools)
  const described = new Set<string>()
  const words: string[] = []
  for (const group of groups) {
    const canonical = TEAM_TOOL_GROUP_TOOLS[group]
    const met = canonical
      .map((tool) => meetTool(offered, tool))
      .filter((tool) => tool !== undefined)
    if (met.length === 0) {
      continue
    }
    for (const tool of met) {
      described.add(tool)
    }
    if (met.length === canonical.length) {
      words.push(groupWords(group, writePaths))
    } else {
      const detail = met.join(', ')
      if (['shell', 'readOnlyShell', 'testShell'].includes(group)) {
        words.push(`${groupWords(group, writePaths)} (${detail})`)
        continue
      }
      let template: string = TEAM_MODEL_TEXT.teamPartialTools
      if (group === 'write') {
        template = TEAM_MODEL_TEXT.teamPartialWriteTools
      } else if (group === 'images') {
        template = TEAM_MODEL_TEXT.teamPartialPaidTools
      }
      words.push(
        template
          .split('{tools}')
          .join(detail)
          .split('{paths}')
          .join(writePaths?.join(', ') ?? TEAM_MODEL_TEXT.teamWriteWholeCopy),
      )
    }
  }
  const extra = tools.filter((tool) => !described.has(tool))
  if (extra.length > 0) {
    words.push(TEAM_MODEL_TEXT.teamPartialTools.split('{tools}').join(extra.join(', ')))
  }
  return words.join('; ')
}

/**
 * A role's tools, met with what the session offers and the paid gates
 * allow. Paid groups (`webSearch`, `images`) are dropped while their gate
 * is off; a worker whose role names `delegates` gets `roster`, `delegate`,
 * `collect` and `cancel`, never `merge`.
 */
export function resolveTeamToolset(
  spec: TeamToolsetSpec,
  session: TeamToolsetSession,
): ResolvedTeamToolset {
  const offered = new Set(session.offered)
  const gated = new Set(
    spec.groups.filter(
      (group) =>
        (group !== 'webSearch' || session.webSearchAllowed) &&
        (group !== 'images' || session.imagesAllowed),
    ),
  )
  const tools: string[] = []
  const kept: TeamToolGroup[] = []
  for (const group of TEAM_TOOL_GROUPS) {
    if (!gated.has(group)) {
      continue
    }
    const met = TEAM_TOOL_GROUP_TOOLS[group]
      .map((tool) => meetTool(offered, tool))
      .filter((tool): tool is string => tool !== undefined)
    if (met.length === 0) {
      continue
    }
    kept.push(group)
    for (const tool of met) {
      if (!tools.includes(tool)) {
        tools.push(tool)
      }
    }
  }
  if (session.delegates.length > 0) {
    for (const tool of TEAM_DELEGATE_TOOLS) {
      if (isToolOffered(offered, tool) && !tools.includes(tool)) {
        tools.push(tool)
      }
    }
  }
  return { tools, groups: kept, youMay: describeToolsForCharter(kept, spec.writePaths, tools) }
}

/** Call admission: a call to anything outside the resolved set is refused. */
export function isTeamToolAdmitted(resolved: ResolvedTeamToolset, tool: string): boolean {
  return resolved.tools.includes(tool)
}
