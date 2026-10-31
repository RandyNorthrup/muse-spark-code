// M104g's per-editor conformance matrix: the render and the checks behind
// `npm run editor-matrix:generate` and `check:editor-matrix`. The matrix
// moves only on the receipt records (`docs/certification/m104-<host>.json`):
// the gate re-renders from those records and refuses any drift, and refuses
// a green record whose report no longer validates against the contract.
import assert from 'node:assert/strict'
import { HOSTS } from '../package-hosts/manifest.mjs'
import { contract, validateReport, waitingLegs, waitsOn } from '../../test/hostApi/run.mjs'

export const MATRIX_PATH = 'docs/ide-compatibility/matrix.md'
export const receiptJsonPath = (host) => `docs/certification/m104-${host}.json`
export const receiptMarkdownPath = (host) => `docs/certification/m104-${host}.md`
export const VSCODE_OBSERVATIONS_PATH = 'temp/m104-vscode-observations.json'

export const MATRIX_GROUPS = [
  { title: 'Reference', hosts: ['vscode'] },
  { title: 'Native', hosts: ['jetbrains', 'visualstudio', 'eclipse', 'xcode'] },
  { title: 'Shim', hosts: ['neovim', 'emacs', 'sublime', 'zed', 'qtcreator'] },
]

export const MATRIX_HOSTS = MATRIX_GROUPS.flatMap((group) => group.hosts)

const DISPLAY_NAMES = {
  vscode: 'VS Code',
  jetbrains: 'JetBrains (IntelliJ platform)',
  visualstudio: 'Visual Studio (Windows)',
  eclipse: 'Eclipse',
  xcode: 'Xcode',
  neovim: 'Neovim',
  emacs: 'Emacs',
  sublime: 'Sublime Text',
  zed: 'Zed',
  qtcreator: 'Qt Creator',
}

/** Every native host the matrix knows is a packaged host, and vice versa. */
export function matrixHosts() {
  const natives = MATRIX_HOSTS.filter((host) => host !== 'vscode')
  assert.deepEqual(
    natives.toSorted((a, b) => a.localeCompare(b)),
    Object.keys(HOSTS).toSorted((a, b) => a.localeCompare(b)),
    'MHP_MATRIX_HOSTS: the matrix covers every packaged host',
  )
  return MATRIX_HOSTS
}

function runnableLegs(host) {
  const waiting = waitingLegs().filter((leg) => waitsOn(leg, host))
  return contract.backends.length * contract.scenarios.length - waiting.length
}

function waitingSummary(waiting) {
  const scenarios = [...new Set(waiting.map((leg) => leg.scenario))].toSorted((a, b) =>
    a.localeCompare(b),
  )
  return `${String(waiting.length)} waits (${scenarios.join(', ')})`
}

/** A record's row cells; throws a fixed word when the record is malformed. */
export function rowFor(host, record) {
  assert.equal(record?.host, host, `MHP_MATRIX_HOST:${host}`)
  assert.ok(typeof record.outcome === 'string', `MHP_MATRIX_OUTCOME:${host}`)
  assert.ok(typeof record.editorVersion === 'string', `MHP_MATRIX_VERSION:${host}`)
  const version = record.editorVersion === '' ? '—' : record.editorVersion
  const evidence = `[m104-${host}](../certification/m104-${host}.md)`
  switch (record.outcome) {
    case 'conformant':
    case 'waiting': {
      let report
      try {
        report = validateReport(host, record.report)
      } catch (error) {
        const word = error instanceof Error ? (error.message.split('\n', 1)[0] ?? '') : ''
        throw new Error(`MHP_MATRIX_REPORT:${host}:${word}`, { cause: error })
      }
      // The waits are the contract's, not the record's to edit: flipping a
      // record from waiting to conformant refuses here.
      const expectedWaiting = waitingLegs().filter((leg) => waitsOn(leg, host))
      assert.deepEqual(record.waiting ?? [], expectedWaiting, `MHP_MATRIX_WAITING:${host}`)
      const expectedOutcome = expectedWaiting.length > 0 ? 'waiting' : 'conformant'
      assert.equal(record.outcome, expectedOutcome, `MHP_MATRIX_OUTCOME:${host}`)
      const legs = `${String(report.results.length)}/${String(runnableLegs(host))} legs green`
      const waits =
        record.outcome === 'waiting' ? waitingSummary(expectedWaiting) : 'nothing waiting'
      const status = record.outcome === 'waiting' ? 'Waiting' : 'Conformant'
      return { status, version, legs, waits, evidence }
    }
    case 'pending': {
      assert.ok(
        typeof record.need === 'string' && record.need.length > 0,
        `MHP_MATRIX_NEED:${host}`,
      )
      return { status: 'Pending', version, legs: '—', waits: record.need, evidence }
    }
    case 'excepted': {
      assert.ok(
        typeof record.reason === 'string' && record.reason.length > 0,
        `MHP_MATRIX_REASON:${host}`,
      )
      const harness = record.harness ?? {}
      assert.equal(harness.exitCode, 0, `MHP_MATRIX_HARNESS:${host}`)
      assert.ok(
        typeof harness.command === 'string' && harness.command.length > 0,
        `MHP_MATRIX_HARNESS:${host}`,
      )
      return {
        status: 'Excepted',
        version,
        legs: '— (no MHP surface)',
        waits: harness.summary ?? harness.command,
        evidence,
      }
    }
    case 'failed': {
      assert.ok(
        typeof record.error === 'string' && record.error.length > 0,
        `MHP_MATRIX_ERROR:${host}`,
      )
      return { status: 'Failed', version, legs: '—', waits: record.error, evidence }
    }
    default: {
      throw new Error(`MHP_MATRIX_OUTCOME:${host}:${String(record.outcome)}`)
    }
  }
}

const HEADER = `# Editor conformance matrix (M104g)

Generated by \`npm run editor-matrix:generate\`; do not edit. Each status
moves only on the evidence its receipt cites
(\`docs/certification/m104-<host>.md\` with its \`.json\` record).
**Conformant**: every leg green, nothing waiting. **Waiting**: every runnable
leg green; the named legs wait on live-model or adapter work. **Pending**: no
evidence on any machine yet, with what it needs. **Excepted**: a shim with no
MHP surface, qualified by its own harness. **Failed**: the harness ran and
disagreed with the contract.
`

/** The matrix text for the records, byte for byte. */
export function renderMatrix(records) {
  const hosts = matrixHosts()
  const lines = [HEADER]
  for (const group of MATRIX_GROUPS) {
    lines.push(
      `## ${group.title}\n`,
      '| Editor | Version | Status | Legs | Waiting / need | Evidence |',
      '| ------ | ------- | ------ | ---- | -------------- | -------- |',
    )
    for (const host of group.hosts) {
      assert.ok(hosts.includes(host), `MHP_MATRIX_HOST:${host}`)
      const record = records[host]
      assert.ok(record !== undefined, `MHP_MATRIX_MISSING:${host}`)
      const row = rowFor(host, record)
      const name = DISPLAY_NAMES[host] ?? host
      lines.push(
        `| ${name} | ${row.version} | ${row.status} | ${row.legs} | ${row.waits} | ${row.evidence} |`,
      )
    }
    lines.push('')
  }
  return `${lines.join('\n').trimEnd()}\n`
}
