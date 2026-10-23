// M97 CM971-R3: this repository's own production build must prove itself
// to the legal scanner. After `npm run build`, copy every bundle record
// (dist/meta, dist/meta-hashes) and every workspace file the records list
// into a fresh workspace and run the PRODUCTION scanner's build-record
// check (dist/legalScan.js `verifyLegalBuildRecords`, unbounded, so no
// reason can hide past the report's incomplete-check bound) over it. Any
// unrecorded or stale input, generated module without a hash, missing or
// changed output, conflicting record or input outside the workspace fails
// the build.
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'

const META = 'dist/meta'
const metafiles = readdirSync(META).filter((name) => name.endsWith('.json'))
if (metafiles.length === 0) throw new Error('no bundle metafiles: run the production build first')
const HASHES = 'dist/meta-hashes'
const listed = new Set()
for (const name of metafiles) {
  const metafile = JSON.parse(readFileSync(path.join(META, name), 'utf8'))
  for (const entry of [
    ...Object.keys(metafile.inputs ?? {}),
    ...Object.keys(metafile.outputs ?? {}),
  ]) {
    // Generated modules and outside paths are not copied: the copied
    // metafile still lists them, so the scanner names any it cannot attribute.
    const isFile = !/^\(?[a-z][\w-]*\)?:/iu.test(entry) && !path.isAbsolute(entry)
    if (isFile && !entry.split(/[\\/]/u).includes('..')) listed.add(entry)
  }
}

const workspace = mkdtempSync(path.join(tmpdir(), 'legal-build-records-'))
try {
  for (const folder of [META, HASHES])
    cpSync(folder, path.join(workspace, folder), { recursive: true })
  for (const file of listed) {
    mkdirSync(path.dirname(path.join(workspace, file)), { recursive: true })
    cpSync(file, path.join(workspace, file))
  }
  const scanner = createRequire(import.meta.url)(path.resolve('dist/legalScan.js'))
  const problems = await scanner.verifyLegalBuildRecords(workspace)
  console.log(
    `legal build records: ${String(metafiles.length)} bundles, ${String(listed.size)} files, ${String(problems.length)} problems`,
  )
  if (problems.length > 0) {
    for (const problem of problems) console.error(`  ${problem}`)
    process.exitCode = 1
  }
  // The whole repository, scanned as any user's workspace is (scan-scope
  // ruling 2026-10-10): it must complete (exit 0, or 1 with blockers),
  // never stay incomplete (exit 2). The checkout's own regenerable tool
  // artifacts are named, not walked (RLF-HYGIENE): VS Code downloads,
  // dev test bundles, harness output, the agent package stage and the
  // report temp folders broke the build's scan on three rigs by blowing
  // the directory-entry budget. All are gitignored (.gitignore); none is
  // distribution, and the build records above still admit what ships.
  const { result } = await scanner.runLegalScan({
    workspaceRoot: process.cwd(),
    input: { headerPolicy: 'optional' },
    exclude: [
      '.vscode-test',
      'coverage',
      'dist/acp-package',
      'dist/test',
      'dist/traffic-harness',
      'harness-shots',
      'temp',
    ],
  })
  const blockers = result.findings.filter((finding) => finding.severity === 'blocker')
  const shouldFix = result.findings.filter((finding) => finding.severity === 'should-fix')
  console.log(
    `legal repository scan: ${String(result.incompleteChecks.length)} incomplete, ${String(blockers.length)} blockers, ${String(shouldFix.length)} should-fix, ${String(result.findings.length)} findings`,
  )
  for (const finding of [...blockers, ...shouldFix])
    console.log(`  ${finding.severity}: ${finding.explanation}`)
  if (result.incompleteChecks.length > 0) {
    for (const check of result.incompleteChecks) console.error(`  ${check}`)
    process.exitCode = 1
  }
} finally {
  rmSync(workspace, { recursive: true, force: true })
}
