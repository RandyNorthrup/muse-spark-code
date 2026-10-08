// How the browser check starts the pinned shell (M81 A1, design spec v4
// §6.4): the fixed command line with the check's own proxy and profile, the
// contract the browser's own report of it is held to, and the projected
// environment.
import { describe, expect, it } from 'vitest'
import {
  browserEnvironment,
  browserLaunchArgs,
  commandLineVerdict,
} from '../../src/core/browser/browserLaunch'
import { hostBrowserRunDeps } from '../../src/host/browser/browserProcess'
import {
  BROWSER_FORBIDDEN_SWITCHES,
  BROWSER_HOST_RESOLVER_RULES,
  BROWSER_LAUNCH_FLAGS,
  UI_TEXT,
} from '../../src/shared/constants'

const PROXY = 'http://127.0.0.1:41234'
const PROFILE = '/storage/bc/0a1b2c3d/p'
const LAUNCHED = browserLaunchArgs(PROXY, PROFILE)
/** What the pin reports: the executable, what was launched, then its own switches and the page. */
const REPORTED = [
  '/storage/browser-runtime/154.0.8037.92/linux64/chrome-headless-shell',
  ...LAUNCHED.slice(0, -1),
  '--headless',
  '--use-gl=angle',
  '--ozone-platform=headless',
  'about:blank',
]

describe('the browser check’s command line (M81 A1)', () => {
  it('is the fixed flags, the owned proxy, the profile and a blank page, and never a port', () => {
    expect(LAUNCHED).toEqual([
      ...BROWSER_LAUNCH_FLAGS,
      `--proxy-server=${PROXY}`,
      `--user-data-dir=${PROFILE}`,
      'about:blank',
    ])
    expect(LAUNCHED).toEqual(
      expect.arrayContaining([
        '--remote-debugging-pipe',
        '--proxy-bypass-list=<-loopback>',
        '--host-resolver-rules=MAP * ^NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE ::1',
        '--auth-server-allowlist=muse-spark-no-ambient-auth.invalid',
        '--force-webrtc-ip-handling-policy=disable_non_proxied_udp',
        '--disable-quic',
      ]),
    )
    expect(
      LAUNCHED.filter((arg) => /remote-debugging-(?:port|address)|no-sandbox/.test(arg)),
    ).toEqual([])
    // Each switch once.
    const names = LAUNCHED.filter((arg) => arg.startsWith('--')).map((arg) => arg.split('=', 1)[0])
    expect(new Set(names).size).toBe(names.length)
  })

  it('holds the browser’s report to it, counting the browser’s own switches only', () => {
    expect(commandLineVerdict(REPORTED, LAUNCHED)).toEqual({ kind: 'ok', unknownSwitches: 3 })
  })

  it('refuses an own switch missing, doubled or changed, and names the resolver rule apart', () => {
    const without = (prefix: string): string[] => REPORTED.filter((arg) => !arg.startsWith(prefix))
    expect(commandLineVerdict(without('--proxy-server='), LAUNCHED)).toEqual({
      kind: 'unrecognized',
    })
    expect(commandLineVerdict([...REPORTED, '--disable-quic'], LAUNCHED)).toEqual({
      kind: 'unrecognized',
    })
    expect(
      commandLineVerdict(
        REPORTED.map((arg) =>
          arg.startsWith('--proxy-bypass-list=') ? '--proxy-bypass-list=<-loopback>;*' : arg,
        ),
        LAUNCHED,
      ),
    ).toEqual({ kind: 'unrecognized' })
    for (const resolver of [
      without('--host-resolver-rules='),
      [...REPORTED, `--host-resolver-rules=${BROWSER_HOST_RESOLVER_RULES}`],
      REPORTED.map((arg) =>
        arg.startsWith('--host-resolver-rules=')
          ? '--host-resolver-rules=MAP * ^NOTFOUND, EXCLUDE *'
          : arg,
      ),
    ]) {
      expect(commandLineVerdict(resolver, LAUNCHED)).toEqual({ kind: 'resolver' })
    }
  })

  it('refuses every forbidden switch whatever its value, the certificate family by prefix', () => {
    for (const name of [...BROWSER_FORBIDDEN_SWITCHES, 'ignore-certificate-errors-spki-list']) {
      expect(
        commandLineVerdict([...REPORTED.slice(0, -1), `--${name}=x`, 'about:blank'], LAUNCHED),
        name,
      ).toEqual({
        kind: 'unrecognized',
      })
    }
    // A single dash and upper case are the same switch to Chromium.
    expect(
      commandLineVerdict([...REPORTED.slice(0, -1), '-No-Sandbox', 'about:blank'], LAUNCHED),
    ).toEqual({
      kind: 'unrecognized',
    })
  })

  it('refuses any page but the one blank page', () => {
    expect(commandLineVerdict(REPORTED.slice(0, -1), LAUNCHED)).toEqual({ kind: 'unrecognized' })
    expect(commandLineVerdict([...REPORTED, 'https://evil.example/'], LAUNCHED)).toEqual({
      kind: 'unrecognized',
    })
  })

  it('reports the spawn’s own error code when the OS refuses it after the spawn returned', async () => {
    const deps = hostBrowserRunDeps({
      platform: process.platform,
      env: {},
      warn: () => undefined,
    })
    const browser = deps.spawn('/definitely-not-here/chrome-headless-shell', [], {})
    // The refused pipe's own error goes nowhere else: it is read here.
    browser.reader.on('error', () => undefined)
    await expect(browser.spawnError).resolves.toBe('ENOENT')
    await browser.exited
    await browser.kill()
  })
})

describe('the browser’s environment (M81 A1)', () => {
  const folders = { profile: '/c/p', temp: '/c/t', home: '/c/h' }
  const secrets = {
    HTTPS_PROXY: 'http://user:secret@proxy:3128',
    http_proxy: 'http://proxy:3128',
    NO_PROXY: '*',
    KRB5CCNAME: 'FILE:/tmp/krb5cc_1000',
    SSLKEYLOGFILE: '/tmp/keys',
    GOOGLE_API_KEY: 'AIza-secret',
    CHROME_HEADLESS: '1',
    OPENAI_API_KEY: 'sk-secret',
    META_TOKEN: 'secret',
    MUSE_SPARK_KEY: 'secret',
    VSCODE_PID: '1',
    ELECTRON_RUN_AS_NODE: '1',
    NODE_OPTIONS: '--require /tmp/x.js',
    LD_PRELOAD: '/tmp/x.so',
    DYLD_INSERT_LIBRARIES: '/tmp/x.dylib',
    DBUS_SESSION_BUS_ADDRESS: 'unix:path=/run/user/1000/bus',
    DISPLAY: ':0',
    WAYLAND_DISPLAY: 'wayland-0',
  }

  it('keeps the locale and a few of the OS’s own variables, never a proxy, credential or loader variable', () => {
    const env = browserEnvironment(
      'linux',
      {
        ...secrets,
        LANG: 'de_DE.UTF-8',
        LC_TIME: 'C',
        TZ: 'UTC',
        FONTCONFIG_PATH: '/etc/fonts',
        HOME: '/home/user',
      },
      folders,
    )
    expect(env).toEqual({
      LANG: 'de_DE.UTF-8',
      TZ: 'UTC',
      LC_TIME: 'C',
      FONTCONFIG_PATH: '/etc/fonts',
      PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
      TMPDIR: '/c/t',
      HOME: '/c/h',
      XDG_CONFIG_HOME: '/c/h',
      XDG_CACHE_HOME: '/c/h',
      XDG_DATA_HOME: '/c/h',
      XDG_STATE_HOME: '/c/h',
    })
  })

  it('on macOS keeps the user’s home (not a keychain boundary) and moves only the temporary folder', () => {
    expect(
      browserEnvironment(
        'darwin',
        { ...secrets, HOME: '/Users/u', USER: 'u', LOGNAME: 'u' },
        folders,
      ),
    ).toEqual({
      HOME: '/Users/u',
      USER: 'u',
      LOGNAME: 'u',
      PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
      TMPDIR: '/c/t',
    })
  })

  it('on Windows keeps its system folders by any case and puts the temporary folder under the check', () => {
    const env = browserEnvironment(
      'win32',
      {
        ...secrets,
        SYSTEMROOT: String.raw`C:\Windows`,
        LocalAppData: String.raw`C:\Users\u\AppData\Local`,
        NUMBER_OF_PROCESSORS: '8',
      },
      { profile: String.raw`C:\s\p`, temp: String.raw`C:\s\t`, home: String.raw`C:\s\h` },
    )
    expect(env).toEqual({
      SystemRoot: String.raw`C:\Windows`,
      LOCALAPPDATA: String.raw`C:\Users\u\AppData\Local`,
      NUMBER_OF_PROCESSORS: '8',
      PATH: String.raw`C:\Windows\System32;C:\Windows`,
      TEMP: String.raw`C:\s\t`,
      TMP: String.raw`C:\s\t`,
    })
  })

  it('finds Windows on any drive and never guesses C: (SECWINPATH2)', () => {
    const folders = { profile: String.raw`E:\s\p`, temp: String.raw`E:\s\t`, home: String.raw`E:\s\h` }
    expect(browserEnvironment('win32', { windir: String.raw`E:\Win` }, folders)).toMatchObject({
      windir: String.raw`E:\Win`,
      PATH: String.raw`E:\Win\System32;E:\Win`,
    })
    for (const env of [{}, { SystemRoot: 'Windows' }, { SystemDrive: 'D:' }]) {
      expect(() => browserEnvironment('win32', env, folders)).toThrow(
        UI_TEXT.windowsSystemRootMissing,
      )
    }
  })
})
