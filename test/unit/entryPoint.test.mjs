// scripts/lib/entryPoint.mjs is the one "am I the entry point" check of every
// script under scripts/. A script started through a symlink or a Windows
// junction used to end without a word and with exit 0, because its check
// compared the start path as typed with the real path Node names the module
// by: a gate that passes by not running. These tests use real links and real
// processes. The function is called on real files through every kind of link,
// then the repository's own scripts are started through a junction and a
// symlink on input that makes each print or fail in its own words, so a
// script that did not run is told from one that did.
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { isEntryPoint } from '../../scripts/lib/entryPoint.mjs'

const repo = process.cwd()
const scripts = path.join(repo, 'scripts')
// Links live under the repository's ignored temp/ and are removed one by one
// before the folder goes, so removing the folder can never reach a target.
mkdirSync(path.join(repo, 'temp'), { recursive: true })
const root = mkdtempSync(path.join(repo, 'temp', 'entry-point-'))
const empty = path.join(root, 'empty')
mkdirSync(empty)
const links = []

function link(target, name, type) {
  const at = path.join(root, name)
  symlinkSync(target, at, type)
  links.push(at)
  return at
}

/** Whether this platform lets this account make a symlink of that type. */
function canLink(type) {
  const target = type === 'file' ? path.join(root, 'link-target.txt') : root
  if (type === 'file') writeFileSync(target, 'target')
  const at = path.join(root, `link-probe-${type}`)
  try {
    symlinkSync(target, at, type)
  } catch (error) {
    // Windows makes a file or directory symlink only with Developer Mode or elevation.
    if (error.code === 'EPERM') return false
    throw error
  }
  unlinkSync(at)
  return true
}

const FILE_SYMLINKS = canLink('file')
const DIR_SYMLINKS = canLink('dir')

// A junction needs no privilege on Windows, and is a plain symlink elsewhere.
const junction = link(scripts, 'via-junction', 'junction')
const subject = path.join(scripts, 'check-vsix-size.mjs')
const subjectUrl = pathToFileURL(subject).href

afterAll(() => {
  for (const at of links) unlinkSync(at)
  rmSync(root, { recursive: true, force: true })
})

function start(script, args = [], { cwd = repo, env = process.env } = {}) {
  return spawnSync(process.execPath, [script, ...args], { cwd, env, encoding: 'utf8' })
}

describe('isEntryPoint on real files', () => {
  it('knows its own start path, a file it is not, and a start argument that names nothing', () => {
    expect(isEntryPoint(subjectUrl, subject)).toBe(true)
    expect(isEntryPoint(subjectUrl, path.join(scripts, 'check-badges.mjs'))).toBe(false)
    expect(isEntryPoint(subjectUrl, path.join(scripts, 'no-such-script.mjs'))).toBe(false)
    expect(isEntryPoint(subjectUrl, path.join(subject, 'below-a-file'))).toBe(false)
    expect(isEntryPoint(subjectUrl, undefined)).toBe(false)
  })

  it('follows a junction to the folder, by an absolute and by a relative path', () => {
    const through = path.join(junction, 'check-vsix-size.mjs')
    expect(isEntryPoint(subjectUrl, through)).toBe(true)
    expect(isEntryPoint(subjectUrl, path.relative(repo, through))).toBe(true)
  })

  it('follows a junction made to another link', () => {
    const chained = link(junction, 'via-chain', 'junction')
    expect(isEntryPoint(subjectUrl, path.join(chained, 'check-vsix-size.mjs'))).toBe(true)
  })

  it.skipIf(!FILE_SYMLINKS)('follows a symlink to the file', () => {
    expect(isEntryPoint(subjectUrl, link(subject, 'to-file.mjs', 'file'))).toBe(true)
  })

  it.skipIf(!DIR_SYMLINKS)('follows a symlink to the folder', () => {
    const folder = link(scripts, 'to-folder', 'dir')
    expect(isEntryPoint(subjectUrl, path.join(folder, 'check-vsix-size.mjs'))).toBe(true)
  })

  it('compares without case on Windows only', () => {
    expect(isEntryPoint(subjectUrl, subject.toUpperCase())).toBe(process.platform === 'win32')
  })

  it('throws what is not a missing start argument', () => {
    expect(() => isEntryPoint(subjectUrl, 'not\0a path')).toThrow()
  })
})

// Each script on input that makes it print, or fail, in its own words. Run by
// its plain path first, the same rows hold, so a row that passes through a
// link cannot be one a silent exit satisfies.
const SCRIPTS = [
  {
    script: 'check-webview-archive.mjs',
    status: 1,
    stderr: 'Usage: node scripts/check-webview-archive.mjs <vsix>',
  },
  { script: 'check-vsix-size.mjs', status: 1, stderr: 'At least one VSIX path required' },
  {
    script: 'github-release.mjs',
    status: 1,
    stderr: 'GitHub Release creation or asset verification failed',
  },
  { script: 'publish-registry.mjs', args: ['npm'], status: 1, stderr: 'npm: publication refused' },
  {
    script: 'sync-bundled-skills.mjs',
    status: 1,
    stderr: 'Usage: node scripts/sync-bundled-skills.mjs --tag vX.Y.Z',
  },
  {
    script: 'sync-provider-catalog.mjs',
    args: ['--bogus'],
    status: 1,
    stderr: 'Usage: node scripts/sync-provider-catalog.mjs',
  },
  {
    script: 'package-node-image.mjs',
    status: 1,
    stderr: 'Usage: node scripts/package-node-image.mjs',
  },
  { script: 'check-node-image.mjs', status: 1, stderr: 'Usage: check-node-image.mjs' },
  {
    script: 'build-linux-helper-pins.mjs',
    status: 1,
    stderr: 'Usage: node scripts/build-linux-helper-pins.mjs',
  },
  {
    script: 'check-linux-helper-pins.mjs',
    args: ['--bundle', 'x'],
    status: 1,
    stderr: '--bundle needs --assets',
  },
  {
    script: 'capture-m106-meta.mjs',
    args: ['--help'],
    status: 0,
    stdout: 'M106 Meta evidence capture',
  },
  {
    script: 'check-badges.mjs',
    args: ['--bogus', 'x'],
    status: 1,
    stderr: 'Badges: Expected --packaged-vsix',
  },
  {
    script: 'release-summary.mjs',
    // The release job's own variable, left out.
    env: Object.fromEntries(
      Object.entries(process.env).filter(([name]) => name !== 'RELEASE_NEEDS'),
    ),
    status: 1,
    stderr: 'is not valid JSON',
  },
  // In a folder with no package.json and no dist/: the script's first read fails.
  { script: 'release-reuse.mjs', cwd: empty, status: 1, stderr: 'package.json' },
  { script: 'release-sbom.mjs', cwd: empty, status: 1, stderr: 'ACP stage receipt is missing' },
  // It imports check-badges.mjs, which must stay quiet as an imported module.
  {
    script: 'refresh-badges.mjs',
    cwd: empty,
    status: 0,
    stderr: '::warning::README badge refresh could not complete',
    notStderr: 'Badges:',
  },
  { script: 'check-tokens.mjs', status: 0, stdout: 'tokens: 0 problems' },
  { script: 'mhp-errors.mjs', args: ['--check'], status: 0, stdout: 'MHP error tables match.' },
]

const STARTS = [
  { how: 'its plain path', make: (script) => path.join(scripts, script), usable: true },
  { how: 'a junction to scripts/', make: (script) => path.join(junction, script), usable: true },
  {
    how: 'a symlink to the file',
    make: (script) => link(path.join(scripts, script), `to-${script}`, 'file'),
    usable: FILE_SYMLINKS,
  },
]

function expectRan(run, row) {
  const shown = `exit ${String(run.status)}\n${run.stdout}\n${run.stderr}`
  expect(run.status, shown).toBe(row.status)
  expect(run.stdout + run.stderr, shown).not.toBe('')
  if (row.stdout !== undefined) expect(run.stdout, shown).toContain(row.stdout)
  if (row.stderr !== undefined) expect(run.stderr, shown).toContain(row.stderr)
  if (row.notStderr !== undefined) expect(run.stderr, shown).not.toContain(row.notStderr)
}

describe.each(STARTS)('a script started through $how', ({ make, usable }) => {
  // A symlink to a file is made only where the platform lets this account make one.
  const scriptCase = usable ? it : it.skip
  scriptCase.each(SCRIPTS)('runs $script', (row) => {
    const run = start(make(row.script), row.args, { cwd: row.cwd, env: row.env })
    expectRan(run, row)
  })
})

describe('a script imported, not started', () => {
  it('stays quiet, even when a junction is how it is reached', () => {
    const run = spawnSync(
      process.execPath,
      [
        '--input-type=module',
        '--eval',
        'await import(process.argv[1])',
        pathToFileURL(path.join(junction, 'check-vsix-size.mjs')).href,
      ],
      { encoding: 'utf8' },
    )
    expect(run.status, run.stderr).toBe(0)
    expect(run.stdout + run.stderr).toBe('')
  })
})
