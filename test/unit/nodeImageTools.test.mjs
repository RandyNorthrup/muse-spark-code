import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const fixture = { scratch: '' }
beforeEach(() => {
  mkdirSync('temp', { recursive: true })
  fixture.scratch = mkdtempSync(path.resolve('temp/m110-tool-guard-'))
})
afterEach(() => rmSync(fixture.scratch, { recursive: true, force: true }))
const install = (preload) => {
  const file = path.join(fixture.scratch, 'preload.mjs')
  writeFileSync(file, preload)
  // --import takes a module URL: a Windows drive path reads as a `c:` scheme.
  return spawnSync(
    process.execPath,
    [
      '--import',
      pathToFileURL(file).href,
      'deploy/container/install-tools.mjs',
      path.join(fixture.scratch, 'tools'),
    ],
    { encoding: 'utf8' },
  )
}
const notice = (manifest, hasLicence = true) => {
  const directory = path.join(fixture.scratch, 'node_modules/fixture')
  mkdirSync(directory, { recursive: true })
  writeFileSync(path.join(directory, 'package.json'), JSON.stringify(manifest))
  if (hasLicence) writeFileSync(path.join(directory, 'LICENSE'), 'Synthetic test licence notice')
  const script = path.join(fixture.scratch, 'notices.mjs')
  // Bind the actual build script to a private test filesystem, leaving its
  // validation unchanged and avoiding writes to the installed dependencies.
  writeFileSync(
    script,
    readFileSync('deploy/container/native-notices.mjs', 'utf8')
      .replace("'/opt/muse/node_modules'", () =>
        JSON.stringify(path.join(fixture.scratch, 'node_modules')),
      )
      .replace("'/opt/muse/native-notices.json'", () =>
        JSON.stringify(path.join(fixture.scratch, 'notices.json')),
      ),
  )
  return spawnSync(process.execPath, [script], { encoding: 'utf8' })
}

describe('pinned image tool installer', () => {
  it('refuses an unsupported tool host', () => {
    const result = install(`
      Object.defineProperty(process, 'platform', {value: 'win32'});
      globalThis.fetch = async () => new Response('synthetic mismatched tool bytes');
    `)
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('Linux amd64/arm64 tool host required')
  })
  it('refuses a mismatched download before installing a binary', () => {
    const result = install(`
      Object.defineProperty(process, 'platform', {value: 'linux'});
      Object.defineProperty(process, 'arch', {value: 'x64'});
      globalThis.fetch = async () => new Response('synthetic mismatched tool bytes');
    `)
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('Pinned tool SHA-256 mismatch')
    expect(() => readFileSync(path.join(fixture.scratch, 'tools/cosign'))).toThrow()
  })
  it('inventories native licence text and refuses an unreviewed licence', () => {
    expect(notice({ version: '1.0.0', license: 'MIT' }).status).toBe(0)
    expect(
      JSON.parse(readFileSync(path.join(fixture.scratch, 'notices.json'), 'utf8'))[0].license,
    ).toBe('MIT')
    const refused = notice({ version: '1.0.0', license: 'GPL-3.0' })
    expect(refused.status).toBe(1)
    expect(refused.stderr).toContain('no reviewed licence notice')
  })
  it('refuses a native dependency missing licence text', () => {
    const refused = notice({ version: '1.0.0', license: 'MIT' }, false)
    expect(refused.status).toBe(1)
    expect(refused.stderr).toContain('no reviewed licence notice')
  })
})
