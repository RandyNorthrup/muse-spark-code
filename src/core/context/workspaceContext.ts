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
  type AgentCatalogue,
  type AgentDefinition,
  type AgentResolution,
  type AgentRoot,
  agentHoles,
  loadAgents,
  NO_AGENTS,
  offeredAgents,
  projectAgentsRoot,
  resolveAgent,
} from './customAgents'
import { loadRuleFile, type RuleFile, ruleDirectoriesFor, renderRules } from './rules'
import {
  type BundledSkillsSource,
  bundledSkillsRoot,
  loadSkills,
  projectSkillsRoot,
  type SkillDefinition,
  type SkillRoot,
} from './skills'

export interface WorkspaceContextDeps {
  /** Bytes and directory entries, links included (PLAN.md D27). */
  readonly io: ContextIo
  readonly workspaceRoot: string
  readonly platform: NodeJS.Platform
  /** Muse Code's personal skill root; undefined when the host has no home. */
  readonly personalSkillsRoot: string | undefined
  /**
   * The skills that ship with the extension (M89, PLAN.md D68), the lowest
   * source; undefined where none ship (the ACP agent, the evaluation).
   */
  readonly bundledSkills?: BundledSkillsSource | undefined
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
  /**
   * The custom agents the model may run through `subagent_spawn` (M76):
   * only those a spawn of the name would run (RV70x).
   */
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
  private agents: AgentCatalogue = NO_AGENTS
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
    // The extension's own files, read only from its own package (M89).
    const { bundledSkills } = this.deps
    if (bundledSkills?.isEnabled() === true) {
      roots.push({
        directory: bundledSkillsRoot(bundledSkills.packageRoot, this.deps.platform),
        source: 'bundled',
        confineTo: bundledSkills.packageRoot,
        packageRoot: bundledSkills.packageRoot,
      })
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
   * repository's files only in a trusted workspace, like the skills. Each
   * root loads on its own; one that fails is a hole the others' precedence
   * respects (RV70x).
   */
  private async loadAgentCatalogue(): Promise<void> {
    // Rules and skills awaited first; trust can change before agent loading.
    if (!this.isTrusted) return
    const roots = this.agentRoots()
    const { platform } = this.deps
    const load = await this.guarded(
      'loading the agents',
      () => loadAgents({ io: this.deps.io, platform }, roots),
      // Anything else that fails leaves every root unknown: no name runs,
      // a built-in included, rather than one a file may have narrowed.
      {
        agents: [],
        holes: agentHoles(
          platform,
          roots.map((root) => ({ root, listingFailure: 'failed', refused: [] })),
        ),
        warnings: [],
      },
    )
    for (const warning of load.warnings) {
      this.deps.warn(warning)
    }
    // An in-flight file read cannot be cancelled, but its catalogue must not
    // survive trust withdrawal while the filesystem was answering.
    this.agents = this.deps.isWorkspaceTrusted()
      ? { agents: load.agents, holes: load.holes }
      : NO_AGENTS
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

  /** What a spawn naming `id` runs: an agent, nothing, or a refusal for a root that did not load. */
  public agent(id: string): AgentResolution {
    return resolveAgent(this.agents, id)
  }

  public sections(): ContextSections {
    return {
      rules: this.rulesText,
      skills: this.skills,
      agents: offeredAgents(this.agents),
      memory: this.memory,
    }
  }

  /** Loaded rule filenames only, for InstructionsLoaded; never their contents. */
  public rulePaths(): readonly string[] {
    return this.rules.map((rule) => rule.path)
  }
}
