// A new, empty home for the product and the environment it runs in: nothing
// of the person's own profile, settings, sessions or usage history is read
// or written. The operating system's credential store is the one thing a
// new home cannot replace (it belongs to the signed-in user), so the run
// stores its keys there under names of its own and removes them afterwards
// (lib/routes.mjs).
import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

// A variable that can hold a credential never reaches the product: the
// product takes a key from its own store or its own standard input only.
const CREDENTIAL_NAME = /KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|AUTH|COOKIE|SESSION_ID/iu
// Names that match the pattern above and hold no credential: the session
// bus a Linux credential store is reached through, and SSH's agent socket.
const NOT_A_CREDENTIAL = new Set(['DBUS_SESSION_BUS_ADDRESS', 'SSH_AUTH_SOCK'])

/** Whether a variable of the caller is handed to the product. */
export const isPassedOn = (name) => NOT_A_CREDENTIAL.has(name) || !CREDENTIAL_NAME.test(name)

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
  return {
    ...env,
    HOME: home,
    USERPROFILE: home,
    APPDATA: roaming,
    LOCALAPPDATA: local,
    XDG_CONFIG_HOME: path.join(home, '.config'),
    XDG_DATA_HOME: path.join(home, '.local', 'share'),
    XDG_STATE_HOME: path.join(home, '.local', 'state'),
    XDG_CACHE_HOME: path.join(home, '.cache'),
    TEMP: temp,
    TMP: temp,
    TMPDIR: temp,
    NO_COLOR: '1',
  }
}
