// Who the person is and what they build (M110t TQ, PLAN.md D90.27): the
// first-run questionnaire's answers live in profile.json. The ten
// personas (several may be chosen), then the languages (pre-ticked from
// the personas), the experience level and the strictness; the suggested
// packs follow from the personas and the languages, with shell and
// cross-cutting for every answer. Pure.
import * as z from 'zod/mini'

/** The questionnaire's ten personas (D90.27's amendment). */
export const personaSchema = z.enum([
  'makers-and-embedded',
  'web',
  'data-and-ml',
  'mobile',
  'backend-and-devops',
  'game-and-graphics',
  'systems',
  'security-and-ctf',
  'docs-and-writing',
  'learning-and-students',
])
export type Persona = z.infer<typeof personaSchema>

/** The personas in words, for reasons and questions. */
export const PERSONA_LABELS: Record<Persona, string> = {
  'makers-and-embedded': 'makers and embedded',
  web: 'web',
  'data-and-ml': 'data and ML',
  mobile: 'mobile',
  'backend-and-devops': 'backend and DevOps',
  'game-and-graphics': 'game and graphics',
  systems: 'systems',
  'security-and-ctf': 'security and CTF',
  'docs-and-writing': 'docs and writing',
  'learning-and-students': 'learning and students',
}

/** The fourteen toolchain packs (D90.27's table). */
export const packNameSchema = z.enum([
  'typescript',
  'python',
  'rust',
  'cpp',
  'csharp',
  'go',
  'java',
  'shell',
  'devops',
  'docs',
  'mobile',
  'makers',
  'game',
  'crosscutting',
])
export type PackName = z.infer<typeof packNameSchema>

/** The packs each persona stands on (D90.27's "Chosen by" column). */
export const PERSONA_PACKS: Record<Persona, readonly PackName[]> = {
  'makers-and-embedded': ['makers'],
  web: ['typescript'],
  'data-and-ml': ['python'],
  mobile: ['mobile'],
  'backend-and-devops': ['devops'],
  'game-and-graphics': ['game'],
  systems: ['cpp', 'rust'],
  'security-and-ctf': [],
  'docs-and-writing': ['docs'],
  'learning-and-students': ['python'],
}

/** The packs every answer takes: shell for every stack, gates for all. */
export const ALWAYS_PACKS: readonly PackName[] = ['shell', 'crosscutting']

/** The languages the second question offers, by id. */
export const languageIdSchema = z.enum([
  'typescript',
  'python',
  'rust',
  'c',
  'cpp',
  'csharp',
  'dotnet',
  'go',
  'java',
  'kotlin',
])
export type LanguageId = z.infer<typeof languageIdSchema>

/** The languages in words, for reasons and questions. */
export const LANGUAGE_LABELS: Record<LanguageId, string> = {
  typescript: 'TypeScript',
  python: 'Python',
  rust: 'Rust',
  c: 'C',
  cpp: 'C++',
  csharp: 'C#',
  dotnet: '.NET',
  go: 'Go',
  java: 'Java',
  kotlin: 'Kotlin',
}

/** The pack each language stands on. */
export const LANGUAGE_PACKS: Record<LanguageId, PackName> = {
  typescript: 'typescript',
  python: 'python',
  rust: 'rust',
  c: 'cpp',
  cpp: 'cpp',
  csharp: 'csharp',
  dotnet: 'csharp',
  go: 'go',
  java: 'java',
  kotlin: 'java',
}

/** Words the questionnaire accepts for each language. */
const LANGUAGE_ALIASES: ReadonlyMap<string, LanguageId> = new Map([
  ['typescript', 'typescript'],
  ['javascript', 'typescript'],
  ['js', 'typescript'],
  ['ts', 'typescript'],
  ['python', 'python'],
  ['rust', 'rust'],
  ['c', 'c'],
  ['c++', 'cpp'],
  ['cpp', 'cpp'],
  ['c#', 'csharp'],
  ['csharp', 'csharp'],
  ['.net', 'dotnet'],
  ['dotnet', 'dotnet'],
  ['f#', 'dotnet'],
  ['go', 'go'],
  ['golang', 'go'],
  ['java', 'java'],
  ['kotlin', 'kotlin'],
])

/** Stack words that are not languages but still name their pack. */
const STACK_PACKS: ReadonlyMap<string, { pack: PackName; reason: string }> = new Map([
  ['flutter', { pack: 'mobile', reason: 'for Flutter (the Android SDK and mobile gates)' }],
  ['dart', { pack: 'mobile', reason: 'for Flutter (the Android SDK and mobile gates)' }],
  [
    'unity',
    { pack: 'csharp', reason: "for C# (Unity's editor has its own licence and is not a pack)" },
  ],
])

/** The languages each persona pre-ticks in the second question. */
export const PERSONA_LANGUAGES: Record<Persona, readonly LanguageId[]> = {
  'makers-and-embedded': ['python'],
  web: ['typescript'],
  'data-and-ml': ['python'],
  mobile: ['typescript', 'kotlin'],
  'backend-and-devops': ['go', 'python'],
  'game-and-graphics': ['csharp', 'cpp'],
  systems: ['c', 'cpp', 'rust'],
  'security-and-ctf': ['python'],
  'docs-and-writing': [],
  'learning-and-students': ['python'],
}

/** How the person describes their level. */
export const levelSchema = z.enum(['new', 'comfortable', 'expert'])
export type Level = z.infer<typeof levelSchema>

/** How strict the quality defaults are. */
export const strictnessSchema = z.enum(['strict', 'standard', 'light'])
export type Strictness = z.infer<typeof strictnessSchema>

/**
The gate sets each strictness proposes (D90.27): strict takes the
skill's full set, standard takes format, lint, types, tests and secrets
(dead code and duplication come later), light takes format, secrets and
tests. A default for new projects, never a loosening.
*/
export const STRICTNESS_GATES: Record<Strictness, readonly string[]> = {
  strict: ['format', 'lint', 'types', 'dead-code', 'duplication', 'security', 'tests'],
  standard: ['format', 'lint', 'types', 'tests', 'secrets'],
  light: ['format', 'secrets', 'tests'],
}

export const PROFILE_VERSION = 1

/** profile.json: the questionnaire's answers, versioned. */
export const profileSchema = z.strictObject({
  version: z.literal(PROFILE_VERSION),
  personas: z.array(personaSchema).check(z.minLength(1)),
  languages: z.array(z.string().check(z.minLength(1))),
  level: levelSchema,
  strictness: strictnessSchema,
  updatedAt: z.string(),
})
export type NodeProfile = z.infer<typeof profileSchema>

/** The file's name beside node.json. */
export const PROFILE_FILE = 'profile.json'

/** A suggested pack with its reason, in words. */
export interface PackSuggestion {
  readonly pack: PackName
  readonly reason: string
}

/**
The packs a persona experience installs: the persona's own packs, then
shell and cross-cutting for every answer.
*/
export function personaPacks(persona: Persona): readonly PackName[] {
  return [...PERSONA_PACKS[persona], ...ALWAYS_PACKS]
}

/**
Suggest packs from the answers: each persona's packs, each named
language's pack, then shell and cross-cutting for every answer. Reasons
name the answer they follow. Unknown words suggest nothing, never a
guess. Pure.
*/
export function suggestPacks(
  profile: Pick<NodeProfile, 'personas' | 'languages'>,
): PackSuggestion[] {
  const suggestions: PackSuggestion[] = []
  const add = (pack: PackName, reason: string): void => {
    if (suggestions.every((suggestion) => suggestion.pack !== pack)) {
      suggestions.push({ pack, reason })
    }
  }
  for (const persona of profile.personas) {
    const label = PERSONA_LABELS[persona]
    const packs = PERSONA_PACKS[persona]
    for (const pack of packs) {
      add(pack, `for the ${label} persona`)
    }
  }
  for (const language of profile.languages) {
    const word = language.trim().toLowerCase()
    const id = LANGUAGE_ALIASES.get(word)
    if (id !== undefined) {
      add(LANGUAGE_PACKS[id], `for ${LANGUAGE_LABELS[id]}`)
      continue
    }
    const stack = STACK_PACKS.get(word)
    if (stack !== undefined) add(stack.pack, stack.reason)
  }
  add('shell', 'for every stack')
  add('crosscutting', 'for every answer')
  return suggestions
}

/** One row of the skill's Phase 2 stack table: the stack and its gates. */
export interface StackTableRow {
  readonly stack: string
  readonly format: string
  readonly lint: string
  readonly types: string
  readonly deadCode: string
  readonly security: string
  readonly test: string
}

/** The fewest `|`-split cells a stack-table row carries. */
const STACK_TABLE_MIN_CELLS = 9

/**
Read the high-quality-projects skill's Phase 2 stack table out of its
SKILL.md: the `| Stack | Format | Lint | … |` rows, in order. Unknown
text yields no rows, never a guess.
*/
export function parseStackTable(skillMarkdown: string): StackTableRow[] {
  const rows: StackTableRow[] = []
  let isInTable = false
  for (const line of skillMarkdown.split('\n')) {
    const cells = line.split('|').map((cell) => cell.trim())
    if (cells.length >= STACK_TABLE_MIN_CELLS && cells[1]?.toLowerCase() === 'stack') {
      isInTable = true
      continue
    }
    if (!isInTable) continue
    if (cells.length < STACK_TABLE_MIN_CELLS || cells[1] === undefined || cells[1] === '') break
    if (/^:?-{2,}:?$/.test(cells[1])) continue
    rows.push({
      stack: cells[1],
      format: cells[2] ?? '',
      lint: cells[3] ?? '',
      types: cells[4] ?? '',
      deadCode: cells[5] ?? '',
      security: cells[6] ?? '',
      test: cells[7] ?? '',
    })
  }
  return rows
}

/** One questionnaire question: its answer key and whether it takes several. */
export interface QuestionStep {
  readonly key: 'personas' | 'languages' | 'level' | 'strictness'
  readonly multi: boolean
}

/**
The questionnaire's order, shared by every surface (first boot, Settings,
the launcher, the TUI): personas, then languages, experience level and
strictness. Prompts and labels are the surfaces' own words.
*/
export const QUESTION_STEPS: readonly QuestionStep[] = [
  { key: 'personas', multi: true },
  { key: 'languages', multi: true },
  { key: 'level', multi: false },
  { key: 'strictness', multi: false },
]

/** The questionnaire's answers, before they are filed as a profile. */
export interface ProfileAnswers {
  readonly personas: readonly Persona[]
  readonly languages: readonly string[]
  readonly level: Level
  readonly strictness: Strictness
}

/**
File the answers as profile.json: validated, stamped, versioned. The
stamp rides the caller's clock so tests pin it; surfaces pass now.
*/
export function buildProfile(answers: ProfileAnswers, updatedAt: string): NodeProfile {
  return profileSchema.parse({ ...answers, version: PROFILE_VERSION, updatedAt })
}

/** One pack's pre-install facts, as the definitions and index carry them. */
export interface PackPreviewInput {
  readonly version: string
  readonly description: string
  readonly license: string
  readonly tools: readonly { readonly name: string; readonly version: string }[]
  readonly sizeBytes?: number
  readonly clickThrough: boolean
}

/** One pack's row in the pre-install list: structured, surfaces format. */
export interface PackPreviewRow {
  readonly pack: PackName
  readonly reason: string
  readonly version: string
  readonly description: string
  readonly license: string
  readonly tools: readonly { readonly name: string; readonly version: string }[]
  readonly sizeBytes?: number
  readonly clickThrough: boolean
}

/**
The pack list with tools, versions, licences, sizes and sources before
**Install**: each suggestion joined to its definition. A suggestion
without a definition is a caller bug — suggestions name known packs.
*/
export function previewPacks(
  suggestions: readonly PackSuggestion[],
  packs: ReadonlyMap<string, PackPreviewInput>,
): PackPreviewRow[] {
  return suggestions.map((suggestion) => {
    const input = packs.get(suggestion.pack)
    if (input === undefined) throw new Error(`no definition previews ${suggestion.pack}`)
    return {
      pack: suggestion.pack,
      reason: suggestion.reason,
      version: input.version,
      description: input.description,
      license: input.license,
      tools: input.tools,
      ...(input.sizeBytes !== undefined && { sizeBytes: input.sizeBytes }),
      clickThrough: input.clickThrough,
    }
  })
}
