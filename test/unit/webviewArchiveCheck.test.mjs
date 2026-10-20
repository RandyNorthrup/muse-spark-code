// scripts/check-webview-archive.mjs is a command: the tests run it as one,
// the way CI runs it over each shipped .vsix. A fixture .vsix carries a
// real solid archive the real producer packed; a planted gap, a loose
// member, no input and a symlinked start directory each refuse.
import { spawnSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { packSolidTextArchive } from '../../scripts/lib/solidTextArchive.mjs'

const root = mkdtempSync(path.join(tmpdir(), 'muse-webview-check-'))
const source = path.join(root, 'tree')
const archive = path.join(root, 'webview.json.br')
const vsix = path.join(root, 'fixture.vsix')

const REQUIRED = [
  'main.js',
  'main.css',
  'models.js',
  'models.css',
  'usage.js',
  'usage.css',
  'whatsNew.js',
  'whatsNew.css',
  'reportingPage.js',
  'reportingPage.css',
]

const PYTHON = ['python3', 'python', 'py'].find(
  (candidate) => spawnSync(candidate, ['--version']).status === 0,
)

function python(args) {
  if (PYTHON === undefined) throw new Error('Python is required for the VSIX fixture')
  return spawnSync(PYTHON, args, { encoding: 'utf8' })
}

function pack(members) {
  rmSync(source, { recursive: true, force: true })
  for (const member of members) {
    const target = path.join(source, member)
    mkdirSync(path.dirname(target), { recursive: true })
    writeFileSync(target, `// ${member}\n`)
  }
  rmSync(path.join(root, 'stage'), { recursive: true, force: true })
  mkdirSync(path.join(root, 'stage'), { recursive: true })
  cpSync(source, path.join(root, 'stage', 'webview'), { recursive: true })
  packSolidTextArchive(path.join(root, 'stage'), 'webview', 'webview.json.br')
  cpSync(path.join(root, 'stage', 'webview.json.br'), archive)
}

/** A fixture .vsix holding the packed archive, optionally with loose members. */
function fixture(loose = []) {
  const names = [...REQUIRED, 'chunks/2M5Y66TM.js']
  pack(names)
  const extra = loose
    .map((name) => `    z.writestr('extension/dist/webview/${name}', b'loose')`)
    .join('\n')
  const made = python([
    '-c',
    `import sys
from zipfile import ZipFile
with ZipFile(sys.argv[1], 'w') as z:
    z.write(sys.argv[2], 'extension/dist/webview.json.br')
${extra}`,
    vsix,
    archive,
  ])
  expect(made.status, made.stderr).toBe(0)
}

function check(...argv) {
  return spawnSync(process.execPath, ['scripts/check-webview-archive.mjs', ...argv], {
    encoding: 'utf8',
  })
}

beforeAll(() => {
  fixture()
})

afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('check-webview-archive', () => {
  it('accepts a .vsix whose archive holds every panel file and no loose member', () => {
    const run = check(vsix)
    expect(run.status, `${run.stdout}\n${run.stderr}`).toBe(0)
    expect(run.stdout).toContain('every panel file present')
  })

  it('refuses a .vsix whose archive drops a panel file', () => {
    pack(REQUIRED.filter((name) => name !== 'whatsNew.css'))
    const made = python([
      '-c',
      `import sys
from zipfile import ZipFile
with ZipFile(sys.argv[1], 'w') as z:
    z.write(sys.argv[2], 'extension/dist/webview.json.br')`,
      vsix,
      archive,
    ])
    expect(made.status, made.stderr).toBe(0)
    try {
      const run = check(vsix)
      expect(run.status).not.toBe(0)
      expect(run.stderr).toContain('whatsNew.css')
    } finally {
      fixture()
    }
  })

  it('refuses a .vsix that still ships a loose webview member', () => {
    fixture(['main.js'])
    try {
      const run = check(vsix)
      expect(run.status).not.toBe(0)
      expect(run.stderr).toContain('Loose webview members')
    } finally {
      fixture()
    }
  })

  it('refuses missing input and runs through a symlinked directory', () => {
    expect(check().status).not.toBe(0)
    const linked = path.join(root, 'linked-scripts')
    symlinkSync(path.resolve('scripts'), linked, 'junction')
    try {
      const run = spawnSync(
        process.execPath,
        [path.join(linked, 'check-webview-archive.mjs'), vsix],
        { encoding: 'utf8' },
      )
      expect(run.status, `${run.stdout}\n${run.stderr}`).toBe(0)
    } finally {
      rmSync(linked, { recursive: true, force: true })
    }
  })
})
