import { spawn, type SpawnOptions } from 'node:child_process'
import { PassThrough } from 'node:stream'

/** Slot protocol tests retain their native/fake peer; launch containment has its own suite. */
export function fixtureResourceProcess(
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
