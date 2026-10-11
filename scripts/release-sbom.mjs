// npm's full locked CycloneDX inventory, restricted to actual shipped esbuild inputs.
// --omit=dev alone is wrong here: zod, React and the Muse/ACP SDKs are bundled devDeps.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { z } from 'zod'
import { contributedPackageDirs } from './lib/noticesInput.mjs'

const COMPONENT = z
  .object({ name: z.string(), version: z.string().optional(), 'bom-ref': z.string() })
  .passthrough()
const BOM = z
  .object({
    metadata: z.object({ component: COMPONENT }).passthrough(),
    components: z.array(COMPONENT),
    dependencies: z.array(z.object({ ref: z.string(), dependsOn: z.array(z.string()) })),
  })
  .passthrough()
const ACP_STAGE = 'dist/acp-package'

export function bundledPackages(metafiles, read = readFileSync, includesOutput = () => true) {
  const packages = new Set()
  for (const dir of contributedPackageDirs(metafiles, read, includesOutput)) {
    const manifest = JSON.parse(read(`${dir}/package.json`, 'utf8'))
    packages.add(`${manifest.name}@${manifest.version}`)
  }
  return packages
}

/** Include the unbundled keyring and all locked optional native platform dependencies. */
export function nativePackages(lock) {
  const packages = new Set()
  const queue = ['node_modules/@napi-rs/keyring']
  const seen = new Set()
  while (queue.length > 0) {
    const dir = queue.pop()
    if (seen.has(dir)) continue
    seen.add(dir)
    const entry = lock.packages[dir]
    if (entry === undefined) throw new Error(`Missing locked native dependency: ${dir}`)
    const name = dir.slice(dir.lastIndexOf('node_modules/') + 'node_modules/'.length)
    packages.add(`${name}@${entry.version}`)
    const dependencies = Object.keys({ ...entry.dependencies, ...entry.optionalDependencies })
    for (const dependency of dependencies) {
      let parent = dir
      let found
      while (found === undefined) {
        const candidate = `${parent === '' ? '' : `${parent}/`}node_modules/${dependency}`
        if (lock.packages[candidate] !== undefined) found = candidate
        else if (parent === '') throw new Error(`Missing locked dependency: ${dependency}`)
        else
          parent = parent.includes('/node_modules/')
            ? parent.slice(0, parent.lastIndexOf('/node_modules/'))
            : ''
      }
      queue.push(found)
    }
  }
  return packages
}

function componentKey(component) {
  return `${component.group === undefined ? '' : `${component.group}/`}${component.name}@${component.version}`
}

/** Bundled devDeps run at runtime, so they ship as required, not optional. */
function asRuntime(component) {
  const normalized = { ...component, scope: 'required' }
  if (Array.isArray(component.properties)) {
    const kept = component.properties.filter((property) => !/develop/i.test(property?.name ?? ''))
    if (kept.length > 0) normalized.properties = kept
    else delete normalized.properties
  }
  return normalized
}

export function shippedBom(document, included, name, required = included) {
  const bom = BOM.parse(document)
  const components = bom.components
    .filter((component) => included.has(componentKey(component)))
    .map((component) => (required.has(componentKey(component)) ? asRuntime(component) : component))
  const found = new Set(components.map((component) => componentKey(component)))
  if ([...included].some((entry) => !found.has(entry)))
    throw new Error('npm SBOM omitted a shipped package')
  const source = bom.metadata.component
  const rootRef = `pkg:npm/${name}@${source.version}`
  // Each derived document is its own product: a fresh identity and a root
  // built from name and version only, never the source BOM wholesale (which
  // would share the serialNumber and leak extension-only root metadata).
  const root = {
    type: source.type ?? 'application',
    name,
    version: source.version,
    purl: rootRef,
    'bom-ref': rootRef,
  }
  const refs = new Set(components.map((component) => component['bom-ref']))
  // Inventory edges only: no build-tool or omitted intermediary component references.
  const dependencies = bom.dependencies
    .filter(({ ref }) => refs.has(ref))
    .map(({ ref, dependsOn }) => ({
      ref,
      dependsOn: dependsOn.filter((dependency) => refs.has(dependency)),
    }))
  dependencies.unshift({
    ref: root['bom-ref'],
    dependsOn: [...refs].toSorted((a, b) => a.localeCompare(b, 'en')),
  })
  // npm writes a random serial number and the current time. Both are replaced
  // so a rebuild of the same inputs gives the same bytes (SHA256SUMS and the
  // rerun's byte comparison depend on it): the serial is a UUID derived from
  // the document's content, unique per product and inventory, and the
  // optional timestamp is left out.
  const { timestamp: _timestamp, ...metadata } = bom.metadata
  const identity = JSON.stringify({ root, components, dependencies })
  return {
    ...bom,
    serialNumber: contentUuid(identity),
    metadata: { ...metadata, component: root },
    components,
    dependencies,
  }
}

/** An RFC 9562 version-8 UUID URN from SHA-256 of `text`: the same text, the same UUID. */
function contentUuid(text) {
  const bytes = createHash('sha256').update(text).digest().subarray(0, 16)
  bytes[6] = (bytes[6] & 0x0f) | 0x80
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = bytes.toString('hex')
  return `urn:uuid:${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  if (!existsSync(path.join(ACP_STAGE, 'package.json')))
    throw new Error('ACP package stage is missing: run scripts/package-acp.mjs first')
  const raw = execFileSync(
    'npm',
    [
      'sbom',
      '--sbom-format',
      'cyclonedx',
      '--package-lock-only',
      '--include=dev',
      '--include=optional',
    ],
    { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024, shell: process.platform === 'win32' },
  )
  const full = JSON.parse(raw)
  const extensionMeta = readdirSync('dist/meta').map((file) => `dist/meta/${file}`)
  const extension = bundledPackages(extensionMeta)
  // Only bundled inputs are proven runtime code; unbundled native platform
  // dependencies keep the optional scope npm gave them.
  // Lazy archive members retain their staged JS entry; browser chunks are
  // included only when the ACP packer copied them into the usage graph.
  const acpMeta = [
    ...extensionMeta,
    ...readdirSync('dist/meta-acp').map((file) => `dist/meta-acp/${file}`),
  ]
  const acpBundled = bundledPackages(acpMeta, readFileSync, (file) =>
    existsSync(path.join(ACP_STAGE, file)),
  )
  const acp = new Set([
    ...acpBundled,
    ...nativePackages(JSON.parse(readFileSync('package-lock.json', 'utf8'))),
  ])
  mkdirSync('dist/sbom', { recursive: true })
  for (const [name, packages, required] of [
    ['muse-spark-code', extension, extension],
    ['muse-spark-code-acp', acp, acpBundled],
  ]) {
    writeFileSync(
      path.join('dist/sbom', `${name}.cdx.json`),
      `${JSON.stringify(shippedBom(full, packages, name, required), null, 2)}\n`,
    )
    console.log(`${name}: ${packages.size} shipped dependency versions in CycloneDX`)
  }
}
