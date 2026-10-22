// Where the Muse Code CLI stores its sign-in: `XDG_CONFIG_HOME` honoured
// on every platform (Windows included), else `~/.config`. Split from
// `launch.ts` (C-M95-SUB) so the Model API subscription reader shares the
// per-OS path without the launcher's weight; `launch.ts` re-exports both.
import path from 'node:path'
import { MUSE_CREDENTIAL_FILE_SEGMENTS } from '../../../shared/constants'

export interface CredentialPathInput {
  readonly platform: NodeJS.Platform
  readonly homeDir: string
  readonly xdgConfigHome: string | undefined
}

/**
Where the CLI stores its browser-login credential. The binary honours
`XDG_CONFIG_HOME` on every platform (Windows included) and otherwise uses
`~/.config`; `MUSE_AUTH_PATH` is honoured only by the POSIX launcher, so it
is deliberately not consulted here.
*/
export function credentialFilePath(input: CredentialPathInput): string {
  const p = input.platform === 'win32' ? path.win32 : path.posix
  const configHome = input.xdgConfigHome ?? p.join(input.homeDir, '.config')
  return p.join(configHome, ...MUSE_CREDENTIAL_FILE_SEGMENTS)
}
