import type { ResourceJob, ResourceLease } from '../../core/resources/launch'
import { RESOURCE_SAMPLE_MS } from '../../shared/constants'
import { windowsJobHost } from '../../core/execGuard'
import { spawnGuarded } from '../../core/guardedChildProcess'

/**
A sampler infrastructure process, excluded from the job it keeps queryable:
the job helper's `hold` command, run as its own program (no PowerShell start).
*/
export async function holdResourceJob(
  lease: ResourceLease,
  job: ResourceJob,
  systemRoot: string,
): Promise<ResourceLease> {
  const host = windowsJobHost(job.assemblyPath, systemRoot)
  // nosemgrep: javascript.lang.security.detect-child-process.detect-child-process -- the packaged, digest-named job helper by absolute path and a fresh generated job name only; the holder never receives a model/workspace command or credentials (M107 C1, PLAN.md §8).
  const child = spawnGuarded(host.file, ['hold', job.name], {
    env: host.env,
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
  })
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
