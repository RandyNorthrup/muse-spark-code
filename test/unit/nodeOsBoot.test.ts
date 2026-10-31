// M110os OS6: the QEMU boot-test driver. os-boot-test runs as a child
// process for composition (dry runs pin the exact per-arch QEMU
// invocations), validation and missing-input refusal; the transcript
// scanner runs over the recorded proving boots
// (test/fixtures/nodeos-boot/CAPTURE.md); and the proving guest boots
// live where QEMU, gcc and the kernel download allow it.
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { type NodeOsRun, runNodeScript, scratch, sha256File } from './helpers/nodeOs'
import { scanTranscript } from '../../scripts/lib/osBootTest.mjs'

const BOOT_TEST = fileURLToPath(new URL('../../scripts/os-boot-test.mjs', import.meta.url))
const PROVING_LOG = fileURLToPath(
  new URL('../../test/fixtures/nodeos-boot/serial-proving.txt', import.meta.url),
)
const PANIC_LOG = fileURLToPath(
  new URL('../../test/fixtures/nodeos-boot/serial-panic.txt', import.meta.url),
)
const PROVING_MARKER = 'NODE-OS-PROVING-GUEST-BOOTED'
const KERNEL_URL =
  'https://dl-cdn.alpinelinux.org/alpine/latest-stable/releases/x86_64/netboot/vmlinuz-virt'
const KERNEL_SHA256 = '17fbd3efd16f2e7cb1b945f06423b37399ba7d5ac8cdd3665e7f13f363500e85'
const PROBE_TIMEOUT_MS = 30_000
const GUEST_TIMEOUT_MS = 180_000
const BOOT_TIMEOUT_MS = 120_000
const GUEST_STOP_WAIT_MS = 10_000
const GUEST_STOP_POLL_MS = 250

const PROVING_INIT_C = String.raw`#include <stdio.h>
#include <unistd.h>
int main(void) {
  printf("\n${PROVING_MARKER}\n");
  fflush(stdout);
  for (;;) pause();
  return 0;
}
`

function hasTool(command: string, args: string[]): boolean {
  try {
    execFileSync(command, args, { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

function hasKernelNet(): boolean {
  try {
    execFileSync(
      process.execPath,
      [
        '--eval',
        `fetch(${JSON.stringify(KERNEL_URL)}, { method: 'HEAD' }).then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))`,
      ],
      { stdio: 'ignore', timeout: PROBE_TIMEOUT_MS },
    )
    return true
  } catch {
    return false
  }
}

const HAS_QEMU = hasTool('qemu-system-x86_64', ['--version'])
const HAS_PGREP = process.platform === 'linux' && hasTool('pgrep', ['--version'])
const HAS_GCC = hasTool('gcc', ['--version'])
const HAS_KERNEL_NET = hasKernelNet()
const CAN_BOOT = HAS_QEMU && HAS_GCC && HAS_KERNEL_NET

/** Whether a QEMU process whose command line carries the token still runs. */
function isGuestRunning(token: string): boolean {
  return spawnSync('pgrep', ['-f', `qemu-system.*guest-token=${token}`]).status === 0
}

function run(args: string[], script: string = BOOT_TEST): NodeOsRun {
  return runNodeScript(script, args)
}

const dryRunResult = z.object({ program: z.string(), args: z.array(z.string()) })

function dryRun(args: string[]): z.infer<typeof dryRunResult> {
  const run = spawnSync(process.execPath, [BOOT_TEST, ...args, '--dry-run'], { encoding: 'utf8' })
  expect(run.status).toBe(0)
  return dryRunResult.parse(JSON.parse(run.stdout))
}

/** One newc cpio entry: 110 bytes of ASCII header, the name, the data. */
function newcEntry(name: string, data: Buffer, mode: number): Buffer {
  const fields = [
    0, // ino
    mode,
    0, // uid
    0, // gid
    1, // nlink
    0, // mtime
    data.length,
    0, // devmajor
    0, // devminor
    0, // rmajor
    0, // rminor
    name.length + 1,
    0, // check
  ]
  const header = `070701${fields.map((field) => field.toString(16).padStart(8, '0')).join('')}`
  const headerBytes = Buffer.from(header, 'ascii')
  const nameBytes = Buffer.from(`${name}\0`, 'ascii')
  return Buffer.concat([
    headerBytes,
    nameBytes,
    Buffer.alloc((4 - ((headerBytes.length + nameBytes.length) % 4)) % 4),
    data,
    Buffer.alloc((4 - (data.length % 4)) % 4),
  ])
}

/** A newc cpio archive holding one file: the proving initramfs. */
function newcArchive(name: string, data: Buffer, mode: number): Buffer {
  return Buffer.concat([newcEntry(name, data, mode), newcEntry('TRAILER!!!', Buffer.alloc(0), 0)])
}

async function fetchKernel(): Promise<string> {
  const cache = path.join(tmpdir(), 'node-os-proving-guest')
  mkdirSync(cache, { recursive: true })
  const kernel = path.join(cache, 'vmlinuz-virt')
  if (existsSync(kernel) && sha256File(kernel) === KERNEL_SHA256) return kernel
  const response = await fetch(KERNEL_URL)
  if (!response.ok) throw new Error(`kernel download answered ${String(response.status)}`)
  writeFileSync(kernel, Buffer.from(await response.arrayBuffer()))
  if (sha256File(kernel) !== KERNEL_SHA256) throw new Error('kernel download failed its hash')
  return kernel
}

async function provingGuest(): Promise<{ kernel: string; initrd: string }> {
  const dir = scratch('node-os-proving-guest-')
  const source = path.join(dir, 'init.c')
  writeFileSync(source, PROVING_INIT_C)
  const init = path.join(dir, 'init')
  execFileSync('gcc', ['-static', '-Os', '-o', init, source], { stdio: 'pipe' })
  const initrd = path.join(dir, 'micro.cpio')
  writeFileSync(initrd, newcArchive('init', readFileSync(init), 0o10_0755))
  return { kernel: await fetchKernel(), initrd }
}

describe('os-boot-test composition', () => {
  it('composes the exact emulated invocations per architecture', () => {
    const x86 = dryRun([
      '--arch',
      'x86_64',
      '--out',
      'out',
      '--marker',
      'M',
      '--timeout',
      '30',
      '--memory',
      '512',
      '--kernel',
      'vmlinuz',
      '--initrd',
      'initrd',
      '--append',
      'console=ttyS0',
      '--kvm',
      'off',
    ])
    expect(x86).toEqual({
      program: 'qemu-system-x86_64',
      args: [
        '-m',
        '512',
        '-display',
        'none',
        '-serial',
        'stdio',
        '-machine',
        'q35',
        '-smp',
        '1',
        '-cpu',
        'max',
        '-kernel',
        'vmlinuz',
        '-initrd',
        'initrd',
        '-append',
        'console=ttyS0',
      ],
    })
    const arm = dryRun([
      '--arch',
      'aarch64',
      '--out',
      'out',
      '--marker',
      'M',
      '--timeout',
      '30',
      '--memory',
      '512',
      '--kernel',
      'vmlinuz',
      '--initrd',
      'initrd',
      '--append',
      'console=ttyAMA0',
      '--kvm',
      'off',
    ])
    expect(arm).toEqual({
      program: 'qemu-system-aarch64',
      args: [
        '-m',
        '512',
        '-display',
        'none',
        '-serial',
        'stdio',
        '-M',
        'virt',
        '-cpu',
        'cortex-a72',
        '-kernel',
        'vmlinuz',
        '-initrd',
        'initrd',
        '-append',
        'console=ttyAMA0',
      ],
    })
  })

  it('composes image boots with their firmware', () => {
    const x86 = dryRun([
      '--arch',
      'x86_64',
      '--out',
      'out',
      '--marker',
      'M',
      '--timeout',
      '30',
      '--memory',
      '2048',
      '--image',
      'node.raw',
      '--ovmf-code',
      'OVMF_CODE.fd',
      '--ovmf-vars',
      'OVMF_VARS.fd',
      '--kvm',
      'off',
    ])
    expect(x86.args).toEqual([
      '-m',
      '2048',
      '-display',
      'none',
      '-serial',
      'stdio',
      '-machine',
      'q35',
      '-smp',
      '1',
      '-cpu',
      'max',
      '-drive',
      'file=OVMF_CODE.fd,format=raw,if=pflash,readonly=on',
      '-drive',
      'file=OVMF_VARS.fd,format=raw,if=pflash',
      '-drive',
      'file=node.raw,format=raw,if=virtio',
    ])
    const arm = dryRun([
      '--arch',
      'aarch64',
      '--out',
      'out',
      '--marker',
      'M',
      '--timeout',
      '30',
      '--memory',
      '2048',
      '--image',
      'node.raw',
      '--aavmf',
      'AAVMF_CODE.fd',
      '--kvm',
      'off',
    ])
    expect(arm.args).toContain('-bios')
    expect(arm.args).toContain('AAVMF_CODE.fd')
    expect(arm.args).toContain('file=node.raw,format=raw,if=virtio')
  })

  it('refuses bad shapes without touching anything', () => {
    const base = [
      '--arch',
      'x86_64',
      '--out',
      'out',
      '--marker',
      'M',
      '--timeout',
      '30',
      '--memory',
      '512',
      '--kernel',
      'vmlinuz',
      '--initrd',
      'initrd',
      '--kvm',
      'off',
    ]
    const without = (...flags: string[]): string[] => {
      const args = [...base]
      for (const flag of flags) {
        const index = args.indexOf(flag)
        expect(index).toBeGreaterThanOrEqual(0)
        args.splice(index, 2)
      }
      return args
    }
    const cases: { args: string[]; anchor: string }[] = [
      {
        args: [...without('--arch'), '--arch', 'riscv'],
        anchor: 'arch must be x86_64 or aarch64',
      },
      { args: without('--marker'), anchor: 'pass --marker MARK' },
      { args: without('--out'), anchor: 'pass --out DIR' },
      { args: [...without('--timeout'), '--timeout', '0'], anchor: '--timeout must be a positive' },
      {
        args: [...without('--timeout'), '--timeout', 'abc'],
        anchor: '--timeout must be a positive',
      },
      { args: [...without('--memory'), '--memory', '-1'], anchor: '--memory must be a positive' },
      { args: [...base, '--image', 'node.raw'], anchor: 'exactly one boot source' },
      { args: without('--kernel', '--initrd'), anchor: 'exactly one boot source' },
      { args: without('--initrd'), anchor: 'exactly one boot source' },
      { args: [...base, '--ovmf-code', 'CODE.fd'], anchor: 'ovmf code and vars come as a pair' },
      { args: [...base, '--bogus'], anchor: 'unknown flag' },
    ]
    for (const { args, anchor } of cases) {
      const result = run([...args, '--dry-run'])
      expect(result.status).toBe(2)
      expect(result.out).toContain(anchor)
    }
  })

  it('refuses missing files and reports a qemu that cannot start', () => {
    const dir = scratch('node-os-boot-missing-')
    const kernel = path.join(dir, 'vmlinuz')
    const initrd = path.join(dir, 'initrd')
    writeFileSync(kernel, 'kernel')
    writeFileSync(initrd, 'initrd')
    const base = [
      '--arch',
      'x86_64',
      '--out',
      path.join(dir, 'out'),
      '--marker',
      'M',
      '--timeout',
      '30',
      '--memory',
      '512',
      '--kvm',
      'off',
    ]
    const missing = run([...base, '--kernel', path.join(dir, 'absent'), '--initrd', initrd])
    expect(missing.status).toBe(2)
    expect(missing.out).toContain('kernel not found')
    const unstartable = run([
      ...base,
      '--kernel',
      kernel,
      '--initrd',
      initrd,
      '--qemu',
      path.join(dir, 'no-qemu-here'),
    ])
    expect(unstartable.status).toBe(1)
    expect(unstartable.out).toContain('spawn')
  })

  it('starts through a symlinked directory', () => {
    const dir = scratch('node-os-boot-link-')
    const link = path.join(dir, 'scripts')
    // Windows's directory link is a junction (no privilege needed; a symlink
    // needs the symbolic-link privilege, which a test account does not hold).
    symlinkSync(path.dirname(BOOT_TEST), link, process.platform === 'win32' ? 'junction' : 'dir')
    const result = run(
      [
        '--arch',
        'x86_64',
        '--out',
        'out',
        '--marker',
        'M',
        '--timeout',
        '30',
        '--memory',
        '512',
        '--kernel',
        'vmlinuz',
        '--initrd',
        'initrd',
        '--kvm',
        'off',
        '--dry-run',
      ],
      path.join(link, 'os-boot-test.mjs'),
    )
    expect(result.status).toBe(0)
    expect(JSON.parse(result.out)).toEqual(
      expect.objectContaining({ program: 'qemu-system-x86_64' }),
    )
  })
})

describe('boot transcript scanner', () => {
  it('finds the marker in the proving boot and the panic in the panic boot', () => {
    const proving = scanTranscript(readFileSync(PROVING_LOG, 'utf8'), PROVING_MARKER)
    expect(proving).toEqual({ found: true, panic: null })
    const panic = scanTranscript(readFileSync(PANIC_LOG, 'utf8'), PROVING_MARKER)
    expect(panic.found).toBe(false)
    expect(panic.panic).toContain('Kernel panic')
    expect(scanTranscript('', PROVING_MARKER)).toEqual({ found: false, panic: null })
  })

  it('pins the recorded transcripts against drift', () => {
    expect(sha256File(PROVING_LOG)).toBe(
      '71dfaf56197c4d2714e72193fda0e0173b4a1385b7e308e4cea7875eb6fc628b',
    )
    expect(sha256File(PANIC_LOG)).toBe(
      '63ffc31df0d67edf5d018791cffc85e818cf77a1d0320e18b9d6d313996fa9fb',
    )
  })
})

describe.runIf(CAN_BOOT)('proving guest boots', () => {
  // Named timeout: a one-time 12 MB kernel download plus an emulated QEMU boot.
  it('boots the proving guest to its marker', { timeout: GUEST_TIMEOUT_MS }, async () => {
    const guest = await provingGuest()
    const out = path.join(scratch('node-os-boot-live-'), 'out')
    const result = run([
      '--arch',
      'x86_64',
      '--out',
      out,
      '--marker',
      PROVING_MARKER,
      '--timeout',
      '240',
      '--memory',
      '512',
      '--kernel',
      guest.kernel,
      '--initrd',
      guest.initrd,
      '--append',
      'console=ttyS0 rdinit=/init',
      '--kvm',
      'off',
    ])
    expect(result.status, result.out).toBe(0)
    expect(readFileSync(path.join(out, 'serial.log'), 'utf8')).toContain(PROVING_MARKER)
    // The receipt names the acceleration it ran under: --kvm off is TCG.
    const receipt = z
      .object({ ok: z.literal(true), accel: z.literal('tcg') })
      .parse(JSON.parse(readFileSync(path.join(out, 'result.json'), 'utf8')))
    expect(receipt.accel).toBe('tcg')
    expect(result.out).toContain('under tcg')
  })

  // Named timeout: a one-time 12 MB kernel download plus an emulated QEMU boot.
  it.runIf(HAS_PGREP)(
    'leaves no guest running once the marker is seen',
    { timeout: GUEST_TIMEOUT_MS },
    async () => {
      const guest = await provingGuest()
      const out = path.join(scratch('node-os-boot-stop-'), 'out')
      const result = run([
        '--arch',
        'x86_64',
        '--out',
        out,
        '--marker',
        PROVING_MARKER,
        '--timeout',
        '240',
        '--memory',
        '512',
        '--kernel',
        guest.kernel,
        '--initrd',
        guest.initrd,
        '--append',
        `console=ttyS0 rdinit=/init guest-token=${path.basename(path.dirname(out))}`,
        '--kvm',
        'off',
      ])
      expect(result.status, result.out).toBe(0)
      // The driver asks the guest to stop with SIGTERM; it must be gone
      // within the driver's own grace, or a container client would leave
      // its guest running after the verdict.
      const token = path.basename(path.dirname(out))
      const deadline = Date.now() + GUEST_STOP_WAIT_MS
      while (isGuestRunning(token) && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, GUEST_STOP_POLL_MS))
      }
      expect(isGuestRunning(token)).toBe(false)
    },
  )

  // Named timeout: waits out the guest's own 20 s timeout plus boot time.
  it('times out on a marker that never prints', { timeout: BOOT_TIMEOUT_MS }, async () => {
    const guest = await provingGuest()
    const out = path.join(scratch('node-os-boot-timeout-'), 'out')
    const result = run([
      '--arch',
      'x86_64',
      '--out',
      out,
      '--marker',
      'MARKER-THAT-NEVER-PRINTS',
      '--timeout',
      '20',
      '--memory',
      '512',
      '--kernel',
      guest.kernel,
      '--initrd',
      guest.initrd,
      '--append',
      'console=ttyS0 rdinit=/init',
      '--kvm',
      'off',
    ])
    expect(result.status).toBe(1)
    expect(result.out).toContain('timeout')
  })
})
