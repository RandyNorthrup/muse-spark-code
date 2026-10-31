// What the desktop harness drives on a machine, and how it finds out
// whether it is there: real executables on PATH with their real version
// output, never an assumed version. `desktop-harness check` prints this.

import { constants } from 'node:fs'
import { access, readdir } from 'node:fs/promises'
import path from 'node:path'
import { runCapture } from './proc.mjs'

export const TOOLS = [
  { name: 'Hyprland', command: 'Hyprland', versionArgs: ['--version'] },
  { name: 'hyprctl', command: 'hyprctl', versionArgs: undefined },
  { name: 'grim', command: 'grim', versionArgs: undefined },
  { name: 'dbus-daemon', command: 'dbus-daemon', versionArgs: ['--version'] },
  { name: 'python3', command: 'python3', versionArgs: ['--version'] },
  { name: 'qemu-system-x86_64', command: 'qemu-system-x86_64', versionArgs: ['--version'] },
  { name: 'qemu-system-aarch64', command: 'qemu-system-aarch64', versionArgs: ['--version'] },
  { name: 'swtpm', command: 'swtpm', versionArgs: ['--version'] },
  { name: 'cargo', command: 'cargo', versionArgs: ['--version'] },
  { name: 'node', command: 'node', versionArgs: ['--version'] },
]

/** The tool names each harness area cannot run without. */
export const TOOL_GROUPS = {
  compositor: ['Hyprland', 'hyprctl', 'grim'],
  scenes: ['node'],
  dbus: ['dbus-daemon', 'python3'],
  electron: ['node'],
  input: ['cargo'],
  qemu: ['swtpm'],
}

/** The absolute path of an executable on PATH, or undefined when absent. */
export async function findExecutable(command, env = process.env) {
  if (command.includes('/')) {
    try {
      await access(command, constants.X_OK)
      return path.resolve(command)
    } catch {
      return undefined
    }
  }
  const dirs = (env.PATH ?? '').split(path.delimiter)
  for (const dir of dirs) {
    if (dir === '') continue
    const candidate = path.join(dir, command)
    try {
      await access(candidate, constants.X_OK)
      return candidate
    } catch {
      // Not in this directory; the search continues down PATH.
    }
  }
  return undefined
}

/** Every known tool as `{ name, command, path, version }` (absent: no path). */
export async function probeTools(env = process.env) {
  const probed = []
  for (const tool of TOOLS) {
    const found = await findExecutable(tool.command, env)
    let version
    if (found !== undefined && tool.versionArgs !== undefined) {
      const result = await runCapture(found, tool.versionArgs, { env, timeoutMs: 5000 })
      const lines = `${result.stdout}\n${result.stderr}`.split('\n')
      version = lines.find((line) => line.trim() !== '')?.trim()
    }
    probed.push({ name: tool.name, command: tool.command, path: found, version })
  }
  return probed
}

/** The tools one group is missing, as their names. Throws for an unknown group. */
export function missingForGroup(probed, group) {
  const needed = TOOL_GROUPS[group]
  if (needed === undefined) {
    throw new Error(`unknown tool group ${group}; known: ${Object.keys(TOOL_GROUPS).join(', ')}`)
  }
  const byName = new Map(probed.map((tool) => [tool.name, tool]))
  return needed.filter((name) => byName.get(name)?.path === undefined)
}

/** KMS devices under a dri directory: card and render node names, [] when none. */
export async function findKmsDevices(driDir = '/dev/dri') {
  let names
  try {
    names = await readdir(driDir)
  } catch (error) {
    if (error instanceof Error && error.code === 'ENOENT') return []
    throw error
  }
  return names
    .filter((name) => /^card\d+$/.test(name) || /^renderD\d+$/.test(name))
    .toSorted((a, b) => a.localeCompare(b, 'en'))
}
