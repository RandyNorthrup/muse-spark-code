// A folder whose name only starts with two dots (..foo) is an ordinary
// folder, not a parent segment: the stores below must keep it inside their
// root while a genuine .. escape still fails closed. Real modules, real
// temporary folders, no stand-ins.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { fileIdentities, newPlaybookModule } from '../../src/core/orchestration/playbook/modules'
import { createNodeScheduleFs } from '../../src/runtime/schedules/nodeScheduleFs'

const folders: string[] = []

afterEach(() => {
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true })
})

function folder(prefix: string): string {
  const made = mkdtempSync(path.join(tmpdir(), prefix))
  folders.push(made)
  return made
}

describe('the schedule store under a ..-prefixed folder', () => {
  it('writes and reads ..foo/x.json, and still refuses a parent escape', async () => {
    const store = createNodeScheduleFs(folder('mswinpath-sched-'))
    await store.replace('..foo/x.json', 'kept')
    await expect(store.read('..foo/x.json')).resolves.toBe('kept')
    await expect(store.replace('../escape.json', 'no')).rejects.toThrow(
      'scheduleStoragePathRefused',
    )
  })
})

describe('playbook file identities under a ..-prefixed folder', () => {
  it('reads ..foo/a.md inside the workspace instead of calling it an escape', () => {
    const workspace = folder('mswinpath-playbook-')
    mkdirSync(path.join(workspace, '..foo'))
    writeFileSync(path.join(workspace, '..foo/a.md'), 'hello\n')
    const identities = fileIdentities(workspace, newPlaybookModule(['..foo/a.md']))
    expect(identities.map((entry) => entry.file)).toEqual(['..foo/a.md'])
  })
})
