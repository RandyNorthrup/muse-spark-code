// The bundles the runtime panel loads run in a plain Node process, where the
// `vscode` module does not exist (M104 lane B, D84). Each is the shared
// production build's own file, required by a child process started in an
// empty folder: a bundle that still reaches the editor's API at load fails
// here, as it would for a person on any other editor.
import { execFile } from 'node:child_process'
import { mkdtempSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest'
import { assertCurrentProductionBuild } from './productionBuild'
import { removeFolder } from './helpers/temporaryFolders'

const run = promisify(execFile)
const ROOT = process.cwd()
const FOLDER = realpathSync(mkdtempSync(path.join(tmpdir(), 'muse-portable-')))

/** What each portable bundle must export for the runtime to use it. */
const PORTABLE_BUNDLES: Readonly<Record<string, readonly string[]>> = {
  'conversation.js': ['createConversation', 'questionsForHost'],
}

beforeAll(() => {
  assertCurrentProductionBuild(inject('productionBuildGeneration'), ROOT)
})

afterAll(async () => {
  await removeFolder(FOLDER)
})

describe('bundles the runtime panel loads', () => {
  it.each(Object.entries(PORTABLE_BUNDLES))(
    '%s loads without the vscode module',
    async (file, names) => {
      const { stdout } = await run(
        process.execPath,
        [
          '-e',
          'process.stdout.write(Object.keys(require(process.argv[1])).sort().join(","))',
          path.join(ROOT, 'dist', file),
        ],
        { cwd: FOLDER },
      )
      expect(stdout.split(',')).toEqual(expect.arrayContaining([...names]))
    },
  )
})
