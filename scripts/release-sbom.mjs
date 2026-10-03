// npm's full locked CycloneDX inventory, restricted to actual shipped esbuild inputs.
// --omit=dev alone is wrong here: zod, React and the Muse/ACP SDKs are bundled devDeps.
import { execFileSync } from 'node:child_process'
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { z } from 'zod'

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
const ACP_META = [
  'dist/meta-acp/acp.json',
  'dist/meta/modelApi.json',
  'dist/meta/searchWorker.json',
  'dist/meta/pageWorker.json',
]

function packageDir(input) {
  const marker = 'node_modules/'
  const at = input.lastIndexOf(marker)
  if (at === -1) return
  const [first, second] = input.slice(at + marker.length).split('/', 2)
  const name = first.startsWith('@') ? `${first}/${second}` : first
  return input.slice(0, at + marker.length) + name
}

export function bundledPackages(metafiles, read = readFileSync) {
  const packages = new Set()
  for (const file of metafiles) {
    const meta = JSON.parse(read(file, 'utf8'))
    for (const output of Object.values(meta.outputs)) {
      for (const [input, contribution] of Object.entries(output.inputs)) {
        const dir = packageDir(input)
        if (dir === undefined || contribution.bytesInOutput <= 0) continue
        const manifest = JSON.parse(read(`${dir}/package.json`, 'utf8'))
        packages.add(`${manifest.name}@${manifest.version}`)
      }
    }
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

export function shippedBom(document, included, name) {
  const bom = BOM.parse(document)
  const components = bom.components.filter((component) =>
    included.has(
      `${component.group === undefined ? '' : `${component.group}/`}${component.name}@${component.version}`,
    ),
  )
  const found = new Set(
    components.map(
      (component) =>
        `${component.group === undefined ? '' : `${component.group}/`}${component.name}@${component.version}`,
    ),
  )
  if ([...included].some((entry) => !found.has(entry)))
    throw new Error('npm SBOM omitted a shipped package')
  const rootRef = `pkg:npm/${name}@${bom.metadata.component.version}`
  const root = { ...bom.metadata.component, name, purl: rootRef, 'bom-ref': rootRef }
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
  return { ...bom, metadata: { ...bom.metadata, component: root }, components, dependencies }
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
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
  const extension = bundledPackages(readdirSync('dist/meta').map((file) => `dist/meta/${file}`))
  const acp = new Set([
    ...bundledPackages(ACP_META),
    ...nativePackages(JSON.parse(readFileSync('package-lock.json', 'utf8'))),
  ])
  mkdirSync('dist/sbom', { recursive: true })
  for (const [name, packages] of [
    ['muse-spark-code', extension],
    ['muse-spark-code-acp', acp],
  ]) {
    writeFileSync(
      path.join('dist/sbom', `${name}.cdx.json`),
      `${JSON.stringify(shippedBom(full, packages, name), null, 2)}\n`,
    )
    console.log(`${name}: ${packages.size} shipped dependency versions in CycloneDX`)
  }
}
