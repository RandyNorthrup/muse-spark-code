// The extension's own question before Muse Code's browser check (M81,
// PLAN.md D49): a native modal naming the URL, asked for every call,
// whatever mode Muse Code runs in (its approval covers using the tool; this
// one covers the extension starting a browser on the user's machine). When
// the host is beyond loopback and the user's setting, it says so: allowing
// then widens this one check to that host. Closing it is Reject.

import * as vscode from 'vscode'
import * as z from 'zod/mini'
import type { BrowserCheckScope } from '../../../core/browser/browserTool'
import { BROWSER_DEV_ORIGIN_GRANTS_KEY, UI_TEXT } from '../../../shared/constants'
import { fill } from '../../../shared/l10n/text'
import {
  widenedHost,
  isLoopbackHost,
  isMachineBrowserUrl,
} from '../../../core/browser/browserPolicy'

function requiresOriginConsent(entry: string): boolean {
  return entry.includes('://') && !isLoopbackHost(new URL(entry).hostname)
}

/** Only a user-setting edit can ask; tool calls only read already confirmed origins. */
export function browserDevOrigins(
  state: { get(key: string): unknown; update(key: string, value: unknown): PromiseLike<void> },
  settings: () => readonly string[],
) {
  let revision = 0
  const remembered = () => {
    const parsed = z.array(z.string()).safeParse(state.get(BROWSER_DEV_ORIGIN_GRANTS_KEY))
    return parsed.success ? parsed.data : []
  }
  const configured = () =>
    settings()
      .map((entry) => widenedHost(entry))
      .filter((host) => host !== undefined)
  let grants = remembered()
  let writes = Promise.resolve()
  const save = (entries: readonly string[]) => {
    const snapshot = [...entries]
    const previous = writes
    writes = (async () => {
      await previous
      await state.update(BROWSER_DEV_ORIGIN_GRANTS_KEY, snapshot)
    })()
    return writes
  }
  return {
    read: () =>
      configured().filter(
        (entry) =>
          (!entry.includes('://') || !isMachineBrowserUrl(new URL(entry))) &&
          (!requiresOriginConsent(entry) || grants.includes(entry)),
      ),
    async change(): Promise<void> {
      revision += 1
      const current = revision
      const entries = configured()
      const confirmed = grants.filter((entry) => entries.includes(entry))
      grants = confirmed
      await save(confirmed)
      for (const origin of entries) {
        if (current !== revision) return
        if (
          !requiresOriginConsent(origin) ||
          confirmed.includes(origin) ||
          isMachineBrowserUrl(new URL(origin))
        )
          continue
        const allow: vscode.MessageItem = { title: UI_TEXT.browserDevOriginAllow }
        const reject: vscode.MessageItem = { title: UI_TEXT.reject, isCloseAffordance: true }
        const answer = await vscode.window.showWarningMessage(
          fill(UI_TEXT.browserDevOriginConsent, { origin }),
          { modal: true },
          allow,
          reject,
        )
        if (current !== revision) return
        if (answer !== allow || !configured().includes(origin)) continue
        confirmed.push(origin)
        await save(confirmed)
      }
    },
  }
}

export async function isBrowserCheckAllowed(
  url: string,
  { widenedHost }: BrowserCheckScope,
): Promise<boolean> {
  const allow: vscode.MessageItem = { title: UI_TEXT.allowOnce }
  const reject: vscode.MessageItem = { title: UI_TEXT.reject, isCloseAffordance: true }
  const detail =
    widenedHost === undefined
      ? UI_TEXT.browserCheckConfirmDetail
      : `${fill(UI_TEXT.browserCheckConfirmDetailWiden, { host: widenedHost })}\n\n${UI_TEXT.browserCheckConfirmDetail}`
  const answer = await vscode.window.showWarningMessage(
    fill(UI_TEXT.browserCheckConfirmTitle, { url }),
    { modal: true, detail },
    allow,
    reject,
  )
  return answer === allow
}
