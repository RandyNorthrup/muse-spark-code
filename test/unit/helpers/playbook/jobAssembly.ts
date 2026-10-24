// The shipped MuseSparkJob type, compiled as the extension compiles it, for
// the suites that run the playbook's real Windows containment.
import { expect } from 'vitest'
import { shellJobAssembly } from '../../../../src/host/backend/shellJob'
import { runProgram } from '../../../../src/host/processTree'
import { readJobSource } from '../jobSource'

export const SYSTEM_ROOT = process.env['SystemRoot'] ?? String.raw`C:\Windows`

/** The compiled assembly's path; the compile's own words fail the suite when it cannot be made. */
export async function compiledJobAssembly(storageDir: string): Promise<string> {
  const logged: string[] = []
  const assembly = await shellJobAssembly({
    readJobSource,
    storageDir,
    systemRoot: SYSTEM_ROOT,
    // The real execFile runner: the default governed compiler needs a
    // configured resource host, which a bare test process has none of.
    run: runProgram,
    log: (message) => {
      logged.push(message)
    },
  })()
  expect(logged).toEqual([])
  return String(assembly)
}
