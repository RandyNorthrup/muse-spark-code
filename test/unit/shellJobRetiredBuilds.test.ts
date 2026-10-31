// The job helper's builds an earlier version left (CC-WINHOOK decision 4):
// until the helper became a program as well as the type, it was built as a
// library, `MuseSparkJob-<digest>.dll`, one 60 KB file per helper version in
// the extension's storage. Building the current helper sweeps them, by their
// exact name and in the helper's own folder only. The product's own builder
// runs for real (the .NET compiler, then the self-test) over a storage folder
// laid out as an earlier version left it.
import { mkdir, mkdtemp, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { shellJobAssembly } from '../../src/host/backend/shellJob'
import { runProgram } from '../../src/host/processTree'
import { SHELL_JOB_FOLDER } from '../../src/shared/constants'
import { readJobSource } from './helpers/jobSource'
import { removeFolder } from './helpers/temporaryFolders'

const BUILD_MS = 120_000
const byName = (a: string, b: string): number => a.localeCompare(b)

// What earlier versions built: the stem, sixteen hex digits of the source's
// digest, the library extension.
const RETIRED = ['MuseSparkJob-690dd47ec7d3b609.dll', 'MuseSparkJob-0123456789abcdef.dll']
// Names that are not the product's builds, beside them: each one stays. (An
// upper-case digest would be the same file as a lower-case one on NTFS.)
const FOREIGN = [
  'MuseSparkJob-0123456789abcde.dll',
  'MuseSparkJob-0123456789abcdef0.dll',
  'MuseSparkJob-0123456789abcdeg.dll',
  'MuseSparkJob-0123456789abcdef.dll.bak',
  'MuseSparkJob-notes.dll',
  'OtherTool-0123456789abcdef.dll',
  'MuseSparkJob-0123456789abcdef.txt',
]

describe.runIf(process.platform === 'win32')('the job helper’s retired library builds', () => {
  const systemRoot = process.env['SystemRoot'] ?? ''
  let storageDir = ''

  beforeAll(async () => {
    storageDir = await mkdtemp(path.join(tmpdir(), 'muse-retired-builds-'))
  })
  afterAll(async () => {
    await removeFolder(storageDir)
  })

  it(
    'removes only the exact earlier builds in the helper’s own folder once the helper is built',
    async () => {
      const folder = path.join(storageDir, SHELL_JOB_FOLDER)
      const elsewhere = path.join(storageDir, 'elsewhere')
      await mkdir(folder, { recursive: true })
      await mkdir(elsewhere)
      for (const name of [...RETIRED, ...FOREIGN]) await writeFile(path.join(folder, name), 'old')
      // An exact name outside the helper's folder is not the sweep's either.
      await writeFile(path.join(elsewhere, RETIRED[0] ?? ''), 'old')
      const logged: string[] = []
      const assembly = await shellJobAssembly({
        storageDir,
        systemRoot,
        readJobSource,
        run: runProgram,
        log: (message) => {
          logged.push(message)
        },
      })()
      expect(logged).toEqual([])
      expect(assembly).toBeDefined()
      const left = await readdir(folder)
      for (const name of RETIRED) expect(left).not.toContain(name)
      expect(left.toSorted(byName)).toEqual(
        [...FOREIGN, path.basename(assembly ?? '')].toSorted(byName),
      )
      expect(await readdir(elsewhere)).toEqual([RETIRED[0]])
    },
    BUILD_MS,
  )
})
