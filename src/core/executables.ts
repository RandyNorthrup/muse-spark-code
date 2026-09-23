// Finding a program on PATH without the working directory (PLAN.md D24).
// A bare name handed to `spawn` / `execFile` is looked up by the platform:
// libuv on Windows tries the current directory before PATH, and an empty or
// relative PATH entry means "here" on every platform. With the workspace as
// the working directory, a `git.exe` or `bash` committed to a repository
// would run instead of the real one. This resolver takes only absolute PATH
// entries, and on Windows only the extensions `execFile` can start without a
// shell (a `.cmd` needs one, and a shell string is banned, D4). Pure: the
// file probe is injected.

import path from 'node:path'

export interface ExecutableProbe {
  readonly platform: NodeJS.Platform
  /** The PATH value, unsplit. */
  readonly pathVariable: string | undefined
  readonly fileExists: (filePath: string) => boolean
}

// `execFile` starts these directly; batch files need a shell.
const WINDOWS_EXECUTABLE_EXTENSIONS = ['.exe', '.com'] as const

/** The absolute, non-empty entries of a PATH value, in order. */
export function absolutePathEntries(
  platform: NodeJS.Platform,
  pathVariable: string | undefined,
): readonly string[] {
  const p = platform === 'win32' ? path.win32 : path.posix
  const separator = platform === 'win32' ? ';' : ':'
  return (pathVariable ?? '')
    .split(separator)
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '' && p.isAbsolute(entry))
}

/** The absolute path of `name` on PATH, or undefined when it is not there. */
export function resolveExecutable(name: string, probe: ExecutableProbe): string | undefined {
  const p = probe.platform === 'win32' ? path.win32 : path.posix
  const candidates =
    probe.platform === 'win32'
      ? WINDOWS_EXECUTABLE_EXTENSIONS.map((extension) => `${name}${extension}`)
      : [name]
  for (const directory of absolutePathEntries(probe.platform, probe.pathVariable)) {
    for (const candidate of candidates) {
      const full = p.join(directory, candidate)
      if (probe.fileExists(full)) {
        return full
      }
    }
  }
  return undefined
}
