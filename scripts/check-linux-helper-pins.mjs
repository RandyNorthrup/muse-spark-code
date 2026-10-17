// Verify the Linux dictation helper's release pins (CM9LNX, PLAN.md D140).
//
// - Shape: both architectures pin the same five files, exactly the binary
//   is executable, every URL is an https release asset (no credentials).
// - `--require-values`: every pin carries real release bytes and digests;
//   the packages job runs this after generating the pins, so a VSIX never
//   ships unset pins.
// - `--assets <dir>`: every asset file in the directory matches its pin's
//   bytes and SHA-256; anything else (a swapped, partial or missing file)
//   fails. The release job runs this against the uploaded assets.
// - `--bundle <file> --assets <dir>`: the built Linux voice bundle embeds
//   every pinned digest, so a VSIX whose pins do not match the uploaded
//   assets fails. The release job extracts dist/voiceLinux.js from the VSIX
//   for this.
//
//   node scripts/check-linux-helper-pins.mjs --require-values --assets release/helpers
//   unzip -p package.vsix extension/dist/voiceLinux.js > /tmp/voiceLinux.js
//   node scripts/check-linux-helper-pins.mjs --bundle /tmp/voiceLinux.js --assets release/helpers
import { createHash } from 'node:crypto'
import { Buffer } from 'node:buffer'
import { build } from 'esbuild'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const ARCHES = ['x64', 'arm64']
const EXPECTED_FILES = ['muse-dictate', 'libwhisper.so.1', 'libggml.so', 'libggml-base.so']

export async function loadPins() {
  const compiled = await build({
    entryPoints: ['src/shared/linuxHelperPins.ts'],
    bundle: true,
    write: false,
    platform: 'node',
    format: 'esm',
  })
  return await import(
    `data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`
  )
}

/** Both architectures, five files each, one executable, https asset URLs. */
export function checkShape(pins) {
  const failures = []
  for (const arch of ARCHES) {
    const entries = pins.LINUX_HELPER_PINS?.[arch]
    if (!Array.isArray(entries) || entries.length !== EXPECTED_FILES.length + 1) {
      failures.push(`${arch}: expected ${String(EXPECTED_FILES.length + 1)} pins`)
      continue
    }
    const baseline = arch === 'x64' ? 'libggml-cpu-x64.so' : 'libggml-cpu-armv8.0_1.so'
    const wanted = [...EXPECTED_FILES, baseline]
    for (const [index, file] of wanted.entries()) {
      const pin = entries[index]
      const asset = `linux-${arch}-${file}`
      if (pin?.asset !== asset || pin?.file !== file)
        failures.push(`${arch}: pin ${String(index)} is not ${asset}`)
      const shouldRun = file === 'muse-dictate'
      const isRunnable = pin?.isExecutable === true
      if (shouldRun !== isRunnable) failures.push(`${arch}/${file}: wrong executable flag`)
      const url = pins.linuxHelperUrl?.(pin)
      if (
        typeof url !== 'string' ||
        !url.startsWith('https://github.com/RandyNorthrup/muse-spark-code/releases/') ||
        !url.endsWith(`/${asset}`)
      )
        failures.push(`${arch}/${file}: bad asset URL ${String(url)}`)
    }
  }
  return failures
}

export function checkValues(pins) {
  const failures = []
  for (const arch of ARCHES) {
    const entries = pins.LINUX_HELPER_PINS[arch] ?? []
    for (const pin of entries) {
      if (!Number.isSafeInteger(pin.bytes) || pin.bytes <= 0)
        failures.push(`${arch}/${pin.file}: unset bytes`)
      if (!/^[0-9a-f]{64}$/.test(pin.sha256 ?? ''))
        failures.push(`${arch}/${pin.file}: unset sha256`)
    }
  }
  return failures
}

/** Every asset on disk matches its pin exactly. */
export function checkAssets(pins, directory) {
  const failures = [...checkValues(pins)]
  for (const arch of ARCHES) {
    const entries = pins.LINUX_HELPER_PINS[arch] ?? []
    for (const pin of entries) {
      if (failures.some((failure) => failure.startsWith(`${arch}/${pin.file}:`))) continue
      let bytes
      try {
        bytes = readFileSync(path.join(directory, pin.asset))
      } catch {
        failures.push(`${arch}/${pin.file}: asset ${pin.asset} missing`)
        continue
      }
      if (bytes.length !== pin.bytes)
        failures.push(
          `${arch}/${pin.file}: asset is ${String(bytes.length)} bytes, not ${String(pin.bytes)}`,
        )
      else if (createHash('sha256').update(bytes).digest('hex') !== pin.sha256)
        failures.push(`${arch}/${pin.file}: asset SHA-256 mismatch`)
    }
  }
  return failures
}

/** The built bundle embeds every pinned digest (checked against assets too). */
export function checkBundle(pins, bundleText) {
  const failures = [...checkValues(pins)]
  for (const arch of ARCHES) {
    const entries = pins.LINUX_HELPER_PINS[arch] ?? []
    for (const pin of entries) {
      if (!bundleText.includes(pin.sha256))
        failures.push(`${arch}/${pin.file}: digest missing from the bundle`)
    }
  }
  return failures
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  try {
    const args = process.argv.slice(2)
    const assets = args.includes('--assets') ? args[args.indexOf('--assets') + 1] : undefined
    const bundle = args.includes('--bundle') ? args[args.indexOf('--bundle') + 1] : undefined
    if (assets === undefined && bundle !== undefined)
      throw new Error('--bundle needs --assets <dir>')
    const pins = await loadPins()
    const failures = [...checkShape(pins)]
    if (args.includes('--require-values')) failures.push(...checkValues(pins))
    if (assets !== undefined) failures.push(...checkAssets(pins, assets))
    if (bundle !== undefined) failures.push(...checkBundle(pins, readFileSync(bundle, 'utf8')))
    if (failures.length > 0) throw new Error(`Helper pins rejected:\n- ${failures.join('\n- ')}`)
    console.log('Helper pins accepted')
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
