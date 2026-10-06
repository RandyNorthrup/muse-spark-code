// Run directly in the rig worktree. Restore every mutated byte
// in finally, then require the entire targeted suite to pass again.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const mutations = [
  [
    'host selection',
    'scripts/package-hosts/ci.mjs',
    /const all = [^\n]+/u,
    'const all = true',
    'selects one changed host',
  ],
  [
    'unknown host',
    'scripts/package-hosts/manifest.mjs',
    "if (!Object.hasOwn(HOSTS, host)) throw new Error('MHP_UNKNOWN_HOST')",
    '',
    'rejects unknown hosts',
  ],
  [
    'absent host',
    'scripts/package-hosts/manifest.mjs',
    'if (!existsSync(directory))',
    'if (false)',
    'names every absent host',
  ],
  [
    'existing incomplete host',
    'scripts/package-hosts/manifest.mjs',
    "const source = inside(root, path.join('hosts', host))",
    "if (!existsSync(path.join(directory, 'distribution.json'))) return { outcome: 'skipped-host-absent' }; const source = inside(root, path.join('hosts', host))",
    'fails an existing host',
  ],
  [
    'artifact traversal',
    'scripts/package-hosts/manifest.mjs',
    String.raw`!value.split(/[/\\]/u).includes('..')`,
    'true',
    'rejects unknown hosts',
  ],
  [
    'symlink containment',
    'scripts/package-hosts/manifest.mjs',
    "throw new Error('MHP_HOST_PATH_ESCAPE')",
    'return target',
    'refuses a symlink',
  ],
  [
    'manifest MHP range',
    'scripts/package-hosts/manifest.mjs',
    "mhp: z.literal('1.x')",
    'mhp: z.string()',
    'rejects unknown hosts',
  ],
  [
    'nonempty build',
    'scripts/package-hosts/manifest.mjs',
    'build: z.array(command).check(z.minLength(1))',
    'build: z.array(command)',
    'rejects unknown hosts',
  ],
  [
    'nonempty artifact list',
    'scripts/package-hosts/manifest.mjs',
    'artifacts: z.array(relative).check(z.minLength(1))',
    'artifacts: z.array(relative)',
    'rejects unknown hosts',
  ],
  [
    'credential stripping',
    'scripts/package-hosts/manifest.mjs',
    /!\/\(\?:_KEY[^\n]+\.test\(\s*name,?\s*\)/u,
    'true',
    'removes credentials',
  ],
  [
    'nonempty archive',
    'scripts/package-hosts/package.mjs',
    ' || statSync(artifact).size === 0',
    '',
    'stages runtime bytes',
  ],
  [
    'harness version',
    'test/hostApi/run.mjs',
    "protocol: z.literal('mhp/1.1.0')",
    'protocol: z.string()',
    'rejects zero tests',
  ],
  [
    'no skipped scenarios',
    'test/hostApi/run.mjs',
    'skipped: z.literal(false)',
    'skipped: z.boolean()',
    'rejects zero tests',
  ],
  [
    'host correlation',
    'test/hostApi/run.mjs',
    "assert.equal(parsed.host, host, 'MHP_CONFORMANCE_WRONG_HOST')",
    '',
    'rejects zero tests',
  ],
  [
    'observed behavior',
    'test/hostApi/run.mjs',
    /assert\.deepEqual\([\s\S]*?\n {8}\)/u,
    'void expected',
    'rejects incorrect conversation behavior',
  ],
]
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex')
function tests() {
  mkdirSync('temp/m104-i', { recursive: true })
  const result = spawnSync(
    process.execPath,
    [
      path.join('node_modules', 'vitest', 'vitest.mjs'),
      'run',
      '--config',
      'test/hostApi/vitest.config.mjs',
      'test/hostApi/distribution.test.mjs',
      '--maxWorkers=3',
      '--testTimeout=120000',
      '--reporter=json',
      '--outputFile=temp/m104-i/drill-result.json',
    ],
    { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: 120_000 },
  )
  return {
    status: result.status,
    report: JSON.parse(readFileSync('temp/m104-i/drill-result.json', 'utf8')),
  }
}
assert.equal(tests().status, 0, 'INITIAL_GREEN_REQUIRED')
const receipts = []
for (const [guard, file, from, to, named] of mutations) {
  const original = readFileSync(file)
  const before = original.toString()
  const changed = before.replace(from, () => to)
  assert.notEqual(changed, before, `MUTATION_NOT_FOUND:${guard}`)
  try {
    writeFileSync(file, changed)
    const result = tests()
    const failures = result.report.testResults.flatMap((entry) =>
      entry.assertionResults
        .filter((test) => test.status === 'failed')
        .map((test) => test.fullName),
    )
    assert.equal(result.status, 1, `DRILL_DID_NOT_FIRE:${guard}`)
    assert.ok(
      failures.some((name) => name.includes(named)),
      `NAMED_FAILURE_MISSING:${guard}`,
    )
    receipts.push({ guard, file, failures, sha256: hash(original) })
    console.log(JSON.stringify(receipts.at(-1)))
  } finally {
    writeFileSync(file, original)
    assert.equal(hash(readFileSync(file)), hash(original), `RESTORE_MISMATCH:${guard}`)
  }
}
assert.equal(tests().status, 0, 'RESTORED_GREEN_REQUIRED')
mkdirSync('temp', { recursive: true })
writeFileSync('temp/m104i-drills.json', JSON.stringify(receipts, null, 2))
console.log(`RED_DRILLS=${receipts.length}; BYTE_EXACT_RESTORED; TARGETED_SUITE_GREEN`)
