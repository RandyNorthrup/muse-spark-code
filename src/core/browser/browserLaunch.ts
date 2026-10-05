// How the browser check starts the pinned headless shell (M81 A1, design
// spec v4 §6.4). Never a system browser, a PATH entry or a workspace file:
// only the executable the runtime bundle verified against the pin. The
// command line is fixed (BROWSER_LAUNCH_FLAGS) plus the check's own proxy
// endpoint and profile, then `about:blank`; the model's URL travels over the
// pipe, never on the command line. What the browser reports back
// (`Browser.getBrowserCommandLine`) is held to that contract: each own
// switch exactly once and byte-equal, no forbidden switch, the one
// positional page. Unknown other switches are counted, never named or kept.
//
// The child's environment is a projection (spec §6.4), not this process's
// environment minus a denylist: the locale, a minimal PATH, a few OS
// folders, and a home and temporary folder under the check's own folder.
// Pure.

import {
  BROWSER_BLANK_PAGE,
  BROWSER_FORBIDDEN_SWITCHES,
  BROWSER_FORBIDDEN_SWITCH_PREFIX,
  BROWSER_HOST_RESOLVER_RULES,
  BROWSER_LAUNCH_FLAGS,
  BROWSER_PROFILE_FLAG,
  BROWSER_PROXY_SERVER_FLAG,
} from '../../shared/browserCheckConstants'

/** The check's own folders: the profile, its temporary folder and its home. */
export interface CheckFolders {
  readonly profile: string
  readonly temp: string
  readonly home: string
}

/** The browser's command line for one check: the fixed flags, the proxy, the profile, a blank page. */
export function browserLaunchArgs(proxyEndpoint: string, profile: string): readonly string[] {
  return [
    ...BROWSER_LAUNCH_FLAGS,
    `${BROWSER_PROXY_SERVER_FLAG}${proxyEndpoint}`,
    `${BROWSER_PROFILE_FLAG}${profile}`,
    BROWSER_BLANK_PAGE,
  ]
}

/** What the reported command line says about the contract. */
export type CommandLineVerdict =
  | { readonly kind: 'ok'; readonly unknownSwitches: number }
  /** The resolver rule is missing, changed or doubled. */
  | { readonly kind: 'resolver' }
  /** Any other own switch, a forbidden switch or the positional page is not as launched. */
  | { readonly kind: 'unrecognized' }

const SWITCH = /^--?([^=]+)(?:=([\s\S]*))?$/

function switchName(arg: string): string | undefined {
  const match = SWITCH.exec(arg)
  return match?.[1]?.toLowerCase()
}

/**
 * The browser's own report of its command line (`arguments`, the executable
 * first) against what was launched. Only counts leave this function.
 */
export function commandLineVerdict(
  reported: readonly string[],
  launched: readonly string[],
): CommandLineVerdict {
  const args = reported.slice(1)
  const own = new Map<string, string>()
  for (const arg of launched) {
    const name = switchName(arg)
    if (name !== undefined) {
      own.set(name, arg)
    }
  }
  const seen = new Map<string, number>()
  const positional: string[] = []
  let unknownSwitches = 0
  let isResolverWrong = false
  let isWrong = false
  for (const arg of args) {
    const name = switchName(arg)
    if (name === undefined) {
      positional.push(arg)
      continue
    }
    const expected = own.get(name)
    if (expected === undefined) {
      if (
        BROWSER_FORBIDDEN_SWITCHES.includes(name) ||
        name.startsWith(BROWSER_FORBIDDEN_SWITCH_PREFIX)
      ) {
        isWrong = true
      }
      unknownSwitches += 1
      continue
    }
    seen.set(name, (seen.get(name) ?? 0) + 1)
    if (arg === expected) {
      continue
    }

    isResolverWrong ||= expected.endsWith(BROWSER_HOST_RESOLVER_RULES)
    isWrong = true
  }
  for (const [name, expected] of own) {
    if (seen.get(name) === 1) {
      continue
    }

    isResolverWrong ||= expected.endsWith(BROWSER_HOST_RESOLVER_RULES)
    isWrong = true
  }
  if (isResolverWrong) {
    return { kind: 'resolver' }
  }
  const isPageWrong = positional.length !== 1 || positional[0] !== BROWSER_BLANK_PAGE
  return isWrong || isPageWrong ? { kind: 'unrecognized' } : { kind: 'ok', unknownSwitches }
}

// The variables a child keeps if present, by OS (spec §6.4); every other
// variable, proxy and credential ones included, is left out.
const KEPT_EVERYWHERE = ['LANG', 'LANGUAGE', 'TZ']
const LOCALE_PREFIX = 'LC_'
const KEPT: Readonly<Record<string, readonly string[]>> = {
  win32: [
    'SystemRoot',
    'SystemDrive',
    'windir',
    'ProgramFiles',
    'ProgramFiles(x86)',
    'ProgramW6432',
    'ProgramData',
    'LOCALAPPDATA',
    'APPDATA',
    'USERPROFILE',
    'PROCESSOR_ARCHITECTURE',
    'NUMBER_OF_PROCESSORS',
  ],
  darwin: ['HOME', 'USER', 'LOGNAME'],
  linux: ['FONTCONFIG_FILE', 'FONTCONFIG_PATH'],
}
const POSIX_PATH = '/usr/bin:/bin:/usr/sbin:/sbin'
const XDG_HOMES = ['XDG_CONFIG_HOME', 'XDG_CACHE_HOME', 'XDG_DATA_HOME', 'XDG_STATE_HOME']

/** A variable by name, case-insensitively on Windows, as the OS reads it. */
function valueOf(
  env: Readonly<Record<string, string | undefined>>,
  platform: NodeJS.Platform,
  name: string,
): string | undefined {
  if (platform !== 'win32') {
    return env[name]
  }
  const key = Object.keys(env).find((candidate) => candidate.toLowerCase() === name.toLowerCase())
  return key === undefined ? undefined : env[key]
}

/** The browser's environment: a projection of this process's, plus the check's own folders. */
export function browserEnvironment(
  platform: NodeJS.Platform,
  env: Readonly<Record<string, string | undefined>>,
  folders: CheckFolders,
): Readonly<Record<string, string>> {
  const out: Record<string, string> = {}
  const keep = (name: string): void => {
    const value = valueOf(env, platform, name)
    if (value !== undefined) {
      out[name] = value
    }
  }
  for (const name of [...KEPT_EVERYWHERE, ...(KEPT[platform] ?? [])]) {
    keep(name)
  }
  for (const name of Object.keys(env)) {
    if (name.toUpperCase().startsWith(LOCALE_PREFIX)) {
      keep(name)
    }
  }
  if (platform === 'win32') {
    const root = valueOf(env, platform, 'SystemRoot') ?? String.raw`C:\Windows`
    out['PATH'] = String.raw`${root}\System32;${root}`
    out['TEMP'] = folders.temp
    out['TMP'] = folders.temp
    return out
  }
  out['PATH'] = POSIX_PATH
  out['TMPDIR'] = folders.temp
  if (platform !== 'darwin') {
    out['HOME'] = folders.home
    for (const name of XDG_HOMES) {
      out[name] = folders.home
    }
  }
  return out
}
