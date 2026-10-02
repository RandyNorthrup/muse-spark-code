// The browser check as a tool (M81, PLAN.md D49): its arguments checked and
// its URL placed before any card or modal, what the model reads (English,
// the page's output between markers) and what the row shows (the display
// language), and why a check did not happen.
import { afterEach, describe, expect, it } from 'vitest'
import type { BrowserCheckReport, BrowserFailure } from '../../src/core/browser/browserRun'
import {
  allowedHostsFor,
  browserRefusal,
  browserReportRow,
  browserReportText,
  extraHostSet,
  placeBrowserCall,
} from '../../src/core/browser/browserTool'
import { MODEL_TEXT, UI_TEXT } from '../../src/shared/constants'
import { EN } from '../../src/shared/l10n/en'
import { BASE_LOCALE, setUiText } from '../../src/shared/l10n/text'

const NONE: ReadonlySet<string> = new Set()
// Plain HTTP to a named host is what these cases test; spelled so the
// lint's HTTPS rule, whose fix would rewrite them, leaves them alone.
const HTTP = 'http:'

const REPORT: BrowserCheckReport = {
  finalUrl: 'http://localhost:3000/after',
  consoleErrors: { shown: ['TypeError: x is undefined'], more: 0 },
  failedRequests: { shown: ['http://localhost:3000/missing.json (HTTP 404)'], more: 2 },
  blockedRequests: { shown: [], more: 0 },
  screenshot: undefined,
}

afterEach(() => {
  setUiText(EN, BASE_LOCALE)
})

describe('the browser check tool (M81)', () => {
  it('takes a URL and up to eight bounded click or type steps', () => {
    const placed = placeBrowserCall(
      {
        url: 'http://localhost:3000/',
        actions: [
          { kind: 'click', selector: '#go' },
          { kind: 'type', selector: 'input', text: 'hello' },
        ],
      },
      NONE,
    )
    expect(placed).toEqual({
      ok: true,
      placement: {
        kind: 'local',
        url: 'http://localhost:3000/',
        host: 'localhost',
        approvalHost: 'localhost:3000',
      },
      actions: [
        { kind: 'click', selector: '#go' },
        { kind: 'type', selector: 'input', text: 'hello' },
      ],
    })
    for (const args of [
      {},
      { url: 7 },
      {
        url: 'http://localhost/',
        actions: Array.from({ length: 9 }, () => ({ kind: 'click', selector: 'a' })),
      },
      { url: 'http://localhost/', actions: [{ kind: 'click', selector: '' }] },
      { url: 'http://localhost/', actions: [{ kind: 'click', selector: 'a'.repeat(257) }] },
      { url: 'http://localhost/', actions: [{ kind: 'type', selector: 'a' }] },
      {
        url: 'http://localhost/',
        actions: [{ kind: 'type', selector: 'a', text: 'x'.repeat(1001) }],
      },
      { url: 'http://localhost/', actions: [{ kind: 'hover', selector: 'a' }] },
    ]) {
      const refused = placeBrowserCall(args, NONE)
      expect(refused.ok, JSON.stringify(args).slice(0, 80)).toBe(false)
      expect(refused).toMatchObject({ model: expect.stringContaining('invalid arguments') })
    }
  })

  it('refuses a URL it would never open before any card, in the words of each reader', () => {
    expect(placeBrowserCall({ url: 'file:///etc/passwd' }, NONE)).toEqual({
      ok: false,
      model: MODEL_TEXT.browserCheckUrlRefused,
      user: UI_TEXT.browserCheckUrlRefused,
    })
  })

  it('widens a check to the setting as it stands now, and to the URL host a card allowed', () => {
    const local = placeBrowserCall({ url: 'http://localhost/' }, NONE)
    const beyond = placeBrowserCall({ url: `${HTTP}//intranet.example:8080/` }, NONE)
    if (!local.ok || !beyond.ok) {
      throw new Error('expected placements')
    }
    expect(allowedHostsFor(local.placement, ['Dev.Example.com', 'bad host'])).toEqual([
      'dev.example.com',
    ])
    expect(allowedHostsFor(beyond.placement, [])).toEqual(['intranet.example'])
    expect(extraHostSet(['::1', 'a;b', 'x.example'])).toEqual(new Set(['[::1]', 'x.example']))
  })

  it('gives the model the counts outside the markers, and what the page produced inside them', () => {
    const text = browserReportText('http://localhost:3000/', REPORT, 'abc123')
    const open = text.indexOf('<<<page abc123>>>')
    const close = text.indexOf('<<<end of page abc123>>>')
    expect(
      text.startsWith(
        'Opened http://localhost:3000/ in a headless browser: 1 console errors, 3 failed requests, 0 requests blocked',
      ),
    ).toBe(true)
    expect(text.indexOf(MODEL_TEXT.browserCheckUntrusted)).toBeLessThan(open)
    for (const pageText of [
      'Ended at: http://localhost:3000/after',
      '- TypeError: x is undefined',
      '- http://localhost:3000/missing.json (HTTP 404)',
      '2 more not shown',
    ]) {
      const at = text.indexOf(pageText)
      expect(at, pageText).toBeGreaterThan(open)
      expect(at, pageText).toBeLessThan(close)
    }
    expect(text).not.toContain(MODEL_TEXT.browserCheckBlockedRequests)
    expect(text).not.toContain(MODEL_TEXT.browserCheckScreenshotNext)
    const withShot = browserReportText(
      'http://localhost:3000/',
      { ...REPORT, screenshot: { png: new Uint8Array(1), width: 1, height: 1 } },
      'abc123',
    )
    expect(withShot).toContain(MODEL_TEXT.browserCheckScreenshotNext)
  })

  it('shows the row in the display language, each entry under its count', () => {
    expect(browserReportRow('http://localhost:3000/', REPORT)).toBe(
      [
        'Checked http://localhost:3000/: 1 console error, 3 failed requests, 0 requests blocked beyond this computer',
        '',
        '1 console error',
        'TypeError: x is undefined',
        '',
        '3 failed requests',
        'http://localhost:3000/missing.json (HTTP 404)',
      ].join('\n'),
    )
    setUiText(
      {
        ...EN,
        browserCheckDone: 'Geprüft {url}: {errors}, {failed}, {blocked}',
        browserCheckConsoleErrors: {
          one: '{count} Konsolenfehler',
          other: '{count} Konsolenfehler',
        },
      },
      'de',
    )
    expect(browserReportRow('http://localhost:3000/', REPORT).split('\n', 1)[0]).toBe(
      'Geprüft http://localhost:3000/: 1 Konsolenfehler, 3 failed requests, 0 requests blocked beyond this computer',
    )
  })

  it('says why a check did not happen or did not finish, to the model and to the user', () => {
    const failures: readonly [BrowserFailure, string, string][] = [
      [{ kind: 'noBrowser' }, MODEL_TEXT.browserCheckNoBrowser, UI_TEXT.browserCheckNoBrowser],
      [
        { kind: 'browserFailed', detail: 'spawn EACCES' },
        'the browser failed: spawn EACCES',
        'The browser failed: spawn EACCES',
      ],
      [
        { kind: 'pageFailed', detail: 'net::ERR_CONNECTION_REFUSED' },
        'the page did not load: net::ERR_CONNECTION_REFUSED',
        'The page did not load: net::ERR_CONNECTION_REFUSED',
      ],
      [
        { kind: 'pageBlocked' },
        MODEL_TEXT.browserCheckPageBlocked,
        UI_TEXT.browserCheckPageBlocked,
      ],
      [
        { kind: 'timedOut' },
        'the browser check did not finish within 60 seconds',
        'The browser check did not finish within 60s.',
      ],
      [
        { kind: 'noElement', selector: '#go' },
        'no element on the page matches the selector #go, or a type step named one that takes no text',
        'No element on the page matches #go, or it takes no text.',
      ],
      [{ kind: 'leaked' }, MODEL_TEXT.browserCheckLeaked, UI_TEXT.browserCheckLeaked],
      [{ kind: 'cancelled' }, MODEL_TEXT.browserCheckCancelled, UI_TEXT.toolStopped],
      [
        { kind: 'managedPolicy', where: '/etc/opt/chrome/policies/managed/p.json (ProxyMode)' },
        "the browser check did not start: an administrator's policy for Chrome or Edge (/etc/opt/chrome/policies/managed/p.json (ProxyMode)) sets a proxy or cloud management, which overrides the check's block on connections beyond loopback; it cannot run on this computer while that policy is in place",
        'The browser check did not start: an administrator’s policy for Chrome or Edge (/etc/opt/chrome/policies/managed/p.json (ProxyMode)) sets a proxy or cloud management, which would override its block on connections beyond this computer.',
      ],
      [
        { kind: 'policyUnreadable', where: '/etc/opt/edge/policies/managed', detail: 'EACCES' },
        'the browser check did not start: the browser policy at /etc/opt/edge/policies/managed could not be read (EACCES), so it cannot tell whether a policy would override its block on connections beyond loopback',
        'The browser check did not start: it could not read the browser policy at /etc/opt/edge/policies/managed (EACCES), so it cannot tell whether a policy would override its block on connections beyond this computer.',
      ],
    ]
    for (const [failure, model, user] of failures) {
      expect(browserRefusal(failure), failure.kind).toEqual({ model, user })
    }
  })
})
