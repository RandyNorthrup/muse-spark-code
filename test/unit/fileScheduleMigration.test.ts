// The schedule migration over real files: a stored file that is not
// JSON refuses with the stored-invalid words and keeps the parse
// failure as its cause.

import { mkdtempSync, realpathSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { createFileScheduleMigrationSource } from '../../src/host/backend/fileScheduleStore'
import { removeFolder } from './helpers/temporaryFolders'

const base = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'muse-schedule-migration-')))
afterAll(async () => {
  await removeFolder(base)
})

describe('freeze', () => {
  it('refuses stored text that is not JSON, keeping the parse failure', async () => {
    await writeFile(path.join(base, 'nightly.json'), '{not json')
    let failure: unknown
    try {
      await createFileScheduleMigrationSource(base).freeze()
    } catch (error: unknown) {
      failure = error
    }
    expect(failure instanceof Error ? failure.message : undefined).toBe('scheduleStoredJsonInvalid')
    expect(failure instanceof Error ? failure.cause : undefined).toBeInstanceOf(SyntaxError)
  })
})
