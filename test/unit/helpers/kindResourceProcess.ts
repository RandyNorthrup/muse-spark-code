import { execFile, type ExecFileOptionsWithStringEncoding } from 'node:child_process'

/**
 * OS helper tests (native schedules, trusted paths) keep a direct bounded
 * execFile; execResourceFile's admission and containment have their own
 * suites (spawnGovernance, spawnRuntimeAdmission, spawnProfiles).
 */
export function fixtureResourceCommand(
  _profile: 'contained' | 'probe',
  file: string,
  args: readonly string[],
  options: ExecFileOptionsWithStringEncoding,
): Promise<{ stdout: string; stderr: string }> {
  // The callback form, not promisify: a suite that spies on execFile keeps its
  // calls (a spy's promisify.custom would reach the unspied original).
  return new Promise((resolve, reject) => {
    execFile(file, [...args], options, (error, stdout, stderr) => {
      if (error === null) resolve({ stdout, stderr })
      else
        reject(Object.assign(new Error(error.message, { cause: error }), error, { stdout, stderr }))
    })
  })
}
