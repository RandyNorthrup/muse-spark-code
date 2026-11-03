// Muse Desktop (M111, D91.3) lane CP: the compositor gate. Runs Hyprland's
// own --verify-config over the generated configs and passes only when it
// prints `config ok`. The desktop workflow calls this with Hyprland
// installed; --expect-pin additionally refuses any Hyprland whose
// --version does not contain the pinned version from pin.json.
// Usage: node os/desktop/hyprland/verify-config.mjs [--binary <path>] [--expect-pin] [files...]

import { execFile } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..', '..')
const DEFAULT_FILES = ['os/desktop/hyprland/hyprland.lua', 'os/desktop/hyprland/hyprland-light.lua']

function run(binary, args) {
  return new Promise((resolve) => {
    execFile(binary, args, { timeout: 60_000 }, (error, stdout, stderr) => {
      resolve(
        error && error.code === 'ENOENT'
          ? { ran: false, output: '' }
          : { ran: true, output: `${stdout}\n${stderr}` },
      )
    })
  })
}

export function pinnedVersion() {
  const pin = JSON.parse(
    readFileSync(path.join(REPO_ROOT, 'os', 'desktop', 'hyprland', 'pin.json'), 'utf8'),
  )
  return String(pin.version).split('+', 1)[0]
}

export async function checkPinnedVersion(binary, expected) {
  const { ran, output } = await run(binary, ['--version'])
  return ran
    ? { binaryFound: true, match: output.includes(expected), output: output.trim() }
    : { binaryFound: false, match: false, output: '' }
}

export async function verifyConfigs(binary, files) {
  const failures = []
  for (const file of files) {
    const full = path.isAbsolute(file) ? file : path.join(REPO_ROOT, file)
    const { ran, output } = await run(binary, ['-c', full, '--verify-config'])
    if (!ran) return { binaryFound: false, failures: [file] }
    if (!output.includes('config ok')) failures.push({ file, output: output.trim() })
  }
  return { binaryFound: true, failures }
}

async function main() {
  const args = process.argv.slice(2)
  let binary = 'Hyprland'
  let shouldCheckPin = false
  const files = []
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--binary') {
      i += 1
      binary = args[i] ?? fail('missing --binary path')
    } else if (args[i] === '--expect-pin') {
      shouldCheckPin = true
    } else {
      files.push(args[i])
    }
  }
  const targets = files.length > 0 ? files : DEFAULT_FILES
  if (shouldCheckPin) {
    const expected = pinnedVersion()
    const checked = await checkPinnedVersion(binary, expected)
    if (!checked.binaryFound) {
      console.error(`hyprland verify: no ${binary} on PATH (install the pinned Hyprland first)`)
      process.exitCode = 1
      return
    }
    if (!checked.match) {
      console.error(`hyprland verify: ${binary} is not the pinned ${expected}:\n${checked.output}`)
      process.exitCode = 1
      return
    }
    console.log(`hyprland verify: pinned ${expected} confirmed (${binary})`)
  }
  const { binaryFound, failures } = await verifyConfigs(binary, targets)
  if (!binaryFound) {
    console.error(`hyprland verify: no ${binary} on PATH (install the pinned Hyprland first)`)
    process.exitCode = 1
    return
  }
  if (failures.length > 0) {
    for (const { file, output } of failures) {
      console.error(`hyprland verify: ${file} failed --verify-config:\n${output}`)
    }
    process.exitCode = 1
    return
  }
  console.log(`hyprland verify: ${targets.length} configs ok (${binary})`)
}

function fail(message) {
  console.error(`hyprland verify: ${message}`)
  process.exit(1)
}

if (
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await main()
}
