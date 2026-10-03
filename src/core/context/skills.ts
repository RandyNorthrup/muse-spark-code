// Skills for the Model API backend (PLAN.md D13), by Muse Code's layout:
// `<root>/<id>/SKILL.md` with YAML-style front matter (`name`,
// `description`; optional `user-invocable`, `argument-hint`) above a
// Markdown body. Project skills live in the workspace's `.agents/skills`,
// personal ones in Muse Code's managed root under the config home; a
// project skill shadows a personal one with the same id. The catalogue
// (id and description) goes into the instructions; the body is loaded on
// demand by `read_skill` or a typed `/id arguments` invocation.
//
// A skill directory may be a symbolic link or a junction (D27): a personal
// one is followed wherever it leads, since the user made it in their own
// config root (a dotfiles checkout is the usual target), while a project one
// is a file the repository ships and is confined to the workspace like every
// other workspace read (D24): a link that leads outside it is skipped with a
// warning, as the file tools refuse it, and the other skills still load.

import path from 'node:path'
import {
  PERSONAL_SKILLS_DIR_SEGMENTS,
  PROJECT_SKILLS_DIR_SEGMENTS,
  SKILL_FILE_MAX_BYTES,
  SKILL_FILE_NAME,
  SKILL_ID_PATTERN,
  type SKILL_SOURCES,
} from '../../shared/constants'
import type { ContextIo } from './contextFiles'
import {
  type CatalogKind,
  type CatalogParse,
  type CatalogRoot,
  loadCatalogFiles,
  splitFrontMatter,
} from './catalogFiles'

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

export type SkillRoot = CatalogRoot<SkillSource>

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

const FALSE = 'false'
const NAME_KEY = 'name'
const DESCRIPTION_KEY = 'description'
const USER_INVOCABLE_KEY = 'user-invocable'
const ARGUMENT_HINT_KEY = 'argument-hint'

const SKILL_CATALOG: CatalogKind = {
  kind: 'skill',
  fileName: SKILL_FILE_NAME,
  maxBytes: SKILL_FILE_MAX_BYTES,
  idPattern: SKILL_ID_PATTERN,
}

/** Splits a SKILL.md into its front matter fields and body. */
export function parseSkillFile(text: string): SkillFileParse {
  const split = splitFrontMatter(text)
  if (!split.ok) {
    return split
  }
  const { fields } = split
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
      body: split.body,
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
  readonly io: ContextIo
  readonly platform: NodeJS.Platform
}

function parseCatalogFile(text: string): CatalogParse<ParsedSkillFile> {
  const parsed = parseSkillFile(text)
  return parsed.ok
    ? { ok: true, name: parsed.skill.name, entry: parsed.skill }
    : { ok: false, reason: parsed.reason }
}

/** Every valid skill under the roots, in root order; ids sorted within a root. */
export async function loadSkills(
  deps: SkillsLoaderDeps,
  roots: readonly SkillRoot[],
): Promise<SkillsLoad> {
  const load = await loadCatalogFiles(deps, roots, SKILL_CATALOG, parseCatalogFile)
  return {
    skills: load.entries.map((entry) => ({ id: entry.id, source: entry.source, ...entry.entry })),
    warnings: load.warnings,
  }
}
