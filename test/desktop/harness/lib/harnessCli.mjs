// The desktop-harness command line (scripts/desktop-harness.mjs): check
// the machine, list and serve the scenes, take one review shot, or run one
// compositor session end to end. Parsing and dispatch live here so the
// script stays a thin entry and the tests drive the same code.

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { findChrome } from '../../../../scripts/lib/chrome.mjs'
import {
  DEFAULT_OUTPUTS,
  hyprlandConfig,
  runSceneClient,
  startCompositorSession,
  verifyHyprlandConfig,
} from './compositor.mjs'
import { captureReviewShots } from './reviewShots.mjs'
import { DESKTOP_SCENES, desktopScene } from './scenes.mjs'
import { serveDesktopScenes } from './sceneServer.mjs'
import {
  TOOL_GROUPS,
  findExecutable,
  findKmsDevices,
  missingForGroup,
  probeTools,
} from './tools.mjs'

export const HARNESS_USAGE = `Usage: desktop-harness <command> [options]

  check [--for compositor|scenes|dbus|electron|input|qemu] [--json]
      Report every tool the harness drives; exit 1 when the group cannot run.
  scenes [--json]
      List the desktop scenes and their capture sizes.
  serve
      Serve the scenes on loopback until interrupted (for a manual look).
  shot <scene> [--theme dark|light|hc-dark|hc-light] [--lang en] [--out dir]
      Capture one review screenshot with Chrome. Never compared by a test.
  session --out <dir> [--outputs HEADLESS-1:1920x1080,HEADLESS-2:1280x800]
          [--nest-display wayland-0] [-- <client command...>]
      Start headless Hyprland on llvmpipe, create the outputs, run the
      client, screenshot every output into <dir>, stop everything.
  verify-config [--out file] [--outputs ...]
      Write the generated harness config and check it with
      Hyprland --verify-config (the same gate CP's product config passes).

Options after -- belong to the client command. Timeouts are operational
bounds for a test rig (session ready 30 s, client window 15 s by default);
--ready-ms and --client-ms change them.`

const OUTPUT_SPEC = /^([A-Za-z0-9-]+):(\d+)x(\d+)$/

function parseOutputs(value) {
  return value.split(',').map((spec) => {
    const match = OUTPUT_SPEC.exec(spec.trim())
    if (match === null) {
      throw new Error(`--outputs needs NAME:WIDTHxHEIGHT entries, got ${spec}`)
    }
    return { name: match[1], width: Number(match[2]), height: Number(match[3]) }
  })
}

function takeValue(argv, index, flag) {
  const value = argv[index + 1]
  if (value === undefined || value.startsWith('--')) {
    throw new Error(`${flag} needs a value\n${HARNESS_USAGE}`)
  }
  return value
}

function applyFlag(options, rest, index) {
  const arg = rest[index]
  switch (arg) {
    case '--json': {
      options.isJson = true
      return index
    }
    case '--for': {
      options.forGroup = takeValue(rest, index, arg)
      return index + 1
    }
    case '--out': {
      options.out = takeValue(rest, index, arg)
      return index + 1
    }
    case '--theme': {
      options.theme = takeValue(rest, index, arg)
      return index + 1
    }
    case '--lang': {
      options.lang = takeValue(rest, index, arg)
      return index + 1
    }
    case '--outputs': {
      options.outputs = parseOutputs(takeValue(rest, index, arg))
      return index + 1
    }
    case '--nest-display': {
      options.nestDisplay = takeValue(rest, index, arg)
      return index + 1
    }
    case '--ready-ms': {
      options.readyMs = Number(takeValue(rest, index, arg))
      return index + 1
    }
    case '--client-ms': {
      options.clientMs = Number(takeValue(rest, index, arg))
      return index + 1
    }
    default: {
      throw new Error(`unknown option ${arg}\n${HARNESS_USAGE}`)
    }
  }
}

/** Parses the harness's arguments; throws with usage on anything unknown. */
export function parseHarnessArgs(argv) {
  const [command, ...rest] = argv
  if (command === undefined || ['--help', '-h'].includes(command)) {
    return { command: 'help' }
  }
  const options = { command }
  const free = []
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index]
    if (arg === '--') {
      options.client = rest.slice(index + 1)
      break
    }
    if (arg.startsWith('--')) {
      index = applyFlag(options, rest, index)
    } else {
      free.push(arg)
    }
  }
  options.free = free
  return options
}

async function runCheck(options, { log, env }) {
  const group = options.forGroup ?? 'compositor'
  if (TOOL_GROUPS[group] === undefined) {
    throw new Error(`unknown tool group ${group}; known: ${Object.keys(TOOL_GROUPS).join(', ')}`)
  }
  const [tools, kmsDevices] = await Promise.all([probeTools(env), findKmsDevices()])
  const missing = missingForGroup(tools, group)
  if (options.isJson === true) {
    log(JSON.stringify({ tools, kmsDevices, group, missing }, null, 2))
  } else {
    for (const tool of tools) {
      const where = tool.path ?? 'MISSING'
      const version = tool.version === undefined ? '' : ` · ${tool.version}`
      log(`${tool.name}: ${where}${version}`)
    }
    log(`KMS devices: ${kmsDevices.length === 0 ? 'none' : kmsDevices.join(', ')}`)
    log(
      missing.length === 0
        ? `${group}: ready`
        : `${group}: cannot run, missing ${missing.join(', ')}`,
    )
  }
  return missing.length === 0 ? 0 : 1
}

function runScenes(options, { log }) {
  if (options.isJson === true) {
    log(JSON.stringify({ scenes: DESKTOP_SCENES }, null, 2))
  } else {
    for (const scene of DESKTOP_SCENES) {
      log(`${scene.id} · ${scene.sheet} · ${String(scene.width)}x${String(scene.height)}`)
    }
  }
  return 0
}

async function runServe(options, { repoRoot, log }) {
  const { server, port } = await serveDesktopScenes(repoRoot)
  log(`desktop scenes at http://127.0.0.1:${String(port)}/desktop-scene/greeter`)
  await new Promise((resolve) => {
    process.once('SIGINT', resolve)
    process.once('SIGTERM', resolve)
  })
  server.close()
  return 0
}

async function runShot(options, { repoRoot, log }) {
  const [sceneId] = options.free
  if (sceneId === undefined) throw new Error(`shot needs a scene name\n${HARNESS_USAGE}`)
  desktopScene(sceneId)
  const chrome = findChrome()
  if (chrome === undefined) {
    throw new Error('No Chrome install found; set CHROME_PATH to the browser executable')
  }
  const plan = {
    scenes: [sceneId],
    themes: [options.theme ?? 'dark'],
    languages: [options.lang ?? 'en'],
  }
  const { server, port } = await serveDesktopScenes(repoRoot)
  try {
    const outDir = path.resolve(repoRoot, options.out ?? 'temp/desktop-review')
    const written = await captureReviewShots(repoRoot, chrome, port, plan, outDir)
    for (const file of written) log(`desktop review: ${path.relative(repoRoot, file)}`)
  } finally {
    server.close()
  }
  return 0
}

async function runSession(options, { repoRoot, log, env }) {
  if (options.out === undefined) {
    throw new Error(`session needs --out <dir>\n${HARNESS_USAGE}`)
  }
  const outDir = path.resolve(repoRoot, options.out)
  await mkdir(outDir, { recursive: true })
  const outputs = options.outputs ?? DEFAULT_OUTPUTS
  const session = await startCompositorSession({
    workDir: path.join(outDir, 'session-state'),
    outputs,
    nestDisplay: options.nestDisplay,
    readyTimeoutMs: options.readyMs,
    env,
  })
  try {
    const first = outputs[0]
    let summary = { monitors: await session.monitors(), clients: [], screenshots: [] }
    if (options.client !== undefined && options.client.length > 0) {
      const [command, ...args] = options.client
      const shot = path.join(outDir, `${first.name}.png`)
      const ran = await runSceneClient(session, command, args, {
        output: first.name,
        screenshotFile: shot,
        readyTimeoutMs: options.clientMs,
      })
      summary = { ...summary, clients: ran.clients, screenshots: [shot] }
      log(`client ${command}: ${path.relative(repoRoot, shot)}`)
    } else {
      for (const output of outputs) {
        const shot = path.join(outDir, `${output.name}.png`)
        await session.screenshot(output.name, shot)
        summary.screenshots.push(shot)
        log(`empty desktop ${output.name}: ${path.relative(repoRoot, shot)}`)
      }
      summary.clients = await session.clients()
    }
    summary.monitors = await session.monitors()
    await writeFile(path.join(outDir, 'session.json'), `${JSON.stringify(summary, null, 2)}\n`)
    log(`session summary: ${path.relative(repoRoot, path.join(outDir, 'session.json'))}`)
  } finally {
    await session.stop()
  }
  return 0
}

async function runVerifyConfig(options, { repoRoot, log, env }) {
  const hyprland = await findExecutable('Hyprland', env)
  if (hyprland === undefined) {
    throw new Error('verify-config cannot run: Hyprland not found on PATH')
  }
  const file = path.resolve(repoRoot, options.out ?? 'temp/desktop-harness/hyprland.lua')
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, hyprlandConfig(options.outputs ?? DEFAULT_OUTPUTS))
  const runtimeDir = await mkdtemp(path.join(tmpdir(), 'muse-desktop-verify-'))
  let verified
  try {
    verified = await verifyHyprlandConfig({ hyprland, configFile: file, runtimeDir, env })
  } finally {
    await rm(runtimeDir, { recursive: true, force: true })
  }
  log(verified.output)
  log(`config: ${path.relative(repoRoot, file)}`)
  return verified.isOk ? 0 : 1
}

/** Runs one harness command; resolves with its process exit code. */
export async function runHarnessCli(argv, { repoRoot, log = console.log, env = process.env }) {
  const options = parseHarnessArgs(argv)
  const context = { repoRoot, log, env }
  switch (options.command) {
    case 'help': {
      log(HARNESS_USAGE)
      return 0
    }
    case 'check': {
      return runCheck(options, context)
    }
    case 'scenes': {
      return runScenes(options, context)
    }
    case 'serve': {
      return runServe(options, context)
    }
    case 'shot': {
      return runShot(options, context)
    }
    case 'session': {
      return runSession(options, context)
    }
    case 'verify-config': {
      return runVerifyConfig(options, context)
    }
    default: {
      throw new Error(`unknown command ${options.command}\n${HARNESS_USAGE}`)
    }
  }
}
