// The browser check for Muse Code through the `ide` session server (M81,
// PLAN.md D49): listed only while offered, open-world and not read-only,
// confirmed in the extension's own modal before every call (which names a
// host beyond loopback, and only then widens the check to it), stopped when
// Muse Code stops waiting, and text only.
import { describe, expect, it } from 'vitest'
import { handleMcpMessage } from '../../src/core/mcp'
import type {
  BrowserCheckRequest,
  BrowserCheckResult,
  CheckAdmission,
} from '../../src/core/browser/browserRun'
import { type BrowserCheckScope, browserScopeKey } from '../../src/core/browser/browserTool'
import { type IdeBrowserCheckDeps, ideBrowserCheckTools } from '../../src/host/ide/browserCheckTool'
import { oneQuestionPerUrl } from '../../src/host/ide/webFetchTool'
import { IDE_MCP_SERVER_INFO, MODEL_TEXT } from '../../src/shared/constants'
import { FakeLogOutputChannel } from './helpers/fakes'

// Plain HTTP to a named host is what these cases test; spelled so the
// lint's HTTPS rule, whose fix would rewrite them, leaves them alone.
const HTTP = 'http:'

const NOTHING = { shown: [], more: 0 }
// What Muse Code's check reports: never a screenshot.
const REPORTED: BrowserCheckResult = {
  ok: true,
  report: {
    screenshot: undefined,
    blockedRequests: NOTHING,
    failedRequests: NOTHING,
    consoleErrors: { shown: ['boom'], more: 0 },
    finalUrl: 'http://localhost:3000/',
  },
}

function setup(
  options: {
    isOffered?: boolean
    answer?: boolean
    held?: Promise<boolean>
    extraHosts?: readonly string[]
    result?: BrowserCheckResult
    /** Runs while the page is checked, with the switch for the offer. */
    onCheck?: (offer: (isNowOffered: boolean) => void) => void
    /** The modal as the extension shares it; asked directly otherwise. */
    share?: (direct: IdeBrowserCheckDeps['confirm']) => IdeBrowserCheckDeps['confirm']
  } = {},
) {
  const asked: { url: string; widenedHost: string | undefined }[] = []
  const checked: BrowserCheckRequest[] = []
  const admissions: CheckAdmission[] = []
  let isOffered = options.isOffered ?? true
  let extraHosts = options.extraHosts ?? []
  const offer = (isNowOffered: boolean) => {
    isOffered = isNowOffered
  }
  const setExtraHosts = (hosts: readonly string[]) => {
    extraHosts = hosts
  }
  const answerModal = (url: string, { widenedHost }: BrowserCheckScope) => {
    asked.push({ url, widenedHost })
    return options.held ?? Promise.resolve(options.answer ?? true)
  }
  const confirm = options.share?.(answerModal) ?? answerModal
  const tools = () =>
    ideBrowserCheckTools({
      isOffered: () => isOffered,
      extraHosts: () => extraHosts,
      confirm,
      check: (request, admission) => {
        checked.push(request)
        admissions.push(admission)
        options.onCheck?.(offer)
        return Promise.resolve(options.result ?? REPORTED)
      },
      log: new FakeLogOutputChannel(),
    })
  /** The listed tool called as Muse Code calls it. */
  const call = async (args: Record<string, unknown>, signal = new AbortController().signal) => {
    const [listed] = tools()
    expect(listed?.name).toBe('browserCheck')
    return await (listed?.call(args, signal) ?? Promise.reject(new Error('not listed')))
  }
  return {
    asked,
    checked,
    admissions,
    tools,
    call,
    offer,
    setExtraHosts,
  }
}

describe('the ide server browser check (M81)', () => {
  it('is listed only while offered, open-world and not read-only', async () => {
    const t = setup()
    const [tool] = t.tools()
    expect(tool?.annotations).toEqual({ readOnlyHint: false, openWorldHint: true })
    expect(tool?.inputSchema).toMatchObject({ required: ['url'], additionalProperties: false })
    expect(tool?.description).toContain('without a screenshot')
    // As Muse Code lists it, annotations included.
    const listing = JSON.stringify(
      await handleMcpMessage(
        JSON.stringify({ jsonrpc: '2.0', id: 7, method: 'tools/list' }),
        t.tools(),
        IDE_MCP_SERVER_INFO,
      ),
    )
    expect(listing).toContain('"name":"browserCheck"')
    expect(listing).toContain('"annotations":{"readOnlyHint":false,"openWorldHint":true}')
    t.offer(false)
    expect(t.tools()).toEqual([])
  })

  it('asks before every check and runs it text only, on loopback alone', async () => {
    const t = setup()
    const text = await t.call({
      url: 'http://localhost:3000/',
      actions: [{ kind: 'click', selector: '#go' }],
    })
    expect(t.asked).toEqual([{ url: 'http://localhost:3000/', widenedHost: undefined }])
    expect(t.checked).toHaveLength(1)
    expect(t.checked[0]).toMatchObject({
      url: 'http://localhost:3000/',
      actions: [{ kind: 'click', selector: '#go' }],
      allowedHosts: [],
      includeScreenshot: false,
    })
    expect(text).toContain('Opened http://localhost:3000/ in a headless browser: 1 console errors')
    expect(text).toMatch(
      /<<<page [\da-f]{16}>>>\nEnded at: http:\/\/localhost:3000\/\nConsole errors:\n- boom\n<<<end of page [\da-f]{16}>>>$/,
    )
    expect(text).not.toContain(MODEL_TEXT.browserCheckScreenshotNext)
  })

  it('names a host beyond loopback in the modal, and widens only that check to it', async () => {
    const t = setup({ extraHosts: ['dev.example.com'] })
    await t.call({ url: `${HTTP}//intranet.example:8080/` })
    await t.call({ url: `${HTTP}//dev.example.com/` })
    expect(t.asked).toEqual([
      { url: `${HTTP}//intranet.example:8080/`, widenedHost: 'intranet.example' },
      { url: `${HTTP}//dev.example.com/`, widenedHost: undefined },
    ])
    expect(t.checked.map((request) => request.allowedHosts)).toEqual([
      ['dev.example.com', 'intranet.example'],
      ['dev.example.com'],
    ])
  })

  it('opens nothing when the user declines, or for a URL it would refuse anyway', async () => {
    const declined = setup({ answer: false })
    await expect(declined.call({ url: 'http://localhost/' })).rejects.toThrow(
      MODEL_TEXT.browserCheckDeclined,
    )
    expect(declined.checked).toEqual([])
    const refused = setup()
    await expect(refused.call({ url: 'file:///etc/passwd' })).rejects.toThrow(
      MODEL_TEXT.browserCheckUrlRefused,
    )
    await expect(refused.call({ url: 'http://localhost/', actions: 'click' })).rejects.toThrow(
      'the arguments are not valid, so nothing was opened',
    )
    expect(refused.asked).toEqual([])
    expect(refused.checked).toEqual([])
  })

  it('opens nothing once Muse Code stopped waiting, or the check is no longer offered', async () => {
    const held = Promise.withResolvers<boolean>()
    const t = setup({ held: held.promise })
    const stop = new AbortController()
    const calling = t.call({ url: 'http://localhost/' }, stop.signal)
    stop.abort()
    await expect(calling).rejects.toThrow(MODEL_TEXT.browserCheckCancelled)
    held.resolve(true)
    expect(t.checked).toEqual([])

    const withdrawn = setup({ held: Promise.resolve(true) })
    const pending = withdrawn.call({ url: 'http://localhost/' })
    withdrawn.offer(false)
    await expect(pending).rejects.toThrow(MODEL_TEXT.browserCheckNotOffered)
    expect(withdrawn.checked).toEqual([])
  })

  it('hands the page back only while the check is still offered, and passes the stop on', async () => {
    const t = setup({
      onCheck: (offer) => {
        offer(false)
      },
    })
    const stop = new AbortController()
    await expect(t.call({ url: 'http://localhost/' }, stop.signal)).rejects.toThrow(
      MODEL_TEXT.browserCheckNotOffered,
    )
    expect(t.checked[0]?.signal).toBe(stop.signal)
  })

  it("never takes another call's answer for a different widening, and reads the setting again after it (RV81)", async () => {
    // The review's case: the host is in the setting when the first call asks
    // (no widening shown); that call is stopped, the host taken out of the
    // setting, and the same URL called again while the first modal is open.
    const held = Promise.withResolvers<boolean>()
    const t = setup({
      extraHosts: ['intranet.example'],
      held: held.promise,
      share: (answerModal) => oneQuestionPerUrl(answerModal, browserScopeKey),
    })
    const url = `${HTTP}//intranet.example/`
    const stop = new AbortController()
    const first = t.call({ url }, stop.signal)
    stop.abort()
    await expect(first).rejects.toThrow(MODEL_TEXT.browserCheckCancelled)
    t.setExtraHosts([])
    const retry = t.call({ url })
    // The same URL and scope again shares the open modal.
    const again = t.call({ url })
    held.resolve(true)
    await Promise.all([retry, again])
    expect(t.asked).toEqual([
      { url, widenedHost: undefined },
      { url, widenedHost: 'intranet.example' },
    ])
    expect(t.checked.map((request) => request.allowedHosts)).toEqual([
      ['intranet.example'],
      ['intranet.example'],
    ])

    // The setting changed while the modal was open: its answer covers nothing.
    const open = Promise.withResolvers<boolean>()
    const changed = setup({ extraHosts: ['intranet.example'], held: open.promise })
    const pending = changed.call({ url })
    await Promise.resolve()
    changed.setExtraHosts([])
    open.resolve(true)
    await expect(pending).rejects.toThrow(MODEL_TEXT.browserCheckScopeChanged)
    expect(changed.checked).toEqual([])
  })

  it('freezes the scope the modal covered and gives the check its admission: the offer and that scope, read again (M81 A1)', async () => {
    const t = setup({ extraHosts: ['staging.example.com'] })
    await t.call({ url: `${HTTP}//staging.example.com/` })
    const [request] = t.checked
    const [admission] = t.admissions
    expect(request?.approvalKey).toBe(
      browserScopeKey(`${HTTP}//staging.example.com/`, {
        widenedHost: undefined,
        allowedHosts: ['staging.example.com'],
      }),
    )
    expect(admission?.()).toBe('ok')
    t.setExtraHosts(['staging.example.com', 'other.example.com'])
    expect(admission?.()).toBe('scopeChanged')
    t.setExtraHosts(['staging.example.com'])
    t.offer(false)
    expect(admission?.()).toBe('notOffered')
  })

  it("throws the check's own reason when it did not finish", async () => {
    const t = setup({ result: { ok: false, failure: { kind: 'runtimeMissing' } } })
    await expect(t.call({ url: 'http://localhost/' })).rejects.toThrow(
      MODEL_TEXT.browserCheckRuntimeMissing,
    )
  })
})
