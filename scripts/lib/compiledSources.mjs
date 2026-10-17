// M97 CM971-R3: the SHA-256 of the exact bytes esbuild compiles, captured
// inside the build itself, never by re-reading files after the build.
// - The last plugin of every shipped build loads each file no earlier
//   plugin claimed from the bytes it hashes (any loader, text or binary).
// - Plugins that transform a source read it through `readCompiledSource`.
// - Every plugin's onLoad is wrapped, so the contents a plugin hands
//   esbuild are hashed where they are handed over: a generated module
//   (`namespace:name`), or a file whose compiled contents a plugin
//   generated (recorded beside the source bytes, which are pinned at that
//   moment when the plugin never read them).
// Records are kept per build. A file read twice with different bytes in
// one build run is recorded as conflicting and gets no hash, so the legal
// scanner reads it as stale.
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'

/** Workspace-relative path → SHA-256 of the source bytes read, or `null` once two reads disagree. */
const recorded = new Map()

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')

function workspaceKey(file) {
  return path.relative(process.cwd(), path.resolve(file)).split(path.sep).join('/')
}

function record(file, bytes) {
  const key = workspaceKey(file)
  const digest = sha256(bytes)
  const earlier = recorded.get(key)
  recorded.set(key, earlier === undefined || earlier === digest ? digest : null)
}

/** Read a source a build plugin compiles, recording its exact bytes. */
export function readCompiledSource(file) {
  const bytes = readFileSync(file)
  record(file, bytes)
  return bytes.toString('utf8')
}

const DEFAULT_LOADERS = {
  '.js': 'js',
  '.mjs': 'js',
  '.cjs': 'js',
  '.jsx': 'jsx',
  '.ts': 'ts',
  '.mts': 'ts',
  '.cts': 'ts',
  '.tsx': 'tsx',
  '.json': 'json',
  '.css': 'css',
  '.txt': 'text',
}

/**
 * The last plugin of every shipped build: loads each file no earlier
 * plugin claimed from the bytes it hashes. Files with no loader at all
 * are left to esbuild, which refuses them.
 */
const compiledSourceRecorder = {
  name: 'compiled-source-recorder',
  setup(build) {
    const configured = build.initialOptions.loader ?? {}
    build.onLoad({ filter: /.*/, namespace: 'file' }, (args) => {
      const extension = path.extname(args.path).toLowerCase()
      const loader = configured[extension] ?? DEFAULT_LOADERS[extension]
      if (loader === undefined) return
      const bytes = readFileSync(args.path)
      record(args.path, bytes)
      return { contents: bytes, loader }
    })
  },
}

/** A fresh per-build record: source and generated-contents hashes. */
export function newBuildRecord() {
  return { inputs: new Map(), generated: new Map() }
}

function capture(buildRecord, args, contents) {
  const bytes = typeof contents === 'string' ? Buffer.from(contents, 'utf8') : contents
  const digest = sha256(bytes)
  if (args.namespace !== 'file') {
    buildRecord.generated.set(`${args.namespace}:${args.path}`, digest)
    return
  }
  const key = workspaceKey(args.path)
  // A plugin that generated contents without reading the file: pin the
  // source bytes now, so a later edit still reads as stale.
  if (!recorded.has(key)) record(args.path, readFileSync(args.path))
  const source = recorded.get(key) ?? null
  buildRecord.inputs.set(key, source)
  if (digest !== source) buildRecord.generated.set(key, digest)
}

/**
 * The build options with every plugin's onLoad wrapped to record what it
 * hands esbuild into `buildRecord`, and the recorder appended last.
 */
export function withCompiledRecording(options, buildRecord) {
  const wrap = (plugin) => ({
    name: plugin.name,
    setup(build) {
      const onLoad = (filter, callback) =>
        build.onLoad(filter, async (args) => {
          const result = await callback(args)
          if (result?.contents !== undefined) capture(buildRecord, args, result.contents)
          return result
        })
      return plugin.setup({ ...build, onLoad })
    },
  })
  return {
    ...options,
    plugins: [...(options.plugins ?? []), compiledSourceRecorder].map((plugin) => wrap(plugin)),
  }
}

/**
 * One bundle's build record for its metafile: input and generated-module
 * hashes from `buildRecord`; unrecorded or conflicting entries are left
 * out, so the scanner names them. esbuild's empty stand-ins for disabled
 * modules (`(disabled):…`) are recorded as the empty contents they are.
 */
export function compiledRecordFor(metafileInputs, buildRecord) {
  const inputs = {}
  const generated = {}
  for (const input of metafileInputs) {
    const key = input.replaceAll('\\', '/')
    if (key.startsWith('(disabled):')) {
      generated[key] = sha256(Buffer.alloc(0))
      continue
    }
    const source = buildRecord.inputs.get(key) ?? recorded.get(key)
    if (typeof source === 'string') inputs[key] = source
    const contents = buildRecord.generated.get(key)
    if (typeof contents === 'string') generated[key] = contents
  }
  return { inputs, generated }
}
