// M110os OS4: the firewall defaults, the sysctl knobs, and the
// systemd-analyze security threshold gate. nft cannot parse here (it needs
// netlink and the sandbox answers EPERM, measured 2026-10-23), so the test
// pins the ruleset's security properties and the OS6 QEMU boot parses the
// file for real inside the booted image. The threshold gate runs the real
// systemd-analyze against a planted insecure unit on Linux.
import { execFileSync, spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const NFTABLES = fileURLToPath(new URL('../../os/hardening/nftables.conf', import.meta.url))
const SYSCTL = fileURLToPath(
  new URL('../../os/hardening/sysctl.d/99-muse-node.conf', import.meta.url),
)
const THRESHOLD = fileURLToPath(
  new URL('../../os/hardening/security-threshold.sh', import.meta.url),
)
const isLinux = process.platform === 'linux'
const BASH = '/bin/bash'
const TCP_MAX_PORT = 65_535
const LOOSE_THRESHOLD = 100
const INSECURE_UNIT = `[Unit]
Description=deliberately insecure test unit
[Service]
ExecStart=/bin/true
`

function hasTool(command: string): boolean {
  try {
    execFileSync(command, ['--version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}
const HAS_ANALYZE = isLinux && hasTool('systemd-analyze')

function runScript(
  script: string,
  args: string[],
  env?: NodeJS.ProcessEnv,
): { status: number | null; out: string } {
  const run = spawnSync(script, args, { encoding: 'utf8', env: env ?? process.env })
  return { status: run.status, out: `${run.stdout}${run.stderr}` }
}

function contentLines(file: string): string[] {
  return readFileSync(file, 'utf8')
    .split('\n')
    .map((line) => line.replace(/#.*$/, '').trim())
    .filter((line) => line.length > 0)
}

function plantedRoot(): { root: string; unit: string } {
  const root = mkdtempSync(path.join(tmpdir(), 'node-os-threshold-'))
  const unitDir = path.join(root, 'usr', 'lib', 'systemd', 'system')
  mkdirSync(unitDir, { recursive: true })
  writeFileSync(path.join(unitDir, 'insecure-test.service'), INSECURE_UNIT)
  return { root, unit: 'insecure-test.service' }
}

describe('firewall defaults', () => {
  it('drops input and forward with only loopback, established, SSH and setup open', () => {
    const lines = contentLines(NFTABLES)
    const joined = lines.join('\n')
    expect(joined).toContain('chain input')
    expect(joined).toMatch(/chain input \{[^}]*policy drop/s)
    expect(joined).toMatch(/chain forward \{[^}]*policy drop/s)
    expect(joined).toMatch(/chain output \{[^}]*policy accept/s)
    const port = /define setup_port = (\d+)/.exec(joined)
    expect(port).not.toBeNull()
    const setupPort = Number(port?.[1] ?? '')
    expect(setupPort).toBeGreaterThan(0)
    expect(setupPort).toBeLessThanOrEqual(TCP_MAX_PORT)
    const accepts = lines.filter((line) => line.includes('accept') && !line.includes('policy'))
    expect(accepts).toHaveLength(4)
    expect(accepts.some((line) => line.includes('iifname "lo"'))).toBe(true)
    expect(accepts.some((line) => line.includes('ct state established,related'))).toBe(true)
    expect(accepts.some((line) => line.includes('tcp dport 22'))).toBe(true)
    expect(accepts.some((line) => line.includes('tcp dport $setup_port'))).toBe(true)
  })
})

describe('sysctl knobs', () => {
  it('is valid key=value with the required hardening knobs', () => {
    const lines = contentLines(SYSCTL)
    expect(lines.length).toBeGreaterThan(0)
    const keys: string[] = []
    for (const line of lines) {
      const match = /^([a-z0-9_.]+)\s*=\s*([0-9]+)$/.exec(line)
      expect(match).not.toBeNull()
      keys.push(match?.[1] ?? '')
    }
    expect(new Set(keys).size).toBe(keys.length)
    for (const required of [
      'net.ipv4.conf.all.rp_filter',
      'kernel.yama.ptrace_scope',
      'fs.protected_symlinks',
      'fs.suid_dumpable',
      'kernel.unprivileged_bpf_disabled',
    ]) {
      expect(keys).toContain(required)
    }
  })
})

describe.skipIf(!isLinux)('security threshold gate', () => {
  it.runIf(HAS_ANALYZE)('passes a loose threshold and fails a zero one on a planted unit', () => {
    const { root, unit } = plantedRoot()
    const loose = runScript(THRESHOLD, [
      '--root',
      root,
      '--threshold',
      String(LOOSE_THRESHOLD),
      unit,
    ])
    expect(loose.status).toBe(0)
    const strict = runScript(THRESHOLD, ['--root', root, '--threshold', '0', unit])
    expect(strict.status).not.toBe(0)
  })

  it.runIf(HAS_ANALYZE)('runs through a symlinked directory', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'node-os-threshold-link-'))
    const link = path.join(dir, 'hardening')
    symlinkSync(path.dirname(THRESHOLD), link, 'dir')
    const { root, unit } = plantedRoot()
    const run = runScript(path.join(link, 'security-threshold.sh'), [
      '--root',
      root,
      '--threshold',
      String(LOOSE_THRESHOLD),
      unit,
    ])
    expect(run.status).toBe(0)
  })

  it('refuses bad arguments without running systemd-analyze', () => {
    const { root, unit } = plantedRoot()
    const cases: { args: string[]; anchor: string }[] = [
      { args: [], anchor: '--root is required' },
      { args: ['--bogus'], anchor: 'unknown option' },
      {
        args: ['--root', path.join(root, 'missing'), '--threshold', '0', unit],
        anchor: 'not a directory',
      },
      { args: ['--root', root, '--threshold', 'abc', unit], anchor: 'from 0 to 100' },
      { args: ['--root', root, '--threshold', '-1', unit], anchor: 'from 0 to 100' },
      { args: ['--root', root, '--threshold', '1.5', unit], anchor: 'from 0 to 100' },
      { args: ['--root', root, '--threshold', '101', unit], anchor: 'from 0 to 100' },
      { args: ['--root', root, '--threshold', '0'], anchor: 'at least one unit' },
    ]
    for (const { args, anchor } of cases) {
      const run = runScript(THRESHOLD, args)
      expect(run.status).toBe(2)
      expect(run.out).toContain(anchor)
    }
  })

  it.runIf(existsSync(BASH))('reports a missing systemd-analyze as exit 3', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'node-os-threshold-notool-'))
    symlinkSync(BASH, path.join(dir, 'bash'))
    const { root, unit } = plantedRoot()
    const run = runScript(
      THRESHOLD,
      ['--root', root, '--threshold', String(LOOSE_THRESHOLD), unit],
      { ...process.env, PATH: dir },
    )
    expect(run.status).toBe(3)
    expect(run.out).toContain('systemd-analyze not installed')
  })
})
