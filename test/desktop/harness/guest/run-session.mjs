#!/usr/bin/env node
// Runs ONE harness compositor session inside a desktop guest (M111 lane
// QA): Hyprland on the guest's virtio-gpu with llvmpipe, a foot terminal
// as the scene client, the virtual-input driver typing into it, and grim
// screenshots of both headless outputs. Prints the marker
// M111QA-SESSION-OK on success (and to /dev/console, where the host's
// QEMU runner watches the serial line). Talks only to the harness libs
// placed beside it on the share disk — no node_modules in the guest.

import { appendFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const share = process.env.MUSE_HARNESS_SHARE ?? here
const { runSceneClient, startCompositorSession } = await import(
  path.join(share, 'lib/compositor.mjs')
)
const { runVirtualInputScript } = await import(path.join(share, 'lib/virtualInput.mjs'))

const outDir = path.join(share, 'session-out')
const marker = 'M111QA-SESSION-OK'

async function announce(line) {
  console.log(line)
  try {
    await appendFile('/dev/console', `${line}\n`)
  } catch {
    // The serial marker is an optimisation for the host; files in
    // session-out on the share are the record either way.
  }
}

try {
  const session = await startCompositorSession({
    workDir: path.join(outDir, 'state'),
    readyTimeoutMs: 120_000,
  })
  try {
    const monitors = await session.monitors()
    await announce(
      `monitors: ${monitors.map((m) => `${m.name} ${m.width}x${m.height}`).join(', ')}`,
    )
    const first = session.outputs[0]
    const ran = await runSceneClient(session, 'foot', ['sh', '-c', 'echo ready; sleep 60'], {
      output: first.name,
      screenshotFile: path.join(outDir, 'guest-headless-1.png'),
      readyTimeoutMs: 60_000,
      settleMs: 1000,
      beforeScreenshot: async () => {
        const driven = await runVirtualInputScript(path.join(share, 'muse-virtual-input'), {
          env: session.clientEnv(),
          script: 'text echo typed-by-virtual-input\nkey enter tap\nsleep 400\n',
          timeoutMs: 60_000,
        })
        await announce(`virtual input acknowledged: ${String(driven.acknowledged)}`)
      },
    })
    await session.screenshot(session.outputs[1].name, path.join(outDir, 'guest-headless-2.png'))
    await announce(`clients: ${ran.clients.map((c) => c.class ?? c.title ?? 'window').join(', ')}`)
    await announce(marker)
  } finally {
    await session.stop()
  }
} catch (error) {
  await announce(`M111QA-SESSION-FAIL ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
}
