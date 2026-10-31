import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  composeDesktopQemu,
  findAavmf,
  findOvmf,
  parseKeyCombo,
  scanDesktopTranscript,
} from '../../../test/desktop/harness/lib/qemuDesktop.mjs'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

const base = { outDir: 'temp/qemu-unit', memoryMb: 2048, cpus: 2, kvm: 'off' }

describe('desktop QEMU composition', () => {
  it('builds a two-output virtio-gpu machine with a TPM on x86_64', () => {
    const composed = composeDesktopQemu({
      ...base,
      arch: 'x86_64',
      image: 'os.img',
      ovmfCode: '/fw/CODE.fd',
      ovmfVars: '/fw/VARS.fd',
    })
    expect(composed.ok).toBe(true)
    const joined = composed.args.join(' ')
    expect(joined).toContain('virtio-vga,id=gpu0,max_outputs=2')
    expect(joined).toContain('tpm-tis,tpmdev=tpmdev0')
    expect(joined).toContain('virtio-keyboard-pci')
    expect(joined).toContain('if=pflash,readonly=on')
    expect(joined).toContain('isa-debugcon,iobase=0x402,chardev=fwlog')
    expect(composed.tpmArgs).toContain('--tpm2')
    expect(composed.program).toBe('qemu-system-x86_64')
  })

  it('builds the aarch64 virt machine with its TPM device', () => {
    const composed = composeDesktopQemu({
      ...base,
      arch: 'aarch64',
      image: 'os.img',
      aavmf: '/fw/QEMU_EFI.fd',
    })
    expect(composed.ok).toBe(true)
    const joined = composed.args.join(' ')
    expect(joined).toContain('virtio-gpu-pci,id=gpu0,max_outputs=2')
    expect(joined).toContain('tpm-tis-device,tpmdev=tpmdev0')
    expect(joined).toContain('virt,accel=tcg')
    expect(joined).toContain('-bios /fw/QEMU_EFI.fd')
    expect(composed.program).toBe('qemu-system-aarch64')
  })

  it('refuses mixed boot sources, lone firmware halves, and bad shapes', () => {
    const cases = [
      { ...base, arch: 'x86_64', image: 'a.img', cdrom: 'b.iso' },
      { ...base, arch: 'x86_64', kernel: 'vmlinuz' },
      { ...base, arch: 'x86_64', image: 'a.img', ovmfCode: '/fw/CODE.fd' },
      { ...base, arch: 'x86_64', firmwareOnly: true },
      { ...base, arch: 'riscv64', image: 'a.img' },
      { ...base, arch: 'x86_64', image: 'a.img', memoryMb: 0 },
    ]
    for (const options of cases) {
      const composed = composeDesktopQemu(options)
      expect(composed.ok, JSON.stringify(options)).toBe(false)
      expect(composed.errors.length).toBeGreaterThan(0)
    }
  })

  it('creates an install target argument in its own format', () => {
    const composed = composeDesktopQemu({
      ...base,
      arch: 'x86_64',
      cdrom: 'install.iso',
      target: 'disk.qcow2',
    })
    expect(composed.ok).toBe(true)
    expect(composed.args.join(' ')).toContain('file=disk.qcow2,format=qcow2,if=virtio')
    expect(composed.args.join(' ')).toContain('file=install.iso,format=raw,if=virtio,readonly=on')
  })
})

describe('transcript scanning and key combos', () => {
  it('finds the marker and a panic', () => {
    expect(scanDesktopTranscript('boot\nDESKTOP-READY\n', 'DESKTOP-READY')).toEqual({
      found: true,
      panic: null,
    })
    const panicked = scanDesktopTranscript('Kernel panic - not syncing\n', 'X')
    expect(panicked.found).toBe(false)
    expect(panicked.panic).toContain('Kernel panic')
  })

  it('parses QMP key combinations', () => {
    expect(parseKeyCombo('ctrl+alt+f2')).toEqual([
      { type: 'qcode', data: 'ctrl' },
      { type: 'qcode', data: 'alt' },
      { type: 'qcode', data: 'f2' },
    ])
  })
})

describe('firmware discovery on this machine', () => {
  it('reports what the distribution installed, pair-complete', () => {
    const ovmf = findOvmf()
    if (ovmf !== undefined) {
      expect(existsSync(ovmf.code)).toBe(true)
      expect(existsSync(ovmf.vars)).toBe(true)
    }
    const aavmf = findAavmf()
    if (aavmf !== undefined) expect(existsSync(aavmf)).toBe(true)
  })
})

describe('the qemu runner script as a child process', () => {
  it('dry-runs a composition and refuses missing arguments with exit 2', () => {
    const dry = spawnSync(
      process.execPath,
      [
        'scripts/qemu-desktop-test.mjs',
        '--arch',
        'x86_64',
        '--out',
        'temp/qemu-unit',
        '--timeout',
        '60',
        '--memory',
        '512',
        '--image',
        'os.img',
        '--marker',
        'READY',
        '--kvm',
        'off',
        '--dry-run',
      ],
      { cwd: root, encoding: 'utf8' },
    )
    expect(dry.status).toBe(0)
    const shown = JSON.parse(dry.stdout)
    expect(shown.program).toBe('qemu-system-x86_64')
    expect(shown.args).toContain('virtio-vga,id=gpu0,max_outputs=2')
    const missing = spawnSync(
      process.execPath,
      ['scripts/qemu-desktop-test.mjs', '--arch', 'x86_64'],
      {
        cwd: root,
        encoding: 'utf8',
      },
    )
    expect(missing.status).toBe(2)
    expect(missing.stderr).toContain('pass --out')
  })
})
