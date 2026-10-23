import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { setTimeout } from 'node:timers/promises'
import { afterAll, describe, expect, it } from 'vitest'

// This explicit suite requires a built fake-only image. It never silently skips.
const image = process.env.M110_TEST_IMAGE
if (!image) throw new Error('Set M110_TEST_IMAGE to the built fake-only node image')
const prefix = `m110-${randomUUID()}`
const containers = []
const volumes = []
const docker = (args) => execFileSync('docker', args, { encoding: 'utf8', stdio: 'pipe' })
const run = (extra = []) => {
  const name = `${prefix}-${containers.length}`
  containers.push(name)
  const state = `${name}-state`
  const workspace = `${name}-workspaces`
  volumes.push(state, workspace)
  return docker([
    'run',
    '--detach',
    '--name',
    name,
    '--read-only',
    '--security-opt',
    'no-new-privileges:true',
    '--cap-drop',
    'ALL',
    '--cap-add',
    'CHOWN',
    '--cap-add',
    'SETUID',
    '--cap-add',
    'SETGID',
    '--cap-add',
    'SETPCAP',
    '--tmpfs',
    '/run:rw,nosuid,nodev,noexec,mode=0755',
    '--tmpfs',
    '/tmp:rw,nosuid,nodev,mode=1777',
    '--mount',
    `type=volume,src=${state},dst=/var/lib/muse-spark-code-node`,
    '--mount',
    `type=volume,src=${workspace},dst=/workspaces`,
    '--env',
    'CANARY_API_KEY=m110-not-a-real-key',
    // An explicit test-only bind runs byte-restored source mutations for
    // red drills without building/publishing an altered product image.
    ...(process.env.M110_TEST_BOOTSTRAP
      ? [
          '--entrypoint',
          '/bin/bash',
          '--mount',
          `type=bind,src=${process.env.M110_TEST_BOOTSTRAP},dst=/run/bootstrap.sh,readonly`,
        ]
      : []),
    ...extra,
    image,
    ...(process.env.M110_TEST_BOOTSTRAP ? ['/run/bootstrap.sh', 'serve'] : []),
  ]).trim()
}
afterAll(() => {
  for (const name of containers) docker(['rm', '--force', name])
  for (const name of volumes) docker(['volume', 'rm', name])
})

describe('real image two-user isolation', () => {
  it('runs the node and real PTY as their own users, with clean environments and no access to node state/memory', async () => {
    const id = run()
    let logs = ''
    for (let attempt = 0; attempt < 100; attempt++) {
      logs = docker(['logs', id])
      if (logs.includes('M110 image runtime probe passed')) break
      await setTimeout(100)
    }
    expect(logs).toContain('M110 image runtime probe passed')
    const processList = docker(['top', id, '-eo', 'pid,uid,args'])
    // Rootless engines remap these UIDs on the host. The in-container fixture
    // checks exact 10001/10002; host ps also proves no process is host root.
    expect(
      processList
        .split('\n')
        .slice(1)
        .some((line) => /^\s*\d+\s+0\s/.test(line)),
    ).toBe(false)
    expect(docker(['exec', id, 'muse-spark-code-acp', 'tui'])).toContain(
      'M110 terminal attach probe passed',
    )
    docker(['stop', '--time', '5', id])
    expect(docker(['inspect', '--format', '{{.State.Running}}', id]).trim()).toBe('false')
  })
  it('refuses unsafe reused volume permissions', async () => {
    const id = run()
    docker(['exec', '--user', '10001', id, 'chmod', '0755', '/var/lib/muse-spark-code-node'])
    docker(['stop', '--time', '5', id])
    docker(['start', id])
    for (let attempt = 0; attempt < 20; attempt++) {
      if (docker(['inspect', '--format', '{{.State.Running}}', id]).trim() === 'false') break
      await setTimeout(100)
    }
    expect(docker(['inspect', '--format', '{{.State.Running}}', id]).trim()).toBe('false')
    expect(docker(['wait', id]).trim()).not.toBe('0')
  })
})
