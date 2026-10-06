import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { pack } from '@vscode/vsce/out/package.js'

const fixture = { root: '' }
beforeAll(async () => {
  mkdirSync('temp', { recursive: true })
  fixture.root = mkdtempSync(path.resolve('temp/m103a-host-unit-'))
  const source = path.join(fixture.root, 'source')
  mkdirSync(source)
  writeFileSync(
    path.join(source, 'package.json'),
    JSON.stringify({
      name: 'm103a-host-fixture',
      version: '0.0.0',
      publisher: 'test',
      repository: 'https://github.com/RandyNorthrup/muse-spark-code',
      license: 'MIT',
      engines: { vscode: '^1.99.0', node: '>=22' },
    }),
  )
  writeFileSync(path.join(source, 'README.md'), 'Private fake-only host guard fixture.\n')
  writeFileSync(path.join(source, 'LICENSE'), 'Private test fixture.\n')
  await pack({
    cwd: source,
    dependencies: false,
    packagePath: path.join(fixture.root, 'normal.vsix'),
  })
})
afterAll(() => rmSync(fixture.root, { recursive: true, force: true }))

function run(work) {
  return execFileSync(
    process.execPath,
    [
      'test/hosts/arduino.mjs',
      path.join(fixture.root, 'absent-ide'),
      path.join(fixture.root, 'normal.vsix'),
      work,
    ],
    { encoding: 'utf8', stdio: 'pipe' },
  )
}

describe('Arduino host installation guards', () => {
  it('refuses a normal VSIX before launching an editor', () => {
    expect(() => run(path.join(fixture.root, 'wrong-build'))).toThrow('requires the Arduino VSIX')
  })
  it('refuses an existing test home and leaves it byte-exact', () => {
    const work = path.join(fixture.root, 'existing')
    mkdirSync(path.join(work, 'home'), { recursive: true })
    const sentinel = path.join(work, 'home/settings.json')
    writeFileSync(sentinel, 'keep these bytes')
    expect(() => run(work)).toThrow('Use a fresh Arduino test work directory')
    expect(readFileSync(sentinel, 'utf8')).toBe('keep these bytes')
  })
})
