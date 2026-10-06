// Reviewed visual baselines stay outside git; CI reconstructs the recorded
// source revision in temp/ and renders both revisions in the same environment.
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'
import {
  CAPTURE_CONTEXT,
  captureMatrix,
  rasterizationFingerprint,
  saveCapture,
} from '../test/harness/goldens/capture.mjs'
import {
  comparePixels,
  decodePng,
  digest,
  PIXEL_POLICY,
  verifyCapture,
  verifyCaptureBytes,
} from './lib/visualImages.mjs'
import {
  captureGroup,
  captureKey,
  ENVIRONMENT,
  mergeVisualResults,
  selectionDigest,
  selectVisualShard,
  validateManifest,
} from './lib/visualManifest.mjs'

export const MANIFEST = 'test/harness/goldens/manifest.json'
const AUDIT = 'docs/certification/m114-audit.json'
const MATRIX = 'test/harness/visual-matrix.json'

export function parseVisualArgs(args) {
  const options = { update: false, review: undefined, archive: undefined }
  for (const arg of args) {
    if (arg === '--update') options.update = true
    else if (arg.startsWith('--review=')) options.review = arg.slice('--review='.length).trim()
    else if (arg.startsWith('--archive=')) options.archive = arg.slice('--archive='.length)
    else if (arg.startsWith('--shard=')) {
      const match = /^([1-9]\d*)\/([1-9]\d*)$/.exec(arg.slice('--shard='.length))
      if (match === null) throw new Error('Use --shard=<index>/<count>')
      const index = Number(match[1])
      const count = Number(match[2])
      if (!Number.isSafeInteger(index) || !Number.isSafeInteger(count) || index > count)
        throw new Error('Invalid visual shard range')
      options.shard = { index, count }
    } else if (arg.startsWith('--merge-shards='))
      options.merge = arg.slice('--merge-shards='.length)
    else throw new Error(`Unknown visual argument: ${arg}`)
  }
  if (options.update && !options.review)
    throw new Error('Visual updates require --review=<review reference>')
  if (!options.update && options.review !== undefined) throw new Error('--review requires --update')
  if (options.update && options.shard !== undefined)
    throw new Error('Visual updates require the full matrix')
  if (
    options.merge !== undefined &&
    (options.update ||
      options.shard !== undefined ||
      options.archive !== undefined ||
      !options.merge)
  )
    throw new Error('--merge-shards only accepts a receipt directory')
  return options
}

async function run(file, args, cwd) {
  return await new Promise((resolve, reject) => {
    const child = spawn(file, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    child.stdout.on('data', (chunk) => {
      output += chunk.toString()
    })
    child.stderr.on('data', (chunk) => {
      output += chunk.toString()
    })
    child.once('error', reject)
    child.once('close', (code) =>
      code === 0
        ? resolve(output.trim())
        : reject(new Error(`${file} ${args.join(' ')} exited ${code}: ${output}`)),
    )
  })
}

async function build(root) {
  await run(process.execPath, ['scripts/build.mjs', '--production'], root)
}

export async function snapshot(root, revision) {
  const directory = await mkdtemp(path.join(root, 'temp/m114-visual-source-'))
  try {
    const tar = path.join(directory, 'source.tar')
    await run('git', ['archive', '--format=tar', `--output=${tar}`, revision], root)
    await run('tar', ['-xf', tar, '-C', directory], root)
    await rm(tar)
    await build(directory)
    return directory
  } catch (error) {
    await rm(directory, { recursive: true, force: true })
    throw error
  }
}

async function json(root, file) {
  return JSON.parse(await readFile(path.join(root, file), 'utf8'))
}

async function main() {
  const root = process.cwd()
  const options = parseVisualArgs(process.argv.slice(2))
  const audit = await json(root, AUDIT)
  const matrix = await json(root, MATRIX)
  await mkdir(path.join(root, 'temp'), { recursive: true })
  const candidateSha256 = digest(
    (await run('git', ['rev-parse', 'HEAD'], root)) +
      (await run(
        'git',
        [
          'diff',
          'HEAD',
          '--',
          'src',
          'design',
          'test/harness',
          'scripts/build.mjs',
          'CHANGELOG.md',
        ],
        root,
      )),
  )
  if (options.merge !== undefined) {
    const manifestBytes = await readFile(path.join(root, MANIFEST))
    const manifest = validateManifest(JSON.parse(manifestBytes.toString()), audit, matrix)
    const files = await readdir(options.merge)
    const values = await Promise.all(
      files
        .filter((file) => file.endsWith('.json'))
        .map(async (file) => JSON.parse(await readFile(path.join(options.merge, file), 'utf8'))),
    )
    const result = mergeVisualResults(values, manifest, digest(manifestBytes), candidateSha256)
    await writeFile(
      path.join(root, 'temp/m114-visual-result.json'),
      JSON.stringify(result, null, 2) + '\n',
    )
    console.log(
      `visual: all ${result.shards} shards passed, ${result.checked} captures; both archives within 512 MiB`,
    )
    return
  }
  await build(root)
  if (options.update) {
    if (!options.archive)
      throw new Error('Visual updates require --archive=<outside-repository directory>')
    const archive = path.resolve(options.archive)
    const relative = path.relative(root, archive).replaceAll('\\', '/')
    if (!(relative === '..' || relative.startsWith('../') || path.isAbsolute(relative)))
      throw new Error('Visual baseline PNGs must stay outside the repository')
    const revision = await run('git', ['rev-parse', 'HEAD'], root)
    const dirty = await run(
      'git',
      [
        'status',
        '--porcelain',
        '--',
        'src',
        'design',
        'test/harness',
        'scripts/build.mjs',
        'CHANGELOG.md',
      ],
      root,
    )
    if (dirty.replace(/^\?\? test\/harness\/goldens\/manifest\.json\s*$/m, '').trim())
      throw new Error('Commit capture inputs before a reviewed visual update')
    if (existsSync(archive)) throw new Error('Use a new archive directory for each reviewed update')
    await mkdir(archive, { recursive: true })
    const result = await captureMatrix(root, audit, matrix, (capture, bytes) =>
      saveCapture(archive, capture, bytes),
    )
    const manifest = validateManifest(
      {
        version: 1,
        revision,
        review: options.review,
        archive,
        environment: ENVIRONMENT,
        policy: PIXEL_POLICY,
        ...result,
      },
      audit,
      matrix,
    )
    await writeFile(path.join(root, MANIFEST), JSON.stringify(manifest, null, 2) + '\n')
    console.log(
      `visual: wrote reviewed candidate manifest, ${manifest.captures.length} PNGs / ${manifest.totalBytes} bytes outside git`,
    )
    return
  }
  const manifestBytes = await readFile(path.join(root, MANIFEST))
  const manifest = validateManifest(JSON.parse(manifestBytes.toString()), audit, matrix)
  const selected = selectVisualShard(manifest, options.shard)
  const groups = new Set(selected.map((capture) => captureGroup(capture)))
  let archive = path.resolve(options.archive ?? manifest.archive)
  let regenerated
  let sourceRoot
  const expected = new Map(selected.map((capture) => [captureKey(capture), capture]))
  let checked = 0
  let changedPixels = 0
  let maxImageChangedPixels = 0
  try {
    // A stored archive is verified before any use, including on another OS.
    if (existsSync(archive))
      for (const capture of selected)
        verifyCaptureBytes(
          await readFile(path.join(archive, capture.file.replaceAll('\\', '/'))),
          capture,
        )
    // OS/font rasterization varies. Reconstruct source on other platforms or
    // when an archive is unavailable, never download a baseline or skip it.
    const { findChrome } = await import('./lib/chrome.mjs')
    const { chromium } = await import('playwright-core')
    const chrome = findChrome()
    if (!chrome) throw new Error('Chrome is required for check:visual')
    const profile = await mkdtemp(path.join(root, 'temp/m114-visual-probe-'))
    let version
    let rasterization
    try {
      const browser = await chromium.launchPersistentContext(profile, {
        ...CAPTURE_CONTEXT,
        ...(path.isAbsolute(chrome) ? { executablePath: chrome } : { channel: 'chrome' }),
      })
      version = browser.browser().version()
      rasterization = await rasterizationFingerprint(browser)
      await browser.close()
    } finally {
      await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
    }
    if (
      !existsSync(archive) ||
      manifest.platform !== process.platform ||
      manifest.browser !== version ||
      manifest.rasterization !== rasterization
    ) {
      if (options.archive !== undefined && !existsSync(archive))
        throw new Error(`Requested visual archive is missing: ${archive}`)
      sourceRoot = await snapshot(root, manifest.revision)
      regenerated = await mkdtemp(path.join(root, 'temp/m114-visual-baseline-'))
      const result = await captureMatrix(
        sourceRoot,
        audit,
        matrix,
        (capture, bytes) => saveCapture(regenerated, capture, bytes),
        groups,
      )
      archive = regenerated
      expected.clear()
      for (const capture of result.captures) expected.set(captureKey(capture), capture)
      console.log(
        `visual: regenerated baseline from ${manifest.revision} in ${version}/${process.platform}`,
      )
    }
    const candidate = await captureMatrix(
      root,
      audit,
      matrix,
      async (capture, bytes) => {
        const baseline = expected.get(captureKey(capture))
        if (!baseline || baseline.applied !== capture.applied || baseline.target !== capture.target)
          throw new Error(`Visual state coverage changed: ${captureKey(capture)}`)
        const before = verifyCapture(
          await readFile(path.join(archive, baseline.file.replaceAll('\\', '/'))),
          baseline,
        )
        try {
          const changed = comparePixels(
            before,
            decodePng(bytes, capture.width, capture.height),
            capture.width,
            capture.height,
          )
          changedPixels += changed
          maxImageChangedPixels = Math.max(maxImageChangedPixels, changed)
        } catch (error) {
          await saveCapture(path.join(root, 'temp/m114-visual-failures'), capture, bytes)
          throw new Error(`${captureKey(capture)}: ${error.message}`, { cause: error })
        }
        checked += 1
      },
      groups,
    )
    if (checked !== selected.length) throw new Error('Incomplete visual shard coverage')
    const resultFile =
      options.shard === undefined
        ? 'm114-visual-result.json'
        : `m114-visual-result-${options.shard.index}-of-${options.shard.count}.json`
    await writeFile(
      path.join(root, 'temp', resultFile),
      JSON.stringify(
        {
          revision: manifest.revision,
          manifestSha256: digest(manifestBytes),
          candidateSha256,
          ...(options.shard !== undefined && { shard: options.shard }),
          selectionSha256: selectionDigest(selected),
          checked,
          changedPixels,
          maxImageChangedPixels,
          regenerated: regenerated !== undefined,
          baselineBytes: expected.values().reduce((sum, capture) => sum + capture.bytes, 0),
          candidateBytes: candidate.totalBytes,
          browser: candidate.browser,
          rasterization: candidate.rasterization,
          platform: candidate.platform,
          policy: PIXEL_POLICY,
        },
        null,
        2,
      ) + '\n',
    )
    console.log(
      `visual: ${checked} captures passed; ${changedPixels} changed pixels within per-image tolerance; manifest unchanged`,
    )
  } finally {
    if (sourceRoot !== undefined) await rm(sourceRoot, { recursive: true, force: true })
    if (regenerated !== undefined) await rm(regenerated, { recursive: true, force: true })
  }
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
)
  await main()
