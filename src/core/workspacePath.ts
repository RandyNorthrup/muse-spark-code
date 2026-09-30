// A path confined to the workspace (PLAN.md D24): the Model API's tools,
// the hooks, the context loaders, Muse Code's memory, the tool rows'
// pictures and the composer's picked files all resolve a given path through
// these two, which refuse one that leaves the workspace by its text or, once
// links and junctions are resolved, by its canonical form. Kept apart from
// the Model API's tool harness so the activation bundle can confine a path
// without carrying the backend that loads on first use (M57, PLAN.md D6).

import { pathModule } from './workspaceRoot'

export type PathResolution =
  | {
      readonly ok: true
      readonly absolute: string
      /** Workspace-relative, forward slashes, as the model named it. */
      readonly relative: string
      /**
       * Workspace-relative, forward slashes, after links are resolved: what
       * the permission rules judge (a link to `.git/hooks` is `.git/hooks`).
       */
      readonly canonical: string
    }
  | { readonly ok: false; readonly reason: string }

/** A confined path and the canonical target checked before a tool read. */
type ConfinedPathResolution =
  | (Extract<PathResolution, { readonly ok: true }> & { readonly checkedAbsolute: string })
  | Extract<PathResolution, { readonly ok: false }>

/** What confinement asks of the file system: the canonical form of a path. */
export interface RealPathIo {
  /**
   * Links, junctions and short names resolved through the nearest existing
   * ancestor; rejects when the file system refuses to say.
   */
  realPath(absolutePath: string): Promise<string>
}

const PARENT_SEGMENT = '..'
// Device names Windows resolves in every directory (`NUL`, `CON`, `COM1.txt`):
// reading one can block on a console, writing one goes nowhere.
const WINDOWS_RESERVED_NAME = /^(?:con|prn|aux|nul|conin\$|conout\$|com\d|lpt\d)(?:\..*)?$/i
const WINDOWS_TRAILING_DOT_OR_SPACE = /[. ]$/

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
 * Why a Windows path segment is refused, if it is: an alternate data stream
 * (`a.txt:hidden`), a device name, or a trailing dot or space, which Windows
 * strips (so `.git.` would be `.git`).
 */
function windowsSegmentProblem(segment: string): string | undefined {
  if (segment.includes(':')) {
    return 'names an alternate data stream'
  }
  if (WINDOWS_RESERVED_NAME.test(segment)) {
    return 'names a Windows device'
  }
  return WINDOWS_TRAILING_DOT_OR_SPACE.test(segment)
    ? 'ends a name with a dot or a space, which Windows drops'
    : undefined
}

/** Resolves a model-given path inside the workspace by its text, refusing escapes. */
export function resolveWorkspacePath(
  workspaceRoot: string,
  given: string,
  platform: NodeJS.Platform,
): PathResolution {
  const p = pathModule(platform)
  const absolute = p.resolve(workspaceRoot, given)
  const relative = p.relative(workspaceRoot, absolute)
  if (!isBelow(relative, p)) {
    return { ok: false, reason: `path ${given} is outside the workspace` }
  }
  const segments = relative.split(p.sep)
  if (platform === 'win32') {
    for (const segment of segments) {
      const problem = windowsSegmentProblem(segment)
      if (problem !== undefined) {
        return { ok: false, reason: `path ${given} ${problem}` }
      }
    }
  }
  const forward = segments.join('/')
  return { ok: true, absolute, relative: forward, canonical: forward }
}

/**
 * `resolveWorkspacePath`, then the same check on the canonical forms of the
 * root and the target: a symbolic link or junction inside the workspace
 * that leads outside it is refused (PLAN.md D24).
 */
export async function confineWorkspacePath(
  workspaceRoot: string,
  given: string,
  platform: NodeJS.Platform,
  io: RealPathIo,
): Promise<ConfinedPathResolution> {
  const textual = resolveWorkspacePath(workspaceRoot, given, platform)
  if (!textual.ok) {
    return textual
  }
  let realRoot: string
  let realTarget: string
  try {
    ;[realRoot, realTarget] = await Promise.all([
      io.realPath(workspaceRoot),
      io.realPath(textual.absolute),
    ])
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : String(error)
    return { ok: false, reason: `path ${given} could not be resolved: ${detail}` }
  }
  const p = pathModule(platform)
  const relative = p.relative(realRoot, realTarget)
  return isBelow(relative, p)
    ? { ...textual, canonical: relative.split(p.sep).join('/'), checkedAbsolute: realTarget }
    : { ok: false, reason: `path ${given} leads outside the workspace through a link` }
}
