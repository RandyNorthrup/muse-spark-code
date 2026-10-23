import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { afterEach, describe, expect, it } from 'vitest'
import { testBash } from './helpers/shellBash'

const manifest = JSON.parse(readFileSync('deploy/toolset/base.json', 'utf8'))
const folders = []
afterEach(async () => {
  await Promise.all(folders.splice(0).map((folder) => rm(folder, { recursive: true, force: true })))
})
const bash = testBash()

function fixture(pack) {
  const root = mkdtempSync(path.join(tmpdir(), 'm110-b0-install-'))
  folders.push(root)
  const artifacts = path.join(root, 'pack')
  const pins = path.join(root, 'checksums')
  mkdirSync(path.join(artifacts, 'debs'), { recursive: true })
  mkdirSync(pins)
  const names = pack === 'base' ? ['git', 'python3', 'python3-minimal'] : ['make', 'cmake']
  const debs = manifest.architectures.amd64.artifacts.filter((pin) => names.includes(pin.name))
  const digest = createHash('sha256').update('abc').digest('hex')
  for (const pin of debs) writeFileSync(path.join(artifacts, 'debs', pin.file), 'abc')
  const checksums = debs.map((pin) => `${digest}  debs/${pin.file}`).join('\n') + '\n'
  writeFileSync(path.join(artifacts, 'SHA256SUMS'), checksums)
  writeFileSync(path.join(pins, `${pack}.sha256`), checksums)
  writeFileSync(path.join(artifacts, 'debs', 'unlisted.deb'), 'abc')
  const calls = path.join(root, 'dpkg.log')
  const inspections = path.join(root, 'dpkg-deb.log')
  writeFileSync(calls, '')
  writeFileSync(inspections, '')
  return { root, artifacts, pins, calls, inspections, debs, checksums, digest, pack }
}

function install(fixture) {
  // Execute the shipped shell's control flow. Only its container paths and
  // package/filesystem commands are virtualized; real SHA-256 checks run in Node
  // on every platform, without installing packages or changing the host.
  const source = readFileSync('deploy/toolset/install.sh', 'utf8')
    .replaceAll('/tmp/muse-toolset/debs/', 'debs/')
    .replaceAll('/usr/local/share/muse-toolset/checksums/', '$TOOLSET_PINS/')
  const commands = String.raw`
cd() { builtin cd "$TOOLSET_PACK"; }
sha256sum() { "$NODE" --input-type=module -e "$HASHER" -- "$@"; }
dpkg-deb() {
  printf '%s\n' "$*" >> "$INSPECTIONS"
  filename=${'${2##*/}'}
  printf '%s\n' "${'${filename%%_*}'}"
}
dpkg() { printf '%s\n' "$*" >> "$CALLS"; }
tar() { :; }
mkdir() { :; }
cp() { :; }
ln() { :; }
chown() { :; }
chmod() { :; }
rm() { :; }
set -- "$PACK"
${source}`
  const child = spawnSync(bash, ['--noprofile', '--norc', '-c', commands], {
    encoding: 'utf8',
    windowsHide: true,
    env: {
      ...process.env,
      TOOLSET_PACK: fixture.artifacts.replaceAll('\\', '/'),
      TOOLSET_PINS: fixture.pins.replaceAll('\\', '/'),
      CALLS: fixture.calls.replaceAll('\\', '/'),
      INSPECTIONS: fixture.inspections.replaceAll('\\', '/'),
      NODE: process.execPath.replaceAll('\\', '/'),
      PACK: fixture.pack,
      HASHER: String.raw`
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
for (const line of readFileSync(process.argv.at(-1), 'utf8').trim().split('\n')) {
  const [digest, file] = line.split('  ')
  if (createHash('sha256').update(readFileSync(file)).digest('hex') !== digest)
    throw new Error('SHA-256 mismatch: ' + file)
}
`,
    },
  })
  expect(child.error).toBeUndefined()
  return child
}

function installed(fixture) {
  return readFileSync(fixture.calls, 'utf8')
    .trim()
    .split('\n')
    .filter((call) => /^--(?:unpack|install) /.test(call))
    .flatMap((call) =>
      call
        .split(' ')
        .slice(1)
        .map((file) => path.posix.basename(file)),
    )
    .toSorted((left, right) => left.localeCompare(right))
}

describe('pinned offline installer dispatch', () => {
  it.each(['base', 'build'])('installs only manifest-named debs in the %s pack', (pack) => {
    const context = fixture(pack)
    const child = install(context)
    expect(child.status, child.stderr).toBe(0)
    expect(installed(context)).toEqual(
      context.debs.map((pin) => pin.file).toSorted((left, right) => left.localeCompare(right)),
    )
  })
  it('keeps manifest pins when an artifact pack rewrites its checksum list', () => {
    const context = fixture('base')
    writeFileSync(
      path.join(context.artifacts, 'SHA256SUMS'),
      context.checksums + `${context.digest}  debs/unlisted.deb\n`,
    )
    const child = install(context)
    expect(child.status, child.stderr).toBe(0)
    expect(installed(context)).toEqual(
      context.debs.map((pin) => pin.file).toSorted((left, right) => left.localeCompare(right)),
    )
  })
  it('refuses changed pinned deb bytes before any package inspection or installation', () => {
    const context = fixture('base')
    writeFileSync(path.join(context.artifacts, 'debs', context.debs[0].file), 'abd')
    const child = install(context)
    expect(child.status).not.toBe(0)
    expect(child.stderr).toContain('SHA-256 mismatch')
    expect(readFileSync(context.calls, 'utf8')).toBe('')
    expect(readFileSync(context.inspections, 'utf8')).toBe('')
  })
  it('refuses an incomplete pinned Python pair before installing the base pack', () => {
    const context = fixture('base')
    writeFileSync(
      path.join(context.pins, 'base.sha256'),
      context.checksums
        .split('\n')
        .filter((line) => !line.includes('/python3-minimal_'))
        .join('\n'),
    )
    const child = install(context)
    expect(child.status).not.toBe(0)
    expect(child.stderr).toContain('Pinned Python packages missing')
    expect(readFileSync(context.calls, 'utf8')).toBe('')
  })
})
