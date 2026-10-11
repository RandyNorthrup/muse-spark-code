// The schedules report reader tells a corrupt store from an unreadable one
// (M113 C-M113-4 repairs): damaged JSON and identity mismatches read
// `invalid`, genuine I/O failures read `failed`, never a generic failure
// with the store's reason discarded and never an empty success.
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { localFailureOf } from '../../src/core/reporting/sources/local'
import { createSchedulesReportReader } from '../../src/runtime/reporting/playbookSchedulesInputs'
import { FIXTURE_WORKSPACE_KEY } from './helpers/reporting/reportKindFixtures'
import { REPORT_FIXTURE_AS_OF, reportOptions } from './helpers/reporting/snapshot'
import { removeFolder, temporaryDir } from './helpers/temporaryFolders'

const context = () => ({
  asOf: REPORT_FIXTURE_AS_OF,
  workspaceKey: FIXTURE_WORKSPACE_KEY,
  options: reportOptions('schedules'),
  signal: new AbortController().signal,
})

const codeOf = async (work: () => Promise<unknown>) => {
  try {
    await work()
  } catch (error) {
    return localFailureOf(error)
  }
  throw new Error('Expected the read to fail')
}

describe('schedules report reader failures', () => {
  it('reads damaged stored JSON as invalid, never a generic failure', async () => {
    const root = await temporaryDir('schedules-corrupt-')
    try {
      await mkdir(path.join(root, FIXTURE_WORKSPACE_KEY, 'fires'), { recursive: true })
      await writeFile(path.join(root, FIXTURE_WORKSPACE_KEY, 'fires', 'abc123.json'), '{corrupt')
      const reader = createSchedulesReportReader({
        storeRoot: root,
        workspaceKey: FIXTURE_WORKSPACE_KEY,
      })
      expect(await codeOf(() => reader.read(context()))).toBe('invalid')
    } finally {
      await removeFolder(root)
    }
  })

  it('reads an unreadable store root as failed, never invalid', async () => {
    const root = await temporaryDir('schedules-unreadable-')
    try {
      const file = path.join(root, 'file')
      await writeFile(file, 'not a directory')
      const reader = createSchedulesReportReader({
        storeRoot: file,
        workspaceKey: FIXTURE_WORKSPACE_KEY,
      })
      expect(await codeOf(() => reader.read(context()))).toBe('failed')
    } finally {
      await removeFolder(root)
    }
  })

  it('reads a fresh store as empty, never a miss', async () => {
    const root = await temporaryDir('schedules-fresh-')
    try {
      const reader = createSchedulesReportReader({
        storeRoot: root,
        workspaceKey: FIXTURE_WORKSPACE_KEY,
      })
      const read = await reader.read(context())
      expect(read.schedules).toEqual([])
      expect(read.fires).toEqual([])
    } finally {
      await removeFolder(root)
    }
  })
})
