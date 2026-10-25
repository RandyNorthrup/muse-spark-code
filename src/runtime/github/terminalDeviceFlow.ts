// The terminal's GitHub device-flow source: the code and GitHub's address
// print here; the token never does. Silent reads never present. Shared by
// `auth github` and the watchdog's signed-in surface.
import { setTimeout as nodeSleep } from 'node:timers/promises'
import type { SecretStore } from '../../host/auth/credentialStore'
import { UI_TEXT, fill } from '../../shared/l10n/text'
import { deviceFlowSource, type DeviceFlowSource } from './deviceFlowSource'

function writeLine(stream: NodeJS.WriteStream, line: string): void {
  stream.write(`${line}\n`)
}

export function terminalGitHubDeviceFlow(
  network: typeof globalThis.fetch,
  secrets: SecretStore,
): DeviceFlowSource {
  return deviceFlowSource({
    store: secrets,
    flow: {
      fetch: network,
      now: Date.now,
      sleep: (ms, signal) => nodeSleep(ms, undefined, { signal }),
    },
    present: (prompt) => {
      writeLine(
        process.stdout,
        fill(UI_TEXT.githubSignIn.code, {
          url: prompt.verificationUri,
          code: prompt.userCode,
        }),
      )
      return Promise.resolve()
    },
    openExternal: (url) => {
      writeLine(process.stdout, fill(UI_TEXT.githubSignIn.signedOut, { url }))
      return Promise.resolve()
    },
    fetch: network,
  })
}
