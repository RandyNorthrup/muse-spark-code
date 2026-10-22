// The C# of the Windows job helpers (M27's shell job assembly, M50's MCP
// stdio launcher, M105 R2's screen recorder), shipped under native/windows/
// and read when a helper is first built, instead of riding in the host
// bundle as strings (PLAN.md D6, the M55 and M56 size receipts). Each job
// helper is its own file (its `using` directives first, then its types)
// followed by the Win32 half both share, MuseSparkMcpJob.cs; the recorder
// is standalone and compiles from its own file alone. A missing or
// unreadable file fails that helper's preparation, which each helper
// already reports and falls back from.

import { readFile } from 'node:fs/promises'
import path from 'node:path'

const NATIVE_WINDOWS = path.join('native', 'windows')

/** The shipped files, relative to the extension's folder. */
export const JOB_SOURCE_FILES = {
  /** The Win32 half both helpers compile in. */
  shared: path.join(NATIVE_WINDOWS, 'MuseSparkMcpJob.cs'),
  /** The job type shell commands join (`shellJob.ts`), a library. */
  shellJob: path.join(NATIVE_WINDOWS, 'MuseSparkJob.cs'),
  /** The MCP launcher's entry and configuration (`mcpJobExecutable.ts`), a console application. */
  mcpLauncher: path.join(NATIVE_WINDOWS, 'MuseSparkMcpLauncher.cs'),
  /** The screen recorder's entry (`windowsRecorderDeps.ts`), standalone: no shared half. */
  screenRecorder: path.join(NATIVE_WINDOWS, 'MuseSparkScreenRecord.cs'),
} as const

/** A helper whose whole C# `jobSourceReader` gives. */
export type JobHelper = Exclude<keyof typeof JOB_SOURCE_FILES, 'shared'>

/** Reads a helper's C# (its own file, then the shared half), each file at most once per window. */
export function jobSourceReader(extensionPath: string): (helper: JobHelper) => Promise<string> {
  const files = new Map<keyof typeof JOB_SOURCE_FILES, Promise<string>>()
  const read = (file: keyof typeof JOB_SOURCE_FILES): Promise<string> => {
    let text = files.get(file)
    if (text === undefined) {
      text = readFile(path.join(extensionPath, JOB_SOURCE_FILES[file]), 'utf8')
      files.set(file, text)
    }
    return text
  }
  return async (helper) => {
    // The recorder compiles from its own file alone (its native suite
    // proves that build); the job half is not its dependency.
    if (helper === 'screenRecorder') return await read(helper)
    const [own, shared] = await Promise.all([read(helper), read('shared')])
    return `${own}\n${shared}`
  }
}
