// M110os OS3: the setup server over real loopback HTTP. Every run starts
// the real server on 127.0.0.1, walks the whole setup with fetch, and
// stops the server; SSH keys come from the installed ssh-keygen and disks
// from a sysfs-shaped fixture beside the real /sys cases next door.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { MUSE_INSTALL_SCRIPT_URL } from '../../src/shared/constants'
import { canReachUrl, hasTool, scratch } from './helpers/nodeOs'
import { fill, UI_TEXT } from '../../src/shared/l10n/text'
import {
  createSetupServer,
  prepareSetupState,
  type SetupServer,
} from '../../src/runtime/node/firstBoot/server'
import { resolveMuseInstallDir } from '../../src/runtime/node/firstBoot/installMuseCode'

const servers: SetupServer[] = []

const PROBE_TIMEOUT_MS = 30_000
const CAN_INSTALL =
  process.platform !== 'win32' &&
  hasTool('bash', ['--version']) &&
  hasTool('curl', ['--version']) &&
  (await canReachUrl(MUSE_INSTALL_SCRIPT_URL, PROBE_TIMEOUT_MS))

afterEach(async () => {
  while (servers.length > 0) {
    const server = servers.pop()
    if (server !== undefined) await server.close()
  }
})

async function get(url: string): Promise<{ status: number; text: string }> {
  const response = await fetch(url)
  return { status: response.status, text: await response.text() }
}

async function postForm(
  url: string,
  fields: Record<string, string>,
  contentType = 'application/x-www-form-urlencoded',
): Promise<{ status: number; text: string }> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': contentType },
    body: new URLSearchParams(fields).toString(),
  })
  return { status: response.status, text: await response.text() }
}

/** A sysfs-shaped block tree: one disk, one partition, one empty slot. */
function fixtureSysfs(root: string): string {
  const sys = path.join(root, 'sys')
  const disk = path.join(sys, 'block', 'sda')
  mkdirSync(disk, { recursive: true })
  writeFileSync(path.join(disk, 'size'), '1953525168\n')
  writeFileSync(path.join(disk, 'removable'), '0\n')
  const part = path.join(sys, 'block', 'sda1')
  mkdirSync(part, { recursive: true })
  writeFileSync(path.join(part, 'partition'), '1\n')
  writeFileSync(path.join(part, 'size'), '1024\n')
  const empty = path.join(sys, 'block', 'sdb')
  mkdirSync(empty, { recursive: true })
  writeFileSync(path.join(empty, 'size'), '0\n')
  writeFileSync(path.join(empty, 'removable'), '1\n')
  return sys
}

/** Fresh setup state plus its serving server, closed by the afterEach. */
async function prepareAndServe(
  root: string,
  stateDir: string,
  bootDir: string,
  muse?: { home?: string; timeoutMs?: number },
): Promise<{ server: SetupServer; code: string }> {
  const prepared = prepareSetupState(stateDir, bootDir)
  if (prepared.code === null) throw new Error('fresh setup has no code')
  const server = await createSetupServer({
    stateDir,
    bootDir,
    host: '127.0.0.1',
    port: 0,
    maxBodyBytes: 1_000_000,
    sysfsRoot: fixtureSysfs(root),
    museCodeHome: muse?.home ?? path.join(root, 'home'),
    museCodeTimeoutMs: muse?.timeoutMs ?? 60_000,
  })
  servers.push(server)
  return { server, code: prepared.code }
}

async function started(): Promise<{ url: string; code: string; root: string }> {
  const root = scratch('node-os-server-')
  const stateDir = path.join(root, 'state')
  const bootDir = path.join(root, 'boot')
  mkdirSync(bootDir, { recursive: true })
  const { server, code } = await prepareAndServe(root, stateDir, bootDir)
  return { url: server.url, code, root }
}

/** The wizard page after the fresh setup code is posted. */
async function wizardTextAfterCode(
  root: string,
  stateDir: string,
  bootDir: string,
): Promise<string> {
  const { server, code } = await prepareAndServe(root, stateDir, bootDir)
  const wizard = await postForm(`${server.url}code`, { code })
  return wizard.text
}

/** A scratch root whose boot partition carries the given seed files. */
function seededRoot(
  prefix: string,
  seeds: Record<string, string>,
): { root: string; stateDir: string; bootDir: string } {
  const root = scratch(prefix)
  const stateDir = path.join(root, 'state')
  const bootDir = path.join(root, 'boot')
  mkdirSync(bootDir, { recursive: true })
  for (const [name, content] of Object.entries(seeds)) {
    writeFileSync(path.join(bootDir, name), content)
  }
  return { root, stateDir, bootDir }
}

describe('setup server', () => {
  let sshKey = ''
  beforeAll(() => {
    const dir = scratch('node-os-server-keys-')
    const base = path.join(dir, 'server')
    execFileSync('ssh-keygen', ['-t', 'ed25519', '-N', '', '-C', 'server-test', '-f', base])
    sshKey = readFileSync(`${base}.pub`, 'utf8').trim()
    rmSync(dir, { recursive: true, force: true })
  })

  it('walks the whole setup and only the setup', async () => {
    const { url, code, root } = await started()
    try {
      const text = UI_TEXT.nodeOs
      const gate = await get(url)
      expect(gate.status).toBe(200)
      expect(gate.text).toContain(text.setupTitle)
      expect(gate.text).toContain(text.setupCodeLabel)
      expect(gate.text).not.toContain(text.netTitle)

      const wrong = await postForm(`${url}code`, { code: 'AAAAA-BBBBB-CCCCC-DDDDD' })
      expect(wrong.text).toContain(text.setupCodeWrong)

      const wizard = await postForm(`${url}code`, { code })
      for (const label of [
        text.netTitle,
        text.diskTitle,
        text.sshTitle,
        text.chromeAccept,
        text.nvidiaAccept,
        text.museCodeAccept,
        text.orchestratorWaiting,
        text.signinPasskeyNote,
      ]) {
        expect(wizard.text).toContain(label)
      }
      expect(wizard.text).toContain('<option value="/dev/sda">')
      expect(wizard.text).not.toContain('/dev/sda1')
      expect(wizard.text).not.toContain('/dev/sdb')
      expect(wizard.text).toContain('https://www.google.com/chrome/terms/')
      expect(wizard.text).toContain('https://www.nvidia.com/en-us/drivers/nvidia-license/')
      expect(wizard.text).toContain('https://dev.meta.ai/legal/terms-of-service')

      const hostileSsid = '<script>alert(1)</script>'
      const review = await postForm(`${url}choices`, {
        code,
        networkKind: 'wifi',
        ssid: hostileSsid,
        psk: 'correct-horse-battery-staple',
        diskTarget: '/dev/sda',
        encryption: 'tpm',
        tpmPin: '1977-pin',
        sshKey,
        chrome: 'install',
        nvidia: 'skip',
        museCode: 'skip',
      })
      expect(review.text).toContain(text.summaryTitle)
      expect(review.text).toContain(text.museCodeTitle)
      expect(review.text).toContain('&lt;script&gt;')
      expect(review.text).not.toContain(hostileSsid)
      expect(review.text).not.toContain('correct-horse-battery-staple')
      expect(review.text).not.toContain('1977-pin')
      expect(review.text).toContain('••••')
      expect(review.text).toContain(text.recoveryKeyTitle)
      const key = /<pre>([0-9A-HJKMNP-TV-Z-]{40,})<\/pre>/.exec(review.text)?.[1]
      expect(key).toMatch(/^[0-9A-HJKMNP-TV-Z]{5}(-[0-9A-HJKMNP-TV-Z]{5}){7}$/)

      const done = await postForm(`${url}complete`, { code })
      expect(done.text).toContain(text.setupDone)
      expect(done.text).not.toContain(key ?? 'no-key-shown')
      expect(done.text).not.toContain(text.recoveryKeyTitle)

      const after = await get(url)
      expect(after.text).toContain(text.setupDone)
      const again = await postForm(`${url}code`, { code })
      expect(again.text).toContain(text.setupDone)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('refuses bad choices with the wizard again', async () => {
    const { url, code, root } = await started()
    try {
      const text = UI_TEXT.nodeOs
      await postForm(`${url}code`, { code })
      const badKey = await postForm(`${url}choices`, {
        code,
        networkKind: 'dhcp',
        diskTarget: '/dev/sda',
        encryption: 'none',
        sshKey: 'not-a-key',
        chrome: 'skip',
        nvidia: 'skip',
      })
      expect(badKey.text).toContain(text.sshKeyInvalid)
      const badDisk = await postForm(`${url}choices`, {
        code,
        networkKind: 'dhcp',
        diskTarget: '/dev/../x',
        encryption: 'none',
        sshKey: '',
        chrome: 'skip',
        nvidia: 'skip',
      })
      expect(badDisk.text).toContain('choices-disk-target')
      const noCode = await postForm(`${url}choices`, {
        code: 'AAAAA-BBBBB-CCCCC-DDDDD',
        networkKind: 'dhcp',
        diskTarget: '/dev/sda',
        encryption: 'none',
        sshKey: '',
        chrome: 'skip',
        nvidia: 'skip',
      })
      expect(noCode.text).toContain(text.setupCodeLabel)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('prefills the wizard from the seed', async () => {
    const { root, stateDir, bootDir } = seededRoot('node-os-server-seed-', {
      'network-config':
        'network:\n  version: 2\n  wifis:\n    wlan0:\n      dhcp4: true\n      access-points:\n        SeedNet:\n          password: seed-password\n',
      'user-data': `#cloud-config\nhostname: seedbox\nssh_authorized_keys:\n  - ${sshKey}\n`,
    })
    try {
      const text = UI_TEXT.nodeOs
      const wizard = await wizardTextAfterCode(root, stateDir, bootDir)
      expect(wizard).toContain(text.netSeedNote)
      expect(wizard).toContain('value="SeedNet"')
      expect(wizard).toContain(sshKey)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('says a refused seed on the wizard', async () => {
    const { root, stateDir, bootDir } = seededRoot('node-os-server-refusal-', {
      'network-config': 'version: 2\nethernets:\n  eth0:\n    addresses: [192.168.1.10/24]\n',
    })
    try {
      const text = UI_TEXT.nodeOs
      const wizard = await wizardTextAfterCode(root, stateDir, bootDir)
      expect(wizard).toContain(fill(text.seedRefused, { reason: 'seed-network-static' }))
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('answers the protocol honestly', async () => {
    const { url, root } = await started()
    try {
      const missing = await get(`${url}nope`)
      expect(missing.status).toBe(404)
      const put = await fetch(url, { method: 'PUT' })
      expect(put.status).toBe(405)
      await put.text()
      const json = await postForm(`${url}code`, { code: 'x' }, 'application/json')
      expect(json.status).toBe(400)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('refuses bodies past the deployment bound', async () => {
    const root = scratch('node-os-server-bound-')
    try {
      const stateDir = path.join(root, 'state')
      const bootDir = path.join(root, 'boot')
      mkdirSync(bootDir, { recursive: true })
      prepareSetupState(stateDir, bootDir)
      const server = await createSetupServer({
        stateDir,
        bootDir,
        host: '127.0.0.1',
        port: 0,
        maxBodyBytes: 32,
        sysfsRoot: fixtureSysfs(root),
        museCodeHome: path.join(root, 'home'),
        museCodeTimeoutMs: 60_000,
      })
      servers.push(server)
      const big = await postForm(`${server.url}code`, { code: 'x'.repeat(64) })
      expect(big.status).toBe(413)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('answers 500 on a damaged state', async () => {
    const { url, root } = await started()
    try {
      writeFileSync(path.join(root, 'state', 'setup.json'), '{oops')
      const broken = await get(url)
      expect(broken.status).toBe(500)
      expect(broken.text).toContain(UI_TEXT.nodeOs.setupTitle)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('refuses an invalid configuration', async () => {
    await expect(
      createSetupServer({
        stateDir: 'relative',
        bootDir: '/boot',
        host: '127.0.0.1',
        port: 0,
        maxBodyBytes: 1024,
        sysfsRoot: '/sys',
        museCodeHome: '/home/setup',
        museCodeTimeoutMs: 60_000,
      }),
    ).rejects.toThrow('Invalid setup server configuration')
    await expect(
      createSetupServer({
        stateDir: '/state',
        bootDir: '/boot',
        host: '127.0.0.1',
        port: 0,
        maxBodyBytes: 0,
        sysfsRoot: '/sys',
        museCodeHome: '/home/setup',
        museCodeTimeoutMs: 60_000,
      }),
    ).rejects.toThrow('Invalid setup server configuration')
    await expect(
      createSetupServer({
        stateDir: '/state',
        bootDir: '/boot',
        host: '127.0.0.1',
        port: 0,
        maxBodyBytes: 1024,
        sysfsRoot: '/sys',
        museCodeHome: 'relative',
        museCodeTimeoutMs: 0,
      }),
    ).rejects.toThrow('Invalid setup server configuration')
  })

  it('brings the wizard back with the reason when the install fails', async () => {
    const root = scratch('node-os-server-muse-fail-')
    try {
      const text = UI_TEXT.nodeOs
      const stateDir = path.join(root, 'state')
      const bootDir = path.join(root, 'boot')
      mkdirSync(bootDir, { recursive: true })
      const home = path.join(root, 'home')
      mkdirSync(home, { recursive: true })
      const { server, code } = await prepareAndServe(root, stateDir, bootDir, {
        home,
        timeoutMs: 1,
      })
      await postForm(`${server.url}code`, { code })
      const review = await postForm(`${server.url}choices`, {
        code,
        networkKind: 'dhcp',
        diskTarget: '/dev/sda',
        encryption: 'none',
        sshKey: '',
        chrome: 'skip',
        nvidia: 'skip',
        museCode: 'install',
      })
      expect(review.text).toContain(text.summaryTitle)
      // A spent bound fails the step: the wizard comes back with its
      // reason, nothing completes, and the person retries or skips.
      const again = await postForm(`${server.url}complete`, { code })
      expect(again.text).toContain(text.netTitle)
      expect(again.text).toContain(fill(text.museCodeFailed, { reason: 'timed-out' }))
      const gate = await get(server.url)
      expect(gate.text).toContain(text.setupCodeLabel)
      expect(gate.text).not.toContain(text.setupDone)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  // Named timeout: Meta's real installer downloads and installs the CLI.
  it.runIf(CAN_INSTALL)(
    'installs Muse Code from Meta and reports its version',
    { timeout: 300_000 },
    async () => {
      const root = scratch('node-os-server-muse-live-')
      try {
        const text = UI_TEXT.nodeOs
        const stateDir = path.join(root, 'state')
        const bootDir = path.join(root, 'boot')
        mkdirSync(bootDir, { recursive: true })
        const home = path.join(root, 'home')
        mkdirSync(home, { recursive: true })
        const { server, code } = await prepareAndServe(root, stateDir, bootDir, {
          home,
          timeoutMs: 240_000,
        })
        await postForm(`${server.url}code`, { code })
        await postForm(`${server.url}choices`, {
          code,
          networkKind: 'dhcp',
          diskTarget: '/dev/sda',
          encryption: 'none',
          sshKey: '',
          chrome: 'skip',
          nvidia: 'skip',
          museCode: 'install',
        })
        const done = await postForm(`${server.url}complete`, { code })
        expect(done.text).toContain(text.setupDone)
        // The installed binary answers for itself, from the install dir.
        const muse = path.join(resolveMuseInstallDir(home, process.env), 'muse')
        expect(existsSync(muse)).toBe(true)
        const version =
          execFileSync(muse, ['--version'], { encoding: 'utf8' }).trim().split('\n', 1)[0] ?? ''
        expect(version.length).toBeGreaterThan(0)
        expect(done.text).toContain(version.slice(0, 100))
        // Profiles stay untouched: the node manages PATH, not Meta's script.
        for (const profile of ['.bashrc', '.bash_profile', '.profile', '.zshrc']) {
          expect(existsSync(path.join(home, profile))).toBe(false)
        }
        // The report survives the completion: later visits show it too.
        const after = await get(server.url)
        expect(after.text).toContain(version.slice(0, 100))
      } finally {
        rmSync(root, { recursive: true, force: true })
      }
    },
  )
})
