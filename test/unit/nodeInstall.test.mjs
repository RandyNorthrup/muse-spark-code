// The native Linux installer's LAN profile (deploy/install/): layout.sh must
// place the runtime, legal files, units and state directories with exact
// modes and refuse anything unexpected; install.sh must verify checksums,
// demand gh for the release attestation and abort before touching the
// destination. Attestation success needs the network and a real release, so
// only the S0 proof run exercises it (docs/certification/m110a0-hosts.md).
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { afterEach, describe, expect, it } from 'vitest'
import { testBash } from './helpers/shellBash'

const folders = []
afterEach(async () => {
  await Promise.all(folders.splice(0).map((folder) => rm(folder, { recursive: true, force: true })))
})
const bash = testBash()
const INSTALL = path.join('deploy', 'install', 'install.sh')
// What dist/node.js needs beside itself to start and to serve; the closure is
// derived from a real production build in packagedBundles.test.mjs.
const SERVE_FILES = [
  'dist/nodeServe.js',
  'dist/nodeAuth.js',
  'dist/uiText.js',
  'dist/uiTextHooks.js',
  'dist/uiTextMedia.js',
  'dist/uiTextRuntime.js',
  'dist/uiTextSurfaces.js',
  'dist/validation.js',
  'dist/modelApiBoundaries.js',
  'dist/resourceAdmission.js',
  'dist/resourceGovernor.js',
  'dist/resourceJournal.js',
  'dist/resourceProcess.js',
  'dist/execGuard.js',
  'dist/vaultBoundaries.js',
  'package.json',
]
const LAYOUT = path.join('deploy', 'install', 'layout.sh')

function release(options = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'm110-s0-install-'))
  folders.push(root)
  const stage = path.join(root, 'stage', 'package')
  mkdirSync(path.join(stage, 'dist'), { recursive: true })
  if (options.runtime !== false)
    writeFileSync(path.join(stage, 'dist', 'node.js'), "'use strict'\n")
  for (const name of SERVE_FILES)
    if (name !== options.without) writeFileSync(path.join(stage, name), "'use strict'\n")
  if (options.toolhost !== false)
    writeFileSync(path.join(stage, 'dist', 'nodeToolHost.js'), "'use strict'\n")
  if (options.licence !== false) writeFileSync(path.join(stage, 'LICENSE'), 'licence\n')
  if (options.notices !== false)
    writeFileSync(path.join(stage, 'THIRD_PARTY_NOTICES.txt'), 'notices\n')
  const name = options.name === undefined ? 'muse-spark-code-acp-0.0.0-test.tgz' : options.name
  const tarball = path.join(root, name)
  // tar runs in the release folder and is handed relative names: GNU tar (Git
  // for Windows ships one) reads a drive path such as `C:/…` as `host:path`
  // on another machine, while every tar reads a relative name the same way.
  const tar = spawnSync('tar', ['-czf', name, '-C', 'stage', 'package'], {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
  })
  expect(tar.status).toBe(0)
  const digest = createHash('sha256').update(readFileSync(tarball)).digest('hex')
  const sums = path.join(root, 'SHA256SUMS')
  writeFileSync(sums, options.sums === undefined ? `${digest}  ${name}\n` : options.sums)
  return { root, tarball, sums }
}

function run(script, args) {
  return spawnSync(bash, [script, ...args], { encoding: 'utf8', windowsHide: true })
}

function modeOf(file) {
  return (statSync(file).mode & 0o777).toString(8)
}

// The layout is the native Linux installer's: it runs on Linux hosts only,
// never on Windows. Under Git for Windows its GNU tar cannot read a drive
// path ("tarball unreadable: C:\…", so its refusal cases would pass for the
// wrong reason) and NTFS keeps no POSIX modes for it to set.
describe.skipIf(process.platform === 'win32')('M110-S0 native installer layout', () => {
  it('lays the runtime, legal files, units and state out with exact modes', () => {
    const { tarball } = release()
    const prefix = path.join(path.dirname(tarball), 'prefix')
    const child = run(LAYOUT, [
      '--tarball',
      tarball,
      '--root',
      prefix,
      '--node-bin',
      process.execPath,
    ])
    expect(child.status).toBe(0)
    expect(readFileSync(path.join(prefix, 'opt', 'muse', 'dist', 'node.js'), 'utf8')).toBe(
      "'use strict'\n",
    )
    expect(readFileSync(path.join(prefix, 'opt', 'muse', 'dist', 'nodeToolHost.js'), 'utf8')).toBe(
      "'use strict'\n",
    )
    for (const name of SERVE_FILES)
      expect(readFileSync(path.join(prefix, 'opt', 'muse', name), 'utf8')).toBe("'use strict'\n")
    expect(readFileSync(path.join(prefix, 'opt', 'muse', 'LICENSE'), 'utf8')).toBe('licence\n')
    expect(readFileSync(path.join(prefix, 'opt', 'muse', 'THIRD_PARTY_NOTICES.txt'), 'utf8')).toBe(
      'notices\n',
    )
    const nodeUnit = readFileSync(
      path.join(prefix, 'etc', 'systemd', 'system', 'muse-node.service'),
      'utf8',
    )
    expect(nodeUnit).toContain('User=muse-node')
    expect(nodeUnit).toContain('/opt/muse/dist/node.js serve')
    const toolUnit = readFileSync(
      path.join(prefix, 'etc', 'systemd', 'system', 'muse-node-toolhost.service'),
      'utf8',
    )
    expect(toolUnit).toContain('ConditionPathExists=/opt/muse/dist/nodeToolHost.js')
    // Modes only mean something where the units run; Windows ACLs
    // report synthetic bits.
    if (process.platform === 'win32') return
    expect(modeOf(path.join(prefix, 'opt', 'muse', 'dist', 'node.js'))).toBe('644')
    expect(modeOf(path.join(prefix, 'etc', 'systemd', 'system', 'muse-node.service'))).toBe('644')
    expect(modeOf(path.join(prefix, 'var', 'lib', 'muse-spark-code-node'))).toBe('700')
    expect(modeOf(path.join(prefix, 'var', 'lib', 'muse-spark-code-node', 'workspaces'))).toBe(
      '700',
    )
  })
  it('installs without the tool host bundle and says the unit stays inert', () => {
    const { tarball } = release({ toolhost: false })
    const prefix = path.join(path.dirname(tarball), 'prefix')
    const child = run(LAYOUT, [
      '--tarball',
      tarball,
      '--root',
      prefix,
      '--node-bin',
      process.execPath,
    ])
    expect(child.status).toBe(0)
    expect(child.stderr).toContain('stays inert')
  })
  it('refuses a tarball without the runtime, licence or notices', () => {
    for (const options of [{ runtime: false }, { licence: false }, { notices: false }]) {
      const { tarball } = release(options)
      const prefix = path.join(path.dirname(tarball), 'prefix')
      const child = run(LAYOUT, [
        '--tarball',
        tarball,
        '--root',
        prefix,
        '--node-bin',
        process.execPath,
      ])
      expect(child.status).not.toBe(0)
      expect(child.stderr.length).toBeGreaterThan(0)
    }
  })
  it.each(SERVE_FILES)(
    'refuses a tarball without %s, which the node cannot serve without',
    (name) => {
      const { tarball } = release({ without: name })
      const prefix = path.join(path.dirname(tarball), 'prefix')
      const child = run(LAYOUT, [
        '--tarball',
        tarball,
        '--root',
        prefix,
        '--node-bin',
        process.execPath,
      ])
      expect(child.status).not.toBe(0)
      expect(child.stderr).toContain(`tarball has no ${name}`)
      expect(() => statSync(path.join(prefix, 'opt'))).toThrow()
    },
  )
  it('refuses a missing tarball, a non-empty destination and a bad node', () => {
    const missing = run(LAYOUT, [
      '--tarball',
      path.join('no-such-dir', 'x.tgz'),
      '--root',
      'unused',
      '--node-bin',
      process.execPath,
    ])
    expect(missing.status).not.toBe(0)
    const { tarball } = release()
    const prefix = path.join(path.dirname(tarball), 'prefix')
    const first = run(LAYOUT, [
      '--tarball',
      tarball,
      '--root',
      prefix,
      '--node-bin',
      process.execPath,
    ])
    expect(first.status).toBe(0)
    const second = run(LAYOUT, [
      '--tarball',
      tarball,
      '--root',
      prefix,
      '--node-bin',
      process.execPath,
    ])
    expect(second.status).not.toBe(0)
    expect(second.stderr).toContain('already installed')
    const badNode = run(LAYOUT, [
      '--tarball',
      tarball,
      '--root',
      `${prefix}-node`,
      '--node-bin',
      path.join(path.dirname(tarball), 'no-such-node'),
    ])
    expect(badNode.status).not.toBe(0)
    expect(badNode.stderr).toContain('node runtime missing')
    const directoryBin = run(LAYOUT, [
      '--tarball',
      tarball,
      '--root',
      `${prefix}-dir`,
      '--node-bin',
      path.dirname(tarball),
    ])
    expect(directoryBin.status).not.toBe(0)
  })
  it('answers --help and refuses bad arguments', () => {
    const help = run(LAYOUT, ['--help'])
    expect(help.status).toBe(0)
    expect(help.stdout).toContain('Usage:')
    expect(run(LAYOUT, ['--bogus']).status).not.toBe(0)
    expect(run(LAYOUT, ['--tarball']).status).not.toBe(0)
    expect(run(LAYOUT, ['--tarball', 'x.tgz']).status).not.toBe(0)
  })
})

describe('M110-S0 native installer verification', () => {
  it('refuses bad arguments, unknown files and non-release names', () => {
    const help = run(INSTALL, ['--help'])
    expect(help.status).toBe(0)
    expect(help.stdout).toContain('Usage:')
    expect(run(INSTALL, ['--bogus']).status).not.toBe(0)
    expect(run(INSTALL, ['--tarball']).status).not.toBe(0)
    expect(run(INSTALL, ['--tarball', 'x.tgz']).status).not.toBe(0)
    const { root } = release()
    const absent = run(INSTALL, [
      '--tarball',
      path.join(root, 'muse-spark-code-acp-9.9.9.tgz'),
      '--sums',
      path.join(root, 'SHA256SUMS'),
    ])
    expect(absent.status).not.toBe(0)
    expect(absent.stderr).toContain('tarball not found')
    const { tarball, sums } = release({ name: 'something-else-1.0.tgz' })
    const named = run(INSTALL, ['--tarball', tarball, '--sums', sums])
    expect(named.status).not.toBe(0)
    expect(named.stderr).toContain('not a node release tarball')
  })
  it('refuses a tampered tarball and an unlisted tarball before touching the prefix', () => {
    const { tarball, sums } = release()
    writeFileSync(tarball, readFileSync(tarball).subarray(0, 64))
    const prefix = path.join(path.dirname(tarball), 'prefix')
    const tampered = run(INSTALL, [
      '--tarball',
      tarball,
      '--sums',
      sums,
      '--root',
      prefix,
      '--node-bin',
      process.execPath,
      '--gh-bin',
      process.execPath,
    ])
    expect(tampered.status).not.toBe(0)
    expect(tampered.stderr).toContain('checksum mismatch')
    expect(() => statSync(prefix)).toThrow()
    const listed = release()
    writeFileSync(listed.sums, '0'.repeat(64) + '  some-other-file.tgz\n')
    const unlisted = run(INSTALL, [
      '--tarball',
      listed.tarball,
      '--sums',
      listed.sums,
      '--root',
      path.join(path.dirname(listed.tarball), 'prefix'),
      '--node-bin',
      process.execPath,
      '--gh-bin',
      process.execPath,
    ])
    expect(unlisted.status).not.toBe(0)
    expect(unlisted.stderr).toContain('not listed')
  })
  it('refuses without its tools and when gh rejects', () => {
    const { tarball, sums } = release()
    const prefix = path.join(path.dirname(tarball), 'prefix')
    const missingShasum = run(INSTALL, [
      '--tarball',
      tarball,
      '--sums',
      sums,
      '--root',
      prefix,
      '--node-bin',
      process.execPath,
      '--shasum-bin',
      path.join(path.dirname(tarball), 'no-such-shasum'),
    ])
    expect(missingShasum.status).not.toBe(0)
    expect(missingShasum.stderr).toContain('checksum checker missing')
    const missingGh = run(INSTALL, [
      '--tarball',
      tarball,
      '--sums',
      sums,
      '--root',
      prefix,
      '--node-bin',
      process.execPath,
      '--gh-bin',
      path.join(path.dirname(tarball), 'no-such-gh'),
    ])
    expect(missingGh.status).not.toBe(0)
    expect(missingGh.stderr).toContain('gh not found')
    // node as gh: it tries to run 'attestation' as a script and fails, which
    // must read as a rejection, never a pass.
    const rejected = run(INSTALL, [
      '--tarball',
      tarball,
      '--sums',
      sums,
      '--root',
      prefix,
      '--node-bin',
      process.execPath,
      '--gh-bin',
      process.execPath,
    ])
    expect(rejected.status).not.toBe(0)
    expect(rejected.stderr).toContain('attestation rejected')
    expect(() => statSync(prefix)).toThrow()
  })
})
