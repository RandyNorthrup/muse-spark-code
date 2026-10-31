// M110os OS6: the QEMU boot-test driver. It composes the QEMU command
// line per architecture, runs the guest with its serial console
// captured, and passes when the boot marker appears. The marker is the
// caller's (the images' serial getty prints `localhost login:`); the
// timeout, the marker and the memory size are required arguments with
// no defaults, so no baked-in limit of ours stops a run. Node builtins
// only, so CI and any rig run it bare.
import { spawn } from 'node:child_process'
import { accessSync, constants, createWriteStream, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { clearTimeout, setTimeout } from 'node:timers'

const PANIC_PATTERN = /kernel panic/i
const X86_QEMU = 'qemu-system-x86_64'
const AARCH64_QEMU = 'qemu-system-aarch64'
const AARCH64_MACHINE = 'virt'
const AARCH64_CPU = 'cortex-a72'
const X86_MACHINE = 'q35'
const X86_CPU = 'max'
// A guest is asked to stop with SIGTERM, which QEMU and a container client
// forward and honour; only a guest still running after this grace is killed.
const STOP_GRACE_MS = 5000

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Whether KVM can be used: the device node opens for reading and writing. */
export function isKvmAvailable() {
  try {
    accessSync('/dev/kvm', constants.R_OK | constants.W_OK)
    return true
  } catch {
    return false
  }
}

/**
Compose the QEMU invocation. Returns { ok, program, args, accel } (accel is
kvm or tcg, the acceleration the guest will run under) or { ok: false,
errors }. Dry runs skip existence checks; only shapes.
*/
export function composeQemu(options) {
  if (!isRecord(options)) return { ok: false, errors: ['options must be an object'] }
  const errors = []
  const { arch } = options
  if (arch !== 'x86_64' && arch !== 'aarch64') errors.push('arch must be x86_64 or aarch64')
  if (!Number.isSafeInteger(options.memoryMb) || options.memoryMb <= 0) {
    errors.push('memory must be a positive number of megabytes')
  }
  if (options.kvm !== 'auto' && options.kvm !== 'on' && options.kvm !== 'off') {
    errors.push('kvm must be auto, on or off')
  }
  const hasImage = typeof options.image === 'string' && options.image !== ''
  const hasKernel =
    typeof options.kernel === 'string' &&
    options.kernel !== '' &&
    typeof options.initrd === 'string' &&
    options.initrd !== ''
  if (hasImage === hasKernel) {
    errors.push('pass exactly one boot source: --image, or --kernel with --initrd')
  }
  if (
    options.append !== undefined &&
    (typeof options.append !== 'string' || options.append === '')
  ) {
    errors.push('append must be a non-empty string')
  }
  const hasOvmfCode = typeof options.ovmfCode === 'string' && options.ovmfCode !== ''
  const hasOvmfVars = typeof options.ovmfVars === 'string' && options.ovmfVars !== ''
  if (hasOvmfCode !== hasOvmfVars) {
    errors.push('ovmf code and vars come as a pair: pass both or neither')
  }
  if (errors.length > 0) return { ok: false, errors }
  const program = options.qemu ?? (arch === 'x86_64' ? X86_QEMU : AARCH64_QEMU)
  const args = ['-m', String(options.memoryMb), '-display', 'none', '-serial', 'stdio']
  const wantKvm = options.kvm === 'on' || (options.kvm === 'auto' && isKvmAvailable())
  if (options.kvm === 'on' && !isKvmAvailable()) {
    return { ok: false, errors: ['kvm is on but /dev/kvm is not usable'] }
  }
  if (wantKvm) args.push('-enable-kvm', '-cpu', 'host')
  if (arch === 'x86_64') {
    // q35 on one vCPU, as OS1 qualified it: a two-vCPU TCG run
    // panicked at the kernel timer/APIC check before initrd.
    args.push('-machine', X86_MACHINE, '-smp', '1')
    if (!wantKvm) args.push('-cpu', X86_CPU)
    if (hasImage && hasOvmfCode) {
      args.push(
        '-drive',
        `file=${options.ovmfCode},format=raw,if=pflash,readonly=on`,
        '-drive',
        `file=${options.ovmfVars},format=raw,if=pflash`,
      )
    }
  } else {
    args.push('-M', AARCH64_MACHINE)
    if (!wantKvm) args.push('-cpu', AARCH64_CPU)
    if (hasImage && typeof options.aavmf === 'string' && options.aavmf !== '') {
      args.push('-bios', options.aavmf)
    }
  }
  if (hasImage) {
    args.push('-drive', `file=${options.image},format=raw,if=virtio`)
  } else {
    args.push('-kernel', options.kernel, '-initrd', options.initrd)
    if (typeof options.append === 'string') args.push('-append', options.append)
  }
  return { ok: true, program, args, accel: wantKvm ? 'kvm' : 'tcg' }
}

/** Scan a serial transcript for the marker and for a kernel panic. */
export function scanTranscript(text, marker) {
  const panic = text.split('\n').find((line) => PANIC_PATTERN.test(line)) ?? null
  return { found: text.includes(marker), panic }
}

/**
Run the guest until the marker, a panic, EOF or the timeout. The
transcript lands in outDir/serial.log and the verdict in
outDir/result.json. Resolves { ok, reason, accel, bootMs, transcript } with
reason marker, timeout, panic, eof or spawn; accel is the composed
acceleration (kvm or tcg), so every receipt says which one it is.
*/
export async function runBoot({ program, args, accel, marker, timeoutSec, outDir }) {
  mkdirSync(outDir, { recursive: true })
  const transcript = path.join(outDir, 'serial.log')
  const output = createWriteStream(transcript, 'utf8')
  const started = Date.now()
  let child
  try {
    child = spawn(program, args, { stdio: ['ignore', 'pipe', 'pipe'] })
  } catch (error) {
    await new Promise((done) => output.end(done))
    return finish(outDir, transcript, started, accel, {
      ok: false,
      reason: `spawn: ${String(error)}`,
    })
  }
  return new Promise((resolve) => {
    let buffer = ''
    let isSettled = false
    const settle = (result) => {
      if (isSettled) return
      isSettled = true
      clearTimeout(timer)
      const hardKill = setTimeout(() => child.kill('SIGKILL'), STOP_GRACE_MS)
      hardKill.unref()
      child.once('close', () => clearTimeout(hardKill))
      child.kill('SIGTERM')
      output.end(() => resolve(finish(outDir, transcript, started, accel, result)))
    }
    const timer = setTimeout(() => settle({ ok: false, reason: 'timeout' }), timeoutSec * 1000)
    timer.unref()
    const onChunk = (chunk) => {
      // The guest may still print while it stops; the transcript is closed.
      if (isSettled) return
      const text = chunk.toString('utf8')
      output.write(text)
      buffer += text
      const scanned = scanTranscript(buffer, marker)
      if (scanned.panic !== null) settle({ ok: false, reason: `panic: ${scanned.panic.trim()}` })
      else if (scanned.found) settle({ ok: true, reason: 'marker' })
    }
    child.stdout.on('data', onChunk)
    child.stderr.on('data', onChunk)
    child.on('error', (error) => settle({ ok: false, reason: `spawn: ${String(error)}` }))
    child.on('close', () => settle({ ok: false, reason: 'eof' }))
  })
}

function finish(outDir, transcript, started, accel, result) {
  const verdict = { ...result, accel, bootMs: Date.now() - started, transcript }
  writeFileSync(path.join(outDir, 'result.json'), `${JSON.stringify(verdict, null, 2)}\n`)
  return verdict
}
