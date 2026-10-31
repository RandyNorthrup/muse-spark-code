// The headless Hyprland harness (M111 lane QA): one private compositor
// session per run — its own runtime directory, home, config and logs —
// with aquamarine headless outputs for scenes, Mesa llvmpipe rendering,
// grim screenshots, and a stop that leaves nothing running.
//
// Aquamarine's headless backend provides outputs but no buffer allocator:
// the GBM allocator comes from a DRM device, so a session needs a KMS
// device (a virtio-gpu in this lane's QEMU runner, a vkms device, or a
// rig's GPU) or an explicit parent Wayland display to nest in. Upstream
// Hyprland runs its own compositor tests the same way (a QEMU VM with
// virtio-gpu). Where neither exists the session refuses and says why.

import { spawn } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { runCapture, sleep, stopProcessGroup, waitFor } from './proc.mjs'
import { findExecutable, findKmsDevices } from './tools.mjs'

export const DEFAULT_OUTPUTS = [
  { name: 'HEADLESS-1', width: 1920, height: 1080 },
  { name: 'HEADLESS-2', width: 1280, height: 800 },
]
export const SESSION_READY_MS = 30_000
export const CLIENT_READY_MS = 15_000

/**
The harness's Hyprland Lua config: the headless outputs at their sizes,
every other output disabled, no logo, splash, wallpaper, animations or
effects (software rendering stays boring). CP's generated product config
is a different file; this one exists only to hold scenes still.
*/
export function hyprlandConfig(outputs) {
  const monitors = outputs
    .map(
      (output) =>
        `hl.monitor({ output = "${output.name}", mode = "${String(output.width)}x${String(output.height)}@60", position = "auto", scale = 1 })`,
    )
    .join('\n')
  return `-- Muse Desktop QA harness session (generated; not the product config).
${monitors}
hl.monitor({ output = "", disabled = true })
hl.config({
  animations = { enabled = false },
  debug = { enable_stdout_logs = true },
  decoration = { rounding = 0, shadow = { enabled = false }, blur = { enabled = false } },
  general = { gaps_in = 4, gaps_out = 8, border_size = 1, layout = "dwindle" },
  misc = { disable_hyprland_logo = true, force_default_wallpaper = 0 },
})
`
}

/** Runs `Hyprland --verify-config`; true only when it prints `config ok`. */
export async function verifyHyprlandConfig({ hyprland, configFile, runtimeDir, env }) {
  const result = await runCapture(hyprland, ['-c', configFile, '--verify-config'], {
    env: { ...env, XDG_RUNTIME_DIR: runtimeDir },
    timeoutMs: 15_000,
  })
  const output = `${result.stdout}\n${result.stderr}`
  return { isOk: output.includes('config ok'), output: output.trim() }
}

async function waylandSockets(runtimeDir) {
  const names = await readdir(runtimeDir)
  return names
    .filter((name) => /^wayland-\d+$/.test(name))
    .toSorted((a, b) => a.localeCompare(b, 'en'))
}

async function instanceSignatures(runtimeDir) {
  try {
    return await readdir(path.join(runtimeDir, 'hypr'))
  } catch (error) {
    if (error instanceof Error && error.code === 'ENOENT') return []
    throw error
  }
}

/**
Starts one harness compositor session in `workDir` (created; the caller
owns removing it). `stop()` on the result ends Hyprland and its group.
*/
export async function startCompositorSession({
  workDir,
  outputs = DEFAULT_OUTPUTS,
  hyprland: hyprlandCommand = 'Hyprland',
  hyprctl: hyprctlCommand = 'hyprctl',
  grim: grimCommand = 'grim',
  nestDisplay,
  driDir = '/dev/dri',
  readyTimeoutMs = SESSION_READY_MS,
  env: parentEnv = process.env,
}) {
  const hyprland = await findExecutable(hyprlandCommand, parentEnv)
  const hyprctl = await findExecutable(hyprctlCommand, parentEnv)
  const grim = await findExecutable(grimCommand, parentEnv)
  const missing = [
    ['Hyprland', hyprland],
    ['hyprctl', hyprctl],
    ['grim', grim],
  ]
    .filter(([, found]) => found === undefined)
    .map(([name]) => name)
  if (missing.length > 0) {
    throw new Error(
      `the compositor session cannot start: ${missing.join(', ')} not found on PATH (run \`desktop-harness check\`)`,
    )
  }
  const kmsDevices = await findKmsDevices(driDir)
  if (
    nestDisplay === undefined &&
    parentEnv.AQ_DRM_DEVICES === undefined &&
    kmsDevices.length === 0
  ) {
    throw new Error(
      `the compositor session cannot start: no KMS device under ${driDir} and no parent Wayland display to nest in. Aquamarine takes its buffer allocator from a DRM device, so run inside a virtio-gpu VM (scripts/qemu-desktop-test.mjs), on a machine with a GPU or vkms device, or pass a parent display.`,
    )
  }

  const runtimeDir = path.join(workDir, 'runtime')
  const homeDir = path.join(workDir, 'home')
  await mkdir(runtimeDir, { recursive: true, mode: 0o700 })
  await mkdir(homeDir, { recursive: true })
  const configFile = path.join(workDir, 'hyprland.lua')
  await writeFile(configFile, hyprlandConfig(outputs))

  const env = { ...parentEnv }
  delete env.HYPRLAND_INSTANCE_SIGNATURE
  env.XDG_RUNTIME_DIR = runtimeDir
  env.HOME = homeDir
  env.LIBGL_ALWAYS_SOFTWARE = '1'
  env.GALLIUM_DRIVER = 'llvmpipe'
  env.HYPRLAND_NO_CRASHREPORTER = '1'
  env.HYPRLAND_NO_SD_VARS = '1'
  if (nestDisplay === undefined) {
    delete env.WAYLAND_DISPLAY
  } else {
    env.WAYLAND_DISPLAY = nestDisplay
  }

  const verified = await verifyHyprlandConfig({ hyprland, configFile, runtimeDir, env })
  if (!verified.isOk) {
    throw new Error(`the generated Hyprland config does not verify:\n${verified.output}`)
  }

  const logStream = createWriteStream(path.join(workDir, 'hyprland.log'))
  const child = spawn(hyprland, ['-c', configFile], {
    env,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stdout.pipe(logStream)
  child.stderr.pipe(logStream)
  let exitInfo
  child.once('close', (code, signal) => {
    exitInfo = { code, signal }
    logStream.end()
  })

  const session = { workDir, runtimeDir, outputs, child }
  const fail = async (error) => {
    try {
      await stopProcessGroup(child)
    } catch {
      // Already failing with the startup error; the log tail below says more.
    }
    let log = ''
    try {
      log = await readFile(path.join(workDir, 'hyprland.log'), 'utf8')
    } catch {
      // No log was written; the startup error stands alone.
    }
    const tail = log.split('\n').slice(-20).join('\n').trim()
    throw new Error(`${error.message}\nHyprland log (last lines):\n${tail}`, { cause: error })
  }

  let signature
  try {
    signature = await waitFor(
      async () => {
        if (exitInfo !== undefined) {
          throw new Error(
            `Hyprland exited during startup (code ${String(exitInfo.code)}, signal ${String(exitInfo.signal)})`,
          )
        }
        const signatures = await instanceSignatures(runtimeDir)
        return signatures[0]
      },
      { timeoutMs: readyTimeoutMs, description: 'the Hyprland instance signature' },
    )
  } catch (error) {
    return fail(error)
  }

  const ctlEnv = { ...env, HYPRLAND_INSTANCE_SIGNATURE: signature }
  session.signature = signature
  session.hyprctl = async (args, { timeoutMs = 10_000 } = {}) => {
    const result = await runCapture(hyprctl, args, { env: ctlEnv, timeoutMs })
    if (result.code !== 0) {
      throw new Error(
        `hyprctl ${args.join(' ')} failed (exit ${String(result.code)}): ${result.stdout.trim()} ${result.stderr.trim()}`.trim(),
      )
    }
    return result.stdout
  }
  session.monitors = async () => JSON.parse(await session.hyprctl(['monitors', '-j']))
  session.clients = async () => JSON.parse(await session.hyprctl(['clients', '-j']))

  try {
    await waitFor(
      async () => {
        try {
          await session.monitors()
          return true
        } catch {
          return false
        }
      },
      { timeoutMs: readyTimeoutMs, description: 'hyprctl answering monitors' },
    )
    for (const output of outputs) {
      await session.hyprctl(['output', 'create', 'headless', output.name])
    }
    await waitFor(
      async () => {
        const monitors = await session.monitors()
        return outputs.every((output) =>
          monitors.some(
            (monitor) =>
              monitor.name === output.name &&
              monitor.width === output.width &&
              monitor.height === output.height,
          ),
        )
      },
      { timeoutMs: readyTimeoutMs, description: 'the headless outputs at their sizes' },
    )
    const sockets = await waylandSockets(runtimeDir)
    session.waylandDisplay = sockets.find((name) => name !== nestDisplay) ?? sockets[0]
    if (session.waylandDisplay === undefined) {
      throw new Error('Hyprland started without a Wayland socket in its runtime directory')
    }
  } catch (error) {
    return fail(error)
  }

  session.clientEnv = (extra = {}) => ({
    ...parentEnv,
    ...extra,
    XDG_RUNTIME_DIR: runtimeDir,
    WAYLAND_DISPLAY: session.waylandDisplay,
    HYPRLAND_INSTANCE_SIGNATURE: signature,
  })
  session.screenshot = async (outputName, file) => {
    const result = await runCapture(grim, ['-o', outputName, file], {
      env: session.clientEnv(),
      timeoutMs: 15_000,
    })
    if (result.code !== 0) {
      throw new Error(
        `grim could not capture ${outputName}: ${result.stderr.trim() || result.stdout.trim()}`,
      )
    }
    return file
  }
  let isStopped = false
  session.stop = async () => {
    if (isStopped) return
    isStopped = true
    try {
      await session.hyprctl(['dispatch', 'exit'], { timeoutMs: 3000 })
    } catch {
      // Hyprland may already be gone; the group stop below is the guarantee.
    }
    await stopProcessGroup(child)
  }
  return session
}

/**
Runs one scene client in the session: waits for its window, lets it
settle, captures the named output, then stops the client group.
*/
export async function runSceneClient(
  session,
  command,
  args,
  {
    output,
    screenshotFile,
    env,
    readyTimeoutMs = CLIENT_READY_MS,
    settleMs = 500,
    beforeScreenshot,
  },
) {
  const before = await session.clients()
  const child = spawn(command, args, {
    env: session.clientEnv(env),
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let clientLog = ''
  child.stdout.on('data', (chunk) => {
    clientLog += chunk
  })
  child.stderr.on('data', (chunk) => {
    clientLog += chunk
  })
  try {
    const clients = await waitFor(
      async () => {
        if (child.exitCode !== null) {
          throw new Error(
            `the scene client exited (code ${String(child.exitCode)}) before opening a window: ${clientLog.trim()}`,
          )
        }
        const now = await session.clients()
        return now.length > before.length ? now : false
      },
      { timeoutMs: readyTimeoutMs, description: 'the scene client window' },
    )
    await sleep(settleMs)
    if (beforeScreenshot !== undefined) await beforeScreenshot()
    await session.screenshot(output, screenshotFile)
    return { clients, screenshot: screenshotFile }
  } finally {
    await stopProcessGroup(child)
  }
}
