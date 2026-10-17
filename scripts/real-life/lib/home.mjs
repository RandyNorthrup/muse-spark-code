// A new, empty home for the product and the environment it runs in: nothing
// of the person's own profile, settings, sessions or usage history is read
// or written. The operating system's credential store is the one thing a
// new home cannot replace (it belongs to the signed-in user), so the run
// stores its keys there under names of its own and removes them afterwards
// (lib/routes.mjs).
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

// A variable that can hold a credential never reaches the product: the
// product takes a key from its own store or its own standard input only.
const CREDENTIAL_NAME = /KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|AUTH|COOKIE|SESSION_ID/iu
// Names that match the pattern above and hold no credential: the session
// bus a Linux credential store is reached through, and SSH's agent socket.
const NOT_A_CREDENTIAL = new Set(['DBUS_SESSION_BUS_ADDRESS', 'SSH_AUTH_SOCK'])

// Node must not load caller-controlled code before the installed product.
const NODE_INJECTION = new Set(['NODE_OPTIONS', 'NODE_PATH'])

/** Whether a variable of the caller is handed to the product. */
export const isPassedOn = (name) =>
  !NODE_INJECTION.has(name.toUpperCase()) &&
  (NOT_A_CREDENTIAL.has(name) || !CREDENTIAL_NAME.test(name))

/**
 * A fresh folder tree: where the artefact is installed, the home, and an
 * empty workspace per scenario.
 * @param {string} [parent] where to make it (the system's temporary folder by default)
 */
export function newRunFolders(parent = tmpdir()) {
  mkdirSync(parent, { recursive: true })
  const root = mkdtempSync(path.join(parent, 'real-life-'))
  const folders = {
    root,
    install: path.join(root, 'install'),
    home: path.join(root, 'home'),
    workspaces: path.join(root, 'workspaces'),
  }
  for (const folder of [folders.install, folders.home, folders.workspaces]) mkdirSync(folder)
  return folders
}

/**
 * The environment the product runs in: the caller's own (the machine as it
 * is: its path, its user, its session), without anything that can hold a
 * credential, and with the new home under every name a system knows a home
 * by. The folders an operating system gives every profile exist; nothing
 * else does.
 * @param {string} home
 * @param {NodeJS.ProcessEnv} [from]
 */
export function productEnvironment(home, from = process.env) {
  const env = {}
  for (const [name, value] of Object.entries(from)) {
    if (value !== undefined && isPassedOn(name)) env[name] = value
  }
  const temp = path.join(home, 'tmp')
  const roaming = path.join(home, 'AppData', 'Roaming')
  const local = path.join(home, 'AppData', 'Local')
  mkdirSync(temp, { recursive: true })
  if (process.platform === 'win32') {
    mkdirSync(roaming, { recursive: true })
    mkdirSync(local, { recursive: true })
  }
  // Windows also names the home in two parts (`C:` and the rest).
  const drive = path.parse(home).root.replace(/[\\/]+$/u, '')
  return {
    ...env,
    HOME: home,
    USERPROFILE: home,
    ...(process.platform === 'win32' && { HOMEDRIVE: drive, HOMEPATH: home.slice(drive.length) }),
    APPDATA: roaming,
    LOCALAPPDATA: local,
    XDG_CONFIG_HOME: path.join(home, '.config'),
    XDG_DATA_HOME: path.join(home, '.local', 'share'),
    XDG_STATE_HOME: path.join(home, '.local', 'state'),
    XDG_CACHE_HOME: path.join(home, '.cache'),
    TEMP: temp,
    TMP: temp,
    TMPDIR: temp,
    // Usage scenarios read English UI labels; never depend on the caller's
    // locale or Windows' runtime locale. The run certifies English UI only.
    LC_ALL: 'en_US.UTF-8',
    LC_MESSAGES: 'en_US.UTF-8',
    LANG: 'en_US.UTF-8',
    NO_COLOR: '1',
  }
}

/**
 * Where the product keeps its own data in a home, as its README names the
 * folder for each system.
 * @param {string} home
 */
export function dataFolderOf(home) {
  if (process.platform === 'win32') return path.join(home, 'AppData', 'Local', 'Muse Spark Code')
  return process.platform === 'darwin'
    ? path.join(home, 'Library', 'Application Support', 'Muse Spark Code')
    : path.join(home, '.local', 'share', 'muse-spark-code')
}

/**
 * Sets the product's own daily budget in a new home, the way its README
 * says a person sets it for the terminal agent: `paidDailyBudgetUsd` in the
 * data folder's `settings.json` ($0.50 to $500; $5 when nothing is set).
 * @param {string} home a home the run made, with no settings yet
 * @param {number} usd
 */
export function setDailyBudget(home, usd) {
  const folder = dataFolderOf(home)
  mkdirSync(folder, { recursive: true })
  writeFileSync(
    path.join(folder, 'settings.json'),
    `${JSON.stringify({ paidDailyBudgetUsd: usd })}\n`,
  )
}
