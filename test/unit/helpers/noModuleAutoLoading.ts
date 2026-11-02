// M51's proof for a PowerShell script that must name no cmdlet: with module
// auto-loading off, a cmdlet not yet loaded is simply not recognized, so neither
// a clock nor a heavy module folder is needed to see one. On a machine with large
// modules and no analysis cache reached, that cmdlet is what would cost 20 s and
// more (docs/certification/cc-winfix2.md).
import process from 'node:process'
import { windowsPowerShell } from '../../../src/core/execGuard'
import { runProgram } from '../../../src/host/processTree'

/** The script's stdout from the shared 5.1 launch; any failure rejects. */
export async function withoutModuleAutoLoading(script: string): Promise<string> {
  const { file, env } = windowsPowerShell(process.env['SystemRoot'] ?? '')
  return await runProgram(
    file,
    [
      '-NoProfile',
      '-NonInteractive',
      '-EncodedCommand',
      Buffer.from(
        `$PSModuleAutoLoadingPreference = 'None'; $ErrorActionPreference = 'Stop'\n${script}`,
        'utf16le',
      ).toString('base64'),
    ],
    env,
  )
}
