import {
  execFile,
  spawn,
  type ExecFileOptionsWithStringEncoding,
  type SpawnOptions,
} from 'node:child_process'
import { PassThrough } from 'node:stream'

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

/** Slot protocol tests retain their native/fake peer; launch containment has its own suite. */
export function fixtureResourceProcess(
  _profile: 'contained' | 'handoff' | 'bootstrap',
  file: string,
  args: readonly string[],
  options: SpawnOptions,
  stdio: SpawnOptions['stdio'] = 'pipe',
) {
  const { signal: _signal, stdio: _stdio, ...spawnOptions } = options
  const child = spawn(file, [...args], {
    ...spawnOptions,
    stdio,
    shell: false,
    windowsHide: true,
  })
  const pipes = {
    stdin: child.stdin ?? new PassThrough(),
    stdout: child.stdout ?? new PassThrough(),
    stderr: child.stderr ?? new PassThrough(),
  }
  return Promise.resolve({
    child: Object.assign(child, pipes),
    pid: () => Promise.resolve(child.pid),
    stop: () => {
      child.kill('SIGKILL')
      return Promise.resolve()
    },
  })
}
