import { describe, expect, it, vi } from 'vitest'
import {
  runningServer,
  openIdleNotice,
  idleSweep,
  oneTeardown,
  unconfirmedDeletion,
  reconcileDeletion,
} from './helpers/estimatorRunFixtures'

describe('M117 idle Keep and funded-lifetime teardown', () => {
  it('waits thirty idle minutes, shows notice, then wipes before confirmed deletion', async () => {
    const fixture = await runningServer()
    const wipe = vi.spyOn(fixture.node, 'teardownAndWipe')
    const remove = vi.spyOn(fixture.provider, 'delete')
    fixture.advance(1_799_999)
    await fixture.lifecycle.sweep()
    expect(fixture.notice).not.toHaveBeenCalled()
    fixture.advance(1)
    await fixture.lifecycle.sweep()
    expect(fixture.notice).toHaveBeenCalledTimes(1)
    expect(fixture.notice.mock.invocationCallOrder[0]).toBeLessThan(
      wipe.mock.invocationCallOrder[0] ?? 0,
    )
    expect(wipe.mock.invocationCallOrder[0]).toBeLessThan(remove.mock.invocationCallOrder[0] ?? 0)
    expect(fixture.lifecycle.snapshots()).toMatchObject([{ state: 'deleted' }])
    expect(await fixture.provider.status(fixture.server.id)).toMatchObject({ state: 'deleted' })
  })

  it('Keep postpones idle teardown, then the next idle interval asks again', async () => {
    const fixture = await runningServer()
    fixture.notice.mockResolvedValueOnce('keep')
    await idleSweep(fixture)
    expect(fixture.lifecycle.snapshots()).toMatchObject([{ state: 'active' }])
    fixture.advance(1_799_999)
    await fixture.lifecycle.sweep()
    expect(fixture.notice).toHaveBeenCalledTimes(1)
  })

  it('Keep never extends the funded deadline, even for a busy server', async () => {
    const fixture = await runningServer()
    fixture.notice.mockResolvedValueOnce('keep')
    await idleSweep(fixture)
    fixture.lifecycle.activity(fixture.provider.id, fixture.server.id, true)
    await idleSweep(fixture)
    expect(fixture.lifecycle.snapshots()).toMatchObject([{ state: 'deleted' }])
    expect(fixture.notice).toHaveBeenCalledTimes(1)
  })

  it('never idles out busy work and cancels a stale notice after new activity', async () => {
    const fixture = await runningServer()
    fixture.lifecycle.activity(fixture.provider.id, fixture.server.id, true)
    await idleSweep(fixture)
    expect(fixture.notice).not.toHaveBeenCalled()
    fixture.lifecycle.activity(fixture.provider.id, fixture.server.id, false)
    fixture.advance(1_800_000 - 1)
    await fixture.lifecycle.sweep()
    expect(fixture.notice).not.toHaveBeenCalled()
    // Use a fresh, longer funded lease for the outstanding-notice race.
    const raced = await openIdleNotice()
    const { answer, sweep: sweep } = raced
    raced.lifecycle.activity(raced.provider.id, raced.server.id, true)
    answer.resolve('teardown')
    await sweep
    expect(raced.lifecycle.snapshots()).toMatchObject([{ state: 'active', busy: true }])
    expect(raced.node.calls.filter((call) => call.operation === 'teardownAndWipe')).toEqual([])
  })

  it('serializes concurrent sweeps and never tears down twice', async () => {
    const fixture = await openIdleNotice()
    const { answer, sweep: first } = fixture
    const second = fixture.lifecycle.sweep()
    answer.resolve('teardown')
    await Promise.all([first, second])
    oneTeardown(fixture)
  })

  it('failed notice grants no idle deletion while expiry still enforces teardown', async () => {
    const fixture = await runningServer()
    fixture.notice.mockRejectedValueOnce(new Error('notice unavailable'))
    await idleSweep(fixture)
    expect(fixture.lifecycle.snapshots()).toMatchObject([{ state: 'active', failure: 'notice' }])
    await idleSweep(fixture)
    expect(fixture.lifecycle.snapshots()).toMatchObject([{ state: 'deleted' }])
  })

  it('keeps deletion failure visible and reconciles lost replies without a second wipe', async () => {
    const fixture = await runningServer()
    const remove = vi.spyOn(fixture.provider, 'delete')
    remove.mockImplementationOnce(async (id) => {
      remove.mockRestore()
      await fixture.provider.delete(id)
      throw new Error('lost reply')
    })
    await idleSweep(fixture)
    expect(fixture.lifecycle.snapshots()).toMatchObject([{ state: 'failed', failure: 'delete' }])
    await reconcileDeletion(fixture)
    oneTeardown(fixture)
  })

  it('refuses wrong deletion receipts and never declares a live server deleted', async () => {
    const fixture = await unconfirmedDeletion()
    await idleSweep(fixture)
    expect(fixture.lifecycle.snapshots()).toMatchObject([{ state: 'failed', failure: 'status' }])
    await reconcileDeletion(fixture)
  })

  it('refuses duplicate server tracking, invalid activity and backward clocks', async () => {
    const fixture = await runningServer()
    expect(() => {
      fixture.lifecycle.track(fixture.provider, fixture.server, '2026-10-06T14:00:00.000Z')
    }).toThrow('duplicate-server')
    expect(() => {
      fixture.lifecycle.activity(fixture.provider.id, 'unknown', true)
    }).toThrow('inactive-server')
    fixture.setTime(fixture.now() - 1)
    await expect(fixture.lifecycle.sweep()).rejects.toThrow('invalid-lifecycle-clock')
  })

  it('new idle activity invalidates a pending notice even when the worker has already finished', async () => {
    const fixture = await openIdleNotice()
    const { answer, sweep: sweep } = fixture
    fixture.advance(1)
    fixture.lifecycle.activity(fixture.provider.id, fixture.server.id, false)
    answer.resolve('teardown')
    await sweep
    expect(fixture.lifecycle.snapshots()).toMatchObject([{ state: 'active', busy: false }])
  })

  it('funded expiry still binds while Keep or a failed notice is awaiting its answer', async () => {
    for (const isFails of [false, true]) {
      const fixture = await openIdleNotice()
      const { answer, sweep } = fixture
      fixture.advance(1_800_000)
      if (isFails) answer.reject(new Error('notice failed'))
      else answer.resolve('keep')
      await sweep
      expect(fixture.lifecycle.snapshots()).toMatchObject([{ state: 'deleted' }])
    }
  })

  it('retains pending deletion until a matching provider receipt confirms it', async () => {
    const fixture = await unconfirmedDeletion()
    vi.spyOn(fixture.provider, 'status').mockResolvedValueOnce({
      ...fixture.server,
      state: 'deleting',
    })
    await idleSweep(fixture)
    expect(fixture.lifecycle.snapshots()).toMatchObject([{ state: 'deleting' }])
    await reconcileDeletion(fixture)
    expect(fixture.node.calls.filter((call) => call.operation === 'teardownAndWipe')).toHaveLength(
      1,
    )
  })

  it('refuses a deletion receipt belonging to a different server', async () => {
    const fixture = await runningServer()
    vi.spyOn(fixture.provider, 'status').mockResolvedValueOnce({
      ...fixture.server,
      id: 'wrong',
      state: 'deleted',
    })
    await idleSweep(fixture)
    expect(fixture.lifecycle.snapshots()).toMatchObject([{ state: 'failed', failure: 'status' }])
    await reconcileDeletion(fixture)
  })

  it('refuses inactive tracking, malformed expiry and unknown cleanup without provider requests', async () => {
    const fixture = await runningServer()
    expect(() => {
      fixture.lifecycle.track(
        fixture.provider,
        { ...fixture.server, id: 'other', state: 'deleted' },
        '2026-10-06T14:00:00.000Z',
      )
    }).toThrow('invalid-created-server')
    expect(() => {
      fixture.lifecycle.track(fixture.provider, { ...fixture.server, id: 'other' }, 'invalid-date')
    }).toThrow()
    await expect(fixture.lifecycle.retire(fixture.provider.id, 'missing')).rejects.toThrow(
      'unknown-server',
    )
    expect(fixture.provider.requests.filter((request) => request.method === 'DELETE')).toEqual([])
  })

  it('returns copied lifecycle and run outcome snapshots', async () => {
    const fixture = await runningServer()
    const lease = fixture.lifecycle.snapshots()[0]
    const outcome = fixture.run.snapshots()[0]
    if (!lease || !outcome?.server) throw new Error('Missing fixture snapshots')
    lease.server.id = 'unowned'
    outcome.server.id = 'unowned'
    expect(fixture.lifecycle.snapshots()[0]?.server.id).toBe(fixture.server.id)
    expect(fixture.run.snapshots()[0]?.server?.id).toBe(fixture.server.id)
  })

  it('refuses malformed activity without changing the lease or postponing idle teardown', async () => {
    const fixture = await runningServer()
    const before = fixture.lifecycle.snapshots()
    fixture.advance(1_800_000)
    expect(() => {
      Reflect.apply(fixture.lifecycle.activity, fixture.lifecycle, [
        fixture.provider.id,
        fixture.server.id,
        'false',
      ])
    }).toThrow()
    expect(fixture.lifecycle.snapshots()).toEqual(before)
    await reconcileDeletion(fixture)
  })
  it('expires a server through a new sweep while its Keep notice is still unanswered', async () => {
    const fixture = await openIdleNotice()
    const { answer, sweep: original } = fixture
    await idleSweep(fixture)
    expect(fixture.lifecycle.snapshots()).toMatchObject([{ state: 'deleted' }])
    answer.resolve('keep')
    await original
    expect(fixture.lifecycle.snapshots()).toMatchObject([{ state: 'deleted' }])
    expect(fixture.provider.requests.filter((request) => request.method === 'DELETE')).toHaveLength(
      1,
    )
  })

  it('a late Keep cannot reactivate a server explicitly retired while the notice was open', async () => {
    const fixture = await openIdleNotice()
    const { answer, sweep: original } = fixture
    await fixture.lifecycle.retire(fixture.provider.id, fixture.server.id)
    answer.resolve('keep')
    await original
    expect(fixture.lifecycle.snapshots()).toMatchObject([{ state: 'deleted' }])
  })
})
