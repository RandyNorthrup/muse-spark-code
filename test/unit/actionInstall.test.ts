// M80 lane C: agent installation (SPEC §6.4, D-M5; G13, G14, G22). The
// provenance chain is read only from the bundles one pinned npm 11.19.0
// `audit signatures --json --include-attestations` run verified: first a
// real capture of that command's output (test/action/npm-audit-capture.json),
// then the full matrix over test-owned statements and certificates
// (test/action/certificates.json). npm itself is test/action/fake-npm.mjs.

import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  AGENT_PACKAGE,
  installAgent,
  integrityHex,
  ProvenanceError,
  releaseIdentity,
  SLSA_PROVENANCE,
  VERIFIER_NPM,
  verifyProvenance,
} from '../../action/lib/install.mjs'
import { childEnvironment } from '../../action/lib/lifecycle.mjs'
import { networkInputs, parseActionInputs, regularFileOutside } from '../../action/lib/tools.mjs'
import certificates from '../action/certificates.json'
import capture from '../action/npm-audit-capture.json'
import {
  allocate,
  FAKE_NPM,
  jsonFetch,
  jsonRecord,
  NODE,
  tempLayout,
  TEST_KEY,
  TEST_TOKEN,
  testOwner,
  type TempLayout,
} from './helpers/actionFixtures'

const VERSION = '0.10.0'
const TARBALL = `https://registry.npmjs.org/${AGENT_PACKAGE}/-/${AGENT_PACKAGE}-${VERSION}.tgz`
const INTEGRITY = `sha512-${createHash('sha512').update('tarball').digest('base64')}`
const PUBLISH = 'https://github.com/npm/attestation/tree/main/specs/publish/v0.1'

function statement(
  overrides: Record<string, unknown> = {},
  workflow: Record<string, unknown> = {},
) {
  return {
    _type: 'https://in-toto.io/Statement/v1',
    subject: [
      { name: `pkg:npm/${AGENT_PACKAGE}@${VERSION}`, digest: { sha512: integrityHex(INTEGRITY) } },
    ],
    predicateType: SLSA_PROVENANCE,
    predicate: {
      buildDefinition: {
        externalParameters: {
          workflow: {
            repository: 'https://github.com/RandyNorthrup/muse-spark-code',
            path: '.github/workflows/release.yml',
            ref: `refs/tags/v${VERSION}`,
            ...workflow,
          },
        },
      },
    },
    ...overrides,
  }
}

function bundle(content: unknown, material?: Record<string, unknown>) {
  return {
    predicateType: SLSA_PROVENANCE,
    bundle: {
      mediaType: 'application/vnd.dev.sigstore.bundle.v0.3+json',
      verificationMaterial: material ?? { certificate: { rawBytes: certificates.good } },
      dsseEnvelope: {
        payload: Buffer.from(JSON.stringify(content)).toString('base64'),
        payloadType: 'application/vnd.in-toto+json',
        signatures: [{ sig: 'c2ln', keyid: '' }],
      },
    },
  }
}

function audit(bundles: unknown[], extra: Record<string, unknown> = {}) {
  return {
    invalid: [],
    missing: [],
    verified: [
      {
        name: AGENT_PACKAGE,
        version: VERSION,
        location: `node_modules/${AGENT_PACKAGE}`,
        registry: 'https://registry.npmjs.org/',
        attestations: {
          url: 'https://registry.npmjs.org/-/npm/v1/attestations/x',
          provenance: { predicateType: SLSA_PROVENANCE },
        },
        attestationBundles: bundles,
      },
    ],
    ...extra,
  }
}

/** The failed check's id, or 'ok' when the whole chain verifies. */
function check(report: unknown, expected?: Parameters<typeof verifyProvenance>[1]): string {
  try {
    verifyProvenance(
      report,
      expected ?? { name: AGENT_PACKAGE, version: VERSION, integrity: INTEGRITY },
    )
    return 'ok'
  } catch (error) {
    return error instanceof ProvenanceError ? error.check : 'other'
  }
}

describe('G22 provenance from the verified bundles', () => {
  it('accepts a real npm 11.19.0 capture for its own publisher, and only for it', () => {
    const real = { name: 'semver', version: '7.8.5', integrity: capture.lockIntegrity }
    expect(check(capture.audit, { ...real, identity: capture.identity })).toBe('ok')
    expect(check(capture.audit, real)).toBe('provenance.repository')
    const wrongDigest = `sha512-${createHash('sha512').update('other').digest('base64')}`
    expect(
      check(capture.audit, { ...real, integrity: wrongDigest, identity: capture.identity }),
    ).toBe('provenance.digest')
    const wrongSigner = { ...capture.identity, san: `${capture.identity.san}x` }
    expect(check(capture.audit, { ...real, identity: wrongSigner })).toBe('certificate.san')
  })

  it('accepts the genuine chain in both certificate formats', () => {
    expect(check(audit([{ predicateType: PUBLISH, bundle: {} }, bundle(statement())]))).toBe('ok')
    const chain = { x509CertificateChain: { certificates: [{ rawBytes: certificates.good }] } }
    expect(check(audit([bundle(statement(), chain)]))).toBe('ok')
    expect(releaseIdentity(VERSION).san).toBe(
      `https://github.com/RandyNorthrup/muse-spark-code/.github/workflows/release.yml@refs/tags/v${VERSION}`,
    )
  })

  it('fails closed on every broken link, naming the check', () => {
    const cases: [string, unknown, string][] = [
      ['signature only', audit([{ predicateType: PUBLISH, bundle: {} }]), 'provenance.missing'],
      ['no bundles', audit([]), 'provenance.missing'],
      [
        'two provenance bundles',
        audit([bundle(statement()), bundle(statement())]),
        'provenance.missing',
      ],
      ['no package record', { invalid: [], missing: [], verified: [] }, 'verifier.package'],
      [
        'verifier invalid',
        audit([bundle(statement())], { invalid: [{ code: 'EATTESTATIONVERIFY' }] }),
        'verifier.invalid',
      ],
      [
        'verifier missing',
        audit([bundle(statement())], { missing: [{ name: 'x' }] }),
        'verifier.missing',
      ],
      ['verifier output', { verified: [] }, 'verifier.output'],
      [
        'wrong subject',
        audit([
          bundle(
            statement({
              subject: [
                { name: 'pkg:npm/other@0.10.0', digest: { sha512: integrityHex(INTEGRITY) } },
              ],
            }),
          ),
        ]),
        'provenance.subject',
      ],
      [
        'wrong digest',
        audit([
          bundle(
            statement({
              subject: [{ name: `pkg:npm/${AGENT_PACKAGE}@${VERSION}`, digest: { sha512: 'ab' } }],
            }),
          ),
        ]),
        'provenance.digest',
      ],
      [
        'wrong repository',
        audit([
          bundle(statement({}, { repository: 'https://github.com/attacker/muse-spark-code' })),
        ]),
        'provenance.repository',
      ],
      [
        'wrong workflow',
        audit([bundle(statement({}, { path: '.github/workflows/other.yml' }))]),
        'provenance.workflow',
      ],
      ['wrong ref', audit([bundle(statement({}, { ref: 'refs/heads/main' }))]), 'provenance.ref'],
      [
        'wrong predicate type',
        audit([bundle(statement({ predicateType: PUBLISH }))]),
        'provenance.type',
      ],
      [
        'SAN with the wrong tag',
        audit([bundle(statement(), { certificate: { rawBytes: certificates.wrongRef } })]),
        'certificate.san',
      ],
      [
        'SAN from another repository',
        audit([bundle(statement(), { certificate: { rawBytes: certificates.wrongRepo } })]),
        'certificate.san',
      ],
      [
        'ambiguous SAN',
        audit([bundle(statement(), { certificate: { rawBytes: certificates.twoNames } })]),
        'certificate.san',
      ],
      [
        'no SAN',
        audit([bundle(statement(), { certificate: { rawBytes: certificates.noName } })]),
        'certificate.san',
      ],
      [
        'no certificate',
        audit([bundle(statement(), { publicKey: { hint: 'x' } })]),
        'certificate.missing',
      ],
      [
        'unparsable certificate',
        audit([bundle(statement(), { certificate: { rawBytes: 'AAAA' } })]),
        'certificate.parse',
      ],
    ]
    for (const [name, report, expected] of cases) {
      expect(check(report), name).toBe(expected)
    }
  })
})

describe('installAgent', () => {
  let layout: TempLayout
  beforeEach(() => {
    layout = tempLayout()
  })
  afterEach(() => {
    vi.restoreAllMocks()
    layout.cleanup()
  })

  function setup(scenario: Record<string, unknown>) {
    const paths = allocate(layout)
    writeFileSync(
      path.join(paths.agent, 'fake-npm.json'),
      JSON.stringify({ version: VERSION, resolved: TARBALL, integrity: INTEGRITY, ...scenario }),
    )
    const parentEnv = {
      ...process.env,
      MUSE_SPARK_MODEL_API_KEY: TEST_KEY,
      GITHUB_TOKEN: TEST_TOKEN,
    }
    const baseEnv = childEnvironment({
      platform: process.platform,
      parentEnv,
      paths,
      nodePath: NODE,
    })
    const test = testOwner(paths)
    const registry = jsonFetch({
      name: AGENT_PACKAGE,
      version: VERSION,
      dist: { integrity: INTEGRITY, tarball: TARBALL },
    })
    const install = (packagePath: string | null = null, packageSha256: string | null = null) =>
      installAgent({
        owner: test.owner,
        paths,
        node: NODE,
        npmCli: FAKE_NPM,
        npxCli: FAKE_NPM,
        version: VERSION,
        workspace: layout.workspace,
        packagePath,
        packageSha256,
        fetch: registry,
        baseEnv,
      })
    const reports = () =>
      existsSync(path.join(paths.agent, 'fake-npm-report.jsonl'))
        ? readFileSync(path.join(paths.agent, 'fake-npm-report.jsonl'), 'utf8')
            .trim()
            .split('\n')
            .map((line) => jsonRecord(line))
        : []
    return { paths, test, registry, install, reports }
  }

  it('installs the exact registry version, verifies the same invocation’s bundles, and returns the bin', async () => {
    const run = setup({ audit: audit([bundle(statement())]) })
    const installed = await run.install()
    expect(installed).toEqual({
      agentJs: realpathSync.native(
        path.join(run.paths.agent, 'node_modules', AGENT_PACKAGE, 'dist', 'acp.js'),
      ),
      candidate: false,
    })
    const [install, verifier] = run.reports()
    expect(install?.['args']).toEqual([
      'install',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      '--save-exact',
      '--registry',
      'https://registry.npmjs.org/',
      `${AGENT_PACKAGE}@${VERSION}`,
    ])
    expect(verifier?.['args']).toEqual([
      '--yes',
      VERIFIER_NPM,
      'audit',
      'signatures',
      '--json',
      '--include-attestations',
      '--prefix',
      run.paths.agent,
    ])
    expect(VERIFIER_NPM).toBe('npm@11.19.0')
    for (const report of [install, verifier]) {
      const env = JSON.stringify(report?.['env'])
      expect(env).not.toContain(TEST_KEY)
      expect(env).not.toContain(TEST_TOKEN)
      expect(report?.['env']).toMatchObject({
        npm_config_userconfig: run.paths.npmUserConfig,
        npm_config_globalconfig: run.paths.npmGlobalConfig,
        npm_config_ignore_scripts: 'true',
      })
    }
    expect(run.registry.calls.map((call) => call.url)).toEqual([
      `https://registry.npmjs.org/${AGENT_PACKAGE}/${VERSION}`,
    ])
    await run.test.owner.cleanup()
  })

  it('G22 uses verified bundle A, never a separately offered bundle B', async () => {
    const forged = bundle(
      statement({}, { repository: 'https://github.com/attacker/muse-spark-code' }),
    )
    const run = setup({ audit: audit([forged]) })
    await expect(run.install()).rejects.toThrow(/provenance.repository/)
    expect(run.registry.calls).toHaveLength(1)
    expect(run.registry.calls[0]?.url).not.toMatch(/attestations/)
    await run.test.owner.cleanup()
  })

  it('refuses a lock or registry integrity that does not bind, and a failed verifier', async () => {
    for (const [scenario, expected] of [
      [{ resolved: 'https://evil.example/x.tgz' }, /lock.resolved/],
      [{ lockVersion: '0.9.0' }, /lock.version/],
      [{ integrity: 'sha1-abc' }, /integrity.format/],
      [{ auditExit: 1, audit: audit([bundle(statement())]) }, /verifier.failed/],
      [{ installExit: 1 }, /could not install/],
      [
        { audit: audit([bundle(statement())]), bin: { [AGENT_PACKAGE]: '../../../outside.js' } },
        /package.bin/,
      ],
    ] as const) {
      const run = setup(scenario)
      await expect(run.install(), JSON.stringify(scenario)).rejects.toThrow(expected)
      await run.test.owner.cleanup()
    }
    const mismatch = setup({ audit: audit([bundle(statement())]) })
    const other = `sha512-${createHash('sha512').update('other').digest('base64')}`
    const registry = jsonFetch({
      name: AGENT_PACKAGE,
      version: VERSION,
      dist: { integrity: other },
    })
    await expect(
      installAgent({
        owner: mismatch.test.owner,
        paths: mismatch.paths,
        node: NODE,
        npmCli: FAKE_NPM,
        npxCli: FAKE_NPM,
        version: VERSION,
        workspace: layout.workspace,
        packagePath: null,
        packageSha256: null,
        fetch: registry,
        baseEnv: {},
      }),
    ).rejects.toThrow(/registry.integrity/)
    await mismatch.test.owner.cleanup()
  })

  it('G13 installs a pinned candidate outside the workspace and labels it unsigned', async () => {
    const run = setup({})
    const tarball = path.join(layout.root, 'candidate.tgz')
    writeFileSync(tarball, 'candidate bytes')
    const digest = createHash('sha256').update('candidate bytes').digest('hex')
    const write = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
    expect(await run.install(tarball, digest)).toMatchObject({ candidate: true })
    expect(write).toHaveBeenCalledWith(expect.stringContaining('unsigned agent package'))
    expect(run.reports()[0]?.['args']).toContain(realpathSync.native(tarball))
    await run.test.owner.cleanup()
  })

  it('G13 refuses a candidate inside the workspace, through ..; a directory; a wrong digest; a lone path', async () => {
    const inside = path.join(layout.workspace, 'pkg.tgz')
    writeFileSync(inside, 'x')
    const viaDots = path.join(layout.root, 'elsewhere', '..', 'workspace', 'pkg.tgz')
    const directory = path.join(layout.root, 'a-directory')
    mkdirSync(directory)
    const outside = path.join(layout.root, 'pkg.tgz')
    writeFileSync(outside, 'x')
    const digest = createHash('sha256').update('x').digest('hex')
    for (const [candidate, sha, expected] of [
      [inside, digest, /outside the workspace/],
      [viaDots, digest, /outside the workspace/],
      [directory, digest, /regular file/],
      [outside, '0'.repeat(64), /does not match/],
      [path.join(layout.root, 'missing.tgz'), digest, /does not exist/],
    ] as const) {
      const run = setup({})
      await expect(run.install(candidate, sha), candidate).rejects.toThrow(expected)
      expect(run.reports(), candidate).toEqual([])
      await run.test.owner.cleanup()
    }
    expect(() =>
      parseActionInputs({ MUSE_INPUT_MAX_BUDGET_USD: '1', MUSE_INPUT_AGENT_PACKAGE: outside }),
    ).toThrow(/go together/)
    expect(() =>
      parseActionInputs({
        MUSE_INPUT_MAX_BUDGET_USD: '1',
        MUSE_INPUT_AGENT_PACKAGE_SHA256: digest,
      }),
    ).toThrow(/go together/)
  })

  it.skipIf(process.platform === 'win32')(
    'G13 refuses a candidate whose link resolves into the workspace (POSIX)',
    async () => {
      const target = path.join(layout.workspace, 'real.tgz')
      writeFileSync(target, 'x')
      const link = path.join(layout.root, 'link.tgz')
      symlinkSync(target, link)
      const run = setup({})
      await expect(
        run.install(link, createHash('sha256').update('x').digest('hex')),
      ).rejects.toThrow(/outside the workspace/)
      expect(run.reports()).toEqual([])
      await run.test.owner.cleanup()
    },
  )

  it('G14 refuses a CA file whose real path is in the workspace', () => {
    const ca = path.join(layout.workspace, 'ca.pem')
    writeFileSync(ca, 'pem')
    const inputs = parseActionInputs({
      MUSE_INPUT_MAX_BUDGET_USD: '1',
      MUSE_INPUT_EXTRA_CA_CERTS: ca,
    })
    expect(() => networkInputs(inputs, layout.workspace)).toThrow(/outside the workspace/)
    const outside = path.join(layout.root, 'ca.pem')
    writeFileSync(outside, 'pem')
    const allowed = parseActionInputs({
      MUSE_INPUT_MAX_BUDGET_USD: '1',
      MUSE_INPUT_EXTRA_CA_CERTS: outside,
      MUSE_INPUT_HTTPS_PROXY: 'https://proxy.example:8443',
    })
    expect(networkInputs(allowed, layout.workspace)).toEqual({
      httpsProxy: 'https://proxy.example:8443',
      noProxy: '',
      extraCaCerts: regularFileOutside(outside, layout.workspace, 'ca'),
    })
  })
})
