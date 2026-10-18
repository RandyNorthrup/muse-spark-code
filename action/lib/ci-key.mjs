// Other-CI credential intake has no dependency on the proposal launcher:
// entry strips names/value copies before loading it or starting any child.
import { Buffer } from 'node:buffer'
import { closeSync, constants as FS, fstatSync, openSync, readSync } from 'node:fs'

export const CI_SECRET_VARIABLE = 'MUSE_MODEL_API_KEY'
export const CI_KEY_FILE_VARIABLE = 'MUSE_MODEL_API_KEY_FILE'
export const CI_KEY_VARIABLES = Object.freeze([
  CI_SECRET_VARIABLE,
  'MUSE_SPARK_MODEL_API_KEY',
  'META_API_KEY',
])
export const CI_KEY_ALIASES_VARIABLE = 'MUSE_CI_KEY_ALIASES'
export const CI_BOOTSTRAP_UNSET = Object.freeze([
  ...CI_KEY_VARIABLES,
  CI_KEY_FILE_VARIABLE,
  'muse_key',
  'muse_key_file',
  'muse_setup',
  'muse_dir',
  'muse_start_ms',
  'muse_sum',
  'muse_alias',
])

// The Action's key cap (lifecycle.mjs ACTION_KEY_MAX_BYTES), restated so
// intake stays dependency-free; takeCiKey re-validates every value through
// the Action's own isValidModelApiKey, cap included.
const ACTION_KEY_MAX_BYTES = 4096

export function readCiKey(env) {
  const aliases = (env[CI_KEY_ALIASES_VARIABLE] ?? '').split(/\s+/).filter(Boolean)
  const aliasesValid = aliases.every(
    (name) =>
      /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) &&
      !/^(?:muse_ci_internal_|MUSE_(?:CI|INPUT|AGENT)_)/.test(name),
  )
  const names = [...CI_KEY_VARIABLES, ...aliases]
  const values = names
    .map((name) => env[name])
    .filter((value) => typeof value === 'string' && value !== '')
  const file = env[CI_KEY_FILE_VARIABLE]
  let hasFileFailed = false
  if (file !== undefined && file !== '') {
    let fd
    try {
      fd = openSync(file, FS.O_RDONLY | FS.O_NONBLOCK | FS.O_NOFOLLOW)
      const stat = fstatSync(fd)
      if (!stat.isFile() || stat.size > ACTION_KEY_MAX_BYTES + 1)
        throw new Error('invalid key file')
      const bytes = Buffer.alloc(ACTION_KEY_MAX_BYTES + 1)
      const count = readSync(fd, bytes, 0, bytes.length, 0)
      values.push(bytes.subarray(0, count).toString('utf8'))
      bytes.fill(0)
    } catch {
      hasFileFailed = true
    } finally {
      if (fd !== undefined) closeSync(fd)
    }
  }
  const needles = values.map((value) => value.replace(/\n$/, '')).filter(Boolean)
  for (const name of [...CI_BOOTSTRAP_UNSET, ...aliases]) Reflect.deleteProperty(env, name)
  for (const [name, value] of Object.entries(env)) {
    if (typeof value === 'string' && needles.some((needle) => value.includes(needle))) {
      Reflect.deleteProperty(env, name)
    }
  }
  if (!aliasesValid || hasFileFailed || new Set(needles).size !== 1) return
  return needles[0]
}
