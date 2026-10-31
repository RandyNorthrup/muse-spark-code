import { lstatSync, readFileSync, realpathSync, statSync } from 'node:fs'
import path from 'node:path'
import * as z from 'zod/mini'

// Native manifests, children and receipts consume A's reviewed snapshot version.
export const MHP_VERSION = z
  .object({ protocol: z.string().check(z.regex(/^mhp\/\d+\.\d+\.\d+$/u)) })
  .parse(
    JSON.parse(
      readFileSync(new URL('../../src/shared/hostApi/mhp-v1.schema.json', import.meta.url), 'utf8'),
    ),
  ).protocol

export const HOSTS = {
  jetbrains: { os: 'ubuntu-latest', channel: 'JetBrains Marketplace' },
  visualstudio: { os: 'windows-latest', channel: 'Visual Studio Marketplace' },
  eclipse: { os: 'ubuntu-latest', channel: 'Eclipse p2' },
  zed: { os: 'ubuntu-latest', channel: 'Zed registry (owner PR)' },
  xcode: { os: 'macos-latest', channel: 'Xcode Developer ID / notarization' },
  qtcreator: { os: 'ubuntu-latest', channel: 'Qt Creator registry (owner PR)' },
  neovim: { os: 'ubuntu-latest', channel: 'Neovim GitHub / luarocks' },
  emacs: { os: 'ubuntu-latest', channel: 'MELPA (owner PR)' },
  sublime: { os: 'ubuntu-latest', channel: 'Package Control (owner PR)' },
}
const text = z.string().check(z.minLength(1))
const relative = text.check(
  z.refine(
    (value) =>
      !path.posix.isAbsolute(value) &&
      !path.win32.isAbsolute(value) &&
      !value.split(/[/\\]/u).includes('..') &&
      !value.includes('\0'),
  ),
)
const command = z.strictObject({ command: text, args: z.array(z.string()) })
export const distributionSchema = z.strictObject({
  mhp: z.literal(MHP_VERSION),
  build: z.array(command).check(z.minLength(1)),
  conformance: command,
  artifacts: z.array(relative).check(z.minLength(1)),
  sign: z.optional(command),
  publish: z.optional(command),
})

/** Resolve existing files without allowing symlinks to escape their source tree. */
export function inside(root, name) {
  const base = realpathSync(root)
  const target = realpathSync(path.resolve(base, name))
  const relativePath = path.relative(base, target)
  if (
    relativePath === '..' ||
    relativePath.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativePath)
  )
    throw new Error('MHP_HOST_PATH_ESCAPE')
  return target
}

/** Absence is the only clean build/conformance skip; an incomplete host fails. */
export function hostManifest(root, host) {
  if (!Object.hasOwn(HOSTS, host)) throw new Error('MHP_UNKNOWN_HOST')
  const directory = path.join(root, 'hosts', host)
  if (!lstatSync(directory, { throwIfNoEntry: false }))
    return { host, outcome: 'skipped-host-absent', reason: `hosts/${host} is absent` }
  const source = inside(root, path.join('hosts', host))
  if (!statSync(source).isDirectory()) throw new Error('MHP_HOST_NOT_DIRECTORY')
  const manifest = distributionSchema.parse(
    JSON.parse(readFileSync(inside(source, 'distribution.json'), 'utf8')),
  )
  return { host, directory: source, manifest }
}

/** No build or harness child receives credentials or Node injection variables. */
export function buildEnvironment(env) {
  return Object.fromEntries(
    Object.entries(env).filter(
      ([name]) =>
        !/(?:_KEY(?:_ID)?|_ISSUER_ID|TOKEN|SECRET|PASSWORD|CERTIFICATE(?:_CHAIN)?|_PAT)$/iu.test(
          name,
        ) &&
        !/^(?:NODE_OPTIONS|NODE_PATH|SSH_AUTH_SOCK|GIT_ASKPASS|SSH_ASKPASS|GOOGLE_APPLICATION_CREDENTIALS|AWS_SHARED_CREDENTIALS_FILE|AZURE_CLIENT_SECRET)$/iu.test(
          name,
        ),
    ),
  )
}
