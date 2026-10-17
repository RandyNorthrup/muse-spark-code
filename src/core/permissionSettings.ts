// The permission settings of M78 (PLAN.md D49) as the Model API backend
// reads them: command rules, named permission profiles and the one chosen,
// and the rules a repository may add. The user's rules, the profiles and
// the choice are machine-scoped (user or machine settings only); the
// repository's setting is not, so everything in it can only tighten: an
// allow rule or an extra root there is refused.
//
// The settings reader keeps each value whole whatever it holds; the
// backend's bundle parses each rule and profile with these schemas and
// reports what it refuses, one entry at a time, so a mistake in one rule
// never drops the others (permissionPolicy.ts).

import * as z from 'zod/mini'
import {
  COMMAND_RULE_DECISIONS,
  COMMAND_RULE_EXAMPLE_MAX_CHARS,
  COMMAND_RULE_JUSTIFICATION_MAX_CHARS,
  COMMAND_RULE_MAX_EXAMPLES,
  COMMAND_RULE_MAX_WORDS,
  COMMAND_RULE_SHELLS,
  COMMAND_RULE_WORD_MAX_CHARS,
  PERMISSION_PROFILE_MAX_GLOBS,
  PERMISSION_PROFILE_MAX_ROOTS,
} from '../shared/constants'

const exampleSchema = z.string().check(z.minLength(1), z.maxLength(COMMAND_RULE_EXAMPLE_MAX_CHARS))

/**
 * One prefix rule (Codex's `prefix_rule`): the words a command starts with,
 * what to do with it, and the command lines it must and must not match,
 * checked whenever the rules are read (the tests kept beside the rule).
 */
export const commandRuleSchema = z.object({
  pattern: z
    .array(z.string().check(z.minLength(1), z.maxLength(COMMAND_RULE_WORD_MAX_CHARS)))
    .check(z.minLength(1), z.maxLength(COMMAND_RULE_MAX_WORDS)),
  decision: z.enum(COMMAND_RULE_DECISIONS),
  /** The shell the rule is for; both when omitted. */
  shell: z.optional(z.enum(COMMAND_RULE_SHELLS)),
  /** Why, as the card and the model's refusal quote it. */
  justification: z.optional(z.string().check(z.maxLength(COMMAND_RULE_JUSTIFICATION_MAX_CHARS))),
  match: z.array(exampleSchema).check(z.minLength(1), z.maxLength(COMMAND_RULE_MAX_EXAMPLES)),
  notMatch: z.optional(z.array(exampleSchema).check(z.maxLength(COMMAND_RULE_MAX_EXAMPLES))),
})

/**
 * A named permission profile: the files the file tools must not touch
 * (globs over workspace-relative paths) and folders outside the workspace
 * `read_file` may read (absolute paths).
 */
export const permissionProfileSchema = z.strictObject({
  denyRead: z.optional(z.array(z.string()).check(z.maxLength(PERMISSION_PROFILE_MAX_GLOBS))),
  extraRoots: z.optional(z.array(z.string()).check(z.maxLength(PERMISSION_PROFILE_MAX_ROOTS))),
})

/** What a repository may add: rules that ask or forbid, and more deny-read globs. */
export const repositoryRulesSchema = z.object({
  commandRules: z.optional(z.array(z.unknown())),
  denyRead: z.optional(z.array(z.string()).check(z.maxLength(PERMISSION_PROFILE_MAX_GLOBS))),
})

/** The four settings as read, each value kept whole for the bundle to parse. */
export interface PermissionSettings {
  /** `museSpark.modelApiCommandRules` (machine). */
  readonly commandRules: readonly unknown[]
  /** `museSpark.modelApiPermissionProfiles` (machine). */
  readonly profiles: Readonly<Record<string, unknown>>
  /** `museSpark.modelApiPermissionProfile` (machine); empty for none. */
  readonly profile: unknown
  /** `museSpark.modelApiRepositoryRules` (any scope; it can only tighten). */
  readonly repositoryRules: unknown
}
