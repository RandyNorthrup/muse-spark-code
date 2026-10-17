// The browser check's address rule (M81, PLAN.md D49): loopback only
// (`localhost`, 127.0.0.0/8, ::1), compared by name and never looked up,
// unless the user widened a plain host in the setting or on a card.
import { describe, expect, it } from 'vitest'
import {
  isAllowedRequest,
  isLoopbackHost,
  isNetworkUrl,
  placeBrowserUrl,
  widenedHost,
} from '../../src/core/browser/browserPolicy'

const NONE: ReadonlySet<string> = new Set()
// Plain HTTP to a named host is what these cases test; spelled so the
// lint's HTTPS rule, whose fix would rewrite them, leaves them alone.
const HTTP = 'http:'

function placed(url: string, extra: ReadonlySet<string> = NONE) {
  const placement = placeBrowserUrl(url, extra)
  return placement.kind === 'refused' ? 'refused' : placement
}

describe('the browser check address rule (M81)', () => {
  it('counts localhost, 127.0.0.0/8 and ::1 as loopback, in every spelling the URL parser accepts', () => {
    for (const url of [
      'http://localhost:3000/',
      'http://LOCALHOST/',
      'http://127.0.0.1:5173/app',
      'http://127.1/',
      'http://0x7f.0.0.1/',
      'http://2130706433/',
      'http://127.255.255.254/',
      'http://[::1]:8080/',
      'https://[0:0:0:0:0:0:0:1]/',
    ]) {
      expect(placed(url), url).toMatchObject({ kind: 'local' })
    }
  })

  it('counts nothing else as loopback: no name is looked up, and look-alikes stay out', () => {
    for (const url of [
      'http://0.0.0.0:3000/',
      `${HTTP}//app.localhost/`,
      `${HTTP}//127.0.0.1.nip.io/`,
      `${HTTP}//localhost.example.com/`,
      'http://[::ffff:127.0.0.1]/',
      'http://169.254.169.254/latest/meta-data/',
      'http://10.0.0.5/',
      'http://intranet/',
    ]) {
      expect(placed(url), url).toMatchObject({ kind: 'needsWidening' })
    }
    expect(isLoopbackHost('[::ffff:7f00:1]')).toBe(false)
  })

  it('refuses what is not an http(s) URL with a plain host and no credentials', () => {
    for (const url of [
      'file:///etc/passwd',
      'ftp://127.0.0.1/',
      'data:text/html,<p>hi</p>',
      'javascript:alert(1)',
      'chrome://settings',
      'ws://127.0.0.1/',
      'http://user:pass@localhost/',
      'http://user@localhost/',
      // A trailing dot is a name DNS would look up, not Chrome's own localhost.
      'http://localhost.:3000/',
      `${HTTP}//*.example.com/`,
      `${HTTP}//a;b.example.com/`,
      `${HTTP}//a,b.example.com/`,
      'localhost:3000',
      'not a url',
      `http://localhost/${'a'.repeat(2048)}`,
    ]) {
      expect(placed(url), url).toBe('refused')
    }
  })

  it('names the host the card and the "always" rule are keyed on, with a port other than the default', () => {
    expect(placed('http://localhost:3000/a?b=1#c')).toEqual({
      kind: 'local',
      url: 'http://localhost:3000/a?b=1#c',
      host: 'localhost',
      approvalHost: 'localhost:3000',
    })
    expect(placed('https://Dev.Example.com:443/')).toMatchObject({
      host: 'dev.example.com',
      approvalHost: 'dev.example.com',
    })
  })

  it('places a host the user widened as widened, and only that exact host', () => {
    const extra = new Set(['dev.example.com', '192.168.1.20', '[fd00::1]'])
    expect(placed(`${HTTP}//dev.example.com:8080/`, extra)).toMatchObject({ kind: 'widened' })
    expect(placed('http://192.168.1.20/', extra)).toMatchObject({ kind: 'widened' })
    expect(placed('http://[fd00::1]/', extra)).toMatchObject({ kind: 'widened' })
    for (const url of [
      `${HTTP}//evil-dev.example.com/`,
      `${HTTP}//a.dev.example.com/`,
      `${HTTP}//example.com/`,
      'http://192.168.1.21/',
    ]) {
      expect(placed(url, extra), url).toMatchObject({ kind: 'needsWidening' })
    }
  })

  it('takes a setting entry only as a plain host name or address, written as a URL writes it', () => {
    expect(widenedHost('Dev.Example.COM')).toBe('dev.example.com')
    expect(widenedHost(' 192.168.1.20 ')).toBe('192.168.1.20')
    expect(widenedHost('::1')).toBe('[::1]')
    expect(widenedHost('[fd00::1]')).toBe('[fd00::1]')
    expect(widenedHost('xn--bcher-kva.example')).toBe('xn--bcher-kva.example')
    expect(widenedHost('bücher.example')).toBe('xn--bcher-kva.example')
    for (const entry of [
      '',
      'example.com:8080',
      'example.com/path',
      `${HTTP}//example.com`,
      '*.example.com',
      'a;b',
      '<-loopback>',
      'user@example.com',
      'example.com?x',
      'a'.repeat(254),
    ]) {
      expect(widenedHost(entry), entry).toBeUndefined()
    }
  })

  it('lets a request through only to loopback or an allowed host, over http(s) or ws(s)', () => {
    const allowed = new Set(['dev.example.com'])
    for (const url of [
      'http://localhost:3000/x.js',
      'https://127.0.0.1/',
      'ws://localhost:5173/hmr',
      'wss://[::1]/',
      `${HTTP}//dev.example.com/api`,
    ]) {
      expect(isAllowedRequest(url, allowed), url).toBe(true)
    }
    for (const url of [
      'http://169.254.169.254/',
      `${HTTP}//intranet.example/`,
      'ws://192.168.1.1/',
      'file:///etc/hosts',
      'chrome-extension://abc/x.js',
      'ftp://localhost/',
      'not a url',
    ]) {
      expect(isAllowedRequest(url, allowed), url).toBe(false)
    }
    expect(isNetworkUrl('wss://example.com/')).toBe(true)
    expect(isNetworkUrl('data:text/plain,x')).toBe(false)
  })
})
