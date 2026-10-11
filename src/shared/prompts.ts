// M118: portable contracts only. File IO and composer/menu adapters belong to P/X.
import * as z from 'zod/mini'
import {
  PROMPT_COMMAND_IDS,
  PROMPT_FILE_EXTENSION,
  PROMPT_SCHEMA_VERSION,
  UI_TEXT,
} from './constants'

const VARIABLE = /\{\{\s*([A-Za-z_][\w-]*)\s*\}\}/g
const BUILT_INS: ReadonlySet<string> = new Set(['selection', 'file', 'clipboard'])
const FRONT_MATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/
const nameSchema = z.string().check(z.regex(/^[A-Za-z_][\w-]*$/))
const scopeSchema = z.enum(['user', 'workspace'])
const variableSchema = z
  .strictObject({
    name: nameSchema,
    source: z.enum(['selection', 'file', 'clipboard', 'input']),
  })
  .check(z.refine((v) => (v.source === 'input' ? !BUILT_INS.has(v.name) : v.name === v.source)))

/** Unique variables in first-use order; values are never expanded on import. */
export function promptVariableNames(body: string): string[] {
  return [...new Set(Array.from(body.matchAll(VARIABLE), (match) => match[1] ?? ''))]
}

const promptMetadataSchema = z.strictObject({
  schemaVersion: z.literal(PROMPT_SCHEMA_VERSION),
  id: z.string().check(z.minLength(1)),
  title: z.string().check(z.minLength(1)),
  tags: z.array(z.string().check(z.minLength(1))),
  variables: z.array(variableSchema),
  scope: scopeSchema,
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
  /** Imported text remains untrusted when persisted or copied to user scope. */
  untrusted: z.boolean(),
})
export const savedPromptSchema = z
  .strictObject({
    ...promptMetadataSchema.shape,
    body: z.string(),
  })
  .check(
    z.refine((p) => Date.parse(p.createdAt) <= Date.parse(p.updatedAt)),
    z.refine((p) => {
      const names = promptVariableNames(p.body)
      return (
        names.length === p.variables.length &&
        names.every((name) => p.variables.some((v) => v.name === name))
      )
    }),
  )
export type SavedPrompt = z.infer<typeof savedPromptSchema>

/** JSON front matter is a YAML subset; strict metadata plus a verbatim body. */
export function serialisePromptFile(input: SavedPrompt): string {
  const { body, ...metadata } = savedPromptSchema.parse(input)
  return `---\n${JSON.stringify(metadata, undefined, 2)}\n---\n${body}`
}

/** Malformed/unsupported front matter throws; never yields an empty prompt. */
export function parsePromptFile(file: string): SavedPrompt {
  const match = FRONT_MATTER.exec(file)
  if (match === null) throw new Error(UI_TEXT.promptFileInvalid)
  const metadata = promptMetadataSchema.parse(JSON.parse(match[1] ?? ''))
  return savedPromptSchema.parse({ ...metadata, body: file.slice(match[0].length) })
}

/** A foreign file cannot claim trust, execute, or resolve clipboard/editor inputs. */
export function importPromptFile(file: string, scope: SavedPrompt['scope']) {
  const prompt = { ...parsePromptFile(file), scope, untrusted: true }
  return { prompt, variables: prompt.variables, autoRun: false } as const
}

/**
 * User lane resolves agentDataFolder()/prompts/<slug>.md, independent of
 * workspace/editor. Workspace lane resolves .muse/prompts/<slug>.md.
 * Adapters validate files with parsePromptFile, enforce unique ids per scope,
 * and use checked, atomic writes. They never execute stored text.
 */
export interface PromptStoragePort {
  list(scope: SavedPrompt['scope']): Promise<readonly SavedPrompt[]>
  write(prompt: SavedPrompt, shouldKeepNewer?: boolean): Promise<void>
  remove(scope: SavedPrompt['scope'], id: string): Promise<void>
}

/** User first, then workspace; title/id lexical order, same title in both stays. */
export function mergePromptScopes(
  user: readonly SavedPrompt[],
  workspace: readonly SavedPrompt[],
): SavedPrompt[] {
  return [
    ...user.filter((p) => p.scope === 'user'),
    ...workspace.filter((p) => p.scope === 'workspace'),
  ]
    .toSorted((a, b) => {
      if (a.scope !== b.scope) return a.scope === 'user' ? -1 : 1
      const left = `${a.title}\u{0}${a.id}`
      const right = `${b.title}\u{0}${b.id}`
      if (left === right) return 0
      return left < right ? -1 : 1
    })
    .filter((p, index, all) => all.findIndex((v) => v.scope === p.scope && v.id === p.id) === index)
}

/** Load anywhere: the active chat in this workspace, or a newly created chat. */
export const promptLoadSchema = z.strictObject({
  promptId: z.string().check(z.minLength(1)),
  scope: scopeSchema,
  chat: z.enum(['active', 'new']),
  action: z.literal('insert'),
  send: z.literal(false),
})

/** Native/MHP adapters use these same ids, conditions and source payloads. */
export const promptMenuEntries = [
  {
    id: 'prompt.save.message',
    menu: 'transcript/context',
    command: PROMPT_COMMAND_IDS.save,
    when: 'museSpark.transcriptRole == user && museSpark.messageIsOwn',
    source: 'userMessage',
  },
  {
    id: 'prompt.save.composer',
    menu: 'composer/context',
    command: PROMPT_COMMAND_IDS.save,
    when: 'museSpark.composerHasText',
    source: 'composer',
  },
  {
    id: 'prompt.save.selection',
    menu: 'editor/context',
    command: PROMPT_COMMAND_IDS.save,
    when: 'editorHasSelection',
    source: 'editorSelection',
  },
  {
    id: 'prompt.use.composer',
    menu: 'composer/context',
    command: PROMPT_COMMAND_IDS.use,
    when: 'museSpark.chatAvailable',
    source: 'library',
  },
] as const

/** Export suffix only; storage uses the brief's <slug>.md within either folder. */
export function promptExportName(slug: string): string {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) throw new Error(UI_TEXT.promptFileInvalid)
  return `${slug}${PROMPT_FILE_EXTENSION}`
}
