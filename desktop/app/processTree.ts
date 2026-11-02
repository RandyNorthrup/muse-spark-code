// Muse Desktop (M111, D91.13) lane BP: "is a command still running" for the
// terminal's exit question. A running command is a live child of the
// shell's process; a shell alone at its prompt has none. Anything the
// probe cannot tell answers true, so the person is asked instead of
// losing work: the dialog's sentence covers both cases.

import { spawnSync } from 'node:child_process'
import { DESKTOP_PROCESS_TREE_TIMEOUT_MS } from '../../src/shared/constants'

/** The Unix probe: pgrep lists the shell's children, exit 1 when none. */
export function processTreeProbeArgs(pid: number): readonly string[] {
  return ['-P', String(pid)]
}

/** The Windows probe: CIM lists the shell's children, empty when none. */
export function processTreeWindowsScript(pid: number): string {
  return `Get-CimInstance Win32_Process -Filter 'ParentProcessId=${String(pid)}' | Select-Object -ExpandProperty ProcessId`
}

function hasUnixChildren(pid: number): boolean {
  const probed = spawnSync('pgrep', [...processTreeProbeArgs(pid)], {
    encoding: 'utf8',
    timeout: DESKTOP_PROCESS_TREE_TIMEOUT_MS,
  })
  return probed.error !== undefined || probed.status === 0
}

function hasWindowsChildren(pid: number): boolean {
  const probed = spawnSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', processTreeWindowsScript(pid)],
    { encoding: 'utf8', timeout: DESKTOP_PROCESS_TREE_TIMEOUT_MS },
  )
  return probed.error !== undefined || probed.stdout.trim() !== ''
}

/** Whether pid currently has a live child process. Unknown answers true. */
export function hasChildProcesses(pid: number): boolean {
  return process.platform === 'win32' ? hasWindowsChildren(pid) : hasUnixChildren(pid)
}
