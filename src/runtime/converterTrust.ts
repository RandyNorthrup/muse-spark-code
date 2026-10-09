// M105 lane V, seam 3: the media converter's shared TrustedPathVerifier for
// this OS. POSIX uses REDM104L3's StrictModes walk (`trustedPath.ts`, with
// its additive executable-file mode); Windows uses the owner/ACL/reparse
// verifier (`windowsTrustedPath.ts`) on the canonical target, so a winget
// link or a relocated profile folder is judged by what it resolves to, on
// any drive. PowerShell comes from %SystemRoot%, never a PATH lookup.
import { execFile } from 'node:child_process'
import { realpath } from 'node:fs/promises'
import path from 'node:path'
import { MEDIA_CONVERTER_TRUST_TIMEOUT_MS } from '../shared/constants'
import { withoutCredentials } from './credentialVariables'
import { posixTrustedPathVerifier } from './trustedPath'
import type { TrustedPathVerifier } from './trustedPathPort'
import { windowsTrustedPathVerifier } from './windowsTrustedPath'

/** `%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe`, or undefined. */
function systemPowerShell(env: NodeJS.ProcessEnv): string | undefined {
  const root = Object.entries(env).find(([name]) => name.toUpperCase() === 'SYSTEMROOT')?.[1]
  return root === undefined || !path.win32.isAbsolute(root) || /\p{Cc}/u.test(root)
    ? undefined
    : path.win32.join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
}

export function converterTrustedPath(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): TrustedPathVerifier {
  if (platform !== 'win32') return posixTrustedPathVerifier()
  const windows = windowsTrustedPathVerifier((file, args) => {
    const program = file === 'powershell.exe' ? systemPowerShell(env) : undefined
    if (program === undefined) return Promise.resolve({ exitCode: 1, stdout: '' })
    return new Promise((resolve) => {
      execFile(
        program,
        [...args],
        {
          env: withoutCredentials(env),
          windowsHide: true,
          timeout: MEDIA_CONVERTER_TRUST_TIMEOUT_MS,
        },
        (error, stdout) => {
          resolve({ exitCode: error === null ? 0 : 1, stdout })
        },
      )
    })
  })
  return {
    verify: async (file, options) => {
      let canonical: string
      try {
        canonical = await realpath(file)
      } catch {
        return { refused: true, component: file, reason: 'path unavailable' }
      }
      return await windows.verify(canonical, options)
    },
  }
}
