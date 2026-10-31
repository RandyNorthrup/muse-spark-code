// The check slots' process runner for suites on a rig without an OS container
// proof: a real process, run to its end, whose clean exit is read as the
// container's proof that nothing else is left running (the checks are leaf
// programs). A request `isUnproved` names ends without that proof, as a
// process group's end does on a bare POSIX host. The product's own runner
// (`checkProcessOver`) proves only through a Windows job or a Linux scope.
import { spawn } from 'node:child_process'
import type { CheckProcess } from '../../../src/host/team/checkSlots'

const NO_EXIT_CODE = 1

export function checkProcessProvedByExit(
  isUnproved: (request: Parameters<CheckProcess>[0]) => boolean = () => false,
): CheckProcess {
  return (request) =>
    new Promise((resolve, reject) => {
      const child = spawn(request.file, [...request.args], { cwd: request.cwd, env: request.env })
      const output: string[] = []
      const stderr: string[] = []
      child.stdout.on('data', (chunk: Buffer) => {
        output.push(chunk.toString('utf8'))
      })
      child.stderr.on('data', (chunk: Buffer) => {
        stderr.push(chunk.toString('utf8'))
      })
      const limit = setTimeout(() => child.kill(), request.timeoutMs)
      child.once('error', reject)
      child.once('close', (code) => {
        clearTimeout(limit)
        resolve({
          exitCode: code ?? NO_EXIT_CODE,
          output: output.join(''),
          descendantsEnded: !isUnproved(request),
          stderr: stderr.join(''),
        })
      })
    })
}
