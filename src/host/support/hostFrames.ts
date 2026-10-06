// Host stack frames for the flight recorder (M93, PLAN.md D72): where a
// failure happened inside the installed extension's shipped bundles, never
// what it said. Loaded with the recorder (dist/recorder.js).

import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { REPORT_PACKAGE_FRAME_PATHS } from '../../shared/constants'
import { packageFramesOf, stackOf, type PackageFrame } from '../../shared/stackFrames'

const FILE_URL_PREFIX = 'file://'

/**
 * A host stack frame's file as the package names it: a file under the
 * installed extension's root, one of REPORT_PACKAGE_FRAME_PATHS, with `/`
 * separators. Anything else (Node's own frames, other extensions, the user's
 * files) is undefined and dropped.
 */
export function hostPackagePath(location: string, extensionRoot: string): string | undefined {
  let file = location
  if (file.startsWith(FILE_URL_PREFIX)) {
    try {
      file = fileURLToPath(file)
    } catch {
      return undefined
    }
  }
  if (!path.isAbsolute(file)) {
    return undefined
  }
  const relative = path.relative(path.toNamespacedPath(extensionRoot), path.toNamespacedPath(file))
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
    return undefined
  }
  const packaged = relative.split(path.sep).join('/')
  return REPORT_PACKAGE_FRAME_PATHS.has(packaged) ? packaged : undefined
}

/** A failure's frames inside the installed extension, most recent first. */
export function hostFramesOf(error: unknown, extensionRoot: string): readonly PackageFrame[] {
  return packageFramesOf(stackOf(error), (location) => hostPackagePath(location, extensionRoot))
}
