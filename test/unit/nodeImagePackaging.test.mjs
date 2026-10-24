import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { stageNodeImage } from '../../scripts/package-node-image.mjs'

const policy = JSON.parse(readFileSync('deploy/container/policy.json', 'utf8'))
const fixture = { root: '', runtime: '', stage: '' }
// A directory link: a junction on Windows, a symlink elsewhere.
const DIR_LINK = process.platform === 'win32' ? 'junction' : 'dir'
beforeEach(() => {
  mkdirSync('temp', { recursive: true })
  fixture.root = mkdtempSync(path.resolve('temp/m110-c-package-'))
  fixture.runtime = path.join(fixture.root, 'runtime')
  fixture.stage = path.join(fixture.root, 'context')
  for (const file of policy.runtimeFiles) {
    mkdirSync(path.dirname(path.join(fixture.runtime, file)), { recursive: true })
    writeFileSync(path.join(fixture.runtime, file), 'fixture')
  }
  writeFileSync(
    path.join(fixture.runtime, 'package.json'),
    JSON.stringify({
      name: 'muse-spark-code-acp',
      version: '0.13.0',
      dependencies: { 'node-pty': '1.1.0', '@napi-rs/keyring': '2.1.0' },
    }),
  )
  writeFileSync(
    path.join(fixture.runtime, 'package-lock.json'),
    JSON.stringify({
      lockfileVersion: 3,
      packages: { 'node_modules/node-pty': {}, 'node_modules/@napi-rs/keyring': {} },
    }),
  )
})
afterEach(() => rmSync(fixture.root, { recursive: true, force: true }))

describe('node image package boundary', () => {
  it('copies only the runtime and records the exact input bytes', () => {
    writeFileSync(path.join(fixture.runtime, 'PLAN.md'), 'private development material')
    const receipt = stageNodeImage(fixture.runtime, fixture.stage)
    expect(receipt.map((entry) => entry.file).toSorted((a, b) => a.localeCompare(b, 'en'))).toEqual(
      policy.runtimeFiles.toSorted((a, b) => a.localeCompare(b, 'en')),
    )
    for (const entry of receipt) {
      expect(entry.sha256).toBe(
        createHash('sha256')
          .update(readFileSync(path.join(fixture.runtime, entry.file)))
          .digest('hex'),
      )
      expect(readFileSync(path.join(fixture.stage, 'runtime', entry.file))).toEqual(
        readFileSync(path.join(fixture.runtime, entry.file)),
      )
    }
  })
  it.each(['dist/node.js', 'dist/nodeToolHost.js', 'THIRD_PARTY_NOTICES.txt', 'package-lock.json'])(
    'refuses the absent integration artifact %s',
    (file) => {
      rmSync(path.join(fixture.runtime, file))
      expect(() => stageNodeImage(fixture.runtime, fixture.stage)).toThrow(
        'Node runtime artifact missing',
      )
    },
  )
  it.each(['.env', 'auth.json', 'credentials.json', 'id_ed25519', 'tls.key'])(
    'refuses credential path %s without printing contents',
    (file) => {
      writeFileSync(path.join(fixture.runtime, file), 'private fixture data')
      expect(() => stageNodeImage(fixture.runtime, fixture.stage)).toThrow('forbidden path')
    },
  )
  it('refuses symlinks, including a fixture.runtime fixture.root alias', () => {
    // Windows grants a file link only with the symbolic-link privilege, which
    // a test account does not hold; its directory link is a junction (no
    // privilege needed), which lstat reads as a link there.
    if (process.platform !== 'win32') {
      symlinkSync(path.join(fixture.runtime, 'LICENSE'), path.join(fixture.runtime, 'linked'))
      expect(() => stageNodeImage(fixture.runtime, fixture.stage)).toThrow('symlink')
      rmSync(path.join(fixture.runtime, 'linked'))
    }
    symlinkSync(path.join(fixture.runtime, 'dist'), path.join(fixture.runtime, 'linked'), DIR_LINK)
    expect(() => stageNodeImage(fixture.runtime, fixture.stage)).toThrow('symlink')
    rmSync(path.join(fixture.runtime, 'linked'))
    symlinkSync(fixture.runtime, path.join(fixture.root, 'alias'), DIR_LINK)
    expect(() => stageNodeImage(path.join(fixture.root, 'alias'), fixture.stage)).toThrow('symlink')
  })
  it('refuses an existing context and a context within the source', () => {
    mkdirSync(fixture.stage)
    writeFileSync(path.join(fixture.stage, 'stale'), 'must not ship')
    expect(() => stageNodeImage(fixture.runtime, fixture.stage)).toThrow()
    expect(() => stageNodeImage(fixture.runtime, path.join(fixture.runtime, 'stage'))).toThrow(
      'outside',
    )
  })
  it('refuses unpinned native dependencies and empty entrypoints', () => {
    const manifest = JSON.parse(readFileSync(path.join(fixture.runtime, 'package.json'), 'utf8'))
    manifest.dependencies['node-pty'] = '^1.1.0'
    writeFileSync(path.join(fixture.runtime, 'package.json'), JSON.stringify(manifest))
    expect(() => stageNodeImage(fixture.runtime, fixture.stage)).toThrow()
    cpSync('deploy/container/entrypoint.sh', path.join(fixture.runtime, 'dist/node.js'))
    writeFileSync(path.join(fixture.runtime, 'dist/nodeToolHost.js'), '')
    expect(() => stageNodeImage(fixture.runtime, fixture.stage)).toThrow('Empty runtime artifact')
  })
  it('withholds malformed package JSON contents from CLI diagnostics', () => {
    writeFileSync(path.join(fixture.runtime, 'package.json'), 'M110PRIVATE')
    const result = spawnSync(
      process.execPath,
      ['scripts/package-node-image.mjs', fixture.runtime, fixture.stage],
      { encoding: 'utf8' },
    )
    expect(result.status).toBe(1)
    expect(`${result.stdout}${result.stderr}`).not.toContain('M110PRIVATE')
  })
  it.each(['node-pty', '@napi-rs/keyring'])(
    'refuses a lock missing native dependency %s',
    (name) => {
      const lock = JSON.parse(readFileSync(path.join(fixture.runtime, 'package-lock.json'), 'utf8'))
      Reflect.deleteProperty(lock.packages, `node_modules/${name}`)
      writeFileSync(path.join(fixture.runtime, 'package-lock.json'), JSON.stringify(lock))
      expect(() => stageNodeImage(fixture.runtime, fixture.stage)).toThrow(
        'Native dependencies missing',
      )
    },
  )
})
