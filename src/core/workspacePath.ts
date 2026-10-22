// A path confined to the workspace (PLAN.md D24): the Model API's tools,
// the hooks, the context loaders, Muse Code's memory, the tool rows'
// pictures and the composer's picked files all resolve a given path through
// these two, which refuse one that leaves the workspace by its text or, once
// links and junctions are resolved, by its canonical form. Kept apart from
// the Model API's tool harness so the activation bundle can confine a path
// without carrying the backend that loads on first use (M57, PLAN.md D6).

import { isCodedError, pathModule } from './workspaceRoot'
import {
  isUncPath,
  normalWindowsPath,
  unprovenUncPathReason,
  windowsPathProblem,
  windowsPathRefusalCode,
} from './windowsPathSpelling'
import { pathIdentityRelation } from './pathIdentity'

export type PathResolution =
  | {
      readonly ok: true
      readonly absolute: string
      /** Workspace-relative, forward slashes, as the model named it. */
      readonly relative: string
      /**
      Workspace-relative, forward slashes, after links are resolved: what
      the permission rules judge (a link to `.git/hooks` is `.git/hooks`).
      */
      readonly canonical: string
    }
  | { readonly ok: false; readonly reason: string; readonly code?: 'outside_workspace' }

/** A confined path and the canonical target checked before a tool read. */
type ConfinedPathResolution =
  | (Extract<PathResolution, { readonly ok: true }> & { readonly checkedAbsolute: string })
  | Extract<PathResolution, { readonly ok: false }>

/** What confinement asks of the file system: the canonical form of a path. */
export interface RealPathIo {
  /**
  Links, junctions and short names resolved through the nearest existing
  ancestor; rejects when the file system refuses to say.
  */
  realPath(absolutePath: string): Promise<string>
}

const PARENT_SEGMENT = '..'

/** The fixed clause a confinement reason carries when a link escape was refused. */
const LINK_ESCAPE_CLAUSE = 'leads outside the workspace through a link'

/** Whether a `path.relative` result stays below its base. */
export function isBelow(relative: string, p: ReturnType<typeof pathModule>): boolean {
  return (
    relative !== '' &&
    relative !== PARENT_SEGMENT &&
    !relative.startsWith(`${PARENT_SEGMENT}${p.sep}`) &&
    !p.isAbsolute(relative)
  )
}

/**
One shared normalisation for every model-given path (M101, Pi's
utils/paths and SoL-Pi's `6f74efcf23`, `8c46b7631b`, `7d7f082eea`): the
permission check and the write resolve the same text, so a path the check
lets through is the path the tool touches. Unicode spaces become spaces,
a leading `@` (a mention, not the name) is dropped, `file://` URLs become
paths, and `/c/…`, `/mnt/c/…` and `/cygdrive/c/…` become `C:/…` on
Windows. `~` is refused: it would otherwise create a literal `~` folder.
*/
export function normalizeModelPath(
  given: string,
  platform: NodeJS.Platform,
):
  | { readonly ok: true; readonly path: string }
  | { readonly ok: false; readonly reason: string; readonly code?: 'outside_workspace' } {
  let path = given.replaceAll(/[\u{00A0}\u{2000}-\u{200A}\u{202F}\u{205F}\u{3000}]/gu, ' ')
  if (path.startsWith('@')) {
    path = path.slice(1)
  }
  if (path === '~' || path.startsWith('~/') || (platform === 'win32' && path.startsWith('~\\'))) {
    return {
      ok: false,
      code: 'outside_workspace',
      reason: `path ${given} starts at the home directory, which is outside the workspace`,
    }
  }
  // `file://` by the URL's own rule, not the host's: the platform names the
  // path, so only an absolute path or a localhost one converts.
  if (path.startsWith('file://')) {
    if (!URL.canParse(path)) {
      return { ok: false, reason: `path ${given} is not a valid file URL` }
    }
    const url = new URL(path)
    if (
      url.protocol !== 'file:' ||
      (url.hostname !== '' && url.hostname !== 'localhost') ||
      url.search !== '' ||
      url.hash !== '' ||
      /%2f|%5c|%00/i.test(url.pathname)
    ) {
      return { ok: false, reason: `path ${given} is not a valid file URL` }
    }
    try {
      path = decodeURIComponent(url.pathname)
    } catch (error: unknown) {
      // Only bad percent-encoding is not a valid file URL: anything else keeps its kind.
      if (error instanceof URIError) {
        return { ok: false, reason: `path ${given} is not a valid file URL` }
      }
      throw error
    }
  }
  if (platform === 'win32') {
    const drive =
      /^\/(?:mnt\/|cygdrive\/)?([a-zA-Z])\//.exec(path) ?? /^\/([a-zA-Z])[:|]\//.exec(path)
    const letter = drive?.[1]
    if (drive !== null && letter !== undefined) {
      path = `${letter}:/${path.slice(drive[0].length)}`
    }
  }
  return { ok: true, path }
}

/**
Normalise a model-given path and resolve it against the root textually,
applying the Windows spelling rules. Lexical containment is NOT checked:
`resolveWorkspacePath` checks it, while `confineWorkspacePath` judges an
alias spelling by resolved identity instead (R4).
*/
function resolveWorkspaceAbsolute(
  workspaceRoot: string,
  given: string,
  platform: NodeJS.Platform,
):
  | { readonly ok: true; readonly root: string; readonly absolute: string }
  | { readonly ok: false; readonly reason: string; readonly code?: 'outside_workspace' } {
  const normalized = normalizeModelPath(given, platform)
  if (!normalized.ok) {
    return normalized
  }
  const problem = windowsPathProblem(normalized.path, platform, workspaceRoot)
  if (problem !== undefined) {
    const code = windowsPathRefusalCode(problem)
    return { ok: false, reason: `path ${given} ${problem}`, ...(code !== undefined && { code }) }
  }
  const p = pathModule(platform)
  const root = platform === 'win32' ? normalWindowsPath(workspaceRoot) : workspaceRoot
  const absolute = p.resolve(
    root,
    platform === 'win32' ? normalWindowsPath(normalized.path) : normalized.path,
  )
  return { ok: true, root, absolute }
}

/** Resolves a model-given path inside the workspace by its text, refusing escapes. */
export function resolveWorkspacePath(
  workspaceRoot: string,
  given: string,
  platform: NodeJS.Platform,
): PathResolution {
  const resolved = resolveWorkspaceAbsolute(workspaceRoot, given, platform)
  if (!resolved.ok) {
    return resolved
  }
  const p = pathModule(platform)
  const relative = p.relative(resolved.root, resolved.absolute)
  if (!isBelow(relative, p)) {
    return {
      ok: false,
      code: 'outside_workspace',
      reason: `path ${given} is outside the workspace`,
    }
  }
  if (
    platform === 'win32' &&
    isUncPath(resolved.absolute) &&
    pathIdentityRelation(resolved.absolute, workspaceRoot, platform) !== 'inside'
  ) {
    return { ok: false, reason: unprovenUncPathReason(given) }
  }
  const segments = relative.split(p.sep)
  const forward = segments.join('/')
  return { ok: true, absolute: resolved.absolute, relative: forward, canonical: forward }
}

/**
`resolveWorkspacePath`'s spelling rules, then containment by resolved
identity (R4): the real path of the nearest existing ancestor of the
target and of the root are compared, so a Windows 8.3 short name of the
workspace is inside it. A spelling the rules refuse (devices, streams,
the home folder, an unproven UNC root) stays refused; a link or junction
inside the workspace that leads outside it is refused as before (PLAN.md D24).
*/
export async function confineWorkspacePath(
  workspaceRoot: string,
  given: string,
  platform: NodeJS.Platform,
  io: RealPathIo,
): Promise<ConfinedPathResolution> {
  const resolved = resolveWorkspaceAbsolute(workspaceRoot, given, platform)
  if (!resolved.ok) {
    return resolved
  }
  const p = pathModule(platform)
  const lexical = p.relative(resolved.root, resolved.absolute)
  const isLexicallyInside = isBelow(lexical, p)
  if (
    isLexicallyInside &&
    platform === 'win32' &&
    isUncPath(resolved.absolute) &&
    pathIdentityRelation(resolved.absolute, workspaceRoot, platform) !== 'inside'
  ) {
    return { ok: false, reason: unprovenUncPathReason(given) }
  }
  let realRoot: string
  let realTarget: string
  try {
    ;[realRoot, realTarget] = await Promise.all([
      io.realPath(workspaceRoot),
      io.realPath(resolved.absolute),
    ])
  } catch (error: unknown) {
    // Only a shaped store failure leaves the path unresolved: a refusal or
    // anything else keeps its kind past the confinement.
    if (isCodedError(error)) {
      const detail = error instanceof Error ? error.message : String(error)
      return { ok: false, reason: `path ${given} could not be resolved: ${detail}` }
    }
    throw error
  }
  const relative = p.relative(realRoot, realTarget)
  if (isBelow(relative, p)) {
    const segments = lexical.split(p.sep)
    const forward = segments.join('/')
    return {
      ok: true,
      absolute: resolved.absolute,
      relative: forward,
      canonical: relative.split(p.sep).join('/'),
      checkedAbsolute: realTarget,
    }
  }
  return {
    ok: false,
    code: 'outside_workspace',
    reason: isLexicallyInside
      ? `path ${given} ${LINK_ESCAPE_CLAUSE}`
      : `path ${given} is outside the workspace`,
  }
}
