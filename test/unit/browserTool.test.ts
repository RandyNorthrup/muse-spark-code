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

/** `text` with its first letter capitalized, as its type says. */
function capitalized<T extends string>(text: T): Capitalize<T> {
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}` as Capitalize<T>
}

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
      [
        { kind: 'pageFailed', netError: 'net::ERR_CONNECTION_REFUSED' },
        'the page did not load: net::ERR_CONNECTION_REFUSED',
        'The page did not load (net::ERR_CONNECTION_REFUSED).',
      ],
      [
        { kind: 'pageFailed', netError: undefined },
        'the page did not load',
        'The page did not load.',
      ],
      [
        { kind: 'timedOut' },
        'the browser check did not finish within 60 seconds',
        'The browser check did not finish within 60s.',
      ],
      [
        { kind: 'preparationTimedOut' },
        "preparing the browser check's browser took longer than 15 minutes; nothing was opened",
        'Getting the browser check’s browser ready took longer than 15m, so it stopped.',
      ],
      [
        { kind: 'noElement', selector: '#go' },
        'no element on the page matches the selector #go, or a type step named one that takes no text',
        'No element on the page matches #go, or it takes no text.',
      ],
      [{ kind: 'cancelled' }, MODEL_TEXT.browserCheckCancelled, UI_TEXT.toolStopped],
    ]
    for (const [failure, model, user] of failures) {
      expect(browserRefusal(failure), failure.kind).toEqual({ model, user })
    }
  })

  it('words every other closed failure with its own fixed text, never free text (M81 A1)', () => {
    // Each kind's words are the UI and model key named after it.
    const fixed = [
      'runtimeMissing',
      'runtimeUnsupported',
      'runtimeOutdated',
      'runtimeIntegrity',
      'runtimeBlocked',
      'runtimeDeclined',
      'scopeChanged',
      'notOffered',
      'launch',
      'unrecognized',
      'profile',
      'routeUnconfirmed',
      'resolverUnconfirmed',
      'signIn',
      'webrtc',
      'transport',
      'unverifiable',
      'unwatchable',
      'auditFailed',
      'restartObserved',
      'pageBlocked',
      'leaked',
      'browserFailed',
    ] as const
    const seen = new Set<string>()
    for (const kind of fixed) {
      const key = `browserCheck${capitalized(kind)}` as const
      const refusal = browserRefusal({ kind })
      expect(refusal, kind).toEqual({ model: MODEL_TEXT[key], user: UI_TEXT[key] })
      expect(refusal.model, kind).not.toMatch(/\{\w+\}/)
      seen.add(refusal.user)
    }
    // Each failure reads differently to the user.
    expect(seen.size).toBe(fixed.length)
  })

  it('redacts a credential-shaped selector before it reaches the model or the row', () => {
    const token = 'ghp_' + 'a'.repeat(36)
    const refusal = browserRefusal({ kind: 'noElement', selector: `#${token}` })
    expect(refusal.model).not.toContain(token)
    expect(refusal.user).not.toContain(token)
  })
})
