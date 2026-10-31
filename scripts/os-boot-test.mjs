#!/usr/bin/env node
// M110os OS6: the QEMU boot-test driver.
// node scripts/os-boot-test.mjs --arch x86_64|aarch64 --out DIR --marker MARK
//   --timeout SEC --memory MB (--image FILE | --kernel FILE --initrd FILE)
//   [--append STR] [--qemu PATH] [--kvm auto|on|off] [--ovmf-code F --ovmf-vars F]
//   [--aavmf F] [--dry-run]
// x86-64 boots with KVM when the device allows it; aarch64 boots the
// virt machine, emulated. The guest contract is the marker on its
// serial console; OS1's images print NODE-OS-BOOT-OK. Exits 0 on the
// marker, 1 on timeout, panic, early EOF or launch failure, 2 on a
// usage, shape or missing-input error.
import { existsSync } from 'node:fs'
import { composeQemu, runBoot } from './lib/osBootTest.mjs'

function usage() {
  console.log(
    [
      'usage: os-boot-test.mjs --arch x86_64|aarch64 --out DIR --marker MARK --timeout SEC --memory MB (--image FILE | --kernel FILE --initrd FILE) [--append STR] [--qemu PATH] [--kvm auto|on|off] [--ovmf-code F --ovmf-vars F] [--aavmf F] [--dry-run]',
      'exit 0: the marker appeared on the serial console',
      'exit 1: timeout, panic, early EOF or launch failure',
      'exit 2: usage, shape or missing-input error',
    ].join('\n'),
  )
}

const VALUE_FLAGS = new Set([
  '--arch',
  '--out',
  '--marker',
  '--timeout',
  '--memory',
  '--image',
  '--kernel',
  '--initrd',
  '--append',
  '--qemu',
  '--kvm',
  '--ovmf-code',
  '--ovmf-vars',
  '--aavmf',
])

function args() {
  const values = {}
  const flags = process.argv.slice(2)
  for (let index = 0; index < flags.length; index += 1) {
    const flag = flags[index]
    if (flag === '--help') return { help: true }
    if (flag === '--dry-run') {
      values.dryRun = true
      continue
    }
    if (flag === undefined || !VALUE_FLAGS.has(flag)) {
      return { error: `unknown flag: ${flag ?? '(missing)'}` }
    }
    const value = flags[index + 1]
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

const parsed = args()
if ('help' in parsed) {
  usage()
  process.exit(0)
}
if ('error' in parsed) {
  console.error(`os-boot-test: ${parsed.error}`)
  process.exit(2)
}
const options = parsed.values
if (options.out === undefined || options.out === '') {
  console.error('os-boot-test: pass --out DIR')
  process.exit(2)
}
if (options.marker === undefined || options.marker === '') {
  console.error('os-boot-test: pass --marker MARK')
  process.exit(2)
}
const timeout = positiveInt(options.timeout, 'timeout')
if ('error' in timeout) {
  console.error(`os-boot-test: ${timeout.error}`)
  process.exit(2)
}
const memory = positiveInt(options.memory, 'memory')
if ('error' in memory) {
  console.error(`os-boot-test: ${memory.error}`)
  process.exit(2)
}
const composed = composeQemu({
  arch: options.arch,
  memoryMb: memory.value,
  kvm: options.kvm ?? 'auto',
  image: options.image,
  kernel: options.kernel,
  initrd: options.initrd,
  append: options.append,
  ovmfCode: options.ovmfCode,
  ovmfVars: options.ovmfVars,
  aavmf: options.aavmf,
  qemu: options.qemu,
})
if (!composed.ok) {
  for (const error of composed.errors) console.error(`os-boot-test: ${error}`)
  process.exit(2)
}
if (options.dryRun === true) {
  console.log(JSON.stringify({ program: composed.program, args: composed.args }))
  process.exit(0)
}
for (const [label, file] of [
  ['image', options.image],
  ['kernel', options.kernel],
  ['initrd', options.initrd],
  ['ovmf code', options.ovmfCode],
  ['ovmf vars', options.ovmfVars],
  ['aavmf', options.aavmf],
]) {
  if (file === undefined || existsSync(file)) continue
  console.error(`os-boot-test: ${label} not found: ${file}`)
  process.exit(2)
}
const verdict = await runBoot({
  program: composed.program,
  args: composed.args,
  accel: composed.accel,
  marker: options.marker,
  timeoutSec: timeout.value,
  outDir: options.out,
})
if (verdict.ok) {
  console.log(
    `os-boot-test: marker in ${String(verdict.bootMs)} ms under ${verdict.accel}: ${verdict.transcript}`,
  )
} else {
  console.error(`os-boot-test: ${verdict.reason} under ${verdict.accel}: ${verdict.transcript}`)
  process.exit(1)
}
