// M110-C: stage only a node-ready, locked runtime package. Lane N supplies it;
// an ACP-only package fails instead of producing a misleading node image.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cpSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { z } from 'zod'

const ROOT = path.resolve(import.meta.dirname, '..')
const POLICY = JSON.parse(readFileSync(path.join(ROOT, 'deploy/container/policy.json'), 'utf8'))
const Manifest = z.object({
  name: z.literal('muse-spark-code-acp'),
  version: z.string().regex(/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/),
  dependencies: z
    .object({
      'node-pty': z.literal('1.1.0'),
      '@napi-rs/keyring': z.literal('2.1.0'),
    })
    .strict(),
})
const Lock = z.object({
  lockfileVersion: z.literal(3),
  packages: z.record(z.string(), z.unknown()),
})
const ROOT_FILES = new Set([
  'package.json',
  'package-lock.json',
  'LICENSE',
  'THIRD_PARTY_NOTICES.txt',
])
const RUNTIME_DIRS = new Set(['dist', 'l10n', 'schemas'])
const FORBIDDEN =
  /(?:^|\/)(?:\.env(?:\..*)?|auth\.json|credentials(?:\.json)?|id_(?:rsa|ed25519)|.*\.(?:pem|key)|node_modules)(?:\/|$)/i

function filesIn(directory, prefix = '') {
  return readdirSync(directory).flatMap((name) => {
    const relative = path.posix.join(prefix, name)
    const stat = lstatSync(path.join(directory, name))
    if (FORBIDDEN.test(relative) || stat.isSymbolicLink()) {
      throw new Error('Runtime package contains a forbidden path or symlink')
    }
    if (stat.isDirectory()) return filesIn(path.join(directory, name), relative)
    if (!stat.isFile()) throw new Error('Runtime package contains a special file')
    return [relative]
  })
}

export function stageNodeImage(runtime, stage) {
  const source = path.resolve(runtime)
  const destination = path.resolve(stage)
  if (destination === source || destination.startsWith(`${source}${path.sep}`)) {
    throw new Error('Build context must be outside the runtime package')
  }
  if (lstatSync(source).isSymbolicLink()) throw new Error('Runtime root must not be a symlink')
  const files = filesIn(source)
  for (const required of POLICY.runtimeFiles) {
    if (!files.includes(required)) throw new Error(`Node runtime artifact missing: ${required}`)
    if (lstatSync(path.join(source, required)).size === 0) throw new Error('Empty runtime artifact')
  }
  const manifest = Manifest.parse(
    JSON.parse(readFileSync(path.join(source, 'package.json'), 'utf8')),
  )
  const lock = Lock.parse(JSON.parse(readFileSync(path.join(source, 'package-lock.json'), 'utf8')))
  if (!lock.packages['node_modules/node-pty'] || !lock.packages['node_modules/@napi-rs/keyring']) {
    throw new Error('Native dependencies missing from package lock')
  }
  // Directory creation is exclusive: no stale file from another build can ship.
  mkdirSync(destination)
  mkdirSync(path.join(destination, 'runtime'))
  const shipped = files.filter(
    (file) => ROOT_FILES.has(file) || RUNTIME_DIRS.has(file.split('/', 1)[0]),
  )
  for (const file of shipped) {
    const target = path.join(destination, 'runtime', file)
    mkdirSync(path.dirname(target), { recursive: true })
    cpSync(path.join(source, file), target)
  }
  for (const file of [
    'Containerfile',
    'entrypoint.sh',
    'muse-spark-code-acp',
    'layer-notices.sh',
    'native-notices.mjs',
  ]) {
    cpSync(path.join(ROOT, 'deploy/container', file), path.join(destination, file))
  }
  const receipt = shipped
    .toSorted((a, b) => a.localeCompare(b, 'en'))
    .map((file) => ({
      file,
      sha256: createHash('sha256')
        .update(readFileSync(path.join(destination, 'runtime', file)))
        .digest('hex'),
    }))
  writeFileSync(
    path.join(destination, 'package-receipt.json'),
    `${JSON.stringify({ version: manifest.version, files: receipt }, null, 2)}\n`,
  )
  return receipt
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const [runtime, stage] = process.argv.slice(2)
    if (!runtime || !stage || process.argv.length !== 4) {
      throw new Error(
        'Usage: node scripts/package-node-image.mjs <node-runtime-directory> <new-context-directory>',
      )
    }
    stageNodeImage(runtime, stage)
    // Scan the actual staged context, including every runtime file and config.
    execFileSync(
      'gitleaks',
      [
        'dir',
        '--config',
        path.join(ROOT, 'deploy/container/gitleaks.toml'),
        '--ignore-gitleaks-allow',
        '--redact',
        '--no-banner',
        '--no-color',
        '--exit-code=1',
        path.resolve(stage),
      ],
      { stdio: 'pipe' },
    )
    console.log('Node image context staged and secret-scanned')
  } catch (error) {
    // Scanner output can contain user material, even with redaction enabled.
    let message = 'Node context secret scan failed'
    if (error instanceof z.ZodError || error instanceof SyntaxError)
      message = 'Invalid node package manifest or lock'
    else if (error.status === undefined) message = error.message
    console.error(message)
    process.exitCode = 1
  }
}
