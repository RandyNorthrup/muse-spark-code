// Release-only CI lookup and byte verification; never builds or publishes.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { appendFileSync, existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { z } from 'zod'

const SHA = z.string().regex(/^[a-f\d]{40}$/)
const REPOSITORY = z.object({ full_name: z.string() })
const RUNS = z.object({
  workflow_runs: z.array(
    z.object({
      id: z.number().int().positive(),
      path: z.string(),
      event: z.string(),
      status: z.string(),
      conclusion: z.string().nullable(),
      head_branch: z.string().nullable(),
      repository: REPOSITORY,
      head_repository: REPOSITORY.nullable(),
    }),
  ),
})
const ARTIFACTS = z.object({
  artifacts: z.array(z.object({ name: z.string(), expired: z.boolean() })),
})
const RECEIPT = z.object({
  tree: SHA,
  commit: SHA,
  sha256: z.record(z.string(), z.string().regex(/^[a-f\d]{64}$/)),
})
const MANIFEST = z.object({ name: z.string(), version: z.string() })
const ARTIFACT_NAMES = ['muse-spark-code-vsix', 'muse-spark-code-acp', 'muse-spark-code-sboms']
const LOOKUP_PAGES = 3
const LOOKUP_TIMEOUT_MS = 120_000

function execute(command, args) {
  return execFileSync(command, args, {
    encoding: 'utf8',
    timeout: 30_000,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}
function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex')
}
function assetNames(version) {
  return [
    `muse-spark-code-${version}.vsix`,
    `muse-spark-code-acp-${version}.tgz`,
    'muse-spark-code.cdx.json',
    'muse-spark-code-acp.cdx.json',
  ].toSorted((a, b) => a.localeCompare(b))
}

/** The receipt artifact names the actual package checkout, not the PR head. */
export async function findBuild(repository, tree, request) {
  SHA.parse(tree)
  for (let page = 1; page <= LOOKUP_PAGES; page++) {
    const { workflow_runs: runs } = RUNS.parse(
      await request(
        `/repos/${repository}/actions/workflows/ci.yml/runs?status=success&per_page=100&page=${page}`,
      ),
    )
    for (const run of runs) {
      if (
        run.repository.full_name !== repository ||
        run.head_repository?.full_name !== repository ||
        run.path !== '.github/workflows/ci.yml' ||
        run.status !== 'completed' ||
        run.conclusion !== 'success' ||
        !(
          run.event === 'pull_request' ||
          run.event === 'merge_group' ||
          (run.event === 'push' && run.head_branch === 'main')
        )
      )
        continue
      const { artifacts } = ARTIFACTS.parse(
        await request(`/repos/${repository}/actions/runs/${run.id}/artifacts?per_page=100`),
      )
      const names = new Set(
        artifacts.filter((artifact) => !artifact.expired).map((artifact) => artifact.name),
      )
      if ([...ARTIFACT_NAMES, `source-tree-${tree}`].every((name) => names.has(name))) return run.id
    }
    if (runs.length < 100) break
  }
  return
}

/** Recovery preserves the earlier same-tag build, even after a workflow-only fix. */
export async function findRecovery(repository, tag, runId, request) {
  z.string()
    .regex(/^[1-9]\d*$/)
    .parse(runId)
  const source = RUNS.shape.workflow_runs.element
    .extend({ head_sha: SHA })
    .parse(await request(`/repos/${repository}/actions/runs/${runId}`))
  if (
    String(source.id) !== runId ||
    source.repository.full_name !== repository ||
    source.head_repository?.full_name !== repository ||
    source.path !== '.github/workflows/release.yml' ||
    source.status !== 'completed' ||
    !(source.event === 'push' || source.event === 'workflow_dispatch') ||
    source.head_branch !== tag
  ) {
    throw new Error('ineligible recovery run')
  }
  const jobs = z
    .object({
      total_count: z.number().int().nonnegative().max(100),
      jobs: z.array(z.object({ name: z.string(), conclusion: z.string().nullable() })),
    })
    .parse(
      await request(`/repos/${repository}/actions/runs/${runId}/jobs?filter=latest&per_page=100`),
    )
  const successful = new Set(
    jobs.jobs.filter((job) => job.conclusion === 'success').map((job) => job.name),
  )
  for (const name of [
    'quality (ubuntu-latest)',
    'quality (windows-latest)',
    'quality (macos-latest)',
    'dictation helper (macos)',
    'package (.vsix)',
    'gitleaks',
    'semgrep',
  ]) {
    if (!successful.has(`build / ${name}`)) throw new Error('recovery build did not pass')
  }
  const { artifacts } = ARTIFACTS.parse(
    await request(`/repos/${repository}/actions/runs/${runId}/artifacts?per_page=100`),
  )
  if (
    ARTIFACT_NAMES.some((name) => artifacts.every((file) => file.name !== name || file.expired))
  ) {
    throw new Error('recovery artifacts unavailable')
  }
  return { commit: source.head_sha, artifacts }
}

/** Check all assets before any are admitted to the publishing jobs. */
export function verifyBuild(directory, tree, version, run = execute, isLegacyRecovery = false) {
  const names = assetNames(version)
  // Pre-receipt recovery has archive integrity and manifests, not historical CI hashes.
  const receipt =
    isLegacyRecovery && !existsSync(path.join(directory, 'release-build.json'))
      ? {
          tree,
          sha256: Object.fromEntries(
            names.map((name) => [name, sha256(path.join(directory, name))]),
          ),
        }
      : RECEIPT.parse(JSON.parse(readFileSync(path.join(directory, 'release-build.json'), 'utf8')))
  if (receipt.tree !== tree) throw new Error('source tree mismatch')
  if (
    JSON.stringify(Object.keys(receipt.sha256).toSorted((a, b) => a.localeCompare(b))) !==
      JSON.stringify(names) ||
    JSON.stringify(
      readdirSync(directory)
        .filter((name) => name !== 'release-build.json')
        .toSorted((a, b) => a.localeCompare(b)),
    ) !== JSON.stringify(names)
  ) {
    throw new Error('asset inventory mismatch')
  }
  for (const name of names) {
    if (sha256(path.join(directory, name)) !== receipt.sha256[name])
      throw new Error('asset SHA-256 mismatch')
  }
  const vsix = MANIFEST.parse(
    JSON.parse(
      run('unzip', [
        '-p',
        path.join(directory, `muse-spark-code-${version}.vsix`),
        'extension/package.json',
      ]),
    ),
  )
  const acp = MANIFEST.parse(
    JSON.parse(
      run('tar', [
        '-xOf',
        path.join(directory, `muse-spark-code-acp-${version}.tgz`),
        'package/package.json',
      ]),
    ),
  )
  if (
    vsix.version !== version ||
    acp.version !== version ||
    vsix.name !== 'muse-spark-code' ||
    acp.name !== 'muse-spark-code-acp'
  ) {
    throw new Error('package version or identity mismatch')
  }
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  const [mode, directory] = process.argv.slice(2)
  let tree
  const { version } = MANIFEST.parse(JSON.parse(readFileSync('package.json', 'utf8')))
  switch (mode) {
    case 'record': {
      tree = SHA.parse(execute('git', ['rev-parse', 'HEAD^{tree}']).trim())
      const files = assetNames(version).map((name) => [
        name,
        name.endsWith('.vsix')
          ? name
          : path.join('dist', name.endsWith('.cdx.json') ? 'sbom' : '', name),
      ])
      writeFileSync(
        'dist/release-build.json',
        `${JSON.stringify({ tree, commit: execute('git', ['rev-parse', 'HEAD']).trim(), sha256: Object.fromEntries(files.map(([name, file]) => [name, sha256(file)])) }, null, 2)}\n`,
      )
      appendFileSync(process.env.GITHUB_OUTPUT, `tree=${tree}\n`)
      break
    }
    case 'find': {
      let runId
      let isLegacyRecovery = false
      const recovery = process.env.RECOVERY_RUN_ID ?? ''
      let reason = 'no eligible exact-tree CI build'
      try {
        if (recovery === '' && process.env.FORCE_REBUILD === 'true') {
          reason = 'RELEASE_FORCE_REBUILD requested'
        } else {
          const repository = z
            .string()
            .regex(/^[\w.-]+\/[\w.-]+$/)
            .parse(process.env.GITHUB_REPOSITORY)
          const signal = globalThis.AbortSignal.timeout(LOOKUP_TIMEOUT_MS)
          const request = async (endpoint) => {
            const reply = await fetch(`https://api.github.com${endpoint}`, {
              signal,
              headers: {
                Authorization: `Bearer ${process.env.GH_TOKEN}`,
                Accept: 'application/vnd.github+json',
              },
            })
            if (!reply.ok) throw new Error('CI lookup unavailable')
            return await reply.json()
          }
          if (recovery === '') {
            tree = SHA.parse(execute('git', ['rev-parse', 'HEAD^{tree}']).trim())
            runId = await findBuild(repository, tree, request)
          } else {
            const source = await findRecovery(
              repository,
              process.env.GITHUB_REF_NAME,
              recovery,
              request,
            )
            tree = SHA.parse(
              execute('git', ['show', '--format=%T', '--no-patch', source.commit]).trim(),
            )
            const receipts = source.artifacts.filter((file) => file.name.startsWith('source-tree-'))
            isLegacyRecovery = receipts.length === 0
            if (
              !isLegacyRecovery &&
              receipts.every((file) => file.name !== `source-tree-${tree}` || file.expired)
            ) {
              throw new Error('recovery receipt unavailable')
            }
            runId = recovery
          }
        }
      } catch {
        if (recovery !== '')
          throw new Error('Recovery source unavailable or invalid; preserve the original bytes.')
        reason = 'CI lookup unavailable or malformed'
      }
      appendFileSync(
        process.env.GITHUB_OUTPUT,
        `run-id=${runId ?? ''}\ntree=${tree ?? ''}\nlegacy-recovery=${String(isLegacyRecovery)}\n`,
      )
      appendFileSync(
        process.env.GITHUB_STEP_SUMMARY,
        runId === undefined
          ? `Full rebuild: ${reason}.\n`
          : `Checking ${recovery === '' ? 'CI' : 'Release recovery'} run ${runId} for source tree ${tree}.\n`,
      )
      break
    }
    case 'verify': {
      let isReused = false
      const recovery = process.env.RECOVERY_RUN_ID ?? ''
      try {
        if (process.env.GITHUB_REF_NAME !== `v${version}`) throw new Error('tag version mismatch')
        tree =
          recovery === ''
            ? SHA.parse(execute('git', ['rev-parse', 'HEAD^{tree}']).trim())
            : SHA.parse(process.env.SOURCE_TREE)
        verifyBuild(
          directory,
          tree,
          version,
          execute,
          recovery !== '' && process.env.LEGACY_RECOVERY === 'true',
        )
        isReused = true
      } catch {
        if (recovery !== '')
          throw new Error('Recovery verification failed; preserve the original bytes.')
        appendFileSync(
          process.env.GITHUB_STEP_SUMMARY,
          'Full rebuild: CI artifacts failed tree, inventory, SHA-256 or package-version verification.\n',
        )
      }
      appendFileSync(process.env.GITHUB_OUTPUT, `reused=${String(isReused)}\n`)
      if (isReused)
        appendFileSync(
          process.env.GITHUB_STEP_SUMMARY,
          recovery === ''
            ? 'Reusing verified CI artifacts; shared build and quality gates skipped.\n'
            : 'Reusing original Release artifacts; no recovery rebuild. Legacy sources have no historical per-asset hash receipt.\n',
        )
      break
    }
    default: {
      throw new Error('usage: release-reuse.mjs <record|find|verify> [download directory]')
    }
  }
}
