// M100 lane R: the durable file store behind ResultChannel, over a real
// owner-only directory. Saves are atomic and synced before resolving; a
// missing record is a new attempt while a missing or damaged directory
// refuses; permission, link and content damage all refuse as storage.
import { rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { DeviceResultError } from '../../src/core/devices/resultChannel'
import { FileResultStore } from '../../src/core/devices/resultStore'
import { grantOthers, ownerOnlyEvidence, reparseAlias } from './helpers/deviceFixtures'
import { resultRecord, usePrivateResultsRoot } from './helpers/deviceResults'

const { fixture } = usePrivateResultsRoot('m100-results-')

describe('M100 result store', () => {
  it('saves and loads records per attempt, and they survive a reopen', async () => {
    const directory = path.join(fixture.parent, 'results')
    const store = await FileResultStore.create(directory, fixture.storage)
    await expect(store.load('0'.repeat(32))).resolves.toBeUndefined()
    const first = resultRecord('0'.repeat(32), [1])
    const second = resultRecord('1'.repeat(32), [1, 2])
    await store.save(first)
    await store.save(second)
    await expect(store.load('0'.repeat(32))).resolves.toEqual(first)
    const reopened = await FileResultStore.open(directory, fixture.storage)
    await expect(reopened.load('0'.repeat(32))).resolves.toEqual(first)
    const reloaded = await reopened.load('1'.repeat(32))
    expect(reloaded).toEqual(second)
  })

  it('keeps every record owner-only', async () => {
    const directory = path.join(fixture.parent, 'results')
    const store = await FileResultStore.create(directory, fixture.storage)
    await store.save(resultRecord('2'.repeat(32), [1]))
    const ownerOnly = process.platform === 'win32' ? 'owner-only' : '700'
    await expect(ownerOnlyEvidence(directory, true)).resolves.toBe(ownerOnly)
    const fileOnly = process.platform === 'win32' ? 'owner-only' : '600'
    await expect(
      ownerOnlyEvidence(path.join(directory, `${'2'.repeat(32)}.json`), false),
    ).resolves.toBe(fileOnly)
  })

  it('refuses a record opened to another principal, then works after restore', async () => {
    const directory = path.join(fixture.parent, 'results')
    const store = await FileResultStore.create(directory, fixture.storage)
    const expected = resultRecord('3'.repeat(32), [1])
    await store.save(expected)
    const file = path.join(directory, `${'3'.repeat(32)}.json`)
    const grant = await grantOthers(file, 'file')
    try {
      await expect(store.load('3'.repeat(32))).rejects.toThrow(DeviceResultError)
    } finally {
      await grant.restore()
    }
    const reopened = await FileResultStore.open(directory, fixture.storage)
    await expect(reopened.load('3'.repeat(32))).resolves.toEqual(expected)
  })

  it('refuses a record swapped for a link', async () => {
    const directory = path.join(fixture.parent, 'results')
    const store = await FileResultStore.create(directory, fixture.storage)
    await store.save(resultRecord('4'.repeat(32), [1]))
    const file = path.join(directory, `${'4'.repeat(32)}.json`)
    const backup = path.join(directory, `${'4'.repeat(32)}.backup`)
    await rename(file, backup)
    await reparseAlias(backup, file)
    await expect(store.load('4'.repeat(32))).rejects.toThrow(DeviceResultError)
  })

  it('refuses damaged content and stays failed, and a stage blocks reopen', async () => {
    const directory = path.join(fixture.parent, 'results')
    const store = await FileResultStore.create(directory, fixture.storage)
    await store.save(resultRecord('5'.repeat(32), [1]))
    await writeFile(path.join(directory, `${'5'.repeat(32)}.json`), '{damaged')
    await expect(store.load('5'.repeat(32))).rejects.toThrow(DeviceResultError)
    await expect(store.load('5'.repeat(32))).rejects.toThrow(DeviceResultError)
    await writeFile(path.join(directory, 'leftover.stage'), 'staged')
    await expect(FileResultStore.open(directory, fixture.storage)).rejects.toThrow(
      DeviceResultError,
    )
  })

  it('refuses a missing directory and a non-id attempt, without poisoning valid use', async () => {
    const directory = path.join(fixture.parent, 'results')
    const store = await FileResultStore.create(directory, fixture.storage)
    await rm(directory, { recursive: true, force: true })
    await expect(store.load('6'.repeat(32))).rejects.toThrow(DeviceResultError)
    const live = path.join(fixture.parent, 'live')
    const second = await FileResultStore.create(live, fixture.storage)
    await expect(second.load('not-an-attempt-id')).rejects.toThrow(DeviceResultError)
    const expected = resultRecord('6'.repeat(32), [1])
    await second.save(expected)
    await expect(second.load('6'.repeat(32))).resolves.toEqual(expected)
  })
})
