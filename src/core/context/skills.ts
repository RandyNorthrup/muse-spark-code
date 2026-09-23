// Skills for the Model API backend (PLAN.md D13), by Muse Code's layout:
// `<root>/<id>/SKILL.md` with YAML-style front matter (`name`,
// `description`; optional `user-invocable`, `argument-hint`) above a
// Markdown body. Project skills live in the workspace's `.agents/skills`,
// personal ones in Muse Code's managed root under the config home; a
// project skill shadows a personal one with the same id. The catalogue
// (id and description) goes into the instructions; the body is loaded on
// demand by `read_skill` or a typed `/id arguments` invocation.

import path from 'node:path'
import {
  PERSONAL_SKILLS_DIR_SEGMENTS,
  PROJECT_SKILLS_DIR_SEGMENTS,
  SKILL_FILE_MAX_BYTES,
  SKILL_FILE_NAME,
  SKILL_ID_PATTERN,
  type SKILL_SOURCES,
} from '../../shared/constants'
import type { ToolIo } from '../backends/modelapi/tools'

export type SkillSource = (typeof SKILL_SOURCES)[number]

export interface SkillDefinition {
  /** The directory name: the selector a `/id` invocation and `read_skill` use. */
  readonly id: string
  readonly name: string
  readonly description: string
  readonly body: string
  readonly source: SkillSource
  /** Shown in the palette unless the front matter says `user-invocable: false`. */
  readonly isUserInvocable: boolean
  readonly argumentHint: string | undefined
}

export interface SkillRoot {
  /** Absolute directory holding `<id>/SKILL.md` entries. */
  readonly directory: string
  readonly source: SkillSource
}

export interface SkillsLoad {
  readonly skills: readonly SkillDefinition[]
  readonly warnings: readonly string[]
}

export interface ParsedSkillFile {
  readonly name: string
  readonly description: string
  readonly isUserInvocable: boolean
  readonly argumentHint: string | undefined
  readonly body: string
}

export type SkillFileParse =
  | { readonly ok: true; readonly skill: ParsedSkillFile }
  | { readonly ok: false; readonly reason: string }

const FRONT_MATTER_FENCE = '---'
const LINE_BREAK = /\r?\n/
const KEY_VALUE = /^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/
const QUOTE_PAIRS = [
  ['"', '"'],
  ["'", "'"],
] as const
const FALSE = 'false'
const NAME_KEY = 'name'
const DESCRIPTION_KEY = 'description'
const USER_INVOCABLE_KEY = 'user-invocable'
const ARGUMENT_HINT_KEY = 'argument-hint'

function unquote(value: string): string {
  const trimmed = value.trim()
  for (const [open, close] of QUOTE_PAIRS) {
    if (trimmed.length >= 2 && trimmed.startsWith(open) && trimmed.endsWith(close)) {
      return trimmed.slice(1, -1)
    }
  }
  return trimmed
}

/** Splits a SKILL.md into its front matter fields and body. */
export function parseSkillFile(text: string): SkillFileParse {
  const lines = text.split(LINE_BREAK)
  if (lines[0]?.trim() !== FRONT_MATTER_FENCE) {
    return { ok: false, reason: 'front matter is missing' }
  }
  const end = lines.findIndex((line, index) => index > 0 && line.trim() === FRONT_MATTER_FENCE)
  if (end === -1) {
    return { ok: false, reason: 'front matter is not closed' }
  }
  const fields = new Map<string, string>()
  for (const line of lines.slice(1, end)) {
    const match = KEY_VALUE.exec(line)
    if (match?.[1] !== undefined && match[2] !== undefined) {
      fields.set(match[1], unquote(match[2]))
    }
  }
  const name = fields.get(NAME_KEY)
  if (name === undefined || name === '') {
    return { ok: false, reason: 'front matter has no name' }
  }
  const description = fields.get(DESCRIPTION_KEY)
  if (description === undefined || description === '') {
    return { ok: false, reason: 'front matter has no description' }
  }
  const argumentHint = fields.get(ARGUMENT_HINT_KEY)
  return {
    ok: true,
    skill: {
      name,
      description,
      isUserInvocable: fields.get(USER_INVOCABLE_KEY)?.toLowerCase() !== FALSE,
      argumentHint: argumentHint === '' ? undefined : argumentHint,
      body: lines
        .slice(end + 1)
        .join('\n')
        .trim(),
    },
  }
}

function pathModule(platform: NodeJS.Platform): path.PlatformPath {
  return platform === 'win32' ? path.win32 : path.posix
}

/** The workspace's project skill root. */
export function projectSkillsRoot(workspaceRoot: string, platform: NodeJS.Platform): string {
  return pathModule(platform).join(workspaceRoot, ...PROJECT_SKILLS_DIR_SEGMENTS)
}

export interface PersonalSkillsRootInput {
  readonly platform: NodeJS.Platform
  readonly homeDir: string
  readonly xdgConfigHome: string | undefined
}

/** Muse Code's managed personal skill root (`$XDG_CONFIG_HOME/muse/skills`, else `~/.config/muse/skills`). */
export function personalSkillsRoot(input: PersonalSkillsRootInput): string {
  const p = pathModule(input.platform)
  const configHome = input.xdgConfigHome ?? p.join(input.homeDir, '.config')
  return p.join(configHome, ...PERSONAL_SKILLS_DIR_SEGMENTS)
}

export interface SkillsLoaderDeps {
  readonly io: ToolIo
  readonly platform: NodeJS.Platform
}

async function loadRoot(
  deps: SkillsLoaderDeps,
  root: SkillRoot,
  seen: Map<string, SkillSource>,
  skills: SkillDefinition[],
  warnings: string[],
): Promise<void> {
  const p = pathModule(deps.platform)
  const entries = await deps.io.listDirectory(root.directory)
  const ids = entries.toSorted((a, b) => a.localeCompare(b, 'en'))
  for (const id of ids) {
    const label = `${root.source} skill ${id}`
    if (!SKILL_ID_PATTERN.test(id)) {
      warnings.push(`${label} skipped: the directory name is not a valid skill id`)
      continue
    }
    const shadowedBy = seen.get(id)
    if (shadowedBy !== undefined) {
      warnings.push(`${label} skipped: the ${shadowedBy} skill with the same id takes precedence`)
      continue
    }
    const file = p.join(root.directory, id, SKILL_FILE_NAME)
    const text = await deps.io.readFile(file)
    if (text === undefined) {
      warnings.push(`${label} skipped: ${SKILL_FILE_NAME} is missing`)
      continue
    }
    const bytes = Buffer.byteLength(text)
    if (bytes > SKILL_FILE_MAX_BYTES) {
      warnings.push(
        `${label} skipped: ${SKILL_FILE_NAME} is ${String(bytes)} bytes, over the ${String(SKILL_FILE_MAX_BYTES)} byte limit`,
      )
      continue
    }
    const parsed = parseSkillFile(text)
    if (!parsed.ok) {
      warnings.push(`${label} skipped: ${parsed.reason}`)
      continue
    }
    if (parsed.skill.name !== id) {
      warnings.push(
        `${label}: front matter name ${parsed.skill.name} differs from the directory; the directory name is the selector`,
      )
    }
    seen.set(id, root.source)
    skills.push({ id, source: root.source, ...parsed.skill })
  }
}

/** Every valid skill under the roots, in root order; ids sorted within a root. */
export async function loadSkills(
  deps: SkillsLoaderDeps,
  roots: readonly SkillRoot[],
): Promise<SkillsLoad> {
  const seen = new Map<string, SkillSource>()
  const skills: SkillDefinition[] = []
  const warnings: string[] = []
  for (const root of roots) {
    await loadRoot(deps, root, seen, skills, warnings)
  }
  return { skills, warnings }
}
