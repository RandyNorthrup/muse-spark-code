// Run directly in the rig worktree. Restore every mutated byte
// in finally, then require the entire targeted suite to pass again.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const mutations = [
  [
    'scoped runtime dependency paths',
    'scripts/package-hosts/release.mjs',
    String.raw`z.regex(/^(?:[\w@+.-]+\/)*[\w@+.-]+$/u)`,
    String.raw`z.regex(/^(?:[\w.-]+\/)*[\w.-]+$/u)`,
    'accepts scoped runtime dependencies',
  ],
  [
    'runtime inventory traversal',
    'scripts/package-hosts/release.mjs',
    "part !== '.' && part !== '..'",
    'true',
    'accepts scoped runtime dependencies',
  ],
  [
    'release waits for native signing',
    '.github/workflows/release.yml',
    'needs: [verify, reuse, build, native-sign]',
    'needs: [verify, reuse, build]',
    'attaches verified native bytes',
  ],
  [
    'release requires native signing success',
    '.github/workflows/release.yml',
    " && needs.native-sign.result == 'success'",
    '',
    'attaches verified native bytes',
  ],
  [
    'receipt directories remain separate',
    '.github/workflows/release.yml',
    'merge-multiple: false\n          path: native-release',
    'merge-multiple: true\n          path: native-release',
    'attaches verified native bytes',
  ],
  [
    'native assets staged before release',
    '.github/workflows/release.yml',
    'node scripts/package-hosts/release.mjs stage native-release release',
    'echo omitted-native-verification',
    'attaches verified native bytes',
  ],
  [
    'native checksums cover receipt and archives',
    '.github/workflows/release.yml',
    '"${native[@]/#/./}" > SHA256SUMS',
    '> SHA256SUMS',
    'attaches verified native bytes',
  ],
  [
    'native GitHub attachment inventory',
    '.github/workflows/release.yml',
    '"${native[@]/#/release/}" release/SHA256SUMS',
    'release/SHA256SUMS',
    'attaches verified native bytes',
  ],
  [
    'runtime product version',
    'scripts/package-hosts/package.mjs',
    "if (agent.version !== product.version) throw new Error('MHP_HOST_RUNTIME_VERSION')",
    'void agent.version',
    'refuses mismatched runtime versions',
  ],
  [
    'runtime dependency pin',
    'scripts/package-hosts/package.mjs',
    "keyring === undefined || agent.dependencies['@napi-rs/keyring'] !== keyring",
    'keyring === undefined',
    'refuses mismatched runtime versions',
  ],
  [
    'runtime no-follow inventory',
    'scripts/package-hosts/package.mjs',
    'const info = lstatSync(file)',
    'const info = statSync(file)',
    'refuses nested runtime symlinks',
  ],
  [
    'required runtime bundles',
    'scripts/package-hosts/package.mjs',
    /if \(!statSync\(inside\(source, `dist\/\$\{name\}`\)\)\.isFile\(\)\)\s*throw new Error\('MHP_HOST_RUNTIME_INCOMPLETE'\)/u,
    'void name',
    'refuses an incomplete runtime',
  ],
  [
    'required portable assets',
    'scripts/package-hosts/package.mjs',
    /if \(runtimeSha256\[`\$\{portableRoot\}\$\{name\}`\] === undefined\)\s*throw new Error\('MHP_HOST_PORTABLE_INCOMPLETE'\)/u,
    'void name',
    'refuses an incomplete runtime',
  ],
  [
    'unique portable modules',
    'scripts/package-hosts/package.mjs',
    'new Set(modules).size !== modules.length || ',
    '',
    'refuses missing, changed, duplicate and unlisted',
  ],
  [
    'portable main entry',
    'scripts/package-hosts/package.mjs',
    '!modules.includes(`${portableRoot}main.js`)',
    'false',
    'refuses missing, changed, duplicate and unlisted',
  ],
  [
    'portable module digest',
    'scripts/package-hosts/package.mjs',
    'runtimeSha256[name] !== module.sha256 ||',
    '',
    'refuses missing, changed, duplicate and unlisted',
  ],
  [
    'portable module size',
    'scripts/package-hosts/package.mjs',
    'statSync(inside(source, name)).size !== module.bytes',
    'false',
    'refuses missing, changed, duplicate and unlisted',
  ],
  [
    'unlisted portable source',
    'scripts/package-hosts/package.mjs',
    /if \(\s*Object\.keys\(runtimeSha256\)\.some\([\s\S]*?throw new Error\('MHP_HOST_PORTABLE_UNLISTED'\)/u,
    '',
    'refuses missing, changed, duplicate and unlisted',
  ],
  [
    'injected runtime stays exact',
    'scripts/package-hosts/package.mjs',
    /if \(JSON\.stringify\(inventory\(runtime\)\) !== JSON\.stringify\(runtimeSha256\)\)\s*throw new Error\('MHP_HOST_RUNTIME_CHANGED'\)/u,
    '',
    'records every runtime and deferred byte',
  ],
  [
    'runtime receipt inventory is required',
    'scripts/package-hosts/release.mjs',
    /runtimeSha256: z[\s\S]*?\.check\(z\.refine\(\(files\) => Object\.keys\(files\)\.length > 0\)\),/u,
    'runtimeSha256: z.optional(z.record(z.string(), z.string())),',
    'refuses old MHP receipts',
  ],
  [
    'runtime receipt inventory is nonempty',
    'scripts/package-hosts/release.mjs',
    '.check(z.refine((files) => Object.keys(files).length > 0))',
    '',
    'refuses old MHP receipts',
  ],
  [
    'release receipt protocol',
    'scripts/package-hosts/release.mjs',
    'mhp: z.literal(MHP_VERSION)',
    'mhp: z.string()',
    'refuses old MHP receipts',
  ],
  [
    'Windows host selection',
    'scripts/package-hosts/ci.mjs',
    String.raw`files?.map((file) => file.replaceAll('\\', '/'))`,
    'files',
    'selects Xcode alone',
  ],
  [
    'broken host path is not absent',
    'scripts/package-hosts/manifest.mjs',
    'lstatSync(directory, { throwIfNoEntry: false })',
    '(lstatSync(directory, { throwIfNoEntry: false })?.isSymbolicLink() ? undefined : lstatSync(directory, { throwIfNoEntry: false }))',
    'fails a broken host symlink',
  ],
  [
    'optional signing password',
    'scripts/package-hosts/release.mjs',
    "keys.filter((key) => !key.endsWith('_PASSWORD')).every",
    'keys.every',
    'allows an unencrypted signing key',
  ],
  [
    'runtime entry file',
    'scripts/package-hosts/package.mjs',
    /if \(!statSync\(inside\(source, name\)\)\.isFile\(\)\) throw new Error\('MHP_HOST_RUNTIME_INCOMPLETE'\)/u,
    'void name',
    'refuses a runtime entry that is a directory',
  ],
  [
    'every native channel published',
    'scripts/package-hosts/release.mjs',
    /allPublished: rows\.every\([\s\S]*?\),/u,
    'allPublished: true,',
    'keeps the all-published signal false',
  ],
  [
    'GitHub Release tag identity',
    'scripts/package-hosts/release.mjs',
    "assert.equal(tag, `v${receipt.version}`, 'MHP_HOST_GITHUB_TAG')",
    '',
    'requires the exact archive and receipt',
  ],
  [
    'GitHub Release asset bytes',
    'scripts/package-hosts/release.mjs',
    "assert.equal(digest(inside(scratch, name)), expected, 'MHP_HOST_GITHUB_SHA256')",
    '',
    'requires the exact archive and receipt',
  ],
  [
    'publish after GitHub attachment',
    '.github/workflows/release.yml',
    'node scripts/package-hosts/release.mjs github "$HOST_ID" native-package',
    'echo missing-proof',
    'keeps every native channel behind',
  ],
  [
    'clean packaging stage',
    'scripts/package-hosts/package.mjs',
    'rmSync(stage, { recursive: true, force: true })',
    '',
    'stages runtime bytes',
  ],
  [
    'native asset name uniqueness',
    'scripts/package-hosts/release.mjs',
    "assert.equal(new Set(names).size, names.length, 'MHP_HOST_RELEASE_DUPLICATE_ASSET')",
    '',
    'rejects colliding native asset names',
  ],
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
    'if (!lstatSync(directory, { throwIfNoEntry: false }))',
    'if (false)',
    'names every absent host',
  ],
  [
    'existing incomplete host',
    'scripts/package-hosts/manifest.mjs',
    "const source = inside(root, path.join('hosts', host))",
    "if (!lstatSync(path.join(directory, 'distribution.json'), { throwIfNoEntry: false })) return { outcome: 'skipped-host-absent' }; const source = inside(root, path.join('hosts', host))",
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
    'mhp: z.literal(MHP_VERSION)',
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
    'protocol: z.literal(MHP_VERSION)',
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
  [
    'host directory',
    'scripts/package-hosts/manifest.mjs',
    "if (!statSync(source).isDirectory()) throw new Error('MHP_HOST_NOT_DIRECTORY')",
    '',
    'refuses a host path',
  ],
  [
    'strict distribution manifest',
    'scripts/package-hosts/manifest.mjs',
    'distributionSchema = z.strictObject(',
    'distributionSchema = z.object(',
    'rejects unknown hosts',
  ],
  [
    'child injection stripping',
    'scripts/package-hosts/manifest.mjs',
    /!\/\^\(\?:NODE_OPTIONS[^\n]+\.test\(\s*name,?\s*\)/u,
    'true',
    'removes credentials',
  ],
  [
    'duplicate archive names',
    'scripts/package-hosts/package.mjs',
    "if (Object.hasOwn(sha256, output)) throw new Error('MHP_HOST_DUPLICATE_ARTIFACT')",
    '',
    'rejects duplicate output names',
  ],
  [
    'strict report boundary',
    'test/hostApi/run.mjs',
    'reportSchema = z.strictObject(',
    'reportSchema = z.object(',
    'rejects zero tests',
  ],
  [
    'extra result count',
    'test/hostApi/run.mjs',
    /assert\.equal\(\s*parsed\.results\.length,[\s\S]*?'MHP_CONFORMANCE_COUNT',?\s*\)/u,
    '',
    'rejects extra results',
  ],
  [
    'duplicate scenario correlation',
    'test/hostApi/run.mjs',
    /assert\.equal\(\s*matches\.length,[\s\S]*?`MHP_CONFORMANCE_MISSING_OR_DUPLICATE:[^`]+`,?\s*\)/u,
    '',
    'reports duplicate scenario identities',
  ],
  [
    'receipt host',
    'scripts/package-hosts/release.mjs',
    "assert.equal(receipt.host, host, 'MHP_HOST_RECEIPT_HOST')",
    '',
    'rejects a changed host receipt',
  ],
  [
    'receipt version',
    'scripts/package-hosts/release.mjs',
    /assert\.equal\(\s*receipt\.version,[\s\S]*?'MHP_HOST_RECEIPT_VERSION',?\s*\)/u,
    '',
    'rejects a changed version receipt',
  ],
  [
    'receipt tree',
    'scripts/package-hosts/release.mjs',
    /assert\.equal\(\s*receipt\.tree,[\s\S]*?'MHP_HOST_RECEIPT_TREE',?\s*\)/u,
    '',
    'rejects a changed tree receipt',
  ],
  [
    'nonempty receipt inventory',
    'scripts/package-hosts/release.mjs',
    "assert.ok(names.length > 0, 'MHP_HOST_RECEIPT_EMPTY')",
    '',
    'rejects a changed empty inventory receipt',
  ],
  [
    'exact receipt inventory',
    'scripts/package-hosts/release.mjs',
    /assert\.deepEqual\([\s\S]*?'MHP_HOST_RECEIPT_INVENTORY',?\s*\)/u,
    '',
    'rejects additional files',
  ],
  [
    'receipt byte hash',
    'scripts/package-hosts/release.mjs',
    "assert.equal(digest(file), receipt.sha256[name], 'MHP_HOST_RECEIPT_SHA256')",
    '',
    'rejects a changed hash receipt',
  ],
  [
    'complete signing credentials',
    'scripts/package-hosts/release.mjs',
    /assert\.ok\(\s*keys\.[\s\S]*?'MHP_HOST_SIGN_CREDENTIALS_INCOMPLETE',?\s*\)/u,
    '',
    'refuses partial signing credentials',
  ],
  [
    'signing command required',
    'scripts/package-hosts/release.mjs',
    "assert.ok(found.manifest.sign, 'MHP_HOST_SIGN_COMMAND_MISSING')",
    '',
    'fails supplied signing credentials',
  ],
  [
    'channel credential isolation',
    'scripts/package-hosts/release.mjs',
    '...buildEnvironment(env)',
    '...env',
    'gives the signer only its own credentials',
  ],
  [
    'signed byte hashes',
    'scripts/package-hosts/release.mjs',
    'receipt.sha256[name] = digest(inside(directory, name))',
    'void name',
    'gives the signer only its own credentials',
  ],
  [
    'unsigned Xcode local-only fence',
    'scripts/package-hosts/release.mjs',
    "if (host === 'xcode' && receipt.signing !== 'signed')",
    'if (false)',
    'names missing signing credentials',
  ],
  [
    'missing publishing credential',
    'scripts/package-hosts/release.mjs',
    "if (keys.some((key) => (env[key] ?? '').length === 0))",
    'if (false)',
    'reports every missing registry credential',
  ],
  [
    'publishing command required',
    'scripts/package-hosts/release.mjs',
    "assert.ok(found.manifest.publish, 'MHP_HOST_PUBLISH_COMMAND_MISSING')",
    '',
    'fails supplied registry credentials',
  ],
  [
    'publisher cannot rebuild',
    'scripts/package-hosts/release.mjs',
    "verifyArtifacts(root, directory, host, run)\n  return { host, outcome: 'published' }",
    "return { host, outcome: 'published' }",
    'refuses a publishing command that rebuilds',
  ],
  [
    'stage collision',
    'scripts/package-hosts/release.mjs',
    "assert.ok(!existsSync(path.join(release, name)), 'MHP_HOST_RELEASE_ASSET_COLLISION')",
    '',
    'stages every verified native asset',
  ],
  [
    'missing channel outcome fails',
    'scripts/package-hosts/release.mjs',
    "outcome: 'failed',",
    "outcome: 'published',",
    'names absent hosts in the channel summary',
  ],
  [
    'outcome host correlation',
    'scripts/package-hosts/release.mjs',
    "assert.equal(result.host, host, 'MHP_HOST_OUTCOME_HOST')",
    '',
    'refuses another host report',
  ],
  [
    'no fabricated absent host outcome',
    'scripts/package-hosts/release.mjs',
    "assert.notEqual(result.outcome, 'skipped-host-absent', 'MHP_HOST_FALSE_ABSENCE')",
    '',
    'refuses another host report',
  ],
  [
    'native host harness CI fence',
    '.github/workflows/hosts-native.yml',
    'node test/hostApi/run.mjs "$HOST_ID"',
    'echo skipped',
    'runs shared conformance',
  ],
  [
    'protected native release environment',
    '.github/workflows/release.yml',
    '    environment: marketplace\n    permissions:',
    '    permissions:',
    'keeps every native channel behind',
  ],
]
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex')
function tests() {
  mkdirSync('temp/m104-i', { recursive: true })
  const reports = []
  let status = 0
  for (const [config, files] of [
    [
      'test/hostApi/vitest.config.mjs',
      [
        'test/hostApi/distribution.test.mjs',
        'test/hostApi/release.test.mjs',
        'test/hostApi/workflow.test.mjs',
      ],
    ],
  ]) {
    const output = `temp/m104-i/drill-result-${reports.length}.json`
    const result = spawnSync(
      process.execPath,
      [
        path.join('node_modules', 'vitest', 'vitest.mjs'),
        'run',
        '--config',
        config,
        ...files,
        '--maxWorkers=3',
        '--reporter=json',
        `--outputFile=${output}`,
      ],
      { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: 120_000 },
    )
    if (result.status !== 0) status = result.status
    reports.push(JSON.parse(readFileSync(output, 'utf8')))
  }
  return {
    status,
    report: { testResults: reports.flatMap((report) => report.testResults) },
  }
}
const record = 'docs/certification/m104-pf-distribution-drills.json'
const selected =
  process.argv[2] === undefined
    ? mutations
    : mutations.filter(([guard]) => guard === process.argv[2])
assert.ok(selected.length > 0, 'UNKNOWN_DRILL')
assert.equal(tests().status, 0, 'INITIAL_GREEN_REQUIRED')
const previous = existsSync(record) ? JSON.parse(readFileSync(record, 'utf8')) : []
const receipts = previous.filter((item) => selected.every(([guard]) => item.guard !== guard))
for (const [guard, file, from, to, named] of selected) {
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
  writeFileSync(record, `${JSON.stringify(receipts, null, 2)}\n`)
}
assert.equal(tests().status, 0, 'RESTORED_GREEN_REQUIRED')
mkdirSync('temp', { recursive: true })
writeFileSync(record, `${JSON.stringify(receipts, null, 2)}\n`)
console.log(`RED_DRILLS=${receipts.length}; BYTE_EXACT_RESTORED; TARGETED_SUITE_GREEN`)
