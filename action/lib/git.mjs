// The one sanitized Git runner (M80, SPEC §6.3, decision D-M4). Every Git
// child of every phase (checkout, input diff, intent-to-add, patch diff,
// prepare and push) goes through safeGit under the launcher owner. It
// reproduces the host's metadata suppression (GIT_METADATA_OPTIONS in the
// extension's source; the parity is tested), adds the Action's own
// overrides, and builds an allow-list environment with no inherited GIT_*
// variable, no credential helper and no header except one explicit one-shot
// token for one command.
//
// Configuration is closed by its shape, not by a list of dangerous keys
// (RVM80CD P1): no system file, an empty global file, no inherited
// GIT_CONFIG_PARAMETERS/COUNT, no discovery above the working directory, and
// before every command every effective configuration name outside this
// command's own overrides (the repository's file and anything it includes)
// must be one a fresh `git init` writes. Those name no program. Anything else
// (url.*.insteadOf, include/includeIf, core.sshCommand, remote.*.uploadpack,
// credential, filter, diff, protocol, http and every key Git may add later)
// refuses the command before it starts. Network commands may use only the
// validated remote's own transport (GIT_ALLOW_PROTOCOL).

import { Buffer } from 'node:buffer'
import path from 'node:path'
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
// Every effective configuration name with its scope, includes followed, as
// NUL-separated scope/name pairs. Names only: a configured value is never read.
const ACTION_CONFIG_LIST_ARGS = Object.freeze([
  'config',
  '--null',
  '--name-only',
  '--list',
  '--show-scope',
])
// The names a fresh `git init` writes on Linux, macOS and Windows, and the
// repository format extensions. None of them names a program.
export const INERT_CONFIG_NAMES = Object.freeze(
  new Set([
    'core.repositoryformatversion',
    'core.filemode',
    'core.bare',
    'core.logallrefupdates',
    'core.symlinks',
    'core.ignorecase',
    'core.precomposeunicode',
    'extensions.objectformat',
    'extensions.refstorage',
  ]),
)
// The scope of this command's own -c and GIT_CONFIG_COUNT overrides.
const OWN_SCOPE = 'command'
const PAIR_SEPARATOR = '\u{0}'
// Read-only Git commands (no index refresh lock).
const READ_ONLY = new Set(['config', 'diff', 'rev-parse', 'merge-base', 'cat-file'])
const AUTH_COMMAND = Object.freeze({ checkout: 'fetch', push: 'push' })
const HTTPS_PROTOCOL = 'https'
const FILE_PROTOCOL = 'file'

/**
 * Refuses unless every configuration name outside this command's own
 * overrides is inert. `output` is ACTION_CONFIG_LIST_ARGS's: malformed
 * output fails closed, and the error names neither a key nor a value.
 */
export function checkConfigNames(output) {
  const fields = output === '' ? [] : output.split(PAIR_SEPARATOR)
  if (fields.at(-1) === '') fields.pop()
  if (fields.length % 2 !== 0) throw new Error('git configuration listing is malformed')
  for (let index = 0; index < fields.length; index += 2) {
    const scope = fields[index]
    const name = fields[index + 1]
    if (scope !== OWN_SCOPE && !INERT_CONFIG_NAMES.has(name)) {
      throw new Error('git configuration names a setting this Action does not allow')
    }
  }
}

/** The one transport a network command may use: the validated remote's own. */
export function remoteProtocol(remote) {
  if (typeof remote === 'string' && remote.startsWith('https://')) return HTTPS_PROTOCOL
  // Only the tests' local bare repositories; remoteFor builds https remotes.
  if (typeof remote === 'string' && path.isAbsolute(remote)) return FILE_PROTOCOL
  throw new Error('the remote must be an https URL')
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
 * name removed (GIT_CONFIG_PARAMETERS and GIT_CONFIG_COUNT included), then
 * the isolated global configuration, no system configuration or
 * attributes, no repository discovery above `cwd`, one allowed transport,
 * no terminal prompt, optional locks off for read-only commands, and
 * http.extraHeader reset (then, for the one authenticated command, set to
 * its one-shot token header).
 */
export function gitEnvironment({ baseEnv, paths, readOnly, auth, cwd, protocol = HTTPS_PROTOCOL }) {
  const env = Object.fromEntries(
    Object.entries(baseEnv).filter(([name]) => !name.toUpperCase().startsWith('GIT_')),
  )
  env.GIT_CONFIG_NOSYSTEM = '1'
  env.GIT_CONFIG_GLOBAL = paths.emptyGitConfig
  env.GIT_ATTR_NOSYSTEM = '1'
  env.GIT_ALLOW_PROTOCOL = protocol
  if (cwd !== undefined) env.GIT_CEILING_DIRECTORIES = path.dirname(path.resolve(cwd))
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
 * Runs one Git command under the owner. Every effective configuration name
 * is listed again before every command, so configuration changed by an
 * earlier step (an apply, an agent's edit) refuses the command instead of
 * selecting a program. `protocol` is the one transport a network command
 * may use (remoteProtocol). Returns the child's outcome; callers treat a
 * nonzero code as a fixed failure.
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
  stdoutPrefixMaxBytes,
  auth,
  protocol,
  withinMs = ACTION_GIT_MS,
  stdoutMaxBytes = ACTION_CHILD_STDOUT_MAX_BYTES,
}) {
  const command = subcommandOf(args)
  if (
    stdoutPrefixMaxBytes !== undefined &&
    (!readOnly ||
      stdoutPath === undefined ||
      command !== 'diff' ||
      args.includes('--binary') ||
      path.resolve(stdoutPath).replaceAll('\\', '/') !==
        path.resolve(paths.diffFull).replaceAll('\\', '/'))
  )
    throw new Error('prefix capture is only for the read-only review diff')
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
    args: [...options, ...ACTION_CONFIG_LIST_ARGS],
    cwd,
    env: gitEnvironment({ baseEnv, paths, readOnly: true, cwd }),
    withinMs,
    stdoutMaxBytes: ACTION_CHILD_STDOUT_MAX_BYTES,
    stderrMaxBytes: ACTION_STDERR_MAX_BYTES,
  })
  if (listing.code !== 0) {
    throw new Error(`git config listing failed (exit ${String(listing.code)})`)
  }
  checkConfigNames(Buffer.from(listing.stdout).toString('utf8'))
  return await owner.child({
    file: git,
    args: [...options, ...args],
    cwd,
    env: gitEnvironment({ baseEnv, paths, readOnly, auth, cwd, protocol }),
    stdoutPath,
    stdoutPrefixMaxBytes,
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
