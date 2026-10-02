// Whether an administrator's policy could carry the browser check's traffic
// past its block (M81, PLAN.md D49; review RV81). The check sends what the
// Fetch domain cannot hold (a WebSocket, a preconnect) to a proxy that does
// not exist, set on the command line. A mandatory proxy policy outranks the
// command line, so on a machine that has one the check refuses to start:
//
// - Chrome's ProxySettings: "This policy overrides the following individual
//   policies: ProxyMode, ProxyPacUrl, ProxyServer, ProxyBypassList" and
//   "overrides command-line proxy options"
//   (https://chromeenterprise.google/policies/#ProxySettings); Edge's: "If
//   you enable this policy, Microsoft Edge ignores all proxy-related options
//   specified from the command line"
//   (https://learn.microsoft.com/en-us/deployedge/microsoft-edge-browser-policies/proxysettings);
//   ProxyMode and the rest likewise. Every policy named Proxy… counts.
// - Chromium's preference stores rank managed (policy) prefs above
//   extension and command-line prefs, and recommended prefs below them
//   (https://www.chromium.org/developers/design-documents/preferences/), so
//   only mandatory policy is read.
// - A cloud management enrollment token (CloudManagementEnrollmentToken)
//   brings policies from Google's servers that cannot be read here, a proxy
//   among them, so it refuses too
//   (https://support.google.com/chrome/a/answer/9301891).
//
// Where each OS keeps mandatory policy:
//
// - Windows: values directly under HKLM and HKCU
//   SOFTWARE\Policies\Google\Chrome and SOFTWARE\Policies\Microsoft\Edge
//   (Edge's "Registry Path (Mandatory)", same page; recommended policy is in
//   the Recommended subkey, not read), in both registry views. A key is
//   found by listing its parent, from SOFTWARE down, so an absent key is
//   told apart from a failed read without reading reg.exe's localised error.
// - Linux: every file in /etc/opt/chrome/policies/managed ("You can spread
//   your policies over multiple JSON files. Chrome will read and apply them
//   all", https://www.chromium.org/administrators/linux-quick-start/),
//   Chromium's /etc/chromium/policies/managed (and Ubuntu's
//   /etc/chromium-browser), Edge's /etc/opt/edge/policies/managed; the
//   enrollment token file /etc/opt/chrome/policies/enrollment.
// - macOS: the forced preferences a configuration profile installs, for the
//   machine (/Library/Managed Preferences/<domain>.plist) and for the user
//   (/Library/Managed Preferences/<user>/<domain>.plist), domains
//   com.google.Chrome and com.microsoft.Edge
//   (https://learn.microsoft.com/en-us/deployedge/configure-microsoft-edge-on-mac);
//   the enrollment token file /Library/Google/Chrome.
//
// Every location is read for both browsers, whichever one the check found:
// a PATH entry named google-chrome need not be Google's build. A location
// that exists but cannot be read (a permission, a file that is not JSON, a
// plist plutil cannot convert) refuses too: the check cannot tell. Pure: the
// file, plutil and reg.exe reads are injected (browserPolicyReaders.ts).

import path from 'node:path'
import {
  BROWSER_POLICY_CLOUD_NAMES,
  BROWSER_POLICY_ENROLLMENT_FILES,
  BROWSER_POLICY_FILES_MAX,
  BROWSER_POLICY_LINUX_FOLDERS,
  BROWSER_POLICY_MACOS_DOMAINS,
  BROWSER_POLICY_MACOS_FOLDER,
  BROWSER_POLICY_PROXY_PREFIX,
  BROWSER_POLICY_WINDOWS_HIVES,
  BROWSER_POLICY_WINDOWS_KEYS,
  BROWSER_POLICY_WINDOWS_VIEWS,
} from '../../shared/constants'

export type ManagedPolicyVerdict =
  | { readonly kind: 'none' }
  /** A policy that could override the check's block, and where it is set. */
  | { readonly kind: 'found'; readonly where: string }
  | { readonly kind: 'unreadable'; readonly where: string; readonly detail: string }

export interface ManagedPolicyReaders {
  readonly platform: NodeJS.Platform
  /** The user's short name, for the user's own macOS managed preferences. */
  readonly userName: () => string
  /** A folder's file names; undefined when it does not exist. Rejects on any other failure. */
  readonly listFiles: (folder: string) => Promise<readonly string[] | undefined>
  /** A file's text, within its bound; undefined when it does not exist. Rejects on any other failure. */
  readonly readText: (file: string) => Promise<string | undefined>
  /** Whether a file exists. Rejects when that cannot be told. */
  readonly isPresent: (file: string) => Promise<boolean>
  /** A property list as XML (`plutil -convert xml1 -o -`). */
  readonly plistXml: (file: string) => Promise<string>
  /** `reg query <key> <view>`'s output. Rejects when reg.exe fails. */
  readonly queryRegistry: (key: string, view: string) => Promise<string>
}

const NONE: ManagedPolicyVerdict = { kind: 'none' }
const PLIST_KEY = /<key>([^<]*)<\/key>/g
// A value line of `reg query`: four spaces, the name, four spaces, its type.
const REGISTRY_VALUE = /^ {4}(.*?) {4}REG_[A-Z_\d]+/
const REGISTRY_ROOTS: Readonly<Record<string, string>> = {
  HKLM: 'HKEY_LOCAL_MACHINE',
  HKCU: 'HKEY_CURRENT_USER',
}

/** Whether a policy of this name could override the check's block. */
export function isBlockingPolicyName(name: string): boolean {
  const lower = name.trim().toLowerCase()
  return lower.startsWith(BROWSER_POLICY_PROXY_PREFIX) || BROWSER_POLICY_CLOUD_NAMES.includes(lower)
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function foundIn(where: string, names: Iterable<string>): ManagedPolicyVerdict {
  for (const name of names) {
    if (isBlockingPolicyName(name)) {
      return { kind: 'found', where: `${where} (${name.trim()})` }
    }
  }
  return NONE
}

/** The first verdict that is not `none`, checked in order. */
async function firstOf(
  checks: readonly (() => Promise<ManagedPolicyVerdict>)[],
): Promise<ManagedPolicyVerdict> {
  for (const check of checks) {
    const verdict = await check()
    if (verdict.kind !== 'none') {
      return verdict
    }
  }
  return NONE
}

async function checkEnrollmentFile(readers: ManagedPolicyReaders): Promise<ManagedPolicyVerdict> {
  const file = BROWSER_POLICY_ENROLLMENT_FILES[readers.platform]
  if (file === undefined) {
    return NONE
  }
  try {
    return (await readers.isPresent(file)) ? { kind: 'found', where: file } : NONE
  } catch (error: unknown) {
    return { kind: 'unreadable', where: file, detail: describe(error) }
  }
}

/** One Linux JSON policy file's top-level names. */
async function checkJsonFile(
  readers: ManagedPolicyReaders,
  file: string,
): Promise<ManagedPolicyVerdict> {
  let parsed: unknown
  try {
    const text = await readers.readText(file)
    // A file gone since the folder was listed holds no policy.
    parsed = text === undefined ? {} : JSON.parse(text)
  } catch (error: unknown) {
    return { kind: 'unreadable', where: file, detail: describe(error) }
  }
  return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
    ? foundIn(file, Object.keys(parsed))
    : { kind: 'unreadable', where: file, detail: 'not a JSON object' }
}

async function checkLinuxFolder(
  readers: ManagedPolicyReaders,
  folder: string,
): Promise<ManagedPolicyVerdict> {
  let names: readonly string[] | undefined
  try {
    names = await readers.listFiles(folder)
  } catch (error: unknown) {
    return { kind: 'unreadable', where: folder, detail: describe(error) }
  }
  if (names === undefined) {
    return NONE
  }
  if (names.length > BROWSER_POLICY_FILES_MAX) {
    return {
      kind: 'unreadable',
      where: folder,
      detail: `more than ${String(BROWSER_POLICY_FILES_MAX)} files`,
    }
  }
  return await firstOf(
    names
      .toSorted((a, b) => a.localeCompare(b))
      .map((name) => async () => await checkJsonFile(readers, path.posix.join(folder, name))),
  )
}

async function checkPlist(
  readers: ManagedPolicyReaders,
  file: string,
): Promise<ManagedPolicyVerdict> {
  try {
    if (!(await readers.isPresent(file))) {
      return NONE
    }
    const xml = await readers.plistXml(file)
    return foundIn(
      file,
      Array.from(xml.matchAll(PLIST_KEY), (match) => match[1] ?? ''),
    )
  } catch (error: unknown) {
    return { kind: 'unreadable', where: file, detail: describe(error) }
  }
}

function macPlists(readers: ManagedPolicyReaders): readonly string[] {
  const user = readers.userName()
  return BROWSER_POLICY_MACOS_DOMAINS.flatMap((domain) => [
    path.posix.join(BROWSER_POLICY_MACOS_FOLDER, `${domain}.plist`),
    path.posix.join(BROWSER_POLICY_MACOS_FOLDER, user, `${domain}.plist`),
  ])
}

/** A `reg query` listing: the key's direct subkeys by name, and its value names. */
export function parseRegistryListing(
  key: string,
  output: string,
): { readonly subkeys: readonly string[]; readonly values: readonly string[] } {
  const subkeys: string[] = []
  const values: string[] = []
  const prefix = `${key.toLowerCase()}\\`
  for (const line of output.split(/\r?\n/)) {
    const value = REGISTRY_VALUE.exec(line)
    if (value !== null) {
      values.push(value[1] ?? '')
      continue
    }
    const trimmed = line.trim()
    if (trimmed.toLowerCase().startsWith(prefix)) {
      subkeys.push(trimmed.slice(prefix.length))
    }
  }
  return { subkeys, values }
}

/**
 * One policy key in one hive: listed from SOFTWARE down, each part looked
 * for in its parent's subkeys, so an absent key is `none` and a failed read
 * is `unreadable`.
 */
async function checkRegistryKey(
  query: (key: string) => Promise<string>,
  hive: string,
  key: string,
): Promise<ManagedPolicyVerdict> {
  const [first = '', ...rest] = key.split('\\')
  let current = `${REGISTRY_ROOTS[hive] ?? hive}\\${first}`
  try {
    let listing = parseRegistryListing(current, await query(current))
    for (const part of rest) {
      const lower = part.toLowerCase()
      if (listing.subkeys.every((subkey) => subkey.toLowerCase() !== lower)) {
        return NONE
      }
      current += `\\${part}`
      listing = parseRegistryListing(current, await query(current))
    }
    return foundIn(current, listing.values)
  } catch (error: unknown) {
    return { kind: 'unreadable', where: current, detail: describe(error) }
  }
}

/** Both keys in one hive and view, each listing read once. */
async function checkRegistryView(
  readers: ManagedPolicyReaders,
  hive: string,
  view: string,
): Promise<ManagedPolicyVerdict> {
  const listings = new Map<string, Promise<string>>()
  const query = async (key: string): Promise<string> => {
    let listing = listings.get(key)
    if (listing === undefined) {
      listing = readers.queryRegistry(key, view)
      listings.set(key, listing)
    }
    return await listing
  }
  return await firstOf(
    BROWSER_POLICY_WINDOWS_KEYS.map((key) => async () => await checkRegistryKey(query, hive, key)),
  )
}

/** Every hive in every view at once; the first verdict in that order that is not `none`. */
async function checkWindows(readers: ManagedPolicyReaders): Promise<ManagedPolicyVerdict> {
  const verdicts = await Promise.all(
    BROWSER_POLICY_WINDOWS_HIVES.flatMap((hive) =>
      BROWSER_POLICY_WINDOWS_VIEWS.map(
        async (view) => await checkRegistryView(readers, hive, view),
      ),
    ),
  )
  return verdicts.find((verdict) => verdict.kind !== 'none') ?? NONE
}

/** Whether a policy on this machine could override the check's block: before any browser starts. */
export async function findManagedProxyPolicy(
  readers: ManagedPolicyReaders,
): Promise<ManagedPolicyVerdict> {
  switch (readers.platform) {
    case 'win32': {
      return await checkWindows(readers)
    }
    case 'darwin': {
      let plists: readonly string[]
      try {
        plists = macPlists(readers)
      } catch (error: unknown) {
        // Without the user's name, the user's own managed preferences cannot be found.
        return { kind: 'unreadable', where: BROWSER_POLICY_MACOS_FOLDER, detail: describe(error) }
      }
      return await firstOf([
        ...plists.map((file) => async () => await checkPlist(readers, file)),
        async () => await checkEnrollmentFile(readers),
      ])
    }
    default: {
      return await firstOf([
        ...BROWSER_POLICY_LINUX_FOLDERS.map(
          (folder) => async () => await checkLinuxFolder(readers, folder),
        ),
        async () => await checkEnrollmentFile(readers),
      ])
    }
  }
}
