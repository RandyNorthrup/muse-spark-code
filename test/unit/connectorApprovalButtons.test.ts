// M124 approval page (Codex on PR #227): the real page runs its shipped
// script in a real DOM (jsdom executes it), against the real loopback page
// server over real HTTP. A double-click, or Approve-then-Deny before the
// stream refreshes, must send exactly one decision; a decision the server
// refuses must leave the row usable again.
import { JSDOM } from 'jsdom'
import { setTimeout as sleep } from 'node:timers/promises'
import { describe, expect, it } from 'vitest'
import { startApprovalPage } from '../../src/runtime/connector/approvalPage'
import { EN } from '../../src/shared/l10n/en'
import type { ConnectorIntentView } from '../../src/shared/connector'
import { connectorCall, connectorHeaders, connectorLogin } from './helpers/connectorLoopback'

const view = (intentId: string): ConnectorIntentView => ({
  intentId,
  digest: 'a'.repeat(64),
  client: 'test-client',
  connectionId: 'default',
  workspace: 'test-workspace',
  tool: 'muse_prompt_save',
  toolClass: 'write',
  generation: 1,
  priceMicrousd: 0,
  expiresAt: Date.now() + 60_000,
  fields: [{ label: 'title', value: 'From another agent' }],
})

/** Where the page's network goes: the real page server, counted per path. */
const network = { origin: '', token: '', posts: 0 }

/**
 * The loopback-authed network for the shown page, which reads bare `fetch`.
 * Each `shown()` refreshes `network` before the page loads, so nothing
 * stale survives a case.
 */
async function authedFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  let source: string
  if (typeof input === 'string') source = input
  else if ('href' in input) source = input.href
  else source = input.url
  const url = new URL(source, network.origin)
  if (url.pathname === '/post') network.posts += 1
  const requestInit: { method: string; headers: Record<string, string>; body?: string } = {
    method: init?.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      Origin: network.origin,
      'X-Muse-Panel': '1',
      Authorization: `Bearer ${network.token}`,
    },
  }
  if (typeof init?.body === 'string') requestInit.body = init.body
  return await fetch(url, requestInit)
}

interface Shown {
  readonly dom: JSDOM
  readonly posted: () => number
  readonly close: () => Promise<void>
}

/** The real page, shown in a DOM whose network reaches the real page server. */
async function shown(
  shouldApprove: (intentId: string, digest: string, isApproved: boolean) => boolean,
  decided: { intentId: string; approve: boolean }[],
): Promise<Shown> {
  const page = await startApprovalPage({
    pending: () => [view('intent-1'), view('intent-2')],
    decide: (intentId, digest, isApproved) => {
      decided.push({ intentId, approve: isApproved })
      return shouldApprove(intentId, digest, isApproved)
    },
  })
  try {
    const origin = new URL(page.launchUrl()).origin
    const panel = { url: `${origin}/`, launchUrl: page.launchUrl }
    const token = await connectorLogin(panel)
    const html = await connectorCall(panel, '/', 'GET', undefined, connectorHeaders(panel, token))
    expect(html.status).toBe(200)
    network.origin = origin
    network.token = token
    network.posts = 0
    const dom = new JSDOM(html.body, {
      url: `${origin}/`,
      runScripts: 'dangerously',
      beforeParse(window) {
        window.fetch = authedFetch
      },
    })
    return {
      dom,
      posted: () => network.posts,
      close: async () => {
        dom.window.close()
        await page.close()
      },
    }
  } catch (error: unknown) {
    await page.close()
    throw error
  }
}

/** The row buttons of every intent, in page order (approve, deny per intent). */
async function rowButtons(dom: JSDOM): Promise<HTMLButtonElement[]> {
  const deadline = Date.now() + 3000
  for (;;) {
    const found = dom.window.document.querySelectorAll<HTMLButtonElement>(':scope section button')
    if (found.length >= 4) return [...found]
    if (Date.now() > deadline) throw new Error('intent rows never rendered')
    await sleep(25)
  }
}

async function decidedCount(
  decided: { intentId: string; approve: boolean }[],
  wanted: number,
): Promise<void> {
  const deadline = Date.now() + 3000
  while (decided.length < wanted && Date.now() < deadline) await sleep(25)
}

describe('M124 approval page double decisions', () => {
  it('sends one decision when the person double-clicks or changes their mind', async () => {
    const decided: { intentId: string; approve: boolean }[] = []
    const page = await shown(() => true, decided)
    try {
      const [approve1, deny1, approve2, deny2] = await rowButtons(page.dom)
      if (
        approve1 === undefined ||
        deny1 === undefined ||
        approve2 === undefined ||
        deny2 === undefined
      )
        throw new Error('intent rows incomplete')
      approve1.click()
      approve1.click()
      approve2.click()
      deny2.click()
      await decidedCount(decided, 2)
      expect(page.posted()).toBe(2)
      expect(decided).toEqual([
        { intentId: 'intent-1', approve: true },
        { intentId: 'intent-2', approve: true },
      ])
      for (const button of [approve1, deny1, approve2, deny2]) expect(button.disabled).toBe(true)
    } finally {
      await page.close()
    }
  })

  it('re-enables the row when its decision request itself fails', async () => {
    const decided: { intentId: string; approve: boolean }[] = []
    const page = await shown(() => false, decided)
    try {
      const [approve1, deny1] = await rowButtons(page.dom)
      if (approve1 === undefined || deny1 === undefined) throw new Error('intent rows incomplete')
      approve1.click()
      await decidedCount(decided, 1)
      const deadline = Date.now() + 3000
      while (approve1.disabled && Date.now() < deadline) await sleep(25)
      expect(page.posted()).toBe(1)
      expect(approve1.disabled).toBe(false)
      expect(deny1.disabled).toBe(false)
      expect(page.dom.window.document.querySelector(':scope #status')?.textContent).toBe(
        EN.acpConnector.decisionFailed,
      )
    } finally {
      await page.close()
    }
  })
})
