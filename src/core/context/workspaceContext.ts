// What the Model API backend loads from the workspace for the model (PLAN.md
// D13): the rules files, the skill catalogue and the memory snapshot (every
// scope's index and note paths since M49, D41), by Muse Code's conventions,
// and only in a trusted workspace. One instance per session: the root is
// loaded once before the first model call, a subdirectory's rules file the
// first time a tool touches a path beneath it, and the skills again when
// the host says their files changed. The memory is read once, as Muse Code
// takes its snapshot at session start.

import { RULES_PREAMBLE } from '../../shared/constants'
import type { MemoryScopeSnapshot } from '../memory/memoryStore'
import type { ContextIo } from './contextFiles'
import {
  type AgentDefinition,
  type AgentRoot,
  builtinAgents,
  loadAgents,
  projectAgentsRoot,
} from './customAgents'
import { loadRuleFile, type RuleFile, ruleDirectoriesFor, renderRules } from './rules'
import { loadSkills, projectSkillsRoot, type SkillDefinition, type SkillRoot } from './skills'

export interface WorkspaceContextDeps {
  /** Bytes and directory entries, links included (PLAN.md D27). */
  readonly io: ContextIo
  readonly workspaceRoot: string
  readonly platform: NodeJS.Platform
  /** Muse Code's personal skill root; undefined when the host has no home. */
  readonly personalSkillsRoot: string | undefined
  /** The managed personal agent root (M76); undefined when the host has no home. */
  readonly personalAgentsRoot: string | undefined
  /**
   * Whether the agents are loaded (M76): a parent conversation lists them
   * and spawns them; a child cannot spawn, so it reads none.
   */
  readonly hasAgents: boolean
  readonly isWorkspaceTrusted: () => boolean
  /** The memory snapshot (M49); undefined when the backend has no memory. */
  readonly loadMemory: (() => Promise<readonly MemoryScopeSnapshot[]>) | undefined
  readonly warn: (message: string) => void
}

/** The loaded context as the instructions builder consumes it. */
export interface ContextSections {
  /** The rendered rules section with the preamble, or undefined without rules. */
  readonly rules: string | undefined
  readonly skills: readonly SkillDefinition[]
  /** The custom agents the model may run through `subagent_spawn` (M76). */
  readonly agents: readonly AgentDefinition[]
  /** The scopes that keep notes, as the session began; empty without any. */
  readonly memory: readonly MemoryScopeSnapshot[]
}

const ROOT_DIRECTORY = ''

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function catalogueKey(skills: readonly SkillDefinition[]): string {
  return JSON.stringify(skills)
}

export class WorkspaceContext {
  private readonly rules: RuleFile[] = []
  private readonly checkedDirectories = new Set<string>()
  private skills: readonly SkillDefinition[] = []
  private agents: readonly AgentDefinition[] = []
  private memory: readonly MemoryScopeSnapshot[] = []
  private rulesText: string | undefined
  private loading: Promise<void> | undefined

  public constructor(private readonly deps: WorkspaceContextDeps) {}

  private get isTrusted(): boolean {
    return this.deps.isWorkspaceTrusted()
  }

  private skillRoots(): readonly SkillRoot[] {
    const roots: SkillRoot[] = [
      {
        directory: projectSkillsRoot(this.deps.workspaceRoot, this.deps.platform),
        source: 'project',
        confineTo: this.deps.workspaceRoot,
      },
    ]
    if (this.deps.personalSkillsRoot !== undefined) {
      roots.push({ directory: this.deps.personalSkillsRoot, source: 'user', confineTo: undefined })
    }
    return roots
  }

  private agentRoots(): readonly AgentRoot[] {
    const roots: AgentRoot[] = [
      {
        directory: projectAgentsRoot(this.deps.workspaceRoot, this.deps.platform),
        source: 'project',
        confineTo: this.deps.workspaceRoot,
      },
    ]
    if (this.deps.personalAgentsRoot !== undefined) {
      roots.push({ directory: this.deps.personalAgentsRoot, source: 'user', confineTo: undefined })
    }
    return roots
  }

  private renderRulesSection(): void {
    if (this.rules.length === 0) {
      this.rulesText = undefined
      return
    }
    const rendered = renderRules(this.rules)
    if (rendered.warning !== undefined) {
      this.deps.warn(rendered.warning)
    }
    this.rulesText = `${RULES_PREAMBLE}\n\n${rendered.text}`
  }

  /** Loads the directory's rules file once; true when a file was added. */
  private async loadDirectory(directory: string): Promise<boolean> {
    if (this.checkedDirectories.has(directory)) {
      return false
    }
    this.checkedDirectories.add(directory)
    const load = await loadRuleFile(
      { io: this.deps.io, workspaceRoot: this.deps.workspaceRoot, platform: this.deps.platform },
      directory,
    )
    if (load.warning !== undefined) {
      this.deps.warn(load.warning)
    }
    if (load.file === undefined) {
      return false
    }
    this.rules.push(load.file)
    return true
  }

  /** A read that fails (permissions, encoding) is a warning, never a failed turn. */
  private async guarded<T>(what: string, run: () => Promise<T>, fallback: T): Promise<T> {
    try {
      return await run()
    } catch (error: unknown) {
      this.deps.warn(`${what} failed: ${describe(error)}`)
      return fallback
    }
  }

  private async loadAll(): Promise<void> {
    if (!this.isTrusted) {
      return
    }
    await this.guarded('loading the rules', () => this.loadDirectory(ROOT_DIRECTORY), false)
    this.renderRulesSection()
    await this.refreshSkills()
    if (this.deps.hasAgents) {
      await this.loadAgentCatalogue()
    }
    const { loadMemory } = this.deps
    if (loadMemory !== undefined) {
      this.memory = await this.guarded('loading the memory', loadMemory, [])
    }
  }

  /**
   * Agents load once per session with the rest of the context (M76): a
   * repository's files only in a trusted workspace, like the skills.
   */
  private async loadAgentCatalogue(): Promise<void> {
    const agents = await this.guarded(
      'loading the agents',
      () => loadAgents({ io: this.deps.io, platform: this.deps.platform }, this.agentRoots()),
      // A root that cannot be read leaves the built-ins, which need no file.
      { agents: builtinAgents(), warnings: [] },
    )
    for (const warning of agents.warnings) {
      this.deps.warn(warning)
    }
    this.agents = agents.agents
  }

  /** The root rules, the skills, the agents and the memory index, loaded once. */
  public load(): Promise<void> {
    this.loading ??= this.loadAll()
    return this.loading
  }

  /**
   * Loads the rules files of the directories above a touched path that have
   * not been checked yet, deeper files after shallower ones (Muse Code: the
   * deeper file wins). True when the rules changed.
   */
  public async touch(relativePath: string): Promise<boolean> {
    if (!this.isTrusted) {
      return false
    }
    await this.load()
    let isChanged = false
    for (const directory of ruleDirectoriesFor(relativePath)) {
      if (await this.guarded('loading the rules', () => this.loadDirectory(directory), false)) {
        isChanged = true
      }
    }
    if (isChanged) {
      this.renderRulesSection()
    }
    return isChanged
  }

  /** Re-reads the skill roots; true when the catalogue changed. */
  public async refreshSkills(): Promise<boolean> {
    if (!this.isTrusted) {
      return false
    }
    const load = await this.guarded(
      'loading the skills',
      () => loadSkills({ io: this.deps.io, platform: this.deps.platform }, this.skillRoots()),
      { skills: this.skills, warnings: [] },
    )
    for (const warning of load.warnings) {
      this.deps.warn(warning)
    }
    const isChanged = catalogueKey(load.skills) !== catalogueKey(this.skills)
    this.skills = load.skills
    return isChanged
  }

  public skill(id: string): SkillDefinition | undefined {
    return this.skills.find((skill) => skill.id === id)
  }

  public agent(id: string): AgentDefinition | undefined {
    return this.agents.find((agent) => agent.id === id)
  }

  public sections(): ContextSections {
    return { rules: this.rulesText, skills: this.skills, agents: this.agents, memory: this.memory }
  }
}
