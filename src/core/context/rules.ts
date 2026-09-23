// The workspace rules files the Model API backend gives the model (PLAN.md
// D13), by Muse Code's conventions: `AGENTS.md` is the rules file of a
// directory and `CLAUDE.md` is read only where `AGENTS.md` is absent; the
// root file is loaded at session start and a subdirectory's file the first
// time a tool touches a path beneath it; deeper files come later so they
// win. A file over `RULES_FILE_MAX_BYTES` is skipped and the whole context
// is cut at `RULES_CONTEXT_MAX_BYTES`, each with the warning Muse prints. A
// file that is not text, or leads outside the workspace through a link, is
// skipped with the reason (D27). Pure: every read goes through `ContextIo`.

import path from 'node:path'
import {
  RULES_CONTEXT_MAX_BYTES,
  RULES_FILE_MAX_BYTES,
  RULES_FILE_NAMES,
  RULES_TRUNCATED_MARKER,
} from '../../shared/constants'
import { type ContextIo, readContextText } from './contextFiles'

export interface RuleFile {
  /** Workspace-relative, forward slashes (`AGENTS.md`, `src/CLAUDE.md`). */
  readonly path: string
  /** The directory the file governs, relative with forward slashes; `''` is the root. */
  readonly directory: string
  readonly text: string
}

export interface RuleFileLoad {
  readonly file: RuleFile | undefined
  readonly warning: string | undefined
}

export interface RulesLoaderDeps {
  readonly io: ContextIo
  readonly workspaceRoot: string
  readonly platform: NodeJS.Platform
}

const SEPARATOR = '/'

function pathModule(platform: NodeJS.Platform): path.PlatformPath {
  return platform === 'win32' ? path.win32 : path.posix
}

/** The directories between the root and `relativePath`'s parent, shallowest first. */
export function ruleDirectoriesFor(relativePath: string): readonly string[] {
  const segments = relativePath.split(SEPARATOR).filter((segment) => segment !== '')
  const directories: string[] = []
  for (let depth = 1; depth < segments.length; depth += 1) {
    directories.push(segments.slice(0, depth).join(SEPARATOR))
  }
  return directories
}

/**
 * The rules file of one directory: `AGENTS.md`, else `CLAUDE.md`, else none.
 * Over the size limit the file is skipped with Muse Code's warning; a file
 * that cannot be read as text, or leads outside the workspace, is skipped
 * with the reason. Either way the other name is not tried: the first one
 * present governs the directory.
 */
export async function loadRuleFile(
  deps: RulesLoaderDeps,
  directory: string,
): Promise<RuleFileLoad> {
  const p = pathModule(deps.platform)
  for (const name of RULES_FILE_NAMES) {
    const relative = directory === '' ? name : `${directory}${SEPARATOR}${name}`
    const absolute = p.join(deps.workspaceRoot, ...relative.split(SEPARATOR))
    const read = await readContextText(deps, absolute, deps.workspaceRoot)
    if (read === undefined) {
      continue
    }
    if (!read.ok) {
      return {
        file: undefined,
        warning: `rules file at ${relative} ${read.reason}; it is skipped for this session`,
      }
    }
    const { text } = read
    const bytes = Buffer.byteLength(text)
    if (bytes > RULES_FILE_MAX_BYTES) {
      return {
        file: undefined,
        warning: `rules file at ${relative} is ${String(bytes)} bytes, over the ${String(RULES_FILE_MAX_BYTES)} byte load limit; it is skipped for this session; trim it (or split it into smaller files) to load it`,
      }
    }
    return { file: { path: relative, directory, text }, warning: undefined }
  }
  return { file: undefined, warning: undefined }
}

export interface RulesContext {
  /** The rules section for the instructions, shallowest file first. */
  readonly text: string
  readonly warning: string | undefined
}

/** Renders the loaded files as one section, cut at the context limit. */
export function renderRules(files: readonly RuleFile[]): RulesContext {
  const sections = files.map((file) => `## Rules from ${file.path}\n\n${file.text.trim()}`)
  const text = sections.join('\n\n')
  const bytes = Buffer.byteLength(text)
  if (bytes <= RULES_CONTEXT_MAX_BYTES) {
    return { text, warning: undefined }
  }
  const cut = Buffer.from(text).subarray(0, RULES_CONTEXT_MAX_BYTES).toString()
  return {
    text: `${cut}\n${RULES_TRUNCATED_MARKER}`,
    warning: `rules context produced ${String(bytes)} bytes, over the ${String(RULES_CONTEXT_MAX_BYTES)} byte limit; it will be truncated for this session`,
  }
}
