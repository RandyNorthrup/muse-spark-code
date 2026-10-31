// M110os OS3: the first-boot core over real code only. Setup codes come
// from the real generator, SSH keys from the installed ssh-keygen, the
// store from the real filesystem, and the seeds are authored to the
// fetched cloud-init v2 and `#cloud-config` contracts (seed.ts header,
// 2026-10-23), never to a guessed shape.
import { execFileSync } from 'node:child_process'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { cleanup, scratch } from './helpers/nodeOs'
import {
  acceptSetupCode,
  applySeed,
  completeSetup,
  createSetupState,
  isCodeHolder,
  loadSetupState,
  recordChoices,
  saveSetupState,
} from '../../src/runtime/node/firstBoot/setupStore'
import {
  isSetupCode,
  issueRecoveryKey,
  issueSetupCode,
} from '../../src/runtime/node/firstBoot/setupCode'
import { parseSshPublicKey, setupDiskTargetSchema } from '../../src/runtime/node/firstBoot/schemas'
import { readAndConsumeSeed } from '../../src/runtime/node/firstBoot/seed'

/** Nothing on the boot partition reads as an empty seed. */
const EMPTY_SEED = {
  ok: true,
  network: { network: null, ignored: [] },
  user: { hostname: undefined, sshKeys: [], ignored: [] },
} as const

describe('setup code', () => {
  it('issues grouped codes that verify through typing variants', () => {
    const code = issueSetupCode()
    expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{5}(-[0-9A-HJKMNP-TV-Z]{5}){3}$/)
    expect(isSetupCode(code, code)).toBe(true)
    expect(isSetupCode(code.toLowerCase(), code)).toBe(true)
    expect(isSetupCode(code.replaceAll('-', ''), code)).toBe(true)
    expect(isSetupCode(code.replaceAll('-', '  '), code)).toBe(true)
  })

  it('rejects a wrong code and a shortened one', () => {
    const code = issueSetupCode()
    const wrong = `${code.slice(0, -1)}${code.endsWith('A') ? 'B' : 'A'}`
    expect(isSetupCode(wrong, code)).toBe(false)
    expect(isSetupCode(code.slice(0, -2), code)).toBe(false)
    expect(isSetupCode('', code)).toBe(false)
  })

  it('issues distinct codes', () => {
    expect(issueSetupCode()).not.toBe(issueSetupCode())
  })

  it('issues longer recovery keys', () => {
    expect(issueRecoveryKey()).toMatch(/^([0-9A-HJKMNP-TV-Z]{5}-){7}[0-9A-HJKMNP-TV-Z]{5}$/)
  })
})

describe('SSH public keys from the installed ssh-keygen', () => {
  let dir = ''
  const keys: Record<string, string> = {}
  beforeAll(() => {
    dir = scratch('node-os-keys-')
    for (const [name, args] of [
      ['ed25519', ['-t', 'ed25519']],
      ['rsa', ['-t', 'rsa', '-b', '2048']],
      ['ecdsa', ['-t', 'ecdsa', '-b', '256']],
    ] as const) {
      const base = path.join(dir, name)
      execFileSync('ssh-keygen', [...args, '-N', '', '-C', `${name}-setup-test`, '-f', base])
      keys[name] = readFileSync(`${base}.pub`, 'utf8').trim()
    }
  })
  afterAll(() => {
    cleanup(dir)
  })

  it('accepts every generated key with its type and comment', () => {
    expect(parseSshPublicKey(keys['ed25519'] ?? '')).toEqual({
      type: 'ssh-ed25519',
      comment: 'ed25519-setup-test',
    })
    expect(parseSshPublicKey(keys['rsa'] ?? '')?.type).toBe('ssh-rsa')
    expect(parseSshPublicKey(keys['ecdsa'] ?? '')?.type).toBe('ecdsa-sha2-nistp256')
  })

  it('refuses what is not a key', () => {
    const good = keys['ed25519'] ?? ''
    expect(parseSshPublicKey('not-a-key')).toBeUndefined()
    expect(parseSshPublicKey('ssh-ed25519 !!!not-base64!!!')).toBeUndefined()
    expect(parseSshPublicKey('ssh-rsa')).toBeUndefined()
    // A valid blob under the wrong type name.
    const [, blob = ''] = good.split(' ', 2)
    expect(parseSshPublicKey(`ssh-rsa ${blob}`)).toBeUndefined()
  })

  it('refuses a truncated blob of every generated type', () => {
    for (const name of ['ed25519', 'rsa', 'ecdsa']) {
      const [type = '', blob = ''] = (keys[name] ?? '').split(' ', 2)
      expect(parseSshPublicKey(`${type} ${blob.slice(0, -8)}`)).toBeUndefined()
      expect(parseSshPublicKey(`${type} ${blob}AAAA`)).toBeUndefined()
    }
  })
})

describe('disk targets', () => {
  it('takes device paths and refuses escapes', () => {
    for (const target of ['/dev/sda', '/dev/nvme0n1', '/dev/mmcblk0', '/dev/mapper/vg-lv']) {
      expect(setupDiskTargetSchema.safeParse(target).success).toBe(true)
    }
    for (const target of ['', 'sda', '/dev/../etc/shadow', '/dev/sda1 evil', '/tmp/disk.img']) {
      expect(setupDiskTargetSchema.safeParse(target).success).toBe(false)
    }
  })
})

describe('setup store', () => {
  it('spends the code once, then records choices and completes', () => {
    const dir = scratch('node-os-store-')
    try {
      expect(loadSetupState(dir)).toBeNull()
      const code = issueSetupCode()
      saveSetupState(dir, createSetupState(code))
      const stored = loadSetupState(dir)
      expect(stored?.codeConsumed).toBe(false)
      expect(stored?.codeSha256).not.toContain(code.replaceAll('-', ''))
      if (stored === null) throw new Error('unreachable')
      expect(acceptSetupCode(stored, 'AAAAA-BBBBB-CCCCC-DDDDD')).toEqual({
        ok: false,
        reason: 'wrong',
      })
      const accepted = acceptSetupCode(stored, code.toLowerCase())
      expect(accepted.ok).toBe(true)
      if (!accepted.ok) throw new Error('unreachable')
      expect(acceptSetupCode(accepted.state, code)).toEqual({ ok: false, reason: 'used' })
      const choices = {
        network: { kind: 'dhcp' as const },
        disk: { target: '/dev/sda', encryption: 'tpm' as const },
        sshKey: '',
        chrome: 'skip' as const,
        nvidia: 'skip' as const,
        museCode: 'skip' as const,
      }
      const done = completeSetup(recordChoices(accepted.state, choices), {
        ok: true,
        version: '1.4.10',
      })
      expect(done.completed).toBe(true)
      expect(done.codeSha256).toBeNull()
      expect(done.museCodeInstall).toEqual({ ok: true, version: '1.4.10' })
      expect(acceptSetupCode(done, code)).toEqual({ ok: false, reason: 'completed' })
      saveSetupState(dir, done)
      expect(loadSetupState(dir)?.completed).toBe(true)
      expect(loadSetupState(dir)?.museCodeInstall).toEqual({ ok: true, version: '1.4.10' })
    } finally {
      cleanup(dir)
    }
  })

  it('refuses choices before the code and completion without choices', () => {
    const state = createSetupState(issueSetupCode())
    const choices = {
      network: { kind: 'dhcp' as const },
      disk: { target: '/dev/sda', encryption: 'none' as const },
      sshKey: '',
      chrome: 'skip' as const,
      nvidia: 'skip' as const,
      museCode: 'skip' as const,
    }
    expect(() => recordChoices(state, choices)).toThrow('setup code not accepted')
    expect(() => completeSetup(state, null)).toThrow('setup has no choices')
  })

  it('holds the code past the gate until completion', () => {
    const code = issueSetupCode()
    const fresh = createSetupState(code)
    expect(isCodeHolder(fresh, code)).toBe(false)
    const accepted = acceptSetupCode(fresh, code)
    if (!accepted.ok) throw new Error('unreachable')
    expect(isCodeHolder(accepted.state, code)).toBe(true)
    expect(isCodeHolder(accepted.state, 'AAAAA-BBBBB-CCCCC-DDDDD')).toBe(false)
  })

  it('folds a seed once, and refuses after the start', () => {
    const fresh = createSetupState(issueSetupCode())
    const seeded = applySeed(fresh, { ok: false, code: 'seed-network-static' })
    expect(seeded.seedRefusal).toBe('seed-network-static')
    const accepted = acceptSetupCode(fresh, 'AAAAA-BBBBB-CCCCC-DDDDD')
    expect(accepted.ok).toBe(false)
    expect(() =>
      applySeed({ ...fresh, codeConsumed: true }, { ok: false, code: 'seed-network-static' }),
    ).toThrow('setup already started')
  })

  it('throws on a damaged file', () => {
    const dir = scratch('node-os-store-bad-')
    try {
      writeFileSync(path.join(dir, 'setup.json'), '{oops')
      expect(() => loadSetupState(dir)).toThrow('setup state is not valid')
      writeFileSync(path.join(dir, 'setup.json'), '{"version":9}')
      expect(() => loadSetupState(dir)).toThrow('setup state is not valid')
    } finally {
      cleanup(dir)
    }
  })
})

describe('cloud-init seed', () => {
  it('reads nothing when the boot partition carries no seed', () => {
    const dir = scratch('node-os-seed-empty-')
    try {
      expect(readAndConsumeSeed(dir)).toEqual(EMPTY_SEED)
    } finally {
      cleanup(dir)
    }
  })

  it('applies a v2 Wi-Fi seed once, then deletes it', () => {
    const dir = scratch('node-os-seed-wifi-')
    try {
      writeFileSync(
        path.join(dir, 'network-config'),
        [
          'network:',
          '  version: 2',
          '  wifis:',
          '    wlan0:',
          '      dhcp4: true',
          '      regulatory-domain: "GB"',
          '      access-points:',
          '        "My Net-Work":',
          '          password: "mysupersecretpassword"',
        ].join('\n'),
      )
      writeFileSync(
        path.join(dir, 'user-data'),
        ['#cloud-config', 'hostname: mynode', 'timezone: Europe/London'].join('\n'),
      )
      writeFileSync(path.join(dir, 'meta-data'), 'instance-id: seed-test\n')
      const outcome = readAndConsumeSeed(dir)
      expect(outcome).toEqual({
        ok: true,
        network: {
          network: { kind: 'wifi', ssid: 'My Net-Work', psk: 'mysupersecretpassword' },
          ignored: ['wlan0.regulatory-domain'],
        },
        user: { hostname: 'mynode', sshKeys: [], ignored: ['timezone'] },
      })
      // Read once: the second read finds nothing.
      expect(readAndConsumeSeed(dir)).toEqual(EMPTY_SEED)
    } finally {
      cleanup(dir)
    }
  })

  it('treats an empty seed file as no network, like cloud-init', () => {
    const dir = scratch('node-os-seed-blank-')
    try {
      writeFileSync(path.join(dir, 'network-config'), '# nothing configured\n')
      const outcome = readAndConsumeSeed(dir)
      expect(outcome.ok).toBe(true)
      if (outcome.ok) expect(outcome.network).toEqual({ network: null, ignored: [] })
      expect(readAndConsumeSeed(dir).ok).toBe(true)
    } finally {
      cleanup(dir)
    }
  })

  it('reads DHCP ethernets with or without the network wrapper', () => {
    for (const text of [
      'network:\n  version: 2\n  ethernets:\n    eth0:\n      dhcp4: true\n',
      'version: 2\nethernets:\n  eth0:\n    dhcp4: yes\n',
    ]) {
      const dir = scratch('node-os-seed-dhcp-')
      try {
        writeFileSync(path.join(dir, 'network-config'), text)
        const outcome = readAndConsumeSeed(dir)
        expect(outcome.ok).toBe(true)
        if (outcome.ok) expect(outcome.network.network).toEqual({ kind: 'dhcp' })
      } finally {
        cleanup(dir)
      }
    }
  })

  it('refuses a static-only seed and keeps the files for the operator', () => {
    const dir = scratch('node-os-seed-static-')
    try {
      const text = [
        'version: 2',
        'ethernets:',
        '  eth0:',
        '    addresses: [192.168.1.10/24]',
        '    gateway4: 192.168.1.1',
      ].join('\n')
      writeFileSync(path.join(dir, 'network-config'), text)
      expect(readAndConsumeSeed(dir)).toEqual({ ok: false, code: 'seed-network-static' })
      expect(readFileSync(path.join(dir, 'network-config'), 'utf8')).toBe(text)
    } finally {
      cleanup(dir)
    }
  })

  it('refuses a v1 seed, a broken file and a bad hostname', () => {
    const dir = scratch('node-os-seed-bad-')
    try {
      writeFileSync(path.join(dir, 'network-config'), 'version: 1\nconfig: []\n')
      expect(readAndConsumeSeed(dir)).toEqual({ ok: false, code: 'seed-network-version' })
      writeFileSync(path.join(dir, 'network-config'), 'version: [2\n')
      expect(readAndConsumeSeed(dir)).toEqual({ ok: false, code: 'seed-network-invalid' })
      rmSync(path.join(dir, 'network-config'))
      writeFileSync(path.join(dir, 'user-data'), '#cloud-config\nhostname: "-bad-"\n')
      expect(readAndConsumeSeed(dir)).toEqual({ ok: false, code: 'seed-hostname-invalid' })
      writeFileSync(path.join(dir, 'user-data'), 'hostname: noheader\n')
      expect(readAndConsumeSeed(dir)).toEqual({ ok: false, code: 'seed-userdata-header' })
    } finally {
      cleanup(dir)
    }
  })

  it('takes SSH keys from user-data and reports the rest', () => {
    const dir = scratch('node-os-seed-user-')
    const keyDir = scratch('node-os-seed-keys-')
    try {
      const base = path.join(keyDir, 'seed')
      execFileSync('ssh-keygen', ['-t', 'ed25519', '-N', '', '-C', 'seed-user', '-f', base])
      const key = readFileSync(`${base}.pub`, 'utf8').trim()
      writeFileSync(
        path.join(dir, 'user-data'),
        [
          '#cloud-config',
          'hostname: seednode',
          'ssh_authorized_keys:',
          `  - ${key}`,
          'users:',
          '  - name: pi',
          '    ssh_authorized_keys:',
          `      - ${key}`,
          'packages: [vim]',
        ].join('\n'),
      )
      const outcome = readAndConsumeSeed(dir)
      expect(outcome).toEqual({
        ok: true,
        network: { network: null, ignored: [] },
        user: { hostname: 'seednode', sshKeys: [key, key], ignored: ['users', 'packages'] },
      })
      writeFileSync(
        path.join(dir, 'user-data'),
        ['#cloud-config', 'ssh_authorized_keys:', '  - not-a-key'].join('\n'),
      )
      expect(readAndConsumeSeed(dir)).toEqual({ ok: false, code: 'seed-ssh-invalid' })
    } finally {
      cleanup(dir)
      cleanup(keyDir)
    }
  })
})
