// The shipped MuseSparkJob type, compiled as the extension compiles it, for
// the suites that run the playbook's real Windows containment. The caller
// mocks the resource admission module (`withFixtureBootstrap`), since the
// compile runs under the bootstrap runner.
import { expect } from 'vitest'
import { shellJobAssembly } from '../../../../src/host/backend/shellJob'
import { readJobSource } from '../jobSource'

export const SYSTEM_ROOT = process.env['SystemRoot'] ?? String.raw`C:\Windows`

/** The compiled assembly's path; the compile's own words fail the suite when it cannot be made. */
export async function compiledJobAssembly(storageDir: string): Promise<string> {
  const logged: string[] = []
  const assembly = await shellJobAssembly({
    readJobSource,
    storageDir,
    systemRoot: SYSTEM_ROOT,
    log: (message) => {
      logged.push(message)
    },
  })()
  expect(logged).toEqual([])
  return String(assembly)
}
