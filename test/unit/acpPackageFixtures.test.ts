// CIFIX017R3: every test that runs scripts/package-acp.mjs over a test-owned
// source tree lays out the packager's native inputs through one helper, read
// from the packager's own list, so a newly required file reaches them all.
// Before this, three fixtures kept hand lists; usagePackaging's lacked
// MuseSparkMcpLauncher.cs after the package began to require it, and packaging
// failed on every OS.
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { JOB_SOURCES, RUNNER_HELPERS } from '../../scripts/lib/acpNativeSources.mjs'
import { ACP_NATIVE_FILES, layOutAcpNativeSources } from './helpers/acpPackageSources'
import { removeFolder } from './helpers/temporaryFolders'

const root = path.resolve(import.meta.dirname, '../..')
const read = (file: string): string => readFileSync(path.join(root, file), 'utf8')
const HELPER = 'test/unit/helpers/acpPackageSources.ts'
const SELF = 'test/unit/acpPackageFixtures.test.ts'
// The suites that pack a test-owned tree today; the scan below must find each.
const KNOWN_FIXTURES = [
  'test/e2e/execStdio.e2e.test.ts',
  'test/unit/runtimeChatGptPackage.test.ts',
  'test/unit/usagePackaging.test.mjs',
]

/** Test files that copy the packager into a temporary tree and run it there. */
function packagingFixtures(): Set<string> {
  // Search Git's index, not every working file: opening all 1,570 test files
  // took 24.7 s on the win11 VM, where each fresh file is scanned on open.
  const listed = spawnSync(
    'git',
    ['grep', '--cached', '-l', '-e', 'package-acp.mjs', '--', 'test'],
    { cwd: root, encoding: 'utf8' },
  )
  expect(listed.status, listed.stderr).toBe(0)
  return new Set(
    listed.stdout
      .split('\n')
      .filter((file) => file !== '' && file !== SELF && file !== HELPER)
      .filter((file) => {
        const text = read(file)
        return text.includes('mkdtempSync') && /\bspawnSync\(/u.test(text)
      }),
  )
}

const folders: string[] = []
afterEach(async () => {
  await Promise.all(folders.splice(0).map((folder) => removeFolder(folder)))
})

describe('ACP packaging fixtures', () => {
  it('lay out every native file the packager copies, its runner helpers and its list', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'acp-native-'))
    folders.push(dir)
    layOutAcpNativeSources(dir, root)
    for (const file of ACP_NATIVE_FILES)
      expect(readFileSync(path.join(dir, file), 'utf8'), file).not.toBe('')
    expect(new Set(readdirSync(path.join(dir, RUNNER_HELPERS)))).toEqual(
      new Set(readdirSync(path.join(root, RUNNER_HELPERS))),
    )
    expect(readFileSync(path.join(dir, 'scripts/lib/acpNativeSources.mjs'), 'utf8')).toBe(
      read('scripts/lib/acpNativeSources.mjs'),
    )
  })

  it('the packager takes its native files from the shared list only', () => {
    const packager = read('scripts/package-acp.mjs')
    expect(packager).toContain("from './lib/acpNativeSources.mjs'")
    expect(packager).not.toMatch(/\.cs['"]/u)
    expect(packager).not.toContain("'muse-created'")
    expect(packager).not.toContain("'runner'")
  })

  it('every packaging fixture uses the shared layout and keeps no list of its own', () => {
    expect(packagingFixtures()).toEqual(new Set(KNOWN_FIXTURES))
    for (const file of KNOWN_FIXTURES) {
      const text = read(file)
      expect(text, file).toMatch(/from '(?:\.\/|\.\.\/unit\/)helpers\/acpPackageSources'/u)
      expect(text, file).toContain('layOutAcpNativeSources(')
      for (const source of JOB_SOURCES)
        expect(text, `${file} lists ${source}`).not.toContain(path.basename(source))
    }
  })
})
