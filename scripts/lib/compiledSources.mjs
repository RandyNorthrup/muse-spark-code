// M97 CM971-R3: the SHA-256 of the exact bytes esbuild compiles, captured
// inside the build itself (an onLoad hook that reads each source once and
// hands those same bytes to esbuild), never by re-reading files after the
// build. Plugins that transform a source read it through
// `readCompiledSource`, so their input is recorded the same way. A file
// read twice with different bytes in one build run is recorded as
// conflicting and gets no hash, so the legal scanner reads it as stale.
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'

/** Workspace-relative path → SHA-256, or `null` once two reads disagree. */
const recorded = new Map()

function workspaceKey(file) {
  return path.relative(process.cwd(), path.resolve(file)).split(path.sep).join('/')
}

function record(file, bytes) {
  const key = workspaceKey(file)
  const digest = createHash('sha256').update(bytes).digest('hex')
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
 * plugin claimed from the bytes it hashes. Files with no known loader
 * are left to esbuild (and stay unrecorded, so never proven fresh).
 */
export const compiledSourceRecorder = {
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

/** Recorded hashes for a metafile's inputs; unrecorded or conflicting ones are left out. */
export function compiledInputHashes(inputs) {
  const hashes = {}
  for (const input of inputs) {
    const key = input.replaceAll('\\', '/')
    const digest = recorded.get(key)
    if (typeof digest === 'string') hashes[key] = digest
  }
  return hashes
}
