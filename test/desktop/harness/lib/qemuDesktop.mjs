// The QEMU desktop boot/install runner (M111 lane QA), built on the same
// shape as scripts/lib/osBootTest.mjs (M110os OS6): the QEMU command line
// composed per architecture, the serial console captured, a required
// marker/timeout/memory with no defaults. What the desktop needs beyond a
// headless node boot is all here: a virtio-gpu with two virtual outputs,
// an swtpm TPM 2.0, UEFI firmware, and QMP for screenshots and keys —
// the machine M111os images and M111i's installer are booted and driven
// on. Node builtins only, so CI and any rig run it bare.

import { spawn } from 'node:child_process'
import { createWriteStream, existsSync } from 'node:fs'
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { connect } from 'node:net'
import path from 'node:path'
import { clearTimeout, setTimeout } from 'node:timers'
import { isKvmAvailable } from '../../../../scripts/lib/osBootTest.mjs'
import { sleep, stopProcessGroup } from './proc.mjs'

const PANIC_PATTERN = /kernel panic/i
const X86_QEMU = 'qemu-system-x86_64'
const AARCH64_QEMU = 'qemu-system-aarch64'

/** Where distributions keep the x86_64 OVMF pair, first found wins. */
export const OVMF_CANDIDATES = [
  { code: '/usr/share/OVMF/OVMF_CODE_4M.fd', vars: '/usr/share/OVMF/OVMF_VARS_4M.fd' },
  { code: '/usr/share/OVMF/OVMF_CODE.fd', vars: '/usr/share/OVMF/OVMF_VARS.fd' },
  {
    code: '/usr/share/edk2/x64/OVMF_CODE.4m.fd',
    vars: '/usr/share/edk2/x64/OVMF_VARS.4m.fd',
  },
  {
    code: '/usr/share/edk2-ovmf/x64/OVMF_CODE.fd',
    vars: '/usr/share/edk2-ovmf/x64/OVMF_VARS.fd',
  },
]

/** Where distributions keep the aarch64 UEFI firmware, first found wins. */
export const AAVMF_CANDIDATES = [
  '/usr/share/qemu-efi-aarch64/QEMU_EFI.fd',
  '/usr/share/AAVMF/AAVMF_CODE.fd',
  '/usr/share/edk2/aarch64/QEMU_EFI-pflash.raw',
  '/usr/share/edk2-armvirt/aarch64/QEMU_EFI-pflash.raw',
]

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isText(value) {
  return typeof value === 'string' && value !== ''
}

/**
Compose the desktop QEMU invocation plus its swtpm companion. Returns
{ ok, program, args, tpmProgram, tpmArgs, paths } or { ok: false, errors }.
Paths inside `outDir` are deterministic so a dry run shows the whole
machine. Existence checks belong to the caller (the runner script).
*/
export function composeDesktopQemu(options) {
  if (!isRecord(options)) return { ok: false, errors: ['options must be an object'] }
  const errors = []
  const { arch } = options
  if (arch !== 'x86_64' && arch !== 'aarch64') errors.push('arch must be x86_64 or aarch64')
  if (!Number.isSafeInteger(options.memoryMb) || options.memoryMb <= 0) {
    errors.push('memory must be a positive number of megabytes')
  }
  if (!Number.isSafeInteger(options.cpus) || options.cpus <= 0) {
    errors.push('cpus must be a positive integer')
  }
  if (options.kvm !== 'auto' && options.kvm !== 'on' && options.kvm !== 'off') {
    errors.push('kvm must be auto, on or off')
  }
  if (!isText(options.outDir)) errors.push('outDir is required')
  const sources = [
    isText(options.image),
    isText(options.cdrom),
    isText(options.kernel) && isText(options.initrd),
    options.firmwareOnly === true,
  ].filter(Boolean).length
  if (sources !== 1) {
    errors.push(
      'pass exactly one boot source: --image, --cdrom, --kernel with --initrd, or --firmware-only',
    )
  }
  if (
    (options.kernel !== undefined || options.initrd !== undefined) &&
    !(isText(options.kernel) && isText(options.initrd))
  ) {
    errors.push('--kernel and --initrd come as a pair')
  }
  const hasOvmf = isText(options.ovmfCode) && isText(options.ovmfVars)
  if (isText(options.ovmfCode) !== isText(options.ovmfVars)) {
    errors.push('ovmf code and vars come as a pair: pass both or neither')
  }
  if (arch === 'aarch64' && isText(options.cdrom) && !isText(options.aavmf)) {
    errors.push('an aarch64 cdrom boot needs --aavmf')
  }
  if (!hasOvmf && arch === 'x86_64' && options.firmwareOnly === true) {
    errors.push('an x86_64 firmware-only boot needs the OVMF pair')
  }
  if (arch === 'aarch64' && options.firmwareOnly === true && !isText(options.aavmf)) {
    errors.push('an aarch64 firmware-only boot needs --aavmf')
  }
  if (errors.length > 0) return { ok: false, errors }
  const wantKvm = options.kvm === 'on' || (options.kvm === 'auto' && isKvmAvailable())
  if (options.kvm === 'on' && !isKvmAvailable()) {
    return { ok: false, errors: ['kvm is on but /dev/kvm is not usable'] }
  }

  const outDir = options.outDir
  const paths = {
    tpmState: path.join(outDir, 'tpm'),
    tpmSocket: path.join(outDir, 'tpm.sock'),
    qmpSocket: path.join(outDir, 'qmp.sock'),
    serial: path.join(outDir, 'serial.log'),
    firmware: path.join(outDir, 'firmware.log'),
    vars: path.join(outDir, 'OVMF_VARS.fd'),
  }
  const program = options.qemu ?? (arch === 'x86_64' ? X86_QEMU : AARCH64_QEMU)
  const args = [
    '-name',
    'muse-desktop-test',
    '-m',
    String(options.memoryMb),
    '-smp',
    String(options.cpus),
    '-display',
    'none',
    '-serial',
    'stdio',
    '-monitor',
    'none',
    '-qmp',
    `unix:${paths.qmpSocket},server,nowait`,
    '-chardev',
    `socket,id=tpm0,path=${paths.tpmSocket}`,
    '-tpmdev',
    'emulator,id=tpmdev0,chardev=tpm0',
    '-device',
    arch === 'x86_64' ? 'tpm-tis,tpmdev=tpmdev0' : 'tpm-tis-device,tpmdev=tpmdev0',
    '-device',
    arch === 'x86_64' ? 'virtio-vga,id=gpu0,max_outputs=2' : 'virtio-gpu-pci,id=gpu0,max_outputs=2',
    '-device',
    'virtio-keyboard-pci',
    '-device',
    'virtio-tablet-pci',
    '-netdev',
    'user,id=net0',
    '-device',
    'virtio-net-pci,netdev=net0',
  ]
  if (wantKvm) {
    args.push('-machine', `${arch === 'x86_64' ? 'q35' : 'virt'},accel=kvm`, '-cpu', 'host')
  } else if (arch === 'aarch64') {
    args.push('-machine', 'virt,accel=tcg', '-cpu', 'cortex-a72')
  } else {
    args.push('-machine', 'q35,accel=tcg', '-cpu', 'qemu64')
  }
  if (arch === 'x86_64' && hasOvmf) {
    args.push(
      '-drive',
      `file=${options.ovmfCode},format=raw,if=pflash,readonly=on`,
      '-drive',
      `file=${paths.vars},format=raw,if=pflash`,
      // The firmware's own console: proves the firmware ran, not just QEMU.
      '-chardev',
      `file,id=fwlog,path=${paths.firmware}`,
      '-device',
      'isa-debugcon,iobase=0x402,chardev=fwlog',
    )
  }
  if (arch === 'aarch64' && isText(options.aavmf)) {
    args.push('-bios', options.aavmf)
  }
  if (options.snapshot === true) args.push('-snapshot')
  if (isText(options.image)) {
    const format = options.imageFormat ?? (options.image.endsWith('.qcow2') ? 'qcow2' : 'raw')
    args.push('-drive', `file=${options.image},format=${format},if=virtio`)
  }
  if (isText(options.cdrom)) {
    args.push('-drive', `file=${options.cdrom},format=raw,if=virtio,readonly=on`, '-boot', 'd')
  }
  if (isText(options.kernel)) {
    args.push('-kernel', options.kernel, '-initrd', options.initrd)
    if (isText(options.append)) args.push('-append', options.append)
  }
  if (isText(options.target)) {
    const format = options.target.endsWith('.qcow2') ? 'qcow2' : 'raw'
    args.push('-drive', `file=${options.target},format=${format},if=virtio`)
  }
  const tpmArgs = [
    'socket',
    '--tpmstate',
    `dir=${paths.tpmState}`,
    '--ctrl',
    `type=unixio,path=${paths.tpmSocket}`,
    '--tpm2',
    '--log',
    `file=${path.join(outDir, 'swtpm.log')}`,
  ]
  return { ok: true, program, args, tpmProgram: options.swtpm ?? 'swtpm', tpmArgs, paths }
}

/** The first OVMF pair present on this machine, or undefined. */
export function findOvmf(exists = existsSync) {
  return OVMF_CANDIDATES.find((pair) => exists(pair.code) && exists(pair.vars))
}

/** The first AAVMF firmware present on this machine, or undefined. */
export function findAavmf(exists = existsSync) {
  return AAVMF_CANDIDATES.find((file) => exists(file))
}

/** Parses the QKeyCode names of one key combination, e.g. "ctrl+alt+f2". */
export function parseKeyCombo(spec) {
  return spec.split('+').map((key) => ({ type: 'qcode', data: key.trim() }))
}

/**
A minimal QMP client over the runner's socket: greeting, capabilities,
and one command at a time (the runner never pipelines).
*/
export async function connectQmp(socketPath, { timeoutMs = 30_000 } = {}) {
  const deadline = Date.now() + timeoutMs
  let socket
  for (;;) {
    try {
      socket = await new Promise((resolve, reject) => {
        const connection = connect(socketPath)
        connection.once('connect', () => resolve(connection))
        connection.once('error', reject)
      })
      break
    } catch (error) {
      if (Date.now() >= deadline) {
        throw new Error(`cannot connect to QMP at ${socketPath}: ${String(error)}`, {
          cause: error,
        })
      }
      await sleep(100)
    }
  }
  socket.setEncoding('utf8')
  let buffer = ''
  const waiting = []
  const failWaiting = (error) => {
    for (const pending of waiting.splice(0)) pending.reject(error)
  }
  socket.on('data', (chunk) => {
    buffer += chunk
    let index = buffer.indexOf('\n')
    while (index !== -1) {
      const line = buffer.slice(0, index)
      buffer = buffer.slice(index + 1)
      if (line.trim() !== '') {
        const next = waiting.shift()
        if (next) next.resolve(JSON.parse(line))
      }
      index = buffer.indexOf('\n')
    }
  })
  socket.once('error', (error) => failWaiting(new Error(`QMP socket error: ${String(error)}`)))
  socket.once('close', () => failWaiting(new Error('QMP socket closed')))
  const readMessage = () =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`timed out waiting for a QMP message on ${socketPath}`)),
        timeoutMs,
      )
      waiting.push({
        resolve: (message) => {
          clearTimeout(timer)
          resolve(message)
        },
        reject: (error) => {
          clearTimeout(timer)
          reject(error)
        },
      })
    })
  const greeting = await readMessage()
  const execute = async (command, args = {}) => {
    socket.write(`${JSON.stringify({ execute: command, arguments: args })}\n`)
    for (;;) {
      const message = await readMessage()
      if (message.event !== undefined) continue
      if (message.error !== undefined) {
        throw new Error(
          `QMP ${command} failed: ${message.error.desc ?? JSON.stringify(message.error)}`,
        )
      }
      return message.return
    }
  }
  await execute('qmp_capabilities')
  return {
    greeting,
    execute,
    async screendump(file, head = 0) {
      return execute('screendump', { filename: file, device: 'gpu0', head, format: 'png' })
    },
    async sendKey(spec) {
      return execute('send-key', { keys: parseKeyCombo(spec) })
    },
    async status() {
      return execute('query-status')
    },
    close() {
      socket.end()
      socket.destroy()
    },
  }
}

/** Scan a serial transcript for a marker and a kernel panic. */
export function scanDesktopTranscript(text, marker) {
  const panic = text.split('\n').find((line) => PANIC_PATTERN.test(line)) ?? null
  return { found: marker === undefined ? false : text.includes(marker), panic }
}

async function finish(outDir, result) {
  await writeFile(path.join(outDir, 'result.json'), `${JSON.stringify(result, null, 2)}\n`)
  return result
}

async function waitForSocket(file, description, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (!existsSync(file)) {
    if (Date.now() >= deadline) throw new Error(`${description} did not appear: ${file}`)
    await sleep(50)
  }
}

/**
Boots the composed machine: swtpm first, then QEMU. Waits for the marker
on the serial console (or, with no marker, for live firmware with a
captured frame), sends early and post-marker keys, screenshots both
heads, and stops the whole tree. The verdict lands in result.json.
*/
export async function runDesktopBoot({
  composed,
  marker,
  timeoutSec,
  outDir,
  keysEarly = [],
  keysAfterMarker = [],
  copyVarsFrom,
}) {
  await mkdir(path.join(outDir, 'tpm'), { recursive: true })
  if (copyVarsFrom !== undefined) await copyFile(copyVarsFrom, composed.paths.vars)
  const started = Date.now()
  const screenshots = []
  let reason
  let isOk = false
  let screenshotError
  const swtpm = spawn(composed.tpmProgram, composed.tpmArgs, {
    detached: true,
    stdio: 'ignore',
  })
  let qemu
  try {
    await waitForSocket(composed.paths.tpmSocket, 'the swtpm socket', 15_000)
    const output = createWriteStream(composed.paths.serial, 'utf8')
    qemu = spawn(composed.program, composed.args, {
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let buffer = ''
    let exitCode
    const onChunk = (chunk) => {
      const text = chunk.toString('utf8')
      output.write(text)
      buffer += text
    }
    qemu.stdout.on('data', onChunk)
    qemu.stderr.on('data', onChunk)
    qemu.once('close', (code) => {
      exitCode = code
    })
    try {
      const qmp = await connectQmp(composed.paths.qmpSocket)
      try {
        for (const combo of keysEarly) await qmp.sendKey(combo)
        const deadline = Date.now() + timeoutSec * 1000
        if (marker === undefined) {
          // Firmware-only proof, in order: the firmware's own log
          // (debugcon on x86_64, the serial UART on aarch64) naming
          // itself, or a framebuffer that changes between captures
          // (release firmware prints no debug log; QEMU's inactive
          // placeholder never changes).
          const shot = path.join(outDir, 'head-0.png')
          let previousFrame
          let hasFirmwareLog = false
          let hasLiveFrame = false
          for (;;) {
            const firmwareLog = existsSync(composed.paths.firmware)
              ? await readFile(composed.paths.firmware, 'utf8')
              : buffer
            hasFirmwareLog = /UEFI|BdsDxe|EDK II/i.test(firmwareLog)
            await qmp.screendump(shot, 0)
            const frame = await readFile(shot)
            hasLiveFrame = previousFrame !== undefined && !frame.equals(previousFrame)
            previousFrame = frame
            if (
              hasFirmwareLog ||
              hasLiveFrame ||
              exitCode !== undefined ||
              Date.now() >= deadline
            ) {
              break
            }
            await sleep(250)
          }
          screenshots.push(shot)
          const status = await qmp.status()
          isOk = status.running === true && (hasFirmwareLog || hasLiveFrame)
          if (isOk) {
            reason = hasFirmwareLog ? 'firmware log and frame' : 'firmware frame is live'
          } else {
            reason = `firmware log ${hasFirmwareLog ? 'found' : 'missing'}, live frame ${hasLiveFrame ? 'yes' : 'no'}, status ${status.status}`
          }
        } else {
          for (;;) {
            const scanned = scanDesktopTranscript(buffer, marker)
            if (scanned.panic !== null) {
              reason = `panic: ${scanned.panic.trim()}`
              break
            }
            if (scanned.found) {
              isOk = true
              reason = 'marker'
              break
            }
            if (exitCode !== undefined) {
              reason = `eof (qemu exit ${String(exitCode)})`
              break
            }
            if (Date.now() >= deadline) {
              reason = 'timeout'
              break
            }
            await sleep(100)
          }
        }
        if (isOk) {
          try {
            for (const combo of keysAfterMarker) await qmp.sendKey(combo)
            for (const head of [0, 1]) {
              const shot = path.join(outDir, `head-${String(head)}.png`)
              if (screenshots.includes(shot)) continue
              await qmp.screendump(shot, head)
              screenshots.push(shot)
            }
          } catch (error) {
            screenshotError = String(error)
          }
        }
      } finally {
        qmp.close()
      }
    } finally {
      await new Promise((done) => {
        output.end(done)
      })
    }
  } catch (error) {
    reason = `launch: ${String(error)}`
  } finally {
    if (qemu !== undefined) await stopProcessGroup(qemu)
    await stopProcessGroup(swtpm)
  }
  return finish(outDir, {
    ok: isOk,
    reason,
    ...(screenshotError !== undefined && { screenshotError }),
    screenshots,
    bootMs: Date.now() - started,
    transcript: composed.paths.serial,
  })
}
