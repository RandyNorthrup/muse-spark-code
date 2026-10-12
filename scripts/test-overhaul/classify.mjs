// Classifier for lane TESTCUT, PASS 1.
//
// Reads every file under test/ with TypeScript's own parser and decides
// STAY, GO or LIST by the lane brief's rules 1 and 4, following imports of
// test helpers transitively. Rule 3 (behaviour a person depends on) is
// PASS 4 and is NOT decided here.
//
// Verdicts:
//   STAY  test of real code only (may still go in PASS 4 under rule 3)
//   GO    has a banned construct, or reaches a fake through an import
//   LIST  not deleted in this lane (live-provider e2e, integration,
//         host scripts); recorded for the integrator/lead
//
// Usage: node scripts/test-overhaul/classify.mjs [--write]
//   --write writes docs/testing/test-overhaul-2026-10-12.json
// Without --write it prints the counts only.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const testDir = path.join(root, 'test')

const FAKE_NAME = /fake|mock|stub/i
const MOCK_REPLACEMENT = /\.mock(Implementation|ReturnValue|ResolvedValue|RejectedValue)(Once)?$/
const LISTEN_CALL = /(^|\.)listen$/
const CREATE_SERVER_CALL = /(^|\.)createServer$/

function propName(node) {
  if (!node) return ''
  return ts.isIdentifier(node) || ts.isStringLiteralLike(node) ? node.text : ''
}

// Call expression callee chain, e.g. ["vi","mock"] or ["vi","spyOn"].
function calleeChain(expression) {
  const parts = []
  let node = expression
  while (ts.isPropertyAccessExpression(node)) {
    parts.unshift(propName(node.name))
    node = node.expression
  }
  if (ts.isIdentifier(node)) parts.unshift(node.text)
  return parts
}

// Leftmost identifier of a call receiver. Reports whether the receiver is
// itself a vi.fn() call (an inline observer callback).
function receiverRoot(expression) {
  let node = expression
  while (true) {
    if (ts.isPropertyAccessExpression(node)) {
      node = node.expression
    } else if (ts.isCallExpression(node)) {
      if (calleeChain(node.expression).join('.').startsWith('vi.fn')) {
        return { inlineObserver: true }
      }
      node = node.expression
    } else if (ts.isIdentifier(node)) {
      return { name: node.text }
    } else if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node)) {
      node = node.expression
    } else {
      return {}
    }
  }
}

function hasViFnCall(node) {
  let hasMatch = false
  function inner(current) {
    if (
      ts.isCallExpression(current) &&
      calleeChain(current.expression).join('.').startsWith('vi.fn')
    ) {
      hasMatch = true
    }
    ts.forEachChild(current, inner)
  }
  inner(node)
  return hasMatch
}

// Names bound to bare vi.fn() observers: rule 2 lets a test pass a
// callback in only to observe what the real code calls it with, so a
// replacement on one of these is not a stand-in.
function collectObservers(source) {
  const observerVars = new Set()
  function visit(node) {
    if (
      ts.isVariableDeclaration(node) &&
      node.name &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      hasViFnCall(node.initializer)
    ) {
      observerVars.add(node.name.text)
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return observerVars
}

function listFiles(dir) {
  const out = []
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      out.push(...listFiles(full))
    } else if (/\.(m?[tj]s|[tj]sx|mjs|cjs|mts|cts)$/.test(entry.name)) {
      out.push(full)
    }
  }
  return out
}

function scriptKindFor(full) {
  let kind
  if (full.endsWith('.tsx')) {
    kind = ts.ScriptKind.TSX
  } else if (full.endsWith('.jsx')) {
    kind = ts.ScriptKind.JSX
  } else if (full.endsWith('.ts') || full.endsWith('.mts') || full.endsWith('.cts')) {
    kind = ts.ScriptKind.TS
  } else {
    kind = ts.ScriptKind.JS
  }
  return kind
}

function parseFile(full) {
  const text = fs.readFileSync(full, 'utf8')
  const kind = scriptKindFor(full)
  return ts.createSourceFile(full, text, ts.ScriptTarget.Latest, true, kind)
}

function newEvidence() {
  return {
    imports: [],
    viMock: null,
    viDoMock: null,
    viHoisted: null,
    viStubGlobal: null,
    viStubEnv: null,
    stubGlobal: null,
    fakeTimers: null,
    setSystemTime: null,
    spyOn: null,
    mockReplacement: null,
    implementsClause: null,
    fakeDefinition: null,
    listen: null,
    createServer: null,
    vscodeImport: null,
    fakeImport: null,
  }
}

function noteImport(found, spec) {
  found.imports.push(spec)
  if (spec === 'vscode') found.vscodeImport = `import from "vscode"`
  else if (FAKE_NAME.test(spec)) found.fakeImport = `import "${spec}"`
}

function visitCall(found, observerVars, node) {
  const chain = calleeChain(node.expression)
  const head = chain.join('.')
  if (head === 'vi.mock' && !found.viMock) found.viMock = 'vi.mock(...)'
  else if (head === 'vi.doMock' && !found.viDoMock) found.viDoMock = 'vi.doMock(...)'
  else if (head === 'vi.hoisted' && !found.viHoisted) found.viHoisted = 'vi.hoisted(...)'
  else if (head === 'vi.stubGlobal' && !found.viStubGlobal)
    found.viStubGlobal = 'vi.stubGlobal(...)'
  else if (head === 'vi.stubEnv' && !found.viStubEnv) found.viStubEnv = 'vi.stubEnv(...)'
  else if (head === 'vi.useFakeTimers' && !found.fakeTimers)
    found.fakeTimers = 'vi.useFakeTimers(...)'
  else if (head === 'vi.setSystemTime' && !found.setSystemTime)
    found.setSystemTime = 'vi.setSystemTime(...)'
  else if (head === 'vi.spyOn' && !found.spyOn) found.spyOn = 'vi.spyOn(...)'
  else if (MOCK_REPLACEMENT.test(head) && !found.mockReplacement) {
    // A replacement on a bare vi.fn() observer (rule 2) only satisfies
    // the seam's return type; a replacement on any other handle fakes
    // behaviour and is a stand-in.
    const receiver = ts.isPropertyAccessExpression(node.expression)
      ? receiverRoot(node.expression.expression)
      : {}
    const isObserver =
      receiver.inlineObserver || (receiver.name ? observerVars.has(receiver.name) : false)
    if (!isObserver) found.mockReplacement = `${chain.at(-1)}(...)`
  } else if (LISTEN_CALL.test(head)) {
    if (!found.listen) found.listen = `${head}(...)`
  } else if (CREATE_SERVER_CALL.test(head)) {
    if (!found.createServer) found.createServer = `${head}(...)`
  } else if ((head === 'require' || head === 'import') && node.arguments.length === 1) {
    const arg = node.arguments[0]
    if (ts.isStringLiteralLike(arg)) noteImport(found, arg.text)
  }
  // vi.spyOn(x).mockX chained: the outer call is the mockX member call
  // on a CallExpression whose expression is a PropertyAccess on the
  // vi.spyOn(...) call. Covered above by the mockX branch.
}

function visitClass(found, node) {
  const heritageClauses = node.heritageClauses ?? []
  for (const heritage of heritageClauses) {
    if (heritage.token === ts.SyntaxKind.ImplementsKeyword && !found.implementsClause) {
      found.implementsClause = `class ${node.name?.text ?? '(anon)'} implements ...`
    }
  }
  const name = node.name?.text ?? ''
  if (!found.fakeDefinition && FAKE_NAME.test(name)) found.fakeDefinition = `class ${name}`
}

// Scan one file's own AST. Returns the evidence found in the file itself.
function scanSelf(source) {
  const found = newEvidence()
  const observerVars = collectObservers(source)

  function visit(node) {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      const spec = node.moduleSpecifier
      if (spec && ts.isStringLiteralLike(spec)) noteImport(found, spec.text)
    } else if (ts.isImportEqualsDeclaration(node)) {
      const ref = node.moduleReference
      if (ts.isExternalModuleReference(ref) && ts.isStringLiteralLike(ref.expression)) {
        found.imports.push(ref.expression.text)
      }
    } else if (ts.isCallExpression(node)) {
      visitCall(found, observerVars, node)
    } else if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isPropertyAccessExpression(node.left) &&
      ts.isIdentifier(node.left.expression) &&
      ['globalThis', 'global', 'window'].includes(node.left.expression.text)
    ) {
      if (!found.stubGlobal) {
        found.stubGlobal = `global stub (${node.left.expression.text}.${propName(node.left.name)} = ...)`
      }
    } else if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) {
      visitClass(found, node)
    } else if (
      (ts.isFunctionDeclaration(node) || ts.isVariableDeclaration(node)) &&
      node.name &&
      ts.isIdentifier(node.name) &&
      FAKE_NAME.test(node.name.text) &&
      !found.fakeDefinition
    ) {
      found.fakeDefinition = `${ts.isFunctionDeclaration(node) ? 'function' : 'const'} ${node.name.text}`
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return found
}

// A non-test file under test/ is itself a fake when its name or its own
// content is a stand-in.
function isFakeHelper(rel, evidence) {
  const base = path.basename(rel)
  if (FAKE_NAME.test(base)) return `helper name "${base}"`
  const isMockPath = rel.includes('unit/mocks/') || rel.includes('e2e/fake-muse/')
  return isMockPath
    ? `path "${rel}"`
    : evidence.viMock ||
        evidence.viDoMock ||
        evidence.viHoisted ||
        evidence.viStubGlobal ||
        evidence.stubGlobal ||
        evidence.viStubEnv ||
        evidence.fakeTimers ||
        evidence.setSystemTime ||
        evidence.implementsClause ||
        evidence.fakeDefinition ||
        evidence.vscodeImport ||
        evidence.createServer ||
        evidence.listen ||
        null
}

function resolveRelative(fromFull, spec) {
  if (!spec.startsWith('.')) return null
  const base = path.resolve(path.dirname(fromFull), spec)
  const candidates = [base, `${base}.ts`, `${base}.tsx`, `${base}.mts`, `${base}.mjs`, `${base}.js`]
  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate
    const indexFiles = [
      path.join(candidate, 'index.ts'),
      path.join(candidate, 'index.tsx'),
      path.join(candidate, 'index.mjs'),
    ]
    for (const index of indexFiles) {
      if (fs.existsSync(index)) return index
    }
  }
  return null
}

const files = listFiles(testDir).toSorted((a, b) => a.localeCompare(b))
const evidenceByFile = new Map()
for (const full of files) {
  try {
    evidenceByFile.set(full, scanSelf(parseFile(full)))
  } catch (error) {
    evidenceByFile.set(full, { imports: [], parseError: String(error) })
  }
}

const fakeReasonByFile = new Map()
for (const full of files) {
  const evidence = evidenceByFile.get(full)
  if (evidence.parseError) {
    fakeReasonByFile.set(full, `parse error: ${evidence.parseError}`)
    continue
  }
  const rel = path.relative(root, full).replaceAll(path.sep, '/')
  const reason = isFakeHelper(rel, evidence)
  if (reason) fakeReasonByFile.set(full, reason)
}

// Transitive import walk limited to files under test/.
function firstFakeReachable(fromFull) {
  const seen = new Set([fromFull])
  const queue = [{ full: fromFull, chain: [] }]
  while (queue.length > 0) {
    const current = queue.shift()
    const evidence = evidenceByFile.get(current.full)
    if (!evidence) continue
    const imports = evidence.imports
    for (const spec of imports) {
      const target = resolveRelative(current.full, spec)
      if (!target || seen.has(target)) continue
      seen.add(target)
      const chain = [...current.chain, spec]
      if (fakeReasonByFile.has(target)) {
        return { target, chain, reason: fakeReasonByFile.get(target) }
      }
      queue.push({ full: target, chain })
    }
  }
  return null
}

function ownBannedConstruct(evidence, full) {
  return (
    evidence.viMock ||
    evidence.viDoMock ||
    evidence.viHoisted ||
    evidence.viStubGlobal ||
    evidence.stubGlobal ||
    evidence.viStubEnv ||
    evidence.fakeTimers ||
    evidence.setSystemTime ||
    (evidence.spyOn && evidence.mockReplacement
      ? `${evidence.spyOn} with ${evidence.mockReplacement}`
      : null) ||
    evidence.implementsClause ||
    evidence.fakeDefinition ||
    evidence.vscodeImport ||
    evidence.fakeImport ||
    evidence.createServer ||
    evidence.listen ||
    (evidence.spyOn && /mock/i.test(path.basename(full)) ? evidence.spyOn : null)
  )
}

function decide(full) {
  const evidence = evidenceByFile.get(full)
  if (evidence.parseError)
    return { verdict: 'GO', decidedBy: `parse error: ${evidence.parseError}` }
  const rel = path.relative(root, full).replaceAll(path.sep, '/')
  const isTest = /\.test\.[cm]?[tj]sx?$/.test(full)
  // Rule 4 + lead lists: live-provider e2e and the real editor stay listed.
  if (rel === 'test/e2e/live.e2e.test.ts' || full.endsWith('.live.e2e.test.ts')) {
    return { verdict: 'LIST', decidedBy: 'live-provider e2e: moves under the real-life run' }
  }
  if (rel.startsWith('test/integration/')) {
    return isTest
      ? { verdict: 'LIST', decidedBy: 'real-editor integration: listed for the integrator' }
      : { verdict: 'STAY', decidedBy: 'integration helper: kept with its suite' }
  }
  if (rel.startsWith('test/hosts/')) {
    return { verdict: 'LIST', decidedBy: 'host script: listed, not a unit test' }
  }
  if (!isTest) {
    // Helpers/fixtures/harness scenes: GO only when themselves fake;
    // PASS 2 removes the orphaned ones via the import graph.
    return fakeReasonByFile.has(full)
      ? { verdict: 'GO', decidedBy: fakeReasonByFile.get(full) }
      : { verdict: 'STAY', decidedBy: 'helper/fixture/scene without a banned construct' }
  }

  // Own-file banned constructs first (rule 1), in brief order.
  const own = ownBannedConstruct(evidence, full)
  if (own) return { verdict: 'GO', decidedBy: own }

  // A replacement on a non-observer handle without spyOn in the same
  // file (e.g. on a rig object or an imported fake) still fakes behaviour.
  if (evidence.mockReplacement) {
    return {
      verdict: 'GO',
      decidedBy: `${evidence.mockReplacement} without spyOn (stand-in behaviour)`,
    }
  }

  // Rule 4: e2e against a stand-in backend goes, whatever it imports.
  if (rel.startsWith('test/e2e/')) {
    return { verdict: 'GO', decidedBy: 'process e2e against a stand-in backend (rule 4)' }
  }

  // Transitive helper reachability (rule 1, last sentence).
  const reached = firstFakeReachable(full)
  if (reached) {
    const targetRel = path.relative(root, reached.target).replaceAll(path.sep, '/')
    return {
      verdict: 'GO',
      decidedBy: `imports fake ${targetRel} via ${reached.chain.join(' -> ')} (${reached.reason})`,
    }
  }

  return { verdict: 'STAY', decidedBy: 'real code only by the parser' }
}

const rows = files.map((full) => {
  const rel = path.relative(root, full).replaceAll(path.sep, '/')
  const { verdict, decidedBy } = decide(full)
  return { file: rel, verdict, decidedBy }
})

const counts = {}
const goByConstruct = {}
for (const row of rows) {
  counts[row.verdict] = (counts[row.verdict] ?? 0) + 1
  if (row.verdict !== 'GO') continue
  const beforeVia = row.decidedBy.split(' via ', 2)[0]
  const key = beforeVia.split(':', 2)[0].slice(0, 60)
  goByConstruct[key] = (goByConstruct[key] ?? 0) + 1
}

const record = {
  generatedBy: 'scripts/test-overhaul/classify.mjs',
  root: 'test/',
  rules: 'lane TESTCUT brief rules 1+4; parser-based (typescript), transitive test-helper imports',
  counts,
  goByConstruct,
  rows,
}

const write = process.argv.includes('--write')
if (write) {
  const outPath = path.join(root, 'docs/testing/test-overhaul-2026-10-12.json')
  fs.mkdirSync(path.dirname(outPath), { recursive: true })
  fs.writeFileSync(outPath, `${JSON.stringify(record, null, 2)}\n`)
  console.log(`wrote ${path.relative(root, outPath)}`)
}
console.log(JSON.stringify({ counts, files: rows.length }, null, 2))
const top = Object.entries(goByConstruct)
  .toSorted(([, aCount], [, bCount]) => bCount - aCount)
  .slice(0, 25)
console.log(JSON.stringify(Object.fromEntries(top), null, 2))
