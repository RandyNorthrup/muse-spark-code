// The harness's private D-Bus session bus (M111 lane QA): a throwaway
// dbus-daemon on an abstract socket with a generated policy, the
// harness-owned canary endpoints from test/desktop/harness/dbus/, and a
// stop that ends the whole tree. Test-only: nothing on this bus pretends
// to be a system service, and the daemon's socket dies with the process.

import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { runCapture, stopProcessGroup, waitFor } from './proc.mjs'
import { findExecutable } from './tools.mjs'

export const BUS_READY_MS = 10_000

const HARNESS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
export const BUS_SERVICES = {
  canary: {
    script: path.join(HARNESS_DIR, 'dbus/canary.py'),
    busName: 'org.muse.TestHarness.Canary1',
  },
  notifications: {
    script: path.join(HARNESS_DIR, 'dbus/notifications.py'),
    busName: 'org.freedesktop.Notifications',
  },
}

/**
The generated bus policy. AppArmor confinement checks are off because a
private harness bus has no confined peers to check (the query also fails
outright where /sys/kernel/security is read-only). `extraPolicy` is how a
drill adds a deny rule and watches a service lose its name.
*/
export function busConfig({ socketName, extraPolicy = '' }) {
  return `<!DOCTYPE busconfig PUBLIC "-//freedesktop//DTD D-Bus Bus Configuration 1.0//EN" "https://www.freedesktop.org/standards/dbus/1.0/busconfig.dtd">
<busconfig>
  <type>session</type>
  <apparmor mode="disabled"/>
  <listen>unix:abstract=${socketName}</listen>
  <policy context="default">
    <allow user="*"/>
    <allow own="*"/>
    <allow send_destination="*" eavesdrop="true"/>
    <allow eavesdrop="true"/>
${extraPolicy}  </policy>
</busconfig>
`
}

async function readFirstLine(child, description, timeoutMs) {
  return waitFor(
    () =>
      new Promise((resolve) => {
        if (child.exitCode !== null) {
          throw new Error(`${description} exited with code ${String(child.exitCode)}`)
        }
        const lines = child.capturedStdout.split('\n')
        resolve(lines.find((line) => line.trim() !== '') ?? false)
      }),
    { timeoutMs, intervalMs: 25, description },
  )
}

async function stopQuietly(child) {
  try {
    await stopProcessGroup(child)
  } catch {
    // The startup error being reported matters more than a teardown race.
  }
}

function pipedChild(command, args, env, logFile) {
  const child = spawn(command, args, { env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] })
  child.capturedStdout = ''
  child.stdout.setEncoding('utf8')
  child.stdout.on('data', (chunk) => {
    child.capturedStdout += chunk
  })
  if (logFile !== undefined) {
    child.stderr.pipe(createWriteStream(logFile))
  }
  return child
}

/**
Starts the private bus and the named services (`canary`, `notifications`).
Records land in `workDir/<service>.jsonl`. `stop()` ends services and
daemon. Refuses by name when a tool is missing or a service cannot own
its bus name under the policy.
*/
export async function startTestBus({
  workDir,
  services = Object.keys(BUS_SERVICES),
  extraPolicy,
  python3: pythonCommand = 'python3',
  dbusDaemon: daemonCommand = 'dbus-daemon',
  readyTimeoutMs = BUS_READY_MS,
  env: parentEnv = process.env,
}) {
  const dbusDaemon = await findExecutable(daemonCommand, parentEnv)
  const python3 = await findExecutable(pythonCommand, parentEnv)
  const missing = [
    ['dbus-daemon', dbusDaemon],
    ['python3', python3],
  ]
    .filter(([, found]) => found === undefined)
    .map(([name]) => name)
  if (missing.length > 0) {
    throw new Error(
      `the test bus cannot start: ${missing.join(', ')} not found on PATH (run \`desktop-harness check --for dbus\`)`,
    )
  }
  for (const name of services) {
    if (BUS_SERVICES[name] === undefined) {
      throw new Error(
        `unknown test-bus service ${name}; known: ${Object.keys(BUS_SERVICES).join(', ')}`,
      )
    }
  }
  await mkdir(workDir, { recursive: true })
  const socketName = `/tmp/muse-harness-${randomUUID().slice(0, 8)}`
  const configFile = path.join(workDir, 'bus.conf')
  await writeFile(configFile, busConfig({ socketName, extraPolicy }))

  const daemon = pipedChild(
    dbusDaemon,
    [`--config-file=${configFile}`, '--nofork', '--print-address=1'],
    parentEnv,
    path.join(workDir, 'dbus-daemon.log'),
  )
  const serviceChildren = []
  try {
    const addressLine = await readFirstLine(daemon, 'dbus-daemon', readyTimeoutMs)
    const address = addressLine.trim()
    const env = { ...parentEnv, DBUS_SESSION_BUS_ADDRESS: address }
    for (const name of services) {
      const service = BUS_SERVICES[name]
      const recordFile = path.join(workDir, `${name}.jsonl`)
      const child = pipedChild(
        python3,
        [service.script],
        { ...env, MUSE_HARNESS_RECORD: recordFile },
        path.join(workDir, `${name}.log`),
      )
      serviceChildren.push({ name, child, recordFile })
      await waitFor(
        () => {
          if (child.capturedStdout.includes(`READY ${service.busName}`)) return true
          if (child.capturedStdout.includes(`LOST ${service.busName}`)) {
            throw new Error(
              `the ${name} service could not own ${service.busName} under the bus policy`,
            )
          }
          if (child.exitCode !== null) {
            throw new Error(
              `the ${name} service exited with code ${String(child.exitCode)} before owning ${service.busName} (log: ${path.join(workDir, `${name}.log`)})`,
            )
          }
          return false
        },
        {
          timeoutMs: readyTimeoutMs,
          intervalMs: 25,
          description: `${name} owning ${service.busName}`,
        },
      )
    }
    let isStopped = false
    return {
      address,
      workDir,
      daemonPid: daemon.pid,
      services: serviceChildren,
      env: (extra = {}) => ({ ...env, ...extra }),
      stop: async () => {
        if (isStopped) return
        isStopped = true
        for (const { child } of serviceChildren) await stopProcessGroup(child)
        await stopProcessGroup(daemon)
      },
    }
  } catch (error) {
    for (const { child } of serviceChildren) await stopQuietly(child)
    await stopQuietly(daemon)
    throw error
  }
}

/**
One real method call through gdbus (arguments are GVariant text, as gdbus
takes them). Throws with gdbus's error text on a failed call.
*/
export async function callBus(bus, { destination, objectPath, method, args = [], env }) {
  const result = await runCapture(
    'gdbus',
    [
      'call',
      '--session',
      '--dest',
      destination,
      '--object-path',
      objectPath,
      '--method',
      method,
      ...args,
    ],
    { env: bus.env(env), timeoutMs: BUS_READY_MS },
  )
  if (result.code !== 0) {
    throw new Error(
      `gdbus call ${method} failed (exit ${String(result.code)}): ${(result.stderr || result.stdout).trim()}`,
    )
  }
  return result.stdout.trim()
}
