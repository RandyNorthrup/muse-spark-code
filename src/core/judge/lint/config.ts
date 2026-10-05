import * as z from 'zod/mini'
import type { LintRule } from './rules'
import { lintKinds } from './units'

// Canonical JSON fields from jevlint 73a7a94a, internal/config/config.go.
const strings = z.nullish(z.array(z.string()))
const confidence = z.nullish(z.number().check(z.minimum(0), z.maximum(1)))
const kinds = z.nullish(z.array(z.enum(lintKinds)))
const localize = z.nullish(z.array(z.enum(['comment', 'docComment', 'field', 'statement'])))
const ruleSchema = z.strictObject({
  id: z.string(),
  description: z.nullish(z.string()),
  severity: z.optional(z.enum(['info', 'warning', 'error'])),
  include: strings,
  exclude: strings,
  exceptions: strings,
  kinds,
  localize,
  minConfidence: confidence,
  allowSkip: z.nullish(z.boolean()),
  allowAbstain: z.nullish(z.boolean()),
  context: z.nullish(z.strictObject({ callees: z.nullish(z.boolean()) })),
})
const languageSchema = z.strictObject({
  extensions: strings,
  functionQueries: strings,
  typeQueries: strings,
  typeContextQueries: strings,
  regions: z.nullish(
    z.partialRecord(z.enum(['comment', 'docComment', 'field', 'statement']), strings),
  ),
})
const packRefSchema = z.strictObject({
  id: z.string(),
  source: z.string(),
  path: z.nullish(z.string()),
  ref: z.nullish(z.string()),
  sha: z.string(),
})
const configSchema = z.strictObject({
  languages: z.record(z.string(), z.nullable(languageSchema)),
  minConfidence: confidence,
  packs: z.nullish(z.array(packRefSchema)),
  rules: z.nullish(z.array(ruleSchema)),
})
const presets: ReadonlySet<string> = new Set([
  'c',
  'cpp',
  'csharp',
  'go',
  'java',
  'javascript',
  'kotlin',
  'php',
  'python',
  'ruby',
  'rust',
  'tsx',
  'typescript',
])

export type LintConfig = z.infer<typeof configSchema>
export type UpstreamLintRule = z.infer<typeof ruleSchema>

function invalid(): never {
  throw new Error('lint-config-invalid')
}
function isBlank(value: string) {
  return value.trim().length === 0
}
function isComplete(rule: UpstreamLintRule) {
  return rule.description != null && !isBlank(rule.description) && rule.severity != null
}

/** JSON.parse also refuses a trailing second value; every nested object is strict. */
export function decodeLintConfig(text: string): LintConfig {
  const cfg = configSchema.parse(JSON.parse(text))
  if (Object.keys(cfg.languages).length === 0) invalid()
  const extensions = new Set<string>()
  for (const [id, language] of Object.entries(cfg.languages)) {
    if (!presets.has(id)) invalid()
    if (language == null) continue
    for (const values of [
      language.extensions,
      language.functionQueries,
      language.typeQueries,
      language.typeContextQueries,
    ]) {
      if (values != null && (values.length === 0 || values.some((value) => isBlank(value))))
        invalid()
    }
    const customExtensions = language.extensions ?? []
    for (const extension of customExtensions) {
      if (
        !extension.startsWith('.') ||
        extension !== extension.toLowerCase() ||
        /[/\\]/u.test(extension) ||
        extensions.has(extension)
      )
        invalid()
      extensions.add(extension)
    }
    const regions = Object.values(language.regions ?? {})
    for (const values of regions) {
      if (values == null || values.length === 0 || values.some((value) => isBlank(value))) invalid()
    }
  }
  const packIds = new Set<string>()
  const packs = cfg.packs ?? []
  for (const pack of packs) {
    if ([pack.id, pack.source, pack.sha].some((value) => isBlank(value)) || packIds.has(pack.id))
      invalid()
    packIds.add(pack.id)
  }
  const ruleIds = new Set<string>()
  const rules = cfg.rules ?? []
  for (const rule of rules) {
    if (isBlank(rule.id) || ruleIds.has(rule.id)) invalid()
    ruleIds.add(rule.id)
    if (
      (rule.include ?? []).some((value) => isBlank(value)) ||
      (rule.exclude ?? []).some((value) => isBlank(value))
    )
      invalid()
    if ((cfg.packs?.length ?? 0) === 0 && !isComplete(rule)) invalid()
  }
  return cfg
}

export function decodeLintPackRules(text: string): readonly UpstreamLintRule[] {
  const document = z
    .strictObject({ rules: z.array(ruleSchema).check(z.minLength(1)) })
    .parse(JSON.parse(text))
  return document.rules
}

/** Normalize only resolved rules; omitted/empty kinds mean function and type upstream. */
export function normalizeLintRules(cfg: LintConfig): readonly LintRule[] {
  return (cfg.rules ?? []).map((rule) => {
    const description = rule.description
    const severity = rule.severity
    if (description == null || severity == null || isBlank(description)) invalid()
    return {
      id: rule.id,
      description,
      severity,
      kinds: rule.kinds?.length ? rule.kinds : ['function', 'type'],
      include: rule.include ?? [],
      exclude: rule.exclude ?? [],
      exceptions: rule.exceptions ?? [],
      localize: rule.localize ?? [],
      minConfidence: rule.minConfidence ?? cfg.minConfidence ?? 0,
      allowSkip: rule.allowSkip ?? false,
      allowAbstain: rule.allowAbstain ?? false,
      callees: rule.context?.callees ?? false,
    }
  })
}
