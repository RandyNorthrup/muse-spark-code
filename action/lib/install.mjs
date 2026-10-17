// Step 4 of the Action (M80, SPEC §6.4, decision D-M5): install the agent
// before any checkout, with no key and no token. Two paths:
// - a caller's candidate tarball, pinned by its SHA-256 and canonical outside
//   the workspace, installed visibly as an unsigned package;
// - the registry's exact version from the Action's own package.json, whose
//   lock integrity must equal the registry's, and whose SLSA provenance is
//   read from the very bundles one pinned `npm audit signatures
//   --include-attestations` invocation verified: subject, digest, workflow
//   repository/path/ref and the signing certificate's URI SAN. No
//   attestation is fetched separately.

import { Buffer } from 'node:buffer'
import { createHash, X509Certificate } from 'node:crypto'
import { createReadStream, realpathSync, statSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import {
  ACTION_CHILD_STDOUT_MAX_BYTES,
  ACTION_INSTALL_MS,
  ACTION_STDERR_MAX_BYTES,
  childEnvironment,
  createLauncherOwner,
  isEntry,
} from './lifecycle.mjs'
import {
  actionPaths,
  InputError,
  invocationFromEnv,
  networkInputs,
  readActionInputs,
  readBounded,
  regularFileOutside,
  writeOutputs,
} from './tools.mjs'

export const AGENT_PACKAGE = 'muse-spark-code-acp'
export const AGENT_REGISTRY = 'https://registry.npmjs.org/'
export const VERIFIER_NPM = 'npm@11.19.0'
export const SOURCE_REPOSITORY = 'https://github.com/RandyNorthrup/muse-spark-code'
export const RELEASE_WORKFLOW = '.github/workflows/release.yml'
export const SLSA_PROVENANCE = 'https://slsa.dev/provenance/v1'
const REGISTRY_DOC_MAX_BYTES = 1_048_576
const VERSION = /^\d+\.\d+\.\d+$/
const SHA512_INTEGRITY = /^sha512-[A-Za-z0-9+/]+={0,2}$/

/** A failed provenance or integrity check, named by a fixed check id. */
export class ProvenanceError extends Error {
  constructor(check) {
    super(`agent provenance check failed: ${check}`)
    this.name = 'ProvenanceError'
    this.check = check
  }
}

function record(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value : undefined
}

function fail(check) {
  throw new ProvenanceError(check)
}

/** An npm sha512 SRI string as lowercase hex. */
export function integrityHex(integrity) {
  if (typeof integrity !== 'string' || !SHA512_INTEGRITY.test(integrity)) fail('integrity.format')
  return Buffer.from(integrity.slice('sha512-'.length), 'base64').toString('hex')
}

/** The leaf signing certificate's DER bytes from a Sigstore bundle's verification material. */
function leafCertificate(bundle) {
  const material = record(bundle?.verificationMaterial)
  const chain = material?.x509CertificateChain?.certificates
  const raw = Array.isArray(chain) ? chain[0]?.rawBytes : material?.certificate?.rawBytes
  if (typeof raw !== 'string' || raw === '') fail('certificate.missing')
  return Buffer.from(raw, 'base64')
}

/** The certificate's subject alternative names must be exactly the one expected URI. */
function checkSigner(bundle, expectedSan) {
  let certificate
  try {
    certificate = new X509Certificate(leafCertificate(bundle))
  } catch (error) {
    if (error instanceof ProvenanceError) throw error
    fail('certificate.parse')
  }
  if (certificate.subjectAltName !== `URI:${expectedSan}`) fail('certificate.san')
}

function decodeStatement(bundle) {
  const payload = bundle?.dsseEnvelope?.payload
  if (typeof payload !== 'string') fail('provenance.payload')
  try {
    return JSON.parse(Buffer.from(payload, 'base64').toString('utf8'))
  } catch {
    return fail('provenance.payload')
  }
}

/**
 * The provenance chain for one package version, from the JSON of one
 * verifying `npm audit signatures --json --include-attestations` run: no
 * invalid or missing entry; exactly one verified record for the package;
 * from that record's own bundles, exactly one SLSA provenance whose subject,
 * SHA-512 digest, workflow repository/path/ref and signing certificate URI
 * SAN all match. Throws a ProvenanceError naming the first failed check.
 * The identity defaults to this project's release workflow at the version's
 * tag; tests pass another publisher's identity to check a real capture.
 */
export function verifyProvenance(audit, { name, version, integrity, identity }) {
  const expected = identity ?? releaseIdentity(version)
  const report = record(audit)
  if (!Array.isArray(report?.invalid) || !Array.isArray(report?.missing)) fail('verifier.output')
  if (report.invalid.length > 0) fail('verifier.invalid')
  if (report.missing.length > 0) fail('verifier.missing')
  if (!Array.isArray(report.verified)) fail('verifier.output')
  const records = report.verified.filter(
    (entry) => record(entry)?.name === name && record(entry)?.version === version,
  )
  if (records.length !== 1) fail('verifier.package')
  const bundles = records[0].attestationBundles
  if (!Array.isArray(bundles)) fail('provenance.missing')
  const provenance = bundles.filter((entry) => record(entry)?.predicateType === SLSA_PROVENANCE)
  if (provenance.length !== 1) fail('provenance.missing')
  const bundle = record(provenance[0].bundle)
  const statement = decodeStatement(bundle)
  if (statement?.predicateType !== SLSA_PROVENANCE) fail('provenance.type')
  const subjects = statement?.subject
  if (!Array.isArray(subjects) || subjects.length !== 1) fail('provenance.subject')
  if (subjects[0]?.name !== `pkg:npm/${name}@${version}`) fail('provenance.subject')
  if (subjects[0]?.digest?.sha512 !== integrityHex(integrity)) fail('provenance.digest')
  const workflow = statement?.predicate?.buildDefinition?.externalParameters?.workflow
  if (workflow?.repository !== expected.repository) fail('provenance.repository')
  if (workflow?.path !== expected.workflow) fail('provenance.workflow')
  if (workflow?.ref !== expected.ref) fail('provenance.ref')
  checkSigner(bundle, expected.san)
}

/** This project's publisher: release.yml at the version's tag, which also signs. */
export function releaseIdentity(version) {
  const ref = `refs/tags/v${version}`
  return {
    repository: SOURCE_REPOSITORY,
    workflow: RELEASE_WORKFLOW,
    ref,
    san: `${SOURCE_REPOSITORY}/${RELEASE_WORKFLOW}@${ref}`,
  }
}

async function sha256File(file, signal) {
  const hash = createHash('sha256')
  const stream = createReadStream(file, { signal })
  for await (const chunk of stream) hash.update(chunk)
  return hash.digest('hex')
}

/** npm's environment: the allow-list plus private empty user/global config and cache. */
export function npmEnvironment(baseEnv, paths) {
  return {
    ...baseEnv,
    npm_config_userconfig: paths.npmUserConfig,
    npm_config_globalconfig: paths.npmGlobalConfig,
    npm_config_cache: paths.npmCache,
    npm_config_registry: AGENT_REGISTRY,
    npm_config_ignore_scripts: 'true',
    npm_config_update_notifier: 'false',
    npm_config_fund: 'false',
  }
}

async function runNpm(input, script, args) {
  const outcome = await input.owner.child({
    file: input.node,
    args: [script, ...args],
    cwd: input.paths.agent,
    env: npmEnvironment(input.baseEnv, input.paths),
    withinMs: ACTION_INSTALL_MS,
    stdoutMaxBytes: ACTION_CHILD_STDOUT_MAX_BYTES,
    stderrMaxBytes: ACTION_STDERR_MAX_BYTES,
  })
  return outcome
}

const INSTALL_FLAGS = [
  '--ignore-scripts',
  '--no-audit',
  '--no-fund',
  '--save-exact',
  '--registry',
  AGENT_REGISTRY,
]

/** The installed package's bin script: canonical, inside the package, a regular file. */
async function agentScript(paths, version) {
  const directory = realpathSync.native(path.join(paths.agent, 'node_modules', AGENT_PACKAGE))
  const manifest = JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8'))
  if (manifest?.name !== AGENT_PACKAGE || manifest?.version !== version) fail('package.identity')
  const bin = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin?.[AGENT_PACKAGE]
  if (typeof bin !== 'string') fail('package.bin')
  let script
  try {
    script = realpathSync.native(path.resolve(directory, bin))
  } catch {
    fail('package.bin')
  }
  const relative = path.relative(directory, script)
  if (relative.startsWith('..') || path.isAbsolute(relative) || !statSync(script).isFile()) {
    fail('package.bin')
  }
  return script
}

async function lockEntry(paths, version) {
  const lock = JSON.parse(await readFile(path.join(paths.agent, 'package-lock.json'), 'utf8'))
  const entry = record(lock?.packages?.[`node_modules/${AGENT_PACKAGE}`])
  if (entry?.version !== version) fail('lock.version')
  const tarball = `${AGENT_REGISTRY}${AGENT_PACKAGE}/-/${AGENT_PACKAGE}-${version}.tgz`
  if (entry.resolved !== tarball) fail('lock.resolved')
  integrityHex(entry.integrity)
  return entry.integrity
}

async function registryIntegrity(input, signal) {
  const response = await input.fetch(`${AGENT_REGISTRY}${AGENT_PACKAGE}/${input.version}`, {
    redirect: 'error',
    signal,
    headers: { accept: 'application/json' },
  })
  const bytes = await readBounded(response, REGISTRY_DOC_MAX_BYTES)
  if (!response.ok) fail('registry.version')
  const document = JSON.parse(Buffer.from(bytes).toString('utf8'))
  if (document?.name !== AGENT_PACKAGE || document?.version !== input.version) {
    fail('registry.version')
  }
  return document?.dist?.integrity
}

async function installCandidate(input, signal) {
  const tarball = regularFileOutside(input.packagePath, input.workspace, 'agent-package')
  if ((await sha256File(tarball, signal)) !== input.packageSha256) {
    throw new InputError('agent-package does not match agent-package-sha256')
  }
  process.stdout.write('::warning::unsigned agent package: installed from agent-package\n')
  const outcome = await runNpm(input, input.npmCli, ['install', ...INSTALL_FLAGS, tarball])
  if (outcome.code !== 0) throw new Error('npm could not install the agent package')
  return { agentJs: await agentScript(input.paths, input.version), candidate: true }
}

async function installRegistry(input, signal) {
  const spec = `${AGENT_PACKAGE}@${input.version}`
  const installed = await runNpm(input, input.npmCli, ['install', ...INSTALL_FLAGS, spec])
  if (installed.code !== 0) throw new Error('npm could not install the agent')
  const integrity = await lockEntry(input.paths, input.version)
  if ((await registryIntegrity(input, signal)) !== integrity) fail('registry.integrity')
  const verifier = await runNpm(input, input.npxCli, [
    '--yes',
    VERIFIER_NPM,
    'audit',
    'signatures',
    '--json',
    '--include-attestations',
    '--prefix',
    input.paths.agent,
  ])
  if (verifier.code !== 0) fail('verifier.failed')
  let audit
  try {
    audit = JSON.parse(Buffer.from(verifier.stdout).toString('utf8'))
  } catch {
    fail('verifier.output')
  }
  verifyProvenance(audit, { name: AGENT_PACKAGE, version: input.version, integrity })
  return { agentJs: await agentScript(input.paths, input.version), candidate: false }
}

/** Installs the agent into work/agent under the owner's install bound. */
export async function installAgent(input) {
  if (!VERSION.test(input.version)) throw new InputError('the Action version is malformed')
  return await input.owner.phase('install', ACTION_INSTALL_MS, async (signal) =>
    input.packagePath === null
      ? await installRegistry(input, signal)
      : await installCandidate(input, signal),
  )
}

async function main() {
  const env = process.env
  const owner = createLauncherOwner({
    paths: {},
    dropSecrets: () => {
      // Installation holds no key and no token.
    },
    totalMs: ACTION_INSTALL_MS,
  })
  try {
    const workspace = env.GITHUB_WORKSPACE ?? ''
    const paths = actionPaths(invocationFromEnv(env), '')
    const inputs = await readActionInputs(paths)
    const node = env.MUSE_NODE ?? ''
    const actionRoot = path.resolve(env.GITHUB_ACTION_PATH ?? '', '..')
    const { version } = JSON.parse(await readFile(path.join(actionRoot, 'package.json'), 'utf8'))
    const baseEnv = childEnvironment({
      platform: process.platform,
      parentEnv: env,
      paths,
      nodePath: node,
      network: networkInputs(inputs, workspace),
    })
    const installed = await installAgent({
      owner,
      paths,
      node,
      npmCli: env.MUSE_NPM_CLI ?? '',
      npxCli: env.MUSE_NPX_CLI ?? '',
      version,
      workspace,
      packagePath: inputs.agentPackage === '' ? null : inputs.agentPackage,
      packageSha256: inputs.agentPackageSha256 === '' ? null : inputs.agentPackageSha256,
      fetch,
      baseEnv,
    })
    await writeOutputs(env.GITHUB_OUTPUT, {
      'agent-js': installed.agentJs,
      candidate: String(installed.candidate),
    })
  } catch (error) {
    const message =
      error instanceof InputError || error instanceof ProvenanceError
        ? error.message
        : 'the agent could not be installed'
    process.stderr.write(`::error::${message}\n`)
    process.exitCode = 1
  } finally {
    await owner.cleanup()
  }
}

if (isEntry(import.meta.url)) await main()
