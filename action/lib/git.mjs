// The one sanitized Git runner (M80, SPEC §6.3, decision D-M4). Every Git
// child of every phase (checkout, input diff, intent-to-add, patch diff,
// prepare and push) goes through safeGit under the launcher owner. It
// reproduces the host's suppression of configured programs
// (GIT_METADATA_OPTIONS and gitFilterOptions in the extension's source; the
// parity is tested), adds the Action's own overrides, and builds an
// allow-list environment with no inherited GIT_* variable, no credential
// helper and no header except one explicit one-shot token for one command.

import { Buffer } from 'node:buffer'
import {
  ACTION_CHILD_STDOUT_MAX_BYTES,
  ACTION_GIT_MS,
  ACTION_STDERR_MAX_BYTES,
} from './lifecycle.mjs'

// A projection of src/shared/constants.ts GIT_METADATA_OPTIONS (parity-tested).
export const GIT_METADATA_OPTIONS = Object.freeze([
  '--no-replace-objects',
  '-c',
  'core.fsmonitor=',
  '-c',
  'log.showSignature=false',
  '-c',
  'maintenance.auto=false',
  '-c',
  'gc.auto=0',
  '-c',
  'core.quotePath=false',
])
// The host's limits on filter names (GIT_FILTER_NAMES_MAX, GIT_FILTER_NAME_MAX_CHARS).
export const GIT_FILTER_NAMES_MAX = 200
export const GIT_FILTER_NAME_MAX_CHARS = 1024
// The host lists clean/process/required; checkout also needs smudge.
export const ACTION_FILTER_NAMES_ARGS = Object.freeze([
  'config',
  '--null',
  '--name-only',
  '--get-regexp',
  String.raw`^filter\..*\.(clean|process|required|smudge)$`,
])
const FILTER_KEY = /^filter\.([^=\p{Cc}]+)\.(?:clean|process|required|smudge)$/u
const FILTER_SEPARATOR = '\u{0}'
const NO_MATCH_EXIT = 1
// Read-only Git commands (no index refresh lock).
const READ_ONLY = new Set(['config', 'diff', 'rev-parse', 'merge-base', 'cat-file'])
const AUTH_COMMAND = Object.freeze({ checkout: 'fetch', push: 'push' })

/**
 * Scoped overrides for the configured filter drivers named by `output`
 * (`git config --null --name-only --get-regexp`): each driver's clean,
 * process and smudge become empty and required becomes false. Names only;
 * a configured command value is never read. Invalid or oversize names fail
 * closed, as the host's gitFilterOptions does.
 */
export function filterOverrides(output) {
  const names = output === '' ? [] : output.split(FILTER_SEPARATOR)
  if (names.at(-1) === '') names.pop()
  if (
    names.length > GIT_FILTER_NAMES_MAX ||
    names.some((name) => name.length > GIT_FILTER_NAME_MAX_CHARS || !FILTER_KEY.test(name))
  ) {
    throw new Error('git filter driver names are invalid')
  }
  const drivers = new Set(names.map((key) => key.slice(0, key.lastIndexOf('.'))))
  return [...drivers].flatMap((driver) => [
    '-c',
    `${driver}.clean=`,
    '-c',
    `${driver}.process=`,
    '-c',
    `${driver}.required=false`,
    '-c',
    `${driver}.smudge=`,
  ])
}

/** The options before every command: metadata suppression plus the Action's overrides. */
export function safeGitOptions(paths) {
  return [
    ...GIT_METADATA_OPTIONS,
    '-c',
    'core.fsmonitor=false',
    '-c',
    `core.hooksPath=${paths.emptyHooks}`,
    '-c',
    'diff.external=',
    '-c',
    'commit.gpgsign=false',
    '-c',
    'tag.gpgsign=false',
    '-c',
    'core.askPass=',
    '-c',
    'credential.helper=',
    '-c',
    'submodule.recurse=false',
  ]
}

function authorizationHeader(token) {
  const basic = Buffer.from(`x-access-token:${token}`, 'utf8').toString('base64')
  return `AUTHORIZATION: basic ${basic}`
}

/**
 * Git's environment: the owner's allow-list environment with every GIT_*
 * name removed, then the isolated global configuration, no system
 * configuration or attributes, no terminal prompt, optional locks off for
 * read-only commands, and http.extraHeader reset (then, for the one
 * authenticated command, set to its one-shot token header).
 */
export function gitEnvironment({ baseEnv, paths, readOnly, auth }) {
  const env = Object.fromEntries(
    Object.entries(baseEnv).filter(([name]) => !name.toUpperCase().startsWith('GIT_')),
  )
  env.GIT_CONFIG_NOSYSTEM = '1'
  env.GIT_CONFIG_GLOBAL = paths.emptyGitConfig
  env.GIT_ATTR_NOSYSTEM = '1'
  env.GIT_TERMINAL_PROMPT = '0'
  if (readOnly) env.GIT_OPTIONAL_LOCKS = '0'
  const entries = [['http.extraHeader', '']]
  if (auth !== undefined) entries.push(['http.extraHeader', authorizationHeader(auth.token)])
  env.GIT_CONFIG_COUNT = String(entries.length)
  for (const [index, [key, value]] of entries.entries()) {
    env[`GIT_CONFIG_KEY_${String(index)}`] = key
    env[`GIT_CONFIG_VALUE_${String(index)}`] = value
  }
  return env
}

/** The subcommand of an argument list, past `-c name=value` pairs and other options. */
export function subcommandOf(args) {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === '-c') index += 1
    else if (!arg.startsWith('-')) return arg
  }
  return ''
}

/**
 * Runs one Git command under the owner. The filter driver names are listed
 * again before every command, so configuration changed by an earlier step
 * (an apply, an agent's edit) cannot select a program. Returns the child's
 * outcome; callers treat a nonzero code as a fixed failure.
 */
export async function safeGit({
  owner,
  git,
  cwd,
  args,
  paths,
  baseEnv,
  readOnly,
  stdoutPath,
  auth,
  withinMs = ACTION_GIT_MS,
  stdoutMaxBytes = ACTION_CHILD_STDOUT_MAX_BYTES,
}) {
  const command = subcommandOf(args)
  if (auth !== undefined && AUTH_COMMAND[auth.kind] !== command) {
    throw new Error(
      `a ${String(auth.kind)} token is only for git ${String(AUTH_COMMAND[auth.kind])}`,
    )
  }
  if (readOnly && !READ_ONLY.has(command)) {
    throw new Error(`git ${command} is not read-only`)
  }
  const options = safeGitOptions(paths)
  const listing = await owner.child({
    file: git,
    args: [...options, ...ACTION_FILTER_NAMES_ARGS],
    cwd,
    env: gitEnvironment({ baseEnv, paths, readOnly: true }),
    withinMs,
    stdoutMaxBytes: ACTION_CHILD_STDOUT_MAX_BYTES,
    stderrMaxBytes: ACTION_STDERR_MAX_BYTES,
  })
  if (listing.code !== 0 && listing.code !== NO_MATCH_EXIT) {
    throw new Error(`git config listing failed (exit ${String(listing.code)})`)
  }
  const names = listing.code === 0 ? Buffer.from(listing.stdout).toString('utf8') : ''
  return await owner.child({
    file: git,
    args: [...options, ...filterOverrides(names), ...args],
    cwd,
    env: gitEnvironment({ baseEnv, paths, readOnly, auth }),
    stdoutPath,
    withinMs,
    stdoutMaxBytes,
    stderrMaxBytes: ACTION_STDERR_MAX_BYTES,
  })
}

/** A Git outcome that must have succeeded; the failure names only the command and code. */
export function requireGit(outcome, what) {
  if (outcome.code !== 0) {
    throw new Error(`git ${what} failed (exit ${String(outcome.code ?? outcome.signal)})`)
  }
  return outcome
}

/** Git's stdout as trimmed UTF-8 text. */
export function gitText(outcome) {
  return Buffer.from(outcome.stdout).toString('utf8').trim()
}
