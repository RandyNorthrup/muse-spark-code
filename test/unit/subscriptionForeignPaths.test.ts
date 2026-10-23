// M95b acceptance 4's foreign-path guard: Remove revokes the refresh token
// and deletes the record, and nothing of Codex CLI's, Claude Code's,
// Gemini CLI's or Copilot's own storage is ever read. The proof is
// structural: no product code names one of their paths. Only string
// literals and identifiers count (comments and doc URLs do not name a
// read), and a path only trips when the dotted folder sits on a path
// boundary, so `platform.claude.com`, `github.copilot` settings keys and
// `copilot/` model hints stay green. The three files below name foreign
// paths on purpose, each with its reviewed mechanism; a new reader
// anywhere else — a subscription file reaching for `~/.codex/auth.json`,
// say — fails the first test, and a listed mechanism that goes away
// fails the anchor test until the record is updated.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import * as ts from 'typescript'
import { filesUnder } from './helpers/temporaryFolders'

const SRC = path.join(__dirname, '..', '..', 'src')

/**
A dotted home folder on a path boundary: `~/.codex`, `.claude/x`, bare
`.gemini`. The boundary keeps doc hosts (`platform.claude.com`),
settings keys (`github.copilot`) and model hints (`copilot/`) green.
*/
const DOT_DIRS: readonly { readonly dir: string; readonly pattern: RegExp }[] = [
  { dir: 'codex', pattern: /(^|[/\\])\.codex([/\\]|$)/u },
  { dir: 'claude', pattern: /(^|[/\\])\.claude([/\\]|$)/u },
  { dir: 'gemini', pattern: /(^|[/\\])\.gemini([/\\]|$)/u },
  { dir: 'copilot', pattern: /(^|[/\\])\.copilot([/\\]|$)/u },
]

/** Fragments that trip in any string literal, however placed. */
const LITERAL_FRAGMENTS = ['.claude.json', 'github-copilot']

/** Environment overrides that trip in a literal or an identifier. */
const ENV_NAMES = ['CODEX_HOME', 'CLAUDE_CONFIG_DIR', 'COPILOT_HOME']

interface ForeignSite {
  readonly line: number
  readonly fragment: string
}

function fragmentInLiteral(text: string): string | undefined {
  for (const fragment of LITERAL_FRAGMENTS) {
    if (text.includes(fragment)) {
      return fragment
    }
  }
  for (const { dir, pattern } of DOT_DIRS) {
    if (pattern.test(text)) {
      return `.${dir}`
    }
  }
  for (const name of ENV_NAMES) {
    if (text.includes(name)) {
      return name
    }
  }
  return undefined
}

function fragmentInIdentifier(text: string): string | undefined {
  for (const name of ENV_NAMES) {
    if (text.includes(name)) {
      return name
    }
  }
  return undefined
}

/** Every foreign-path naming in one file: string and template literals plus identifiers. */
function foreignSites(file: string, text: string): ForeignSite[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true)
  const sites: ForeignSite[] = []
  const seen = new Set<string>()
  const flag = (node: ts.Node, fragment: string): void => {
    const line = source.getLineAndCharacterOfPosition(node.getStart()).line + 1
    const key = `${String(line)}:${fragment}`
    if (seen.has(key)) {
      return
    }
    seen.add(key)
    sites.push({ line, fragment })
  }
  const visit = (node: ts.Node): void => {
    if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node)
    ) {
      const fragment = fragmentInLiteral(node.text)
      if (fragment !== undefined) {
        flag(node, fragment)
      }
    } else if (ts.isIdentifier(node)) {
      const fragment = fragmentInIdentifier(node.text)
      if (fragment !== undefined) {
        flag(node, fragment)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return sites
}

interface KnownForeignPaths {
  /** Reviewed mechanism strings that must stay in the file. */
  readonly anchors: readonly string[]
  readonly reason: string
}

/**
The three files that name foreign paths on purpose. Anything else that
names one is a new reader of another application's storage.
*/
const KNOWN: Record<string, KnownForeignPaths> = {
  'src/shared/constants.ts': {
    anchors: ['AGENT_IMPORT_PATHS', 'PROTECTED_PATH_SEGMENTS'],
    reason:
      'the documented folders the consented agent import reads, and the workspace paths the agent must never write',
  },
  'src/core/reporting/sources/agentUsage.ts': {
    anchors: ["? '.codex' : '.claude'"],
    reason: "usage reporting resolves the other agents' session files under their home folders",
  },
  'src/runtime/reporting/sources.ts': {
    anchors: ["? '.codex' : '.claude'"],
    reason: "report agent roots default under the other agents' home folders",
  },
}

/**
The inventory, built once at import: parsing the whole tree takes far
past a test's own budget, and the result cannot change mid-suite.
*/
const inventory = ((): Map<string, ForeignSite[]> => {
  const found = new Map<string, ForeignSite[]>()
  const root = path.join(__dirname, '..', '..')
  for (const file of filesUnder(SRC)) {
    if (!file.endsWith('.ts')) {
      continue
    }
    // Cheap prefilter: only a file that mentions a foreign marker can
    // name one; only those pay for a parse.
    const text = readFileSync(file, 'utf8')
    if (
      !text.includes('.codex') &&
      !text.includes('.claude') &&
      !text.includes('.gemini') &&
      !text.includes('.copilot') &&
      !text.includes('github-copilot') &&
      ENV_NAMES.every((name) => !text.includes(name))
    ) {
      continue
    }
    const sites = foreignSites(file, text)
    if (sites.length > 0) {
      found.set(path.relative(root, file).replaceAll('\\', '/'), sites)
    }
  }
  return found
})()

describe('M95b acceptance 4 foreign-path guard', () => {
  it("no product code names another application's storage paths", () => {
    const detail: string[] = []
    for (const [file, sites] of inventory) {
      if (KNOWN[file] !== undefined) {
        continue
      }
      const named = Array.from(sites, (site) => `${site.fragment}:${String(site.line)}`)
      detail.push(`${file}: ${named.join(', ')}`)
    }
    expect(
      detail,
      'foreign storage path named outside the reviewed list: read only the own record, or review it into the record',
    ).toEqual([])
    const missing: string[] = []
    for (const file of Object.keys(KNOWN)) {
      if (!inventory.has(file)) {
        missing.push(file)
      }
    }
    expect(missing, 'inventory entry with no naming left: update the record').toEqual([])
  })

  it('every listed mechanism is still wired', () => {
    const root = path.join(__dirname, '..', '..')
    const withoutAnchor: string[] = []
    for (const [file, entry] of Object.entries(KNOWN)) {
      const text = readFileSync(path.join(root, file), 'utf8')
      for (const anchor of entry.anchors) {
        if (!text.includes(anchor)) {
          withoutAnchor.push(`${file} lost its anchor ${anchor}`)
        }
      }
    }
    expect(withoutAnchor, 'a reviewed mechanism went away without updating the record').toEqual([])
  })
})
