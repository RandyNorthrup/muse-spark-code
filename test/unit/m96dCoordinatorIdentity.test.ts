// M96d native process identity per OS: exact birth evidence beside
// this boot's identity, or the documented unknown where the table is
// silent. macOS `ps` seconds are coarse by construction: an observation
// there never validates a foreign reference.
import { expect, it } from 'vitest'
import { systemBootIdentity } from '../../src/core/locks/processOwner'
import { observeProcessBirth } from '../../src/core/team/coordinator/references'
import { canReadProcessBirth } from './helpers/processBirth'

if (canReadProcessBirth()) {
  it('observes this process with its boot-bound exact birth', async () => {
    const observed = await observeProcessBirth(process.pid)
    if (observed === undefined) throw new Error('Expected a birth observation')
    expect(observed.pid).toBe(process.pid)
    expect(observed.platform).toBe(process.platform)
    expect(observed.birth).toBeTruthy()
    expect(observed.boot).toBe(await systemBootIdentity())
    expect(observed.precise).toBe(process.platform !== 'darwin')
    const again = await observeProcessBirth(process.pid)
    expect(again).toEqual(observed)
  })

  it('reads an unknown PID and invalid PIDs as unknown, never as death', async () => {
    expect(await observeProcessBirth(4_194_303)).toBeUndefined()
    for (const pid of [0, -1, 1.5, NaN]) {
      expect(await observeProcessBirth(pid)).toBeUndefined()
    }
  })

  it('reads this boot identity stably on every platform', async () => {
    const first = await systemBootIdentity()
    const second = await systemBootIdentity()
    if (first === undefined) throw new Error('Expected a boot identity')
    expect(second).toBe(first)
    if (process.platform === 'darwin') expect(first).toMatch(/^[A-F0-9-]{36}$/iu)
    else if (process.platform === 'linux') expect(first).toMatch(/^[a-f0-9-]{36}$/u)
    expect(await systemBootIdentity('freebsd')).toBeUndefined()
  })
} else {
  it('reads birth as unknown where the table is silent, boot where it answers', async () => {
    // This lane's sandbox denies macOS `ps` while `sysctl` answers.
    expect(await observeProcessBirth(process.pid)).toBeUndefined()
    expect(await observeProcessBirth(4_194_303)).toBeUndefined()
    expect(await systemBootIdentity()).toBeTruthy()
  })
}
