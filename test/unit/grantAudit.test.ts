import { describe, expect, it } from 'vitest'
import {
  ScheduleGrantEditor,
  type ScheduleAuthorityStore,
  type ScheduleGrantAudit,
} from '../../src/core/schedules/grantAudit'
import { fakeSchedule } from './helpers/schedules/fixtures'
import type { ScheduleV2 } from '../../src/shared/scheduleV2'

function authorityStore() {
  let schedule: ScheduleV2 | undefined = fakeSchedule({
    grant: {
      rules: [{ id: 'test', kind: 'command', prefix: 'npm test' }],
      destinationIds: [],
      paidCapUsd: 1,
    },
    paidCapUsd: 1,
  })
  const entries: ScheduleGrantAudit[] = [{ scheduleId: 'schedule-1', atMs: 0, kind: 'created' }]
  const store: ScheduleAuthorityStore = {
    read: () => Promise.resolve(schedule),
    commit: (next, audit) => {
      if (audit.kind === 'created' ? schedule !== undefined : schedule?.revision !== next.revision)
        return Promise.resolve(false)
      schedule = { ...next, revision: next.revision + 1 }
      entries.push(audit)
      return Promise.resolve(true)
    },
    append: (audit) => {
      entries.push(audit)
      return Promise.resolve()
    },
    audit: () => Promise.resolve(entries),
  }
  return {
    store,
    get: () => schedule,
    remove: () => {
      schedule = undefined
    },
  }
}

describe('schedule grant editor and audit', () => {
  it('creates authority and its audit atomically, refusing nonzero revisions and duplicate ids', async () => {
    const { store, get, remove } = authorityStore()
    const editor = new ScheduleGrantEditor(store, () => 1)
    remove()
    expect(await editor.create(fakeSchedule({ revision: 1 }))).toBe(false)
    expect(get()).toBeUndefined()
    expect(await editor.create(fakeSchedule())).toBe(true)
    expect(await editor.create(fakeSchedule())).toBe(false)
    const audit = await editor.audit('workspace-1', 'schedule-1')
    expect(audit.filter((entry) => entry.atMs === 1)).toEqual([
      { scheduleId: 'schedule-1', atMs: 1, kind: 'created' },
    ])
  })
  it('changes only displayed authority, invalidates paid consent and preserves the other schedule fields', async () => {
    const { store, get } = authorityStore()
    const editor = new ScheduleGrantEditor(store, () => 1)
    expect(
      await editor.change('workspace-1', 'schedule-1', 0, {
        rules: [],
        destinationIds: [],
        paidCapUsd: 0,
      }),
    ).toBe(true)
    expect(get()).toMatchObject({
      revision: 1,
      paidCapUsd: 0,
      grant: { rules: [] },
      name: 'Check the build',
      mode: 'manual',
    })
    expect(await editor.audit('workspace-1', 'schedule-1')).toEqual([
      { scheduleId: 'schedule-1', atMs: 0, kind: 'created' },
      { scheduleId: 'schedule-1', atMs: 1, kind: 'changed' },
    ])
  })
  it('revokes tools, paths, destinations, paid consent and cap, and a stale editor cannot restore them', async () => {
    const { store, get } = authorityStore()
    const old = get()
    const editor = new ScheduleGrantEditor(store, () => 1)
    expect(await editor.revoke('workspace-1', 'schedule-1')).toBe(true)
    expect(get()).toMatchObject({
      grant: { rules: [], destinationIds: [], paidCapUsd: 0 },
      paidCapUsd: 0,
      paidConsent: undefined,
    })
    if (old === undefined) throw new Error('missing fixture')
    expect(await editor.change('workspace-1', old.id, old.revision, old.grant)).toBe(false)
    const audit = await editor.audit('workspace-1', old.id)
    expect(audit.map((entry) => entry.kind)).toEqual(['created', 'revoked'])
  })
  it('retries revocation from fresh state after a CAS conflict and leaves missing ids untouched', async () => {
    const { store, get, remove } = authorityStore()
    const commit = store.commit
    let hasConflict = true
    store.commit = async (next, audit) => {
      if (hasConflict) {
        hasConflict = false
        await commit(
          {
            ...next,
            name: 'Changed concurrently',
            grant: { rules: [], destinationIds: [], paidCapUsd: 0 },
          },
          { ...audit, kind: 'changed' },
        )
        return false
      }
      return await commit(next, audit)
    }
    const editor = new ScheduleGrantEditor(store, () => 1)
    expect(await editor.revoke('workspace-1', 'schedule-1')).toBe(true)
    expect(get()?.name).toBe('Changed concurrently')
    remove()
    expect(await editor.revoke('workspace-1', 'schedule-1')).toBe(false)
  })
})
