// The generated lazy-bundle registry's shared logic (MODELAPIDIETR4,
// review RVAPP-MODELAPIDIET3 P2-1/P2-2/P2-3): scan every src loader for the
// dist file it names, resolve each name through the build's own redirect map
// (DEFERRED_OUTFILES) and emitted chunks, and attribute each request to the
// side whose bundles contain the requesting source (no hand-kept lists).
// scripts/gen-lazy-registry.mjs writes src/shared/lazyBundles.generated.ts
// from this; its --check and test/unit/lazyBundleFiles.test.ts read it back.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

const TS_EXTENSIONS = new Set(['.ts', '.tsx'])

// A line that names a bundle at its use site: the dist prefix or one of the
// loader adapters whose argument is the file name.
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
  'bundleRoot',
  'extensionUri',
  'extensionPath',
  'packageRoot',
]

const BASENAME = /^(?!\.)[A-Za-z0-9_.-]+\.js$/u
const CONST_ASSIGNMENT = /\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*(['"])((?:(?!\2)[^\\]|\\.)*?)\2/gu
const STRING_LITERAL = /(['"])((?:(?!\1)[^\\]|\\.)*?)\1/g
const IDENTIFIER_CHARACTER = /[\w$]/u

/**
 * Whether the text reads the constant as a whole name: no identifier
 * character on either side. A search, never an expression built from the
 * name: the name comes out of scanned source.
 */
export function usesIdentifier(text, identifier) {
  if (identifier === '') return false
  let at = text.indexOf(identifier)
  while (at !== -1) {
    const before = text.charAt(at - 1)
    const after = text.charAt(at + identifier.length)
    if (!IDENTIFIER_CHARACTER.test(before) && !IDENTIFIER_CHARACTER.test(after)) return true
    at = text.indexOf(identifier, at + 1)
  }
  return false
}

/** The file's lines with comments removed and strings kept whole. */
export function codeLines(text) {
  const lines = []
  let current = ''
  let quote = null
  let i = 0
  const push = (char) => {
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

function sourceFiles(directory, skip) {
  const found = []
  for (const name of readdirSync(directory)) {
    const file = path.join(directory, name)
    if (statSync(file).isDirectory()) found.push(...sourceFiles(file, skip))
    else if (file !== skip && TS_EXTENSIONS.has(path.extname(name))) found.push(file)
  }
  return found
}

const isStaticFrom = (line) => /^\s*(?:import|export)\b[^'"]*\bfrom\s*['"]/u.test(line)
const isPathValue = (value) =>
  value.startsWith('dist/') || value.startsWith('./') || value.startsWith('../')

/**
 * @typedef {object} LazyRequest
 * @property {string} importer root-relative source with forward slashes
 * @property {number} line 1-based line of the naming literal
 * @property {string} value the dist name as spelled (dist/, relative or bare)
 * @property {string|undefined} identifier the const holding it, when assigned
 *
 * @typedef {object} LazyScan
 * @property {LazyRequest[]} requests
 * @property {Map<string, string>} definitions bundle-name constant to defining file
 * @property {Map<string, string[]>} uses constant to every mentioning file
 * @property {Map<string, string[]>} usesLoad constant to files loading by it
 * @property {string[]} dynamics unresolvable computed bundle names
 */

/**
 * Every dist name the sources load by file name: [{ importer, line, value }].
 * importer is root-relative with forward slashes. A literal counts when it
 * names the file: a dist/ or entry-relative path always; a bare basename
 * from a const assignment (the definition carries the name) or beside a
 * loader hint; a bare `.js` fragment only when concatenated with a sibling
 * path literal (`'./rogue' + '.js'`). Static `import/export ... from` lines
 * never count (the bundler inlines those); templates with ${} count only as
 * unresolvable dynamics. Also returns const definitions (identifier to
 * defining file) and their uses, so requests attribute to every file that
 * names the bundle, not just the definition site.
 * @param {string} root repository root
 * @param {string} generatedFile root-relative generated registry to skip
 * @returns {LazyScan}
 */
export function scanRequests(root, generatedFile) {
  const source = path.join(root, 'src')
  const files = sourceFiles(source, path.join(root, generatedFile))
  const texts = new Map()
  for (const file of files) {
    texts.set(file, readFileSync(file, 'utf8').replaceAll('\r\n', '\n'))
  }
  const relative = (file) => path.relative(root, file).replaceAll('\\', '/')
  const definitions = new Map()
  for (const [file, text] of texts) {
    for (const match of text.matchAll(CONST_ASSIGNMENT)) {
      if (match[3].endsWith('.js')) definitions.set(match[1], relative(file))
    }
  }
  // Where each bundle-name constant is read: every mentioning file, and the
  // subset mentioning it where a bundle loads (a dynamic import/require or a
  // loader hint on the line). A name only framed, listed or logged is data,
  // never a load.
  const uses = new Map()
  const usesLoad = new Map()
  for (const [identifier, at] of definitions) {
    const mentioning = [...texts]
      .filter(([file, text]) => relative(file) !== at && usesIdentifier(text, identifier))
      .map(([file]) => relative(file))
    uses.set(identifier, mentioning)
    usesLoad.set(
      identifier,
      [...texts]
        .filter(([file]) => mentioning.includes(relative(file)))
        .filter(([, text]) =>
          codeLines(text).some(
            (line) =>
              usesIdentifier(line, identifier) &&
              !isStaticFrom(line) &&
              (/(\bimport\(|\brequire\()/.test(line) ||
                LOADER_HINTS.some((hint) => line.includes(hint))),
          ),
        )
        .map(([file]) => relative(file)),
    )
  }
  const requests = []
  const dynamics = []
  for (const [file, text] of texts) {
    for (const [index, line] of codeLines(text).entries()) {
      if (isStaticFrom(line)) continue
      // A sibling path beside this bundle (an OS-launch path, never a module
      // load) is not a load: the launcher resolves it where it runs.
      if (/path\.dirname/u.test(line) && /path\.(join|resolve)\(/u.test(line)) continue
      const literals = line
        .matchAll(STRING_LITERAL)
        .map((match) => match[2])
        .toArray()
      if (literals.some((value) => value.includes('${'))) {
        if (
          literals.some((value) => value.includes('dist/')) ||
          LOADER_HINTS.some((hint) => line.includes(hint))
        ) {
          dynamics.push(`${relative(file)}:${String(index + 1)} builds a bundle name`)
        }
        continue
      }
      const assigned = new Map(line.matchAll(CONST_ASSIGNMENT).map((match) => [match[3], match[1]]))
      const siblings = literals.filter((value) => isPathValue(value) && !value.endsWith('.js'))
      const isDynamicCall = /(\bimport\(|\brequire\()/.test(line)
      for (const value of literals) {
        if (value.includes('@')) continue
        // An extensionless relative name in a dynamic import()/require() is
        // either a redirected bundle (the map knows it) or a bundled import.
        if (!value.endsWith('.js')) {
          // A path stem concatenated with a `.js` fragment names its bundle.
          const isJoinedFragment = /(['"])\s*\+\s*\1\.js/u.test(line)
          if (isJoinedFragment && isPathValue(value)) {
            requests.push({ importer: relative(file), line: index + 1, value: `${value}.js` })
          } else if (isDynamicCall && isPathValue(value)) {
            requests.push({ importer: relative(file), line: index + 1, value })
          }
          continue
        }
        if (isPathValue(value)) {
          // A dist/ path counts only where it is passed, assigned or keyed:
          // a bare path list (the report's frame set) is data, never a load.
          // Entry-relative names always count: only a load spells those.
          if (
            !value.startsWith('dist/') ||
            assigned.has(value) ||
            /[(:=]/u.test(line.replaceAll(STRING_LITERAL, ''))
          ) {
            requests.push({ importer: relative(file), line: index + 1, value })
          }
          continue
        }
        const base = value.split('/').pop() ?? ''
        if (!BASENAME.test(base)) continue
        if (
          assigned.has(value) ||
          LOADER_HINTS.some((hint) => line.includes(hint)) ||
          siblings.length > 0
        ) {
          requests.push({
            importer: relative(file),
            line: index + 1,
            value,
            identifier: assigned.get(value),
          })
        }
      }
    }
  }
  return { requests, definitions, uses, usesLoad, dynamics }
}

/**
 * What one request loads: { mapped } for a redirect-map target, { file }
 * for a dist basename, { bundled: true } for an import the bundler inlines
 * (an entry-relative name whose source exists and the map does not cover).
 * dist/ prefixes and bare basenames always name dist files.
 * @param {string} root repository root
 * @param {Map<string, string>} deferredOutfiles absolute source entry to dist output
 * @param {LazyRequest} request
 * @returns {{ mapped?: string, file?: string, bundled?: true }}
 */
export function resolveRequest(root, deferredOutfiles, request) {
  const { importer, value } = request
  if (value.startsWith('dist/')) return { file: value.slice('dist/'.length) }
  if (value.startsWith('./') || value.startsWith('../')) {
    const stem = path.resolve(root, path.dirname(importer), value).replace(/\.js$/, '')
    for (const [source, output] of deferredOutfiles) {
      if (path.resolve(source) === `${stem}.ts`) {
        return { mapped: output.replace(/^dist\//, '') }
      }
    }
    if (!value.endsWith('.js')) return { bundled: true }
    return existsSync(`${stem}.ts`) || existsSync(`${stem}.tsx`)
      ? { bundled: true }
      : { file: value.split('/').pop() ?? value }
  }
  return { file: value.split('/').pop() ?? value }
}
