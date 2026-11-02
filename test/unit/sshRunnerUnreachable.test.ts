// The SSH runner's failure contract (src/host/runners/sshRunner.ts) is
// kept as it is: a runner that cannot be reached answers with the fixed
// notices — never a throw, and never OpenSSH's verbose text, which the
// module deliberately refuses to retain or log. The failures below are a
// real SSH client refused by a real closed port, through a real process
// transport.
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, it } from 'vitest'
import { runnerEnvironment } from '../../src/core/runners/runnerConfig'
import { SshRunner } from '../../src/host/runners/sshRunner'
import type { Runner } from '../../src/shared/team'
import { UI_TEXT } from '../../src/shared/constants'
import { checkProcess } from './helpers/runnerProcesses'

async function runner(): Promise<{ ssh: SshRunner; value: Runner }> {
  const scratch = await mkdtemp(path.join(tmpdir(), 'ssh-runner-'))
  const ssh = new SshRunner({
    file: 'git',
    run: checkProcess,
    env: runnerEnvironment(process.env),
    ssh: 'ssh',
    helperFolder: 'native/runner',
    scratch,
    isTrusted: () => true,
    assertWorkingCopy: () => Promise.resolve(),
    now: () => Date.now(),
    wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  })
  return {
    ssh,
    value: {
      id: 'r1',
      destination: 'root@127.0.0.1',
      port: 9,
      os: 'linux',
      workFolder: '/tmp/ssh-runner-work',
      maxJobs: 1,
      labels: [],
      commandClasses: ['tests'],
      setupCommand: 'true',
      cacheKey: 'c1',
      environmentNames: [],
    },
  }
}

// A refused port answers at once; a filtered one waits out SSH's own timeouts.
it('an unreachable runner fails the test with the fixed notice', async () => {
  const { ssh, value } = await runner()
  const outcome = await ssh.test(value)
  expect(outcome.ok).toBe(false)
  expect(outcome.notice).toBe(UI_TEXT.teamRunners.testFailed)
  expect(JSON.stringify(outcome)).not.toContain('OpenSSH')
}, 30_000)

it('an unreachable runner samples as unhealthy', async () => {
  const { ssh, value } = await runner()
  await expect(ssh.sample(value)).resolves.toBeUndefined()
}, 30_000)
