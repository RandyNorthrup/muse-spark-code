// What the Model API backend loads from the workspace for the model (PLAN.md
// D13): the rules files, the skill catalogue and the project memory index,
// by Muse Code's conventions, and only in a trusted workspace. One instance
// per session: the root is loaded once before the first model call, a
// subdirectory's rules file the first time a tool touches a path beneath
// it, and the skills again when the host says their files changed.

import { RULES_PREAMBLE } from '../../shared/constants'
import type { ToolIo } from '../backends/modelapi/tools'
import { loadMemoryIndex, type MemoryIndex } from './memory'
import { loadRuleFile, type RuleFile, ruleDirectoriesFor, renderRules } from './rules'
import { loadSkills, projectSkillsRoot, type SkillDefinition, type SkillRoot } from './skills'

export interface WorkspaceContextDeps {
  readonly io: ToolIo
  readonly workspaceRoot: string
  readonly platform: NodeJS.Platform
  /** Muse Code's personal skill root; undefined when the host has no home. */
  readonly personalSkillsRoot: string | undefined
  readonly isWorkspaceTrusted: () => boolean
  readonly warn: (message: string) => void
}

/** The loaded context as the instructions builder consumes it. */
export interface ContextSections {
  /** The rendered rules section with the preamble, or undefined without rules. */
  readonly rules: string | undefined
  readonly skills: readonly SkillDefinition[]
  readonly memory: MemoryIndex | undefined
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
  private memory: MemoryIndex | undefined
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
      },
    ]
    if (this.deps.personalSkillsRoot !== undefined) {
      roots.push({ directory: this.deps.personalSkillsRoot, source: 'user' })
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
    this.memory = await this.guarded(
      'loading the memory index',
      () =>
        loadMemoryIndex({
          io: this.deps.io,
          workspaceRoot: this.deps.workspaceRoot,
          platform: this.deps.platform,
        }),
      undefined,
    )
    if (this.memory?.warning !== undefined) {
      this.deps.warn(this.memory.warning)
    }
  }

  /** The root rules, the skills and the memory index, loaded once. */
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

  public sections(): ContextSections {
    return { rules: this.rulesText, skills: this.skills, memory: this.memory }
  }
}
