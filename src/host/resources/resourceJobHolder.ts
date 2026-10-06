import { spawn } from 'node:child_process'
import { powerShellQuoted } from '../../core/shellQuote'
import type { ResourceJob, ResourceLease } from '../../core/resources/launch'
import {
  RESOURCE_SAMPLE_MS,
  SHELL_JOB_TYPE_NAME,
  WINDOWS_POWERSHELL_COMMAND_ARGS,
} from '../../shared/constants'
import { windowsPowerShell } from '../processTree'

/** A sampler infrastructure process, excluded from the job it keeps queryable. */
export async function holdResourceJob(
  lease: ResourceLease,
  job: ResourceJob,
  systemRoot: string,
): Promise<ResourceLease> {
  const ps = windowsPowerShell(systemRoot)
  // nosemgrep: javascript.lang.security.detect-child-process.detect-child-process -- absolute Windows PowerShell, the packaged verified job assembly and a fresh generated job name only; the holder never receives a model/workspace command or credentials (M107 C1, PLAN.md §8).
  const child = spawn(
    ps.file,
    [
      ...WINDOWS_POWERSHELL_COMMAND_ARGS,
      `Add-Type -Path ${powerShellQuoted(job.assemblyPath)}; [${SHELL_JOB_TYPE_NAME}]::Hold(${powerShellQuoted(job.name)})`,
    ],
    { env: ps.env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] },
  )
  child.stdin.on('error', () => {
    /* A retired holder has already closed the job. */
  })
  child.stderr.resume()
  try {
    await new Promise<void>((resolve, reject) => {
      let text = ''
      const timer = setTimeout(() => {
        reject(new Error('Resource job holder did not start'))
      }, RESOURCE_SAMPLE_MS)
      child.once('error', () => {
        clearTimeout(timer)
        reject(new Error('Resource job holder could not start'))
      })
      child.once('exit', () => {
        clearTimeout(timer)
        reject(new Error('Resource job holder exited before ready'))
      })
      child.stdout.on('data', (chunk: Buffer) => {
        text += chunk.toString('utf8')
        if (text.trim() === 'held') {
          clearTimeout(timer)
          resolve()
        } else if (text.length > 'held\r\n'.length) {
          clearTimeout(timer)
          reject(new Error('Resource job holder returned invalid readiness'))
        }
      })
    })
  } catch (error: unknown) {
    child.kill()
    lease.complete(true)
    throw error
  }
  let hasEnded = false
  let wasRetired = false
  child.once('exit', (code, signal) => {
    wasRetired = hasEnded && code === 0 && signal === null
  })
  return {
    temp: lease.temp,
    failed: lease.failed,
    kill: lease.kill,
    isTreeGone: lease.isTreeGone,
    register: (launch) => {
      lease.register({ ...launch, job: { ...job, isRetired: () => wasRetired } })
    },
    background: () => {
      lease.background()
    },
    complete: (isTreeGone) => {
      if (!hasEnded) {
        hasEnded = true
        child.stdin.end('end\n')
      }
      lease.complete(isTreeGone)
    },
  }
}
