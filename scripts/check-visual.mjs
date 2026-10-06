// Reviewed visual baselines stay outside git; CI reconstructs the recorded
// source revision in temp/ and renders both revisions in the same environment.
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'
import {
  CAPTURE_CONTEXT,
  captureMatrix,
  rasterizationFingerprint,
  saveCapture,
} from '../test/harness/goldens/capture.mjs'
import { comparePixels, decodePng, PIXEL_POLICY, verifyCapture } from './lib/visualImages.mjs'
import { captureKey, ENVIRONMENT, validateManifest } from './lib/visualManifest.mjs'

export const MANIFEST = 'test/harness/goldens/manifest.json'
const AUDIT = 'docs/certification/m114-audit.json'
const MATRIX = 'test/harness/visual-matrix.json'

export function parseVisualArgs(args) {
  const options = { update: false, review: undefined, archive: undefined }
  for (const arg of args) {
    if (arg === '--update') options.update = true
    else if (arg.startsWith('--review=')) options.review = arg.slice('--review='.length).trim()
    else if (arg.startsWith('--archive=')) options.archive = arg.slice('--archive='.length)
    else throw new Error(`Unknown visual argument: ${arg}`)
  }
  if (options.update && !options.review)
    throw new Error('Visual updates require --review=<review reference>')
  if (!options.update && options.review !== undefined) throw new Error('--review requires --update')
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

async function snapshot(root, revision) {
  const directory = await mkdtemp(path.join(root, 'temp/m114-visual-source-'))
  const tar = path.join(directory, 'source.tar')
  await run('git', ['archive', '--format=tar', `--output=${tar}`, revision], root)
  await run('tar', ['-xf', tar, '-C', directory], root)
  await rm(tar)
  await build(directory)
  return directory
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
  const manifest = validateManifest(await json(root, MANIFEST), audit, matrix)
  let archive = path.resolve(options.archive ?? manifest.archive)
  let regenerated
  let sourceRoot
  const expected = new Map(manifest.captures.map((capture) => [captureKey(capture), capture]))
  let checked = 0
  try {
    // A stored archive is verified before any use, including on another OS.
    if (existsSync(archive))
      for (const capture of manifest.captures)
        verifyCapture(
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
      const result = await captureMatrix(sourceRoot, audit, matrix, (capture, bytes) =>
        saveCapture(regenerated, capture, bytes),
      )
      archive = regenerated
      expected.clear()
      for (const capture of result.captures) expected.set(captureKey(capture), capture)
      console.log(
        `visual: regenerated baseline from ${manifest.revision} in ${version}/${process.platform}`,
      )
    }
    await captureMatrix(root, audit, matrix, async (capture, bytes) => {
      const baseline = expected.get(captureKey(capture))
      if (!baseline || baseline.applied !== capture.applied || baseline.target !== capture.target)
        throw new Error(`Visual state coverage changed: ${captureKey(capture)}`)
      const before = verifyCapture(
        await readFile(path.join(archive, baseline.file.replaceAll('\\', '/'))),
        baseline,
      )
      try {
        comparePixels(
          before,
          decodePng(bytes, capture.width, capture.height),
          capture.width,
          capture.height,
        )
      } catch (error) {
        await saveCapture(path.join(root, 'temp/m114-visual-failures'), capture, bytes)
        throw new Error(`${captureKey(capture)}: ${error.message}`, { cause: error })
      }
      checked += 1
    })
    await writeFile(
      path.join(root, 'temp/m114-visual-result.json'),
      JSON.stringify(
        {
          revision: manifest.revision,
          checked,
          regenerated: regenerated !== undefined,
          policy: PIXEL_POLICY,
        },
        null,
        2,
      ) + '\n',
    )
    console.log(`visual: ${checked} captures passed; zero changed pixels; manifest unchanged`)
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
