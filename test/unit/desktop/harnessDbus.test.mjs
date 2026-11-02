import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { callBus, startTestBus } from '../../../test/desktop/harness/lib/dbusBus.mjs'

const CANARY = {
  destination: 'org.muse.TestHarness.Canary1',
  objectPath: '/org/muse/TestHarness/Canary1',
}
const NOTIFICATIONS = {
  destination: 'org.freedesktop.Notifications',
  objectPath: '/org/freedesktop/Notifications',
}

// The private bus is a Linux facility; other platforms have no dbus-daemon
// of their session to test against (the harness itself is Linux-only).
describe.skipIf(process.platform !== 'linux')('the desktop test bus', () => {
  const runtime = {}

  beforeAll(async () => {
    runtime.dir = await mkdtemp(path.join(tmpdir(), 'muse-test-bus-'))
    runtime.bus = await startTestBus({ workDir: runtime.dir })
  })

  afterAll(async () => {
    await runtime.bus?.stop()
    if (runtime.dir !== undefined) await rm(runtime.dir, { recursive: true, force: true })
  })

  it('round-trips a canary ping and counts it', async () => {
    const first = await callBus(runtime.bus, {
      ...CANARY,
      method: 'org.muse.TestHarness.Canary1.Ping',
      args: ['round-trip'],
    })
    expect(first).toContain('round-trip')
    const second = await callBus(runtime.bus, {
      ...CANARY,
      method: 'org.muse.TestHarness.Canary1.Ping',
      args: ['again'],
    })
    expect(second).toContain('again')
    const count = await callBus(runtime.bus, {
      ...CANARY,
      method: 'org.freedesktop.DBus.Properties.Get',
      args: ['org.muse.TestHarness.Canary1', 'PingCount'],
    })
    expect(count).toContain('uint32 2')
    const record = await readFile(path.join(runtime.dir, 'canary.jsonl'), 'utf8')
    const entries = record
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line))
    expect(entries.map((entry) => entry.message)).toEqual(['round-trip', 'again'])
  })

  it('returns the canary error by name when asked to fail', async () => {
    await expect(
      callBus(runtime.bus, { ...CANARY, method: 'org.muse.TestHarness.Canary1.Fail' }),
    ).rejects.toThrow('org.muse.TestHarness.Error.CanaryRequested')
  })

  it('records notifications with real ids and answers server information', async () => {
    const notify = (summary) =>
      callBus(runtime.bus, {
        ...NOTIFICATIONS,
        method: 'org.freedesktop.Notifications.Notify',
        args: ['desktop-test', '0', '', summary, 'body', '[]', '{}', '0'],
      })
    expect(await notify('First')).toContain('uint32 1')
    expect(await notify('Second')).toContain('uint32 2')
    const info = await callBus(runtime.bus, {
      ...NOTIFICATIONS,
      method: 'org.freedesktop.Notifications.GetServerInformation',
    })
    expect(info).toContain('Muse Desktop QA sink')
    expect(info).toContain('1.2')
    await callBus(runtime.bus, {
      ...NOTIFICATIONS,
      method: 'org.freedesktop.Notifications.CloseNotification',
      args: ['1'],
    })
    await expect(
      callBus(runtime.bus, {
        ...NOTIFICATIONS,
        method: 'org.freedesktop.Notifications.CloseNotification',
        args: ['99'],
      }),
    ).rejects.toThrow('not open')
    const record = await readFile(path.join(runtime.dir, 'notifications.jsonl'), 'utf8')
    const entries = record
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line))
    expect(
      entries.filter((entry) => entry.method === 'Notify').map((entry) => entry.summary),
    ).toEqual(['First', 'Second'])
    expect(entries.at(-1)).toMatchObject({ method: 'CloseNotification', id: 1 })
  })

  it('refuses to start when the bus policy denies the canary its name', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'muse-test-bus-denied-'))
    try {
      await expect(
        startTestBus({
          workDir: dir,
          services: ['canary'],
          extraPolicy: '    <deny own="org.muse.TestHarness.Canary1"/>\n',
          readyTimeoutMs: 3000,
        }),
      ).rejects.toThrow('could not own org.muse.TestHarness.Canary1')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('leaves no daemon behind after stop', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'muse-test-bus-stop-'))
    const bus = await startTestBus({ workDir: dir, services: ['canary'] })
    const pid = bus.daemonPid
    await bus.stop()
    expect(() => process.kill(pid, 0)).toThrow()
    await rm(dir, { recursive: true, force: true })
  })
})
