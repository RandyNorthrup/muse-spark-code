// The editor group's language catalog (M111 lane ED, D91.14): which
// CodeMirror language a file gets, by name and extension. The loaders
// live in codemirror.mjs behind dynamic imports, so each language is its
// own lazy chunk and a surface pays only for the languages it opens.
// Language names are the languages' own names, shown as data (like a
// file name); everything around them is UI text.
//
// Real Lezer parsers cover JavaScript/TypeScript and JSON; the legacy
// stream modes cover the rest at a few KiB each. A file matching
// nothing is plain text — the honest fallback, never a guessed
// grammar. The set is sized to the node's existing 600 KiB editor
// budget, measured chunk by chunk (docs/certification/rlf-m111ed.md):
// the full @codemirror/language-data set measures ~1.1 MiB of lazy
// chunks on top of the editor core, and @codemirror/lang-markdown
// alone ~99 KiB because it carries the HTML and CSS parsers, so
// Markdown opens as plain text here. Muse Desktop's workbench bundle
// (lane WB) carries its own new-bundle budget and widens this catalog
// there; widening is a catalog edit here plus a loader in
// codemirror.mjs.

import { fileTitle } from './groupState'

export interface EditorLanguage {
  readonly id: string
  readonly name: string
  /** Lowercase extensions without the dot (`ts`, `py`). */
  readonly extensions: readonly string[]
  /** Exact file names (`Dockerfile`, `Makefile`); matched first. */
  readonly filenames?: readonly string[]
}

export const EDITOR_LANGUAGES: readonly EditorLanguage[] = [
  { id: 'javascript', name: 'JavaScript', extensions: ['js', 'mjs', 'cjs'] },
  { id: 'jsx', name: 'JSX', extensions: ['jsx'] },
  { id: 'typescript', name: 'TypeScript', extensions: ['ts', 'mts', 'cts'] },
  { id: 'tsx', name: 'TSX', extensions: ['tsx'] },
  { id: 'json', name: 'JSON', extensions: ['json', 'jsonc', 'json5'] },
  { id: 'python', name: 'Python', extensions: ['py', 'pyi'] },
  { id: 'html', name: 'HTML', extensions: ['html', 'htm'] },
  { id: 'css', name: 'CSS', extensions: ['css'] },
  { id: 'yaml', name: 'YAML', extensions: ['yaml', 'yml'] },
  { id: 'xml', name: 'XML', extensions: ['xml', 'svg', 'plist'] },
  { id: 'rust', name: 'Rust', extensions: ['rs'] },
  { id: 'go', name: 'Go', extensions: ['go'] },
  { id: 'shell', name: 'Shell', extensions: ['sh', 'bash', 'zsh'] },
  { id: 'powershell', name: 'PowerShell', extensions: ['ps1', 'psm1'] },
  { id: 'toml', name: 'TOML', extensions: ['toml'] },
  { id: 'dockerfile', name: 'Docker', extensions: [], filenames: ['Dockerfile'] },
  { id: 'cmake', name: 'CMake', extensions: ['cmake'], filenames: ['CMakeLists.txt'] },
  { id: 'diff', name: 'Diff', extensions: ['diff', 'patch'] },
  { id: 'properties', name: 'Properties', extensions: ['properties', 'ini'] },
]

/** The language a path opens with, or null for plain text. File names
win over extensions (`CMakeLists.txt` is CMake, not text); a leading-dot
name (`.gitignore`) has no extension. Paths may use either separator. */
export function languageIdForPath(path: string): string | null {
  const name = fileTitle(path)
  for (const language of EDITOR_LANGUAGES) {
    if (language.filenames?.includes(name) === true) return language.id
  }
  const dot = name.lastIndexOf('.')
  if (dot <= 0) return null
  const extension = name.slice(dot + 1).toLowerCase()
  return extension === ''
    ? null
    : (EDITOR_LANGUAGES.find((language) => language.extensions.includes(extension))?.id ?? null)
}

export function languageName(id: string | null): string | undefined {
  return id === null ? undefined : EDITOR_LANGUAGES.find((language) => language.id === id)?.name
}
