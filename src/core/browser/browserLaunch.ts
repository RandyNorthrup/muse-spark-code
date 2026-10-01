// Finding and starting the system Chrome or Edge for the browser check (M81,
// PLAN.md D49). No bundled browser: the well-known places first, then PATH
// by absolute entry only (D24, `resolveExecutable`), so a `chrome` committed
// to the workspace never runs. The command line is fixed (constants.ts):
// headless, CDP over `--remote-debugging-pipe` and never a port, a fresh
// temporary profile, and a proxy bypass list of loopback plus the hosts this
// check may reach. Pure: the file probe and the environment are injected.

import path from 'node:path'
import {
  BROWSER_BLANK_PAGE,
  BROWSER_LAUNCH_FLAGS,
  BROWSER_MACOS_PATHS,
  BROWSER_POSIX_PATH_NAMES,
  BROWSER_PROFILE_FLAG,
  BROWSER_PROXY_BYPASS_FLAG,
  BROWSER_PROXY_BYPASS_LOOPBACK,
  BROWSER_WINDOWS_PATH_NAMES,
  BROWSER_WINDOWS_PATH_SUFFIXES,
  BROWSER_WINDOWS_PROGRAM_DIR_VARIABLES,
} from '../../shared/constants'
import { resolveExecutable } from '../executables'

export interface BrowserDiscovery {
  readonly platform: NodeJS.Platform
  /** The PATH value, unsplit. */
  readonly pathVariable: string | undefined
  /** An environment variable by name: Windows' program folders. */
  readonly variable: (name: string) => string | undefined
  readonly fileExists: (filePath: string) => boolean
}

/** The well-known absolute places a system Chrome or Edge lives, in the order tried. */
function wellKnownPaths(discovery: BrowserDiscovery): readonly string[] {
  if (discovery.platform === 'darwin') {
    return BROWSER_MACOS_PATHS
  }
  if (discovery.platform !== 'win32') {
    return []
  }
  return BROWSER_WINDOWS_PROGRAM_DIR_VARIABLES.flatMap((name) => {
    const folder = discovery.variable(name)
    // A relative value would be read against the working folder: only an absolute one counts.
    return folder === undefined || !path.win32.isAbsolute(folder)
      ? []
      : BROWSER_WINDOWS_PATH_SUFFIXES.map((suffix) => path.win32.join(folder, suffix))
  })
}

/** The absolute path of a system Chrome or Edge, or undefined when none is installed. */
export function findBrowserExecutable(discovery: BrowserDiscovery): string | undefined {
  const known = wellKnownPaths(discovery).find((candidate) => discovery.fileExists(candidate))
  if (known !== undefined) {
    return known
  }
  const names =
    discovery.platform === 'win32' ? BROWSER_WINDOWS_PATH_NAMES : BROWSER_POSIX_PATH_NAMES
  for (const name of names) {
    const resolved = resolveExecutable(name, discovery)
    if (resolved !== undefined) {
      return resolved
    }
  }
  return undefined
}

/**
 * The browser's command line for one check: the fixed flags, the bypass list
 * (loopback, then each host this check may reach, each a plain name or
 * address checked by `browserPolicy`), the profile, and a blank first page.
 */
export function browserLaunchArgs(
  profileDir: string,
  allowedHosts: readonly string[],
): readonly string[] {
  const bypass = [...BROWSER_PROXY_BYPASS_LOOPBACK, ...allowedHosts].join(';')
  return [
    ...BROWSER_LAUNCH_FLAGS,
    `${BROWSER_PROXY_BYPASS_FLAG}${bypass}`,
    `${BROWSER_PROFILE_FLAG}${profileDir}`,
    BROWSER_BLANK_PAGE,
  ]
}
