// M124 (D106): M118's prompt library through the connector. Listing returns
// metadata only; bodies need the content grant and arrive scrubbed, marked
// untrusted. A save is a new prompt, marked untrusted, written only after
// our approval page approves the exact text (registry.ts owns that path).
import { randomUUID } from 'node:crypto'
import { PROMPT_SCHEMA_VERSION } from '../../../shared/constants'
import { promptVariableNames, type SavedPrompt } from '../../../shared/prompts'

export interface PromptsPort {
  readonly list: (
    root: string | undefined,
    scope: SavedPrompt['scope'],
    signal?: AbortSignal,
  ) => Promise<readonly SavedPrompt[]>
  /**
   * The approved save; with `expectedGeneration` the store recomputes the
   * library generation under its write lock and throws instead of landing a
   * save the library moved under (Codex on PR #227).
   */
  readonly write: (
    root: string | undefined,
    prompt: SavedPrompt,
    expectedGeneration?: number,
  ) => Promise<void>
  /** M118's scrubbed share preview of a saved prompt (in memory). */
  readonly preview: (
    root: string | undefined,
    prompt: SavedPrompt,
    format: 'md' | 'html' | 'json',
  ) => string
}

const BUILT_IN_SOURCES = ['selection', 'file', 'clipboard'] as const
const VARIABLE = /\{\{\s*([A-Za-z_][\w-]*)\s*\}\}/gu

export function promptGeneration(prompt: SavedPrompt): number {
  return Date.parse(prompt.updatedAt)
}

/** The scope's library generation: its newest revision, 0 when empty. */
export function libraryGeneration(prompts: readonly SavedPrompt[]): number {
  let newest = 0
  for (const prompt of prompts) newest = Math.max(newest, promptGeneration(prompt))
  return newest
}

export function promptSummary(prompt: SavedPrompt) {
  return {
    id: prompt.id,
    title: prompt.title,
    tags: prompt.tags,
    scope: prompt.scope,
    variables: prompt.variables.map((variable) => variable.name),
    untrusted: prompt.untrusted,
    generation: promptGeneration(prompt),
  }
}

export function isMatching(
  prompt: SavedPrompt,
  query: string | undefined,
  tags: readonly string[] | undefined,
): boolean {
  const needle = query?.toLocaleLowerCase()
  const isInText =
    needle === undefined ||
    prompt.title.toLocaleLowerCase().includes(needle) ||
    prompt.tags.some((tag) => tag.toLocaleLowerCase().includes(needle))
  return isInText && (tags ?? []).every((tag) => prompt.tags.includes(tag))
}

export type PrepareOutcome =
  | { readonly kind: 'ok'; readonly text: string }
  | { readonly kind: 'builtIn' }
  | { readonly kind: 'missing'; readonly names: readonly string[] }
  | { readonly kind: 'undeclared'; readonly names: readonly string[] }

/** Fills declared input variables; built-ins need an editor and refuse. */
export function preparePrompt(
  prompt: SavedPrompt,
  values: Readonly<Record<string, string>>,
): PrepareOutcome {
  if (prompt.variables.some((variable) => variable.source !== 'input')) return { kind: 'builtIn' }
  const declared = new Set(prompt.variables.map((variable) => variable.name))
  const undeclared = Object.keys(values).filter((name) => !declared.has(name))
  if (undeclared.length > 0) return { kind: 'undeclared', names: undeclared }
  const missing = [...declared].filter((name) => values[name] === undefined)
  if (missing.length > 0) return { kind: 'missing', names: missing }
  return {
    kind: 'ok',
    text: prompt.body.replaceAll(VARIABLE, (_match, name: string) => values[name] ?? ''),
  }
}

export interface PromptDraftInput {
  readonly scope: SavedPrompt['scope']
  readonly title: string
  readonly body: string
  readonly tags: readonly string[]
}

/**
 * Whether a draft fits M118's own limits, before anything is shown or saved
 * (D121: a scope holds prompts of any title/body length; only a blank title
 * refuses).
 */
export function isDraftWithinLimits(draft: PromptDraftInput): boolean {
  return draft.title.trim() !== ''
}

/** A new prompt from another agent: a fresh id, always untrusted. */
export function newPrompt(draft: PromptDraftInput, nowIso: string): SavedPrompt {
  return {
    schemaVersion: PROMPT_SCHEMA_VERSION,
    id: randomUUID(),
    title: draft.title,
    tags: [...draft.tags],
    variables: promptVariableNames(draft.body).map((name) => ({
      name,
      source: BUILT_IN_SOURCES.find((source) => source === name) ?? 'input',
    })),
    scope: draft.scope,
    createdAt: nowIso,
    updatedAt: nowIso,
    untrusted: true,
    body: draft.body,
  }
}
