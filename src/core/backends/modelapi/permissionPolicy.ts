// The permission policy of the Model API backend (M78, PLAN.md D49), built
// from the settings of permissionSettings.ts: the command rules, the
// permission profile in force, and what a repository adds.
//
// - **Command rules** (commandRules.ts): the user's, then the repository's
//   ask and forbid rules; a repository's allow rules are refused.
// - **A permission profile** binds the file tools: its deny-read globs, and
//   a repository's, are paths the file tools neither read, list, search nor
//   write; its extra roots are folders outside the workspace `read_file` may
//   read by absolute path. The shell runs unconfined, so while a profile is
//   on every shell command asks (permissions.ts).
// - **Failing closed.** A profile named but not defined, or not valid, is
//   still on (every shell command asks); a profile that is not valid, or a
//   glob that cannot be read, denies every file. A rule that asks or forbids
//   is kept whenever its pattern can be read. Every problem is reported
//   once for each value of the settings.

import * as z from 'zod/mini'
import {
  PERMISSION_PROFILE_NAME_MAX_CHARS,
  PERMISSION_PROFILES_MAX,
  UI_TEXT,
} from '../../../shared/constants'
import { fill } from '../../../shared/l10n/text'
import {
  type PermissionSettings,
  permissionProfileSchema,
  repositoryRulesSchema,
} from '../../permissionSettings'
import { pathModule } from '../../workspaceRoot'
import {
  type CommandRule,
  compileCommandRules,
  type RuleProblem,
  type RuleSource,
} from './commandRules'
import { compileDenyGlobs, compileGlob } from './globLimits'

/** The paths the file tools refuse, and the folders `read_file` may read outside the workspace. */
export interface FileRules {
  /** The deny-read globs that compile, for the search worker. */
  readonly denyGlobs: readonly string[]
  /** A profile or a glob that cannot be read: every file is refused. */
  readonly isDenyAll: boolean
  /** Absolute, normalized. */
  readonly extraRoots: readonly string[]
  /**
   * Whether a path, relative to the workspace or to an extra root (forward
   * slashes; its textual and canonical forms both), is refused: a glob
   * matches it or a folder above it. Case is ignored.
   */
  isDenied(relativePaths: readonly string[]): boolean
}

export type PolicyProblem =
  | { readonly kind: 'rule'; readonly source: RuleSource; readonly problem: RuleProblem }
  | { readonly kind: 'profileUnknown'; readonly name: string }
  | { readonly kind: 'profileInvalid'; readonly name: string; readonly detail: string }
  | { readonly kind: 'globInvalid'; readonly glob: string; readonly detail: string }
  | { readonly kind: 'rootInvalid'; readonly root: string }
  | { readonly kind: 'repositoryInvalid'; readonly detail: string }

export interface PermissionPolicy {
  readonly commandRules: readonly CommandRule[]
  /** The profile in force, if any: every shell command asks while it is on. */
  readonly profileName: string | undefined
  readonly files: FileRules
  readonly problems: readonly PolicyProblem[]
}

const profileNameSchema = z.string().check(z.maxLength(PERMISSION_PROFILE_NAME_MAX_CHARS))

function fileRules(
  denyGlobs: readonly string[],
  isDenyAll: boolean,
  extraRoots: readonly string[],
): FileRules {
  const isCovered = compileDenyGlobs(denyGlobs)
  return {
    denyGlobs,
    isDenyAll,
    extraRoots,
    isDenied: (relativePaths) => isDenyAll || isCovered(relativePaths),
  }
}

/** The globs that compile, lower case; one that does not denies every file, and says so. */
function validGlobs(
  globs: readonly string[],
  problems: PolicyProblem[],
): { readonly valid: readonly string[]; readonly isDenyAll: boolean } {
  const valid: string[] = []
  let isDenyAll = false
  for (const glob of globs) {
    const lower = glob.toLowerCase()
    try {
      compileGlob(lower)
      valid.push(lower)
    } catch (error: unknown) {
      problems.push({
        kind: 'globInvalid',
        glob,
        detail: error instanceof Error ? error.message : String(error),
      })
      isDenyAll = true
    }
  }
  return { valid, isDenyAll }
}

/** The extra roots that are absolute paths, normalized; the rest are reported and left out. */
function absoluteRoots(
  roots: readonly string[],
  platform: NodeJS.Platform,
  problems: PolicyProblem[],
): string[] {
  const p = pathModule(platform)
  const kept: string[] = []
  for (const root of roots) {
    if (p.isAbsolute(root)) {
      kept.push(p.resolve(root))
    } else {
      problems.push({ kind: 'rootInvalid', root })
    }
  }
  return kept
}

interface ProfileParts {
  readonly name: string | undefined
  readonly denyRead: readonly string[]
  readonly extraRoots: readonly string[]
  readonly isDenyAll: boolean
}

/** The profile the settings choose, read; a name with no valid profile fails closed. */
function chosenProfile(settings: PermissionSettings, problems: PolicyProblem[]): ProfileParts {
  const name = profileNameSchema.safeParse(settings.profile)
  if (!name.success) {
    const shown =
      typeof settings.profile === 'string'
        ? settings.profile.slice(0, PERMISSION_PROFILE_NAME_MAX_CHARS)
        : typeof settings.profile
    problems.push({
      kind: 'profileInvalid',
      name: shown,
      detail: UI_TEXT.permissionProfileInvalidData,
    })
    return { name: shown, denyRead: [], extraRoots: [], isDenyAll: true }
  }
  if (name.data.trim() === '') {
    return { name: undefined, denyRead: [], extraRoots: [], isDenyAll: false }
  }
  const profiles = Object.entries(settings.profiles).slice(0, PERMISSION_PROFILES_MAX)
  const raw = profiles.find(([candidate]) => candidate === name.data)?.[1]
  if (raw === undefined) {
    problems.push({ kind: 'profileUnknown', name: name.data })
    return { name: name.data, denyRead: [], extraRoots: [], isDenyAll: true }
  }
  const parsed = permissionProfileSchema.safeParse(raw)
  if (!parsed.success) {
    problems.push({
      kind: 'profileInvalid',
      name: name.data,
      detail: UI_TEXT.permissionProfileInvalidData,
    })
    return { name: name.data, denyRead: [], extraRoots: [], isDenyAll: true }
  }
  return {
    name: name.data,
    denyRead: parsed.data.denyRead ?? [],
    extraRoots: parsed.data.extraRoots ?? [],
    isDenyAll: false,
  }
}

/** A repository's rules: its ask and forbid rules and its deny-read globs. */
function repositoryParts(
  raw: unknown,
  problems: PolicyProblem[],
): { readonly commandRules: readonly unknown[]; readonly denyRead: readonly string[] } {
  if (raw === undefined || raw === null) {
    return { commandRules: [], denyRead: [] }
  }
  const parsed = repositoryRulesSchema.safeParse(raw)
  if (!parsed.success) {
    problems.push({ kind: 'repositoryInvalid', detail: z.prettifyError(parsed.error) })
    return { commandRules: [], denyRead: [] }
  }
  return { commandRules: parsed.data.commandRules ?? [], denyRead: parsed.data.denyRead ?? [] }
}

/** The policy the settings describe, with every problem found in them. */
export function compilePolicy(
  settings: PermissionSettings,
  platform: NodeJS.Platform,
): PermissionPolicy {
  const problems: PolicyProblem[] = []
  const user = compileCommandRules(settings.commandRules, 'user')
  const repository = repositoryParts(settings.repositoryRules, problems)
  const repositoryRules = compileCommandRules(repository.commandRules, 'repository')
  for (const problem of user.problems) {
    problems.push({ kind: 'rule', source: 'user', problem })
  }
  for (const problem of repositoryRules.problems) {
    problems.push({ kind: 'rule', source: 'repository', problem })
  }
  const profile = chosenProfile(settings, problems)
  const globs = validGlobs([...profile.denyRead, ...repository.denyRead], problems)
  return {
    commandRules: [...user.rules, ...repositoryRules.rules],
    profileName: profile.name,
    files: fileRules(
      globs.valid,
      profile.isDenyAll || globs.isDenyAll,
      absoluteRoots(profile.extraRoots, platform, problems),
    ),
    problems,
  }
}

const RULE_PROBLEM_TEXT = {
  invalid: () => UI_TEXT.commandRuleInvalid,
  invalidKept: () => UI_TEXT.commandRuleInvalidKept,
  exampleFailed: () => UI_TEXT.commandRuleExampleFailed,
  exampleFailedKept: () => UI_TEXT.commandRuleExampleFailedKept,
  allowInRepository: () => UI_TEXT.commandRuleAllowInRepository,
  allowsEvaluator: () => UI_TEXT.commandRuleAllowsEvaluator,
  tooMany: () => UI_TEXT.commandRulesTooMany,
} as const satisfies Readonly<Record<RuleProblem['kind'], () => string>>

// The setting each problem is in, as the user finds it in settings.json.
const SETTING_OF_SOURCE: Readonly<Record<RuleSource, string>> = {
  user: 'museSpark.modelApiCommandRules',
  repository: 'museSpark.modelApiRepositoryRules',
}
const PROFILES_SETTING = 'museSpark.modelApiPermissionProfiles'
const PROFILE_SETTING = 'museSpark.modelApiPermissionProfile'

/** One problem as the transcript's notice says it, in the display language. */
export function describePolicyProblem(problem: PolicyProblem): string {
  switch (problem.kind) {
    case 'rule': {
      const { index, pattern, detail } = problem.problem
      return fill(RULE_PROBLEM_TEXT[problem.problem.kind](), {
        setting: SETTING_OF_SOURCE[problem.source],
        index,
        pattern,
        detail,
      })
    }
    case 'profileUnknown': {
      return fill(UI_TEXT.permissionProfileUnknown, {
        setting: PROFILE_SETTING,
        name: problem.name,
      })
    }
    case 'profileInvalid': {
      return fill(UI_TEXT.permissionProfileInvalid, {
        setting: PROFILES_SETTING,
        name: problem.name,
        detail: problem.detail,
      })
    }
    case 'globInvalid': {
      return fill(UI_TEXT.permissionGlobInvalid, { glob: problem.glob, detail: problem.detail })
    }
    case 'rootInvalid': {
      return fill(UI_TEXT.permissionRootInvalid, { setting: PROFILES_SETTING, root: problem.root })
    }
    case 'repositoryInvalid': {
      return fill(UI_TEXT.permissionRepositoryInvalid, {
        setting: SETTING_OF_SOURCE.repository,
        detail: problem.detail,
      })
    }
  }
}

/**
 * The policy for the settings as they stand, compiled once for each value
 * of them; `fresh` holds the problems of a value not seen before, to be
 * reported once.
 */
export class PolicyCache {
  private key: string | undefined
  private policy: PermissionPolicy | undefined

  public constructor(
    private readonly read: () => PermissionSettings,
    private readonly platform: NodeJS.Platform,
  ) {}

  public current(): {
    readonly policy: PermissionPolicy
    readonly fresh: readonly PolicyProblem[]
  } {
    const settings = this.read()
    const key = JSON.stringify(settings)
    if (this.policy !== undefined && key === this.key) {
      return { policy: this.policy, fresh: [] }
    }
    const policy = compilePolicy(settings, this.platform)
    this.key = key
    this.policy = policy
    return { policy, fresh: policy.problems }
  }
}
