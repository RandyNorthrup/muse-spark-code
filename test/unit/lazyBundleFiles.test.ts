// RVMODELAPIDIETB P2: the lazy-bundle registry (src/shared/lazyBundleFiles.ts)
// is the single authority for dist file names. Any string or template in
// src that names a dist file outside the table fails here, so a new
// filename-loaded chunk cannot land without a registry entry, and the
// packaging gate (packagedBundles.test.mjs) then proves that entry ships.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { expect, it } from 'vitest'
import { LAZY_BUNDLE_FILES } from '../../src/shared/lazyBundleFiles'

const root = process.cwd()
const source = path.join(root, 'src')
const registry = path.join(source, 'shared', 'lazyBundleFiles.ts')

// A line that loads a bundle by file name: a dist path segment, a loader
// adapter argument, a worker path or a webview script reference.
const LOADER_HINTS = [
  'dist',
  'distDir',
  'bundlePath',
  'bundleFile',
  'BUNDLE_FILE',
  '__dirname',
  'Worker',
  'workerPath',
  'loadBundle',
  'requireFile',
  'joinPath',
  'asWebviewUri',
  'loadModule',
  'path.join',
  'path.dirname',
  'path.resolve',
  "require('",
  'bundleRoot',
  'extensionUri',
  'extensionPath',
  'packageRoot',
]

const BASENAME = /^[A-Za-z0-9_.-]+\.js$/u

function sourceFiles(directory: string): string[] {
  const found: string[] = []
  for (const name of readdirSync(directory)) {
    const file = path.join(directory, name)
    if (statSync(file).isDirectory()) found.push(...sourceFiles(file))
    else if (file !== registry && name.endsWith('.ts')) found.push(file)
  }
  return found
}

// The file's lines with comments removed, strings kept whole: a quoted
// dist name in a comment (a doc reference, never a load) must not fail.
function codeLines(text: string): string[] {
  const lines: string[] = []
  let current = ''
  let quote: string | null = null
  let i = 0
  const push = (char: string): void => {
    if (char === '\n') {
      lines.push(current)
      current = ''
    } else {
      current += char
    }
  }
  while (i < text.length) {
    const char = text[i]
    const next = text[i + 1]
    if (quote === null && char === '/' && next === '/') {
      while (i < text.length && text[i] !== '\n') i += 1
      continue
    }
    if (quote === null && char === '/' && next === '*') {
      i += 2
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) {
        if (text[i] === '\n') {
          lines.push(current)
          current = ''
        }
        i += 1
      }
      i += 2
      continue
    }
    if (quote === null && ["'", '"', '`'].includes(char)) {
      quote = char
      push(char)
      i += 1
      continue
    }
    if (quote !== null && char === '\\') {
      push(char)
      push(next ?? '')
      i += 2
      continue
    }
    if (quote !== null && char === quote) {
      quote = null
      push(char)
      i += 1
      continue
    }
    push(char)
    i += 1
  }
  lines.push(current)
  return lines
}

it('holds one well-formed entry per filename-loaded chunk', () => {
  const files = Object.values(LAZY_BUNDLE_FILES).map((entry) => entry.file)
  expect(new Set(files).size).toBe(files.length)
  for (const [key, entry] of Object.entries(LAZY_BUNDLE_FILES)) {
    expect(key).toMatch(/^[a-z][a-zA-Z0-9]*$/u)
    expect(entry.file).toMatch(/^([a-z]+\/)?[A-Za-z0-9_.-]+\.js$/u)
    expect(typeof entry.vsix).toBe('boolean')
    expect(typeof entry.acp).toBe('boolean')
    expect(entry.vsix || entry.acp).toBe(true)
  }
})

it('names every dist file the sources load by file name', () => {
  const known = new Set(
    Object.values(LAZY_BUNDLE_FILES).map((entry) => entry.file.split('/').pop()!),
  )
  const outside: string[] = []
  const dynamic: string[] = []
  for (const file of sourceFiles(source)) {
    const lines = codeLines(readFileSync(file, 'utf8').replaceAll('\r\n', '\n'))
    for (const [index, line] of lines.entries()) {
      for (const match of line.matchAll(/(['"`])((?:(?!\1)[^\\]|\\.)*?)\1/g)) {
        const value = match[2]!
        if (!value.endsWith('.js') || value.includes('@')) continue
        if (value.includes('${')) {
          if (value.includes('dist/') || LOADER_HINTS.some((hint) => line.includes(hint))) {
            dynamic.push(`${relative(file)}:${String(index + 1)} builds ${value}`)
          }
          continue
        }
        if (value.includes('/') && !value.startsWith('dist/')) continue
        const base = value.split('/').pop()!
        if (!BASENAME.test(base)) continue
        if (!(value.startsWith('dist/') || LOADER_HINTS.some((hint) => line.includes(hint))))
          continue
        if (!known.has(base)) outside.push(`${relative(file)}:${String(index + 1)} names ${base}`)
      }
    }
  }
  expect(dynamic).toEqual([])
  expect(outside).toEqual([])
})

function relative(file: string): string {
  return path.relative(root, file).replaceAll('\\', '/')
}
