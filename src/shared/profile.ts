// Who the person is and what they build (M110t TQ, PLAN.md D90.27): the
// first-run questionnaire's answers live in profile.json. Personas,
// languages, level and strictness; the suggested experiences follow
// from the answers, pre-filled from the world's answers where those
// exist and from the high-quality-projects skill's stack table. Pure.

import * as z from 'zod/mini'

/** The questionnaire's personas: hobbyist, professional, or team. */
export const personaSchema = z.enum(['hobbyist', 'professional', 'team'])
export type Persona = z.infer<typeof personaSchema>

/** How the person describes their level. */
export const levelSchema = z.enum(['learning', 'practicing', 'expert'])
export type Level = z.infer<typeof levelSchema>

/** How strict the agent's gates should be. */
export const strictnessSchema = z.enum(['lenient', 'balanced', 'strict'])
export type Strictness = z.infer<typeof strictnessSchema>

/** The experiences the questionnaire can suggest. */
export const experienceNameSchema = z.enum([
  'node',
  'python',
  'rust',
  'go',
  'flutter',
  'polyglot',
  'unity',
])
export type ExperienceName = z.infer<typeof experienceNameSchema>

export const PROFILE_VERSION = 1

/** profile.json: the questionnaire's answers, versioned. */
export const profileSchema = z.strictObject({
  version: z.literal(PROFILE_VERSION),
  persona: personaSchema,
  languages: z.array(z.string().check(z.minLength(1))),
  level: levelSchema,
  strictness: strictnessSchema,
  updatedAt: z.string(),
})
export type NodeProfile = z.infer<typeof profileSchema>

/** The file's name inside the node's data folder. */
export const PROFILE_FILE = 'profile.json'

/** An experience suggestion with its reason, in words. */
export interface ExperienceSuggestion {
  readonly experience: ExperienceName
  readonly reason: string
}

/**
Suggest experiences from the answers: each named language maps to its
experience, more than two languages add polyglot, and Unity tooling is
suggested only as its note (the editor is not a pack). Reasons name the
answer they follow. Pure.
*/
export function suggestExperiences(
  profile: Pick<NodeProfile, 'languages'>,
): ExperienceSuggestion[] {
  const languages = profile.languages.map((language) => language.trim().toLowerCase())
  const suggestions: ExperienceSuggestion[] = []
  const named = new Set(languages)
  const add = (experience: ExperienceName, reason: string): void => {
    if (suggestions.every((suggestion) => suggestion.experience !== experience)) {
      suggestions.push({ experience, reason })
    }
  }
  if (named.has('typescript') || named.has('javascript') || named.has('node')) {
    add('node', 'for TypeScript and JavaScript')
  }
  if (named.has('python')) add('python', 'for Python')
  if (named.has('rust')) add('rust', 'for Rust')
  if (named.has('go') || named.has('golang')) add('go', 'for Go')
  if (named.has('dart') || named.has('flutter')) add('flutter', 'for Flutter and Dart')
  if (named.has('c#') || named.has('csharp') || named.has('unity')) {
    add('unity', 'as cross-platform notes only: the Unity editor is not a pack')
  }
  if (suggestions.length > 2) add('polyglot', 'for working across stacks')
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

/**
Read the high-quality-projects skill's Phase 2 stack table out of its
SKILL.md: the `| Stack | Format | Lint | … |` rows, in order. Unknown
text yields no rows, never a guess.
*/
/** The fewest `|`-split cells a stack-table row carries. */
const STACK_TABLE_MIN_CELLS = 9

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
