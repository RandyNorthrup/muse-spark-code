import path from 'node:path'
import * as z from 'zod/mini'
import { decodeLintConfig, type LintConfig, type UpstreamLintRule } from './config'

const packId = z.string().check(z.regex(/^[\dA-Za-z][\w.-]*\/[\dA-Za-z][\w.-]*$/u))
const manifestSchema = z.strictObject({
  version: z.literal(1),
  id: packId,
  languages: z.nullish(z.array(z.string())),
  rules: z.nullish(z.string()),
  evals: z.nullish(z.string()),
})
const evalSchema = z.strictObject({
  version: z.literal(1),
  cases: z
    .array(
      z.strictObject({
        name: z.nullish(z.string()),
        rule: z.string().check(z.minLength(1)),
        file: z.string().check(z.minLength(1)),
        expect: z.enum(['pass', 'fail']),
      }),
    )
    .check(z.minLength(1)),
})
export type LintPackManifest = z.infer<typeof manifestSchema>
export interface LintEvals {
  readonly version: 1
  readonly cases: readonly z.infer<typeof evalSchema>['cases'][number][]
}

/** Refuse escapes on every platform, including Windows drive/UNC names on POSIX. */
function validatePackPath(name: string) {
  const normalized = path.posix.normalize(name.replaceAll('\\', '/'))
  if (
    normalized === '..' ||
    path.win32.isAbsolute(name) ||
    path.posix.isAbsolute(name) ||
    normalized.startsWith('../') ||
    /^[A-Za-z]:/u.test(name)
  ) {
    throw new Error('lint-pack-path-invalid')
  }
}

export function decodeLintPackManifest(text: string): LintPackManifest {
  const manifest = manifestSchema.parse(JSON.parse(text))
  for (const name of [manifest.rules, manifest.evals]) {
    if (name) validatePackPath(name)
  }
  return manifest
}

/** Caller resolves pins locally using its authorized reader; this performs no fetch. */
export function mergeLintPacks(
  cfg: LintConfig,
  loaded: readonly {
    readonly manifest: LintPackManifest
    readonly rules: readonly UpstreamLintRule[]
  }[],
): LintConfig {
  const pins = cfg.packs ?? []
  if (pins.length !== loaded.length) throw new Error('lint-pack-pin-mismatch')
  const rules = new Map<string, UpstreamLintRule>()
  for (const [index, pack] of loaded.entries()) {
    if (pack.manifest.id !== pins[index]?.id) throw new Error('lint-pack-pin-mismatch')
    if ((pack.manifest.languages ?? []).some((id) => !Object.hasOwn(cfg.languages, id))) {
      throw new Error('lint-pack-language-missing')
    }
    for (const rule of pack.rules) {
      if (rules.has(rule.id)) throw new Error('lint-rule-id-duplicate')
      rules.set(rule.id, { ...rule })
    }
  }
  const overlays = cfg.rules ?? []
  for (const overlay of overlays) {
    const base = rules.get(overlay.id)
    if (base === undefined) {
      rules.set(overlay.id, { ...overlay })
      continue
    }
    // Upstream overlays only these fields, never allowSkip/allowAbstain/context.
    const result = { ...base }
    if (overlay.description) result.description = overlay.description
    if (overlay.severity != null) result.severity = overlay.severity
    if (overlay.include != null) result.include = overlay.include
    if (overlay.exclude != null) result.exclude = overlay.exclude
    if (overlay.exceptions != null) result.exceptions = overlay.exceptions
    if (overlay.kinds != null) result.kinds = overlay.kinds
    if (overlay.localize != null) result.localize = overlay.localize
    if (overlay.minConfidence != null) result.minConfidence = overlay.minConfidence
    rules.set(overlay.id, result)
  }
  // Validate the resolved document as complete, rather than as partial overlays.
  const resolvedRules = [...rules].map(([, rule]) => rule)
  const complete = decodeLintConfig(JSON.stringify({ ...cfg, packs: [], rules: resolvedRules }))
  return { ...complete, packs: pins }
}

/** Fixture existence, authorization and grammar support belong to the caller's reader. */
export function decodeLintEvals(text: string, cfg: LintConfig): LintEvals {
  const document = evalSchema.parse(JSON.parse(text))
  const seen = new Set<string>()
  for (const item of document.cases) {
    if ((cfg.rules ?? []).every((rule) => rule.id !== item.rule)) {
      throw new Error('lint-eval-rule-unknown')
    }
    const identity = JSON.stringify([item.rule, path.normalize(item.file)])
    if (seen.has(identity)) throw new Error('lint-eval-duplicate')
    seen.add(identity)
  }
  return document
}
