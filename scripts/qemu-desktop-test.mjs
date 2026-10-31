#!/usr/bin/env node
// M111 lane QA: the QEMU desktop boot/install test runner. Boots a
// desktop image, install medium, kernel, or bare UEFI firmware on a
// two-output virtio-gpu machine with an swtpm TPM, waits for the serial
// marker, drives keys over QMP, and screenshots both heads.
//
//   node scripts/qemu-desktop-test.mjs --arch x86_64 --out temp/qemu-smoke \
//     --timeout 120 --memory 4096 --firmware-only
//   node scripts/qemu-desktop-test.mjs --arch aarch64 --out temp/qemu-boot \
//     --timeout 300 --memory 4096 --image out/muse-desktop.img \
//     --marker DESKTOP-READY
//   node scripts/qemu-desktop-test.mjs --arch x86_64 --out temp/qemu-install \
//     --timeout 900 --memory 4096 --cdrom out/muse-desktop.iso \
//     --target temp/install-target.qcow2 --target-size-gib 24 \
//     --marker INSTALLER-READY --keys-after-marker ret
//
// Exit 0: the marker appeared (or, firmware-only, a live firmware frame
// was captured). Exit 1: timeout, panic, early EOF or launch failure.
// Exit 2: usage, shape or missing-input error. The verdict and the
// serial transcript land under --out either way.

import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import process from 'node:process'
import {
  composeDesktopQemu,
  findAavmf,
  findOvmf,
  runDesktopBoot,
} from '../test/desktop/harness/lib/qemuDesktop.mjs'

const USAGE =
  'usage: qemu-desktop-test.mjs --arch x86_64|aarch64 --out DIR --timeout SEC --memory MB [--cpus N] (--image FILE | --cdrom FILE | --kernel FILE --initrd FILE | --firmware-only) [--marker MARK] [--append STR] [--snapshot] [--target FILE --target-size-gib N] [--keys-early a+b,...] [--keys-after-marker ret,...] [--qemu PATH] [--swtpm PATH] [--kvm auto|on|off] [--ovmf-code F --ovmf-vars F] [--aavmf F] [--dry-run]'

const VALUE_FLAGS = new Set([
  '--arch',
  '--out',
  '--marker',
  '--timeout',
  '--memory',
  '--cpus',
  '--image',
  '--cdrom',
  '--kernel',
  '--initrd',
  '--append',
  '--qemu',
  '--swtpm',
  '--kvm',
  '--ovmf-code',
  '--ovmf-vars',
  '--aavmf',
  '--target',
  '--target-size-gib',
  '--keys-early',
  '--keys-after-marker',
  '--seed',
])

function parse(argv) {
  const values = {}
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index]
    if (['--help', '-h'].includes(flag)) return { help: true }
    if (['--dry-run', '--firmware-only', '--snapshot'].includes(flag)) {
      const name = flag.slice(2).replaceAll(/-([a-z])/g, (_, letter) => letter.toUpperCase())
      values[name] = true
      continue
    }
    if (flag === undefined || !VALUE_FLAGS.has(flag)) {
      return { error: `unknown flag: ${flag ?? '(missing)'}` }
    }
    const value = argv[index + 1]
    if (value === undefined || value.startsWith('--')) return { error: `missing value: ${flag}` }
    const name = flag.slice(2).replaceAll(/-([a-z])/g, (_, letter) => letter.toUpperCase())
    values[name] = value
    index += 1
  }
  return { values }
}

function positiveInt(value, what) {
  if (value === undefined) return { error: `pass --${what}` }
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0
    ? { value: parsed }
    : { error: `--${what} must be a positive integer` }
}

function fail2(message) {
  console.error(`qemu-desktop-test: ${message}`)
  process.exit(2)
}

const parsed = parse(process.argv.slice(2))
if ('help' in parsed) {
  console.log(USAGE)
  process.exit(0)
}
if ('error' in parsed) fail2(parsed.error)
const options = parsed.values
if (options.out === undefined || options.out === '') fail2('pass --out DIR')
const timeout = positiveInt(options.timeout, 'timeout')
if ('error' in timeout) fail2(timeout.error)
const memory = positiveInt(options.memory, 'memory')
if ('error' in memory) fail2(memory.error)
const cpus = options.cpus === undefined ? { value: undefined } : positiveInt(options.cpus, 'cpus')
if ('error' in cpus) fail2(cpus.error)
if (
  options.firmwareOnly !== true &&
  options.kernel === undefined &&
  (options.marker === undefined || options.marker === '')
) {
  fail2('pass --marker MARK (the guest contract on its serial console)')
}

// Firmware auto-discovery, overridable by flag; the x86_64 vars template
// is copied into --out so a run never mutates the distribution's copy.
let { ovmfCode, ovmfVars } = options
if (ovmfCode === undefined && options.arch === 'x86_64') {
  const found = findOvmf()
  if (found !== undefined) ({ code: ovmfCode, vars: ovmfVars } = found)
}
const aavmf = options.aavmf ?? (options.arch === 'aarch64' ? findAavmf() : undefined)

const composed = composeDesktopQemu({
  arch: options.arch,
  outDir: options.out,
  memoryMb: memory.value,
  cpus: cpus.value ?? 2,
  kvm: options.kvm ?? 'auto',
  image: options.image,
  cdrom: options.cdrom,
  kernel: options.kernel,
  initrd: options.initrd,
  append: options.append,
  firmwareOnly: options.firmwareOnly === true,
  snapshot: options.snapshot === true,
  target: options.target,
  seed: options.seed,
  ovmfCode,
  ovmfVars,
  aavmf,
  qemu: options.qemu,
  swtpm: options.swtpm,
})
if (!composed.ok) {
  for (const error of composed.errors) console.error(`qemu-desktop-test: ${error}`)
  process.exit(2)
}
if (options.dryRun === true) {
  console.log(
    JSON.stringify({
      program: composed.program,
      args: composed.args,
      tpmProgram: composed.tpmProgram,
      tpmArgs: composed.tpmArgs,
    }),
  )
  process.exit(0)
}
for (const [label, file] of [
  ['image', options.image],
  ['cdrom', options.cdrom],
  ['kernel', options.kernel],
  ['initrd', options.initrd],
  ['ovmf code', ovmfCode],
  ['ovmf vars', ovmfVars],
  ['aavmf', aavmf],
  ['seed', options.seed],
]) {
  if (file === undefined || existsSync(file)) continue
  fail2(`${label} not found: ${file}`)
}
if (options.target !== undefined && !existsSync(options.target)) {
  const size = positiveInt(options.targetSizeGib, 'target-size-gib')
  if ('error' in size) fail2(`the install target ${options.target} does not exist: ${size.error}`)
  const format = options.target.endsWith('.qcow2') ? 'qcow2' : 'raw'
  const created = spawnSync(
    'qemu-img',
    ['create', '-f', format, options.target, `${String(size.value)}G`],
    {
      stdio: 'inherit',
    },
  )
  if (created.status !== 0) fail2(`qemu-img could not create ${options.target}`)
}

const splitKeys = (value) =>
  value === undefined
    ? []
    : value
        .split(',')
        .map((combo) => combo.trim())
        .filter(Boolean)
const verdict = await runDesktopBoot({
  composed,
  marker: options.firmwareOnly === true ? undefined : options.marker,
  timeoutSec: timeout.value,
  outDir: options.out,
  keysEarly: splitKeys(options.keysEarly),
  keysAfterMarker: splitKeys(options.keysAfterMarker),
  copyVarsFrom: ovmfVars,
})
if (verdict.ok) {
  console.log(
    `qemu-desktop-test: ${verdict.reason} in ${String(verdict.bootMs)} ms: ${verdict.transcript}`,
  )
} else {
  console.error(`qemu-desktop-test: ${verdict.reason}: ${verdict.transcript}`)
  process.exit(1)
}
