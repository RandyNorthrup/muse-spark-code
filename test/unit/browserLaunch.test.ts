// Finding and starting the system Chrome or Edge (M81, PLAN.md D49): the
// well-known places, then absolute PATH entries only (D24); and a command
// line with CDP over the pipe, never a port, a fresh profile, and the dead
// proxy for whatever the Fetch domain cannot see.
import { describe, expect, it } from 'vitest'
import { browserLaunchArgs, findBrowserExecutable } from '../../src/core/browser/browserLaunch'

function discovery(
  platform: NodeJS.Platform,
  files: readonly string[],
  options: { path?: string; variables?: Record<string, string> } = {},
) {
  return {
    platform,
    pathVariable: options.path,
    variable: (name: string) => options.variables?.[name],
    fileExists: (file: string) => files.includes(file),
  }
}

const CHROME_MAC = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const EDGE_MAC = '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'

describe('finding the system browser (M81)', () => {
  it('takes the macOS app bundles first, Chrome before Edge', () => {
    expect(findBrowserExecutable(discovery('darwin', [EDGE_MAC, CHROME_MAC]))).toBe(CHROME_MAC)
    expect(findBrowserExecutable(discovery('darwin', [EDGE_MAC]))).toBe(EDGE_MAC)
  })

  it('looks under each Windows program folder, and ignores one the environment gives as relative', () => {
    const variables = {
      ProgramFiles: String.raw`C:\Program Files`,
      'ProgramFiles(x86)': String.raw`C:\Program Files (x86)`,
      LocalAppData: String.raw`.\here`,
    }
    const edge = String.raw`C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`
    expect(findBrowserExecutable(discovery('win32', [edge], { variables }))).toBe(edge)
    const local = String.raw`.\here\Google\Chrome\Application\chrome.exe`
    expect(findBrowserExecutable(discovery('win32', [local], { variables }))).toBeUndefined()
  })

  it('falls back to PATH by absolute entry only, so a browser in the workspace never runs', () => {
    const linux = discovery('linux', ['/usr/bin/google-chrome', 'bin/google-chrome'], {
      path: 'bin:/usr/local/bin:/usr/bin',
    })
    expect(findBrowserExecutable(linux)).toBe('/usr/bin/google-chrome')
    const relativeOnly = discovery('linux', ['bin/google-chrome', './microsoft-edge'], {
      path: 'bin:.:',
    })
    expect(findBrowserExecutable(relativeOnly)).toBeUndefined()
    const windows = discovery('win32', [String.raw`D:\tools\msedge.exe`], {
      path: String.raw`tools;D:\tools`,
    })
    expect(findBrowserExecutable(windows)).toBe(String.raw`D:\tools\msedge.exe`)
  })

  it('answers undefined when no Chrome or Edge is installed', () => {
    expect(findBrowserExecutable(discovery('linux', [], { path: '/usr/bin' }))).toBeUndefined()
    expect(findBrowserExecutable(discovery('darwin', []))).toBeUndefined()
    expect(findBrowserExecutable(discovery('win32', []))).toBeUndefined()
  })
})

describe('the browser command line (M81)', () => {
  const args = browserLaunchArgs('/tmp/muse-spark-browser-abc', ['dev.example.com', '[fd00::1]'])

  it('speaks CDP over the pipe and never names a debugging port', () => {
    expect(args).toContain('--remote-debugging-pipe')
    expect(args).toContain('--headless')
    expect(args.filter((arg) => /remote-debugging-(port|address)|port=/i.test(arg))).toEqual([])
  })

  it('uses only the fresh profile it is given, once', () => {
    expect(args.filter((arg) => arg.startsWith('--user-data-dir'))).toEqual([
      '--user-data-dir=/tmp/muse-spark-browser-abc',
    ])
    expect(args).toContain('--password-store=basic')
    expect(args).toContain('--use-mock-keychain')
  })

  it('sends what Fetch cannot see to a dead proxy, bypassed for loopback and the allowed hosts only', () => {
    expect(args).toContain('--proxy-server=http://127.0.0.1:9')
    expect(args).toContain(
      '--proxy-bypass-list=<-loopback>;localhost;127.0.0.1/8;[::1];dev.example.com;[fd00::1]',
    )
    expect(args).toContain('--force-webrtc-ip-handling-policy=disable_non_proxied_udp')
    expect(args.at(-1)).toBe('about:blank')
  })
})
