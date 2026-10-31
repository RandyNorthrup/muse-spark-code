import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  appendFileSync,
  copyFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as z from 'zod/mini'
import { buildEnvironment, HOSTS, hostManifest, inside, MHP_VERSION } from './manifest.mjs'

const signingKeys = {
  jetbrains: [
    'JETBRAINS_CERTIFICATE_CHAIN',
    'JETBRAINS_PRIVATE_KEY',
    'JETBRAINS_PRIVATE_KEY_PASSWORD',
  ],
  visualstudio: ['WINDOWS_SIGNING_CERTIFICATE', 'WINDOWS_SIGNING_PASSWORD'],
  eclipse: ['ECLIPSE_SIGNING_KEY', 'ECLIPSE_SIGNING_PASSWORD'],
  xcode: [
    'APPLE_SIGNING_CERTIFICATE',
    'APPLE_SIGNING_PASSWORD',
    'APPLE_NOTARY_KEY',
    'APPLE_NOTARY_KEY_ID',
    'APPLE_NOTARY_ISSUER_ID',
  ],
}
const publishingKeys = {
  jetbrains: ['JETBRAINS_MARKETPLACE_TOKEN'],
  visualstudio: ['VSCE_PAT'],
  neovim: ['LUAROCKS_API_KEY'],
}
const receiptSchema = z.strictObject({
  host: z.enum(Object.keys(HOSTS)),
  outcome: z.literal('packaged'),
  mhp: z.literal(MHP_VERSION),
  version: z.string(),
  tree: z.string().check(z.regex(/^[a-f0-9]{40}$/u)),
  sha256: z.record(
    z.string().check(z.regex(/^[\w.-]+$/u)),
    z.string().check(z.regex(/^[a-f0-9]{64}$/u)),
  ),
  runtimeSha256: z
    .record(
      z.string().check(
        z.regex(/^(?:[\w@+.-]+\/)*[\w@+.-]+$/u),
        z.refine((name) => name.split('/').every((part) => part !== '.' && part !== '..')),
      ),
      z.string().check(z.regex(/^[a-f0-9]{64}$/u)),
    )
    .check(z.refine((files) => Object.keys(files).length > 0)),
  signing: z.optional(z.enum(['signed', 'unsigned', 'unsigned-local-only'])),
})
const digest = (file) => createHash('sha256').update(readFileSync(file)).digest('hex')

/** Every downloaded asset is bound to this tag's tree and its recorded bytes. */
export function verifyArtifacts(root, directory, host, run = execFileSync) {
  const receipt = receiptSchema.parse(
    JSON.parse(readFileSync(inside(directory, 'receipt.json'), 'utf8')),
  )
  assert.equal(receipt.host, host, 'MHP_HOST_RECEIPT_HOST')
  assert.equal(
    receipt.version,
    JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).version,
    'MHP_HOST_RECEIPT_VERSION',
  )
  assert.equal(
    receipt.tree,
    run('git', ['rev-parse', 'HEAD^{tree}'], {
      cwd: root,
      encoding: 'utf8',
      env: buildEnvironment(process.env),
    }).trim(),
    'MHP_HOST_RECEIPT_TREE',
  )
  const names = Object.keys(receipt.sha256).toSorted((a, b) => a.localeCompare(b))
  assert.ok(names.length > 0, 'MHP_HOST_RECEIPT_EMPTY')
  assert.deepEqual(
    readdirSync(directory)
      .filter((name) => name !== 'receipt.json')
      .toSorted((a, b) => a.localeCompare(b)),
    names,
    'MHP_HOST_RECEIPT_INVENTORY',
  )
  for (const name of names) {
    const file = inside(directory, name)
    assert.ok(statSync(file).isFile() && statSync(file).size > 0, 'MHP_HOST_EMPTY_ARTIFACT')
    assert.equal(digest(file), receipt.sha256[name], 'MHP_HOST_RECEIPT_SHA256')
  }
  return receipt
}

/** Only the named channel's credentials reach its one trusted command. */
function commandEnvironment(env, keys, directory, receipt) {
  return {
    ...buildEnvironment(env),
    ...Object.fromEntries(keys.filter((key) => env[key]).map((key) => [key, env[key]])),
    MUSE_HOST_ARTIFACTS: JSON.stringify(
      Object.keys(receipt.sha256).map((name) => path.join(directory, name)),
    ),
    MUSE_MHP_VERSION: receipt.mhp,
  }
}

export function signArtifacts(root, directory, host, env = process.env, run = execFileSync) {
  const receipt = verifyArtifacts(root, directory, host, run)
  const found = hostManifest(root, host)
  assert.ok('manifest' in found, 'MHP_HOST_ABSENT_AT_RELEASE')
  const keys = signingKeys[host] ?? []
  const hasCredential = keys.some((key) => (env[key] ?? '').length > 0)
  if (hasCredential) {
    assert.ok(
      keys.filter((key) => !key.endsWith('_PASSWORD')).every((key) => (env[key] ?? '').length > 0),
      'MHP_HOST_SIGN_CREDENTIALS_INCOMPLETE',
    )
    assert.ok(found.manifest.sign, 'MHP_HOST_SIGN_COMMAND_MISSING')
    run(found.manifest.sign.command, found.manifest.sign.args, {
      cwd: found.directory,
      env: commandEnvironment(env, keys, directory, receipt),
      stdio: 'pipe',
      timeout: 1_200_000,
    })
    receipt.signing = 'signed'
    for (const name of Object.keys(receipt.sha256))
      receipt.sha256[name] = digest(inside(directory, name))
  } else receipt.signing = host === 'xcode' ? 'unsigned-local-only' : 'unsigned'
  writeFileSync(path.join(directory, 'receipt.json'), `${JSON.stringify(receipt, null, 2)}\n`)
  verifyArtifacts(root, directory, host, run)
  return {
    host,
    outcome: receipt.signing,
    reason: hasCredential ? undefined : 'signing credentials absent; no credential created',
  }
}

export function publishArtifacts(root, directory, host, env = process.env, run = execFileSync) {
  const receipt = verifyArtifacts(root, directory, host, run)
  const found = hostManifest(root, host)
  assert.ok('manifest' in found, 'MHP_HOST_ABSENT_AT_RELEASE')
  if (host === 'xcode' && receipt.signing !== 'signed')
    return {
      host,
      outcome: 'unsigned-local-only',
      reason: 'Developer ID / notarization credentials absent; local builds only',
    }
  const keys = publishingKeys[host]
  if (!keys) return { host, outcome: 'manual-registry-submission', reason: HOSTS[host].channel }
  if (keys.some((key) => (env[key] ?? '').length === 0))
    return {
      host,
      outcome: 'skipped-no-secret',
      reason: `${HOSTS[host].channel}: ${keys.join(', ')} absent`,
    }
  assert.ok(found.manifest.publish, 'MHP_HOST_PUBLISH_COMMAND_MISSING')
  run(found.manifest.publish.command, found.manifest.publish.args, {
    cwd: found.directory,
    env: commandEnvironment(env, keys, directory, receipt),
    stdio: 'pipe',
    timeout: 600_000,
  })
  // Publishing consumes the exact GitHub Release bytes; it must not rebuild.
  verifyArtifacts(root, directory, host, run)
  return { host, outcome: 'published' }
}

/** Publishing is admitted only after the exact native bytes exist on this version's Release. */
export function verifyReleaseAssets(root, directory, host, tag, run = execFileSync) {
  const receipt = verifyArtifacts(root, directory, host, run)
  assert.equal(tag, `v${receipt.version}`, 'MHP_HOST_GITHUB_TAG')
  const scratch = mkdtempSync(path.join(path.dirname(path.resolve(directory)), '.native-proof-'))
  try {
    const assets = [
      ...Object.entries(receipt.sha256),
      [
        `muse-spark-code-${host}-${receipt.version}-receipt.json`,
        digest(inside(directory, 'receipt.json')),
      ],
    ]
    for (const [name, expected] of assets) {
      run('gh', ['release', 'download', tag, '--pattern', name, '--dir', scratch], {
        cwd: root,
        stdio: 'pipe',
        timeout: 180_000,
        env: { ...buildEnvironment(process.env), GH_TOKEN: process.env.GH_TOKEN },
      })
      assert.equal(digest(inside(scratch, name)), expected, 'MHP_HOST_GITHUB_SHA256')
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
  return { host, outcome: 'release-assets-verified' }
}

/** Verify every present host before extending the release's checksum/asset inventory. */
export function stageArtifacts(root, directory, release, run = execFileSync) {
  const sources = Object.keys(HOSTS).flatMap((host) => {
    const found = hostManifest(root, host)
    if ('outcome' in found) return []
    const source = path.join(directory, `m104-native-release-${host}`)
    const receipt = verifyArtifacts(root, source, host, run)
    return [
      ...Object.keys(receipt.sha256).map((name) => ({ source: inside(source, name), name })),
      {
        source: inside(source, 'receipt.json'),
        name: `muse-spark-code-${host}-${receipt.version}-receipt.json`,
      },
    ]
  })
  const names = sources.map(({ name }) => name)
  assert.equal(new Set(names).size, names.length, 'MHP_HOST_RELEASE_DUPLICATE_ASSET')
  for (const { source, name } of sources) {
    assert.ok(!existsSync(path.join(release, name)), 'MHP_HOST_RELEASE_ASSET_COLLISION')
    copyFileSync(source, path.join(release, name))
  }
  writeFileSync(path.join(release, '.native'), names.length > 0 ? `${names.join('\n')}\n` : '')
  return { outcome: 'staged', assets: names }
}

const outcomeSchema = z.strictObject({
  host: z.enum(Object.keys(HOSTS)),
  outcome: z.enum([
    'published',
    'skipped-host-absent',
    'skipped-no-secret',
    'manual-registry-submission',
    'unsigned-local-only',
    'failed',
  ]),
  reason: z.optional(z.string()),
})

/** Missing reports for present hosts fail; incomplete channels are listed first. */
export function nativeSummary(root, directory) {
  const rows = Object.keys(HOSTS)
    .map((host) => {
      const found = hostManifest(root, host)
      if ('outcome' in found) return found
      const file = path.join(directory, `${host}.json`)
      if (!existsSync(file))
        return { host, outcome: 'failed', reason: 'native release or channel job did not complete' }
      const result = outcomeSchema.parse(JSON.parse(readFileSync(file, 'utf8')))
      assert.equal(result.host, host, 'MHP_HOST_OUTCOME_HOST')
      assert.notEqual(result.outcome, 'skipped-host-absent', 'MHP_HOST_FALSE_ABSENCE')
      return result
    })
    .toSorted((a, b) => Number(a.outcome === 'published') - Number(b.outcome === 'published'))
  return {
    failed: rows.some(({ outcome }) => outcome === 'failed'),
    allPublished: rows.every(
      ({ outcome }) => outcome === 'published' || outcome === 'skipped-host-absent',
    ),
    rows,
    markdown: `| Native channel | Outcome | Reason |\n| --- | --- | --- |\n${rows.map(({ host, outcome, reason = '' }) => `| ${HOSTS[host].channel} | ${outcome} | ${reason} |`).join('\n')}\n`,
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [mode, host, directory] = process.argv.slice(2)
    if (mode === 'stage') {
      console.log(JSON.stringify(stageArtifacts(process.cwd(), host, directory)))
    } else if (mode === 'summary') {
      const result = nativeSummary(process.cwd(), host)
      console.log(result.markdown)
      if (process.env.GITHUB_STEP_SUMMARY)
        appendFileSync(process.env.GITHUB_STEP_SUMMARY, result.markdown)
      if (process.env.GITHUB_OUTPUT)
        appendFileSync(process.env.GITHUB_OUTPUT, `all-published=${String(result.allPublished)}\n`)
      if (result.failed) process.exitCode = 1
    } else {
      const task = new Map([
        ['verify', verifyArtifacts],
        ['sign', signArtifacts],
        ['publish', publishArtifacts],
        ['github', verifyReleaseAssets],
      ]).get(mode)
      assert.ok(task, 'MHP_HOST_RELEASE_MODE')
      let result
      if (mode === 'github')
        result = task(process.cwd(), directory, host, process.env.GITHUB_REF_NAME)
      else if (mode === 'verify') result = task(process.cwd(), directory, host)
      else result = task(process.cwd(), directory, host, process.env)
      console.log(JSON.stringify(result))
      if (process.env.MUSE_HOST_OUTCOME_FILE)
        writeFileSync(process.env.MUSE_HOST_OUTCOME_FILE, `${JSON.stringify(result)}\n`)
      if (process.env.GITHUB_STEP_SUMMARY)
        appendFileSync(
          process.env.GITHUB_STEP_SUMMARY,
          `\n${host}: **${result.outcome}**${result.reason ? ` — ${result.reason}` : ''}\n`,
        )
    }
  } catch {
    // Native CLI output can contain credential material; never print it.
    console.error('MHP_HOST_RELEASE_FAILED: verification or trusted channel command failed')
    process.exitCode = 1
  }
}
