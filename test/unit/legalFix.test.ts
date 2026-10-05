// M97 lane W (PLAN.md D76): the selected-fix handoff. Exact selection and
// preview, stale evidence refusal, Bypass still requiring the user's
// selection, Plan refusing writes, and the postMessage contract between
// the report and the host.

import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  authorizeLegalFix,
  eligibleFixTargets,
  fixPaths,
  isProjectLicenseChange,
  liveEvidence,
  type LegalFixLiveState,
} from '../../src/core/legalFix'
import {
  LegalFixPreviews,
  type LegalFixFileAccess,
  type LegalFixHostState,
} from '../../src/host/legalFix'
import {
  LEGAL_FINDINGS_MAX,
  LEGAL_FIX_FILE_READ_MAX_BYTES,
  LEGAL_FIX_PREVIEWS_MAX,
  LEGAL_RESULT_VERSION,
} from '../../src/shared/constants'
import type { LegalFinding, LegalScanResult } from '../../src/shared/legal'
import {
  confirmLegalFixMessageSchema,
  findingDigest,
  legalFixPreviewMessageSchema,
  legalFixResultMessageSchema,
  requestLegalFixMessageSchema,
  type LegalFixSnapshot,
  type RequestLegalFixMessage,
} from '../../src/shared/legalFix'
import { parseHostToWebviewMessage, parseWebviewToHostMessage } from '../../src/shared/protocol'

const HEADER: LegalFinding = {
  id: 'header/1/1',
  severity: 'advice',
  category: 'codeQualityHeader',
  file: 'src/a.ts',
  line: 1,
  evidenceSource: 'header reader',
  confidence: 1,
  explanation: 'The file has no copyright header.',
  recommendation: 'Add the project copyright header.',
  fixable: true,
  evidenceExcerpt: '// no header here',
}

const LICENSE_PROJECT: LegalFinding = {
  id: 'license/1/1',
  severity: 'should-fix',
  category: 'license',
  evidenceSource: 'project manifest',
  confidence: 0.9,
  explanation: 'The project declares no license.',
  recommendation: 'Choose a license and confirm it separately.',
  fixable: true,
}

const DEP_BLOCKED: LegalFinding = {
  id: 'dep/1/1',
  severity: 'blocker',
  category: 'dependencyLicense',
  packageName: 'leftpad',
  packageVersion: '1.0.0',
  licenseExpression: 'GPL-3.0-only',
  evidenceSource: 'npm lock',
  confidence: 0.9,
  explanation: 'A dependency may oblige source distribution.',
  recommendation: 'Review the obligation with its evidence.',
  fixable: false,
}

const DEP_META: LegalFinding = {
  id: 'dep/1/2',
  severity: 'should-fix',
  category: 'dependencyLicense',
  file: 'package.json',
  line: 12,
  packageName: 'leftpad',
  packageVersion: '1.0.0',
  licenseExpression: 'MIT',
  evidenceSource: 'npm lock',
  confidence: 0.8,
  explanation: 'The manifest license field disagrees with the lock.',
  recommendation: 'Correct the manifest metadata.',
  fixable: true,
}

const FINDINGS = [HEADER, LICENSE_PROJECT, DEP_BLOCKED, DEP_META]

const SCAN = { ruleVersion: '1', dataVersion: '2026-10-04', scope: '' }

describe('findingDigest', () => {
  it('is stable and changes with the evidence', () => {
    expect(findingDigest(HEADER)).toBe(findingDigest({ ...HEADER }))
    expect(findingDigest(HEADER)).toMatch(/^[0-9a-f]{8}$/)
    expect(findingDigest({ ...HEADER, explanation: 'other words' })).not.toBe(findingDigest(HEADER))
  })
})

describe('isProjectLicenseChange', () => {
  it('names the project license, not a dependency license', () => {
    expect(isProjectLicenseChange(LICENSE_PROJECT)).toBe(true)
    expect(isProjectLicenseChange(DEP_META)).toBe(false)
    expect(isProjectLicenseChange(HEADER)).toBe(false)
  })
})

describe('eligibleFixTargets', () => {
  it('keeps exactly the selected findings, in scan order', () => {
    const { eligible, excluded } = eligibleFixTargets(FINDINGS, ['dep/1/2', 'header/1/1'], false)
    expect(eligible.map((finding) => finding.id)).toEqual(['header/1/1', 'dep/1/2'])
    expect(excluded).toEqual([])
  })

  it('leaves out what the scanner marked unfixable', () => {
    const { eligible, excluded } = eligibleFixTargets(FINDINGS, ['dep/1/1'], false)
    expect(eligible).toEqual([])
    expect(excluded).toEqual([{ id: 'dep/1/1', reason: 'notFixable' }])
  })

  it('keeps project-license changes for a separate confirmation only', () => {
    expect(eligibleFixTargets(FINDINGS, ['license/1/1'], false).eligible).toEqual([])
    expect(eligibleFixTargets(FINDINGS, ['license/1/1'], false).excluded).toEqual([
      { id: 'license/1/1', reason: 'projectLicenseSeparate' },
    ])
    const confirmed = eligibleFixTargets(FINDINGS, ['license/1/1'], true)
    expect(confirmed.eligible.map((finding) => finding.id)).toEqual(['license/1/1'])
    expect(confirmed.excluded).toEqual([])
  })

  it('names unknown ids instead of guessing', () => {
    const { eligible, excluded } = eligibleFixTargets(FINDINGS, ['nope/9/9'], false)
    expect(eligible).toEqual([])
    expect(excluded).toEqual([{ id: 'nope/9/9', reason: 'unknownFinding' }])
  })

  it('selects nothing from nothing, and dedupes', () => {
    expect(eligibleFixTargets(FINDINGS, [], false)).toEqual({ eligible: [], excluded: [] })
    const { eligible } = eligibleFixTargets(FINDINGS, ['header/1/1', 'header/1/1'], false)
    expect(eligible.map((finding) => finding.id)).toEqual(['header/1/1'])
  })

  it('lists only the selected files, sorted', () => {
    expect(fixPaths([DEP_META, HEADER])).toEqual(['package.json', 'src/a.ts'])
    expect(fixPaths([LICENSE_PROJECT])).toEqual([])
  })
})

const SNAPSHOT: LegalFixSnapshot = {
  version: LEGAL_RESULT_VERSION,
  ruleVersion: SCAN.ruleVersion,
  dataVersion: SCAN.dataVersion,
  scope: SCAN.scope,
  evidence: [
    { id: HEADER.id, digest: findingDigest(HEADER) },
    { id: DEP_META.id, digest: findingDigest(DEP_META) },
  ],
  fileHashes: [
    { path: 'src/a.ts', hash: 'a'.repeat(64) },
    { path: 'package.json', hash: 'b'.repeat(64) },
  ],
  workspacePath: '/ws',
  permissionMode: 'manual',
}

const LIVE: LegalFixLiveState = {
  permissionMode: 'manual',
  workspacePath: '/ws',
  isTrusted: true,
  evidence: liveEvidence([HEADER, DEP_META]),
  fileHashes: { 'src/a.ts': 'a'.repeat(64), 'package.json': 'b'.repeat(64) },
}

describe('authorizeLegalFix', () => {
  it('authorizes the snapshotted paths when nothing moved', () => {
    expect(authorizeLegalFix(SNAPSHOT, { ...LIVE })).toEqual({
      ok: true,
      paths: ['package.json', 'src/a.ts'],
    })
  })

  it('refuses an empty selection, even in Bypass', () => {
    expect(authorizeLegalFix({ ...SNAPSHOT, evidence: [], fileHashes: [] }, { ...LIVE })).toEqual({
      ok: false,
      refusal: 'nothingSelected',
    })
    expect(
      authorizeLegalFix(
        { ...SNAPSHOT, evidence: [], fileHashes: [] },
        { ...LIVE, permissionMode: 'bypassPermissions' },
      ),
    ).toEqual({ ok: false, refusal: 'nothingSelected' })
  })

  it('refuses writes in Plan mode, whatever was selected', () => {
    expect(authorizeLegalFix(SNAPSHOT, { ...LIVE, permissionMode: 'plan' })).toEqual({
      ok: false,
      refusal: 'planRefusesWrites',
    })
  })

  it('refuses an untrusted workspace and a changed one', () => {
    expect(authorizeLegalFix(SNAPSHOT, { ...LIVE, isTrusted: false })).toEqual({
      ok: false,
      refusal: 'workspaceUntrusted',
    })
    expect(authorizeLegalFix(SNAPSHOT, { ...LIVE, workspacePath: '/elsewhere' })).toEqual({
      ok: false,
      refusal: 'workspaceChanged',
    })
  })

  it('refuses changed evidence and changed or vanished files', () => {
    expect(
      authorizeLegalFix(SNAPSHOT, {
        ...LIVE,
        evidence: { ...LIVE.evidence, 'header/1/1': 'deadbeef' },
      }),
    ).toEqual({ ok: false, refusal: 'staleEvidence' })
    expect(
      authorizeLegalFix(SNAPSHOT, {
        ...LIVE,
        fileHashes: { ...LIVE.fileHashes, 'src/a.ts': 'c'.repeat(64) },
      }),
    ).toEqual({ ok: false, refusal: 'staleEvidence' })
    expect(
      authorizeLegalFix(SNAPSHOT, {
        ...LIVE,
        fileHashes: { ...LIVE.fileHashes, 'src/a.ts': undefined },
      }),
    ).toEqual({ ok: false, refusal: 'staleEvidence' })
  })
})

describe('the fix postMessage contract', () => {
  const request = {
    type: 'requestLegalFix',
    scan: SCAN,
    findings: [HEADER],
    includeProjectLicense: false,
  }
  it('carries a fix request and its confirm', () => {
    expect(requestLegalFixMessageSchema.safeParse(request).success).toBe(true)
    expect(parseWebviewToHostMessage(request).ok).toBe(true)
    expect(parseWebviewToHostMessage({ type: 'confirmLegalFix', previewId: 'p1' }).ok).toBe(true)
    expect(confirmLegalFixMessageSchema.safeParse({ type: 'confirmLegalFix' }).success).toBe(false)
  })

  it('rejects an unknown key, too many findings and a wrong scan version', () => {
    expect(parseWebviewToHostMessage({ ...request, write: true }).ok).toBe(false)
    expect(
      requestLegalFixMessageSchema.safeParse({
        ...request,
        findings: Array.from({ length: LEGAL_FINDINGS_MAX + 1 }, () => ({ ...HEADER })),
      }).success,
    ).toBe(false)
    expect(
      legalFixPreviewMessageSchema.safeParse({
        type: 'legalFixPreview',
        previewId: 'p1',
        snapshot: { ...SNAPSHOT, version: 2 },
        eligible: [],
        excluded: [],
        paths: [],
      }).success,
    ).toBe(false)
  })

  it('carries a preview with an optional snapshot and refusal', () => {
    const preview = {
      type: 'legalFixPreview',
      previewId: 'p1',
      snapshot: SNAPSHOT,
      eligible: ['header/1/1'],
      excluded: [{ id: 'dep/1/1', reason: 'notFixable' }],
      paths: ['src/a.ts'],
    }
    expect(legalFixPreviewMessageSchema.safeParse(preview).success).toBe(true)
    expect(parseHostToWebviewMessage(preview).ok).toBe(true)
    const refused = {
      type: 'legalFixPreview',
      previewId: 'p2',
      eligible: [],
      excluded: [],
      paths: [],
      refusal: 'nothingSelected',
    }
    expect(legalFixPreviewMessageSchema.safeParse(refused).success).toBe(true)
    expect(legalFixPreviewMessageSchema.safeParse({ ...refused, refusal: 'someday' }).success).toBe(
      false,
    )
  })

  it('carries a result with its outcome, and rejects a bad one', () => {
    const result = {
      type: 'legalFixResult',
      previewId: 'p1',
      outcome: 'partial',
      applied: ['src/a.ts'],
      failed: [{ path: 'package.json', reason: 'locked' }],
    }
    expect(legalFixResultMessageSchema.safeParse(result).success).toBe(true)
    expect(parseHostToWebviewMessage(result).ok).toBe(true)
    expect(legalFixResultMessageSchema.safeParse({ ...result, outcome: 'mostly' }).success).toBe(
      false,
    )
  })
})

function fakeFiles(entries: Record<string, string>): {
  files: LegalFixFileAccess
  reads: string[]
} {
  const reads: string[] = []
  const bytes: Record<string, Uint8Array> = Object.fromEntries(
    Object.entries(entries).map(([path, text]) => [path, new TextEncoder().encode(text)]),
  )
  return {
    reads,
    files: {
      resolveRelativePath: (relative: string) =>
        Promise.resolve(
          relative.startsWith('../') || relative.startsWith('/') ? undefined : `/ws/${relative}`,
        ),
      readBytes: (absolute: string, maxBytes: number) => {
        reads.push(`${absolute}:${String(maxBytes)}`)
        const full = bytes[absolute.slice('/ws/'.length)]
        return Promise.resolve(full === undefined || full.length > maxBytes ? undefined : full)
      },
    },
  }
}

const HOST_STATE = (
  files: LegalFixFileAccess,
  over: Partial<Pick<LegalFixHostState, 'permissionMode' | 'workspacePath' | 'isTrusted'>> = {},
): LegalFixHostState => ({
  permissionMode: over.permissionMode ?? 'manual',
  workspacePath: over.workspacePath ?? '/ws',
  isTrusted: over.isTrusted ?? true,
  files,
  applier: undefined,
})

async function singleHeaderPreview() {
  const { files } = fakeFiles({ 'src/a.ts': 'header' })
  const state = HOST_STATE(files)
  const previews = new LegalFixPreviews()
  const preview = await previews.preview(
    { type: 'requestLegalFix', scan: SCAN, findings: [HEADER], includeProjectLicense: false },
    state,
  )
  return { state, previews, preview }
}

describe('LegalFixPreviews', () => {
  it('previews exactly the selected findings and hashes their files', async () => {
    const { files } = fakeFiles({ 'src/a.ts': 'header', 'package.json': '{}' })
    const previews = new LegalFixPreviews()
    const preview = await previews.preview(
      { type: 'requestLegalFix', scan: SCAN, findings: FINDINGS, includeProjectLicense: false },
      HOST_STATE(files),
    )
    expect(preview.refusal).toBeUndefined()
    expect(preview.eligible).toEqual(['header/1/1', 'dep/1/2'])
    expect(preview.excluded).toEqual([
      { id: 'license/1/1', reason: 'projectLicenseSeparate' },
      { id: 'dep/1/1', reason: 'notFixable' },
    ])
    expect(preview.paths).toEqual(['package.json', 'src/a.ts'])
    expect(preview.snapshot?.evidence).toEqual([
      { id: 'header/1/1', digest: findingDigest(HEADER) },
      { id: 'dep/1/2', digest: findingDigest(DEP_META) },
    ])
    const expected = createHash('sha256').update('header').digest('hex')
    expect(preview.snapshot?.fileHashes).toContainEqual({ path: 'src/a.ts', hash: expected })
    expect(preview.snapshot?.workspacePath).toBe('/ws')
  })

  it('refuses an empty selection without storing a preview', async () => {
    const { files } = fakeFiles({})
    const previews = new LegalFixPreviews()
    const preview = await previews.preview(
      { type: 'requestLegalFix', scan: SCAN, findings: [], includeProjectLicense: false },
      HOST_STATE(files),
    )
    expect(preview.refusal).toBe('nothingSelected')
    expect(previews.size).toBe(0)
    const result = await previews.confirm(
      { type: 'confirmLegalFix', previewId: preview.previewId },
      HOST_STATE(files),
    )
    expect(result).toMatchObject({ outcome: 'refused', refusal: 'previewExpired' })
  })

  it('keeps traversal, missing and oversize files out, and never reads escapes', async () => {
    const escape: LegalFinding = { ...HEADER, id: 'escape/1/1', file: '../outside.ts' }
    const missing: LegalFinding = { ...HEADER, id: 'missing/1/1', file: 'gone.ts' }
    const big: LegalFinding = { ...HEADER, id: 'big/1/1', file: 'big.ts' }
    const { files, reads } = fakeFiles({
      'src/a.ts': 'header',
      'big.ts': 'x'.repeat(LEGAL_FIX_FILE_READ_MAX_BYTES + 1),
    })
    const previews = new LegalFixPreviews()
    const preview = await previews.preview(
      {
        type: 'requestLegalFix',
        scan: SCAN,
        findings: [escape, missing, big],
        includeProjectLicense: false,
      },
      HOST_STATE(files),
    )
    expect(preview.eligible).toEqual([])
    expect(preview.excluded).toEqual([
      { id: 'escape/1/1', reason: 'unknownFinding' },
      { id: 'missing/1/1', reason: 'unknownFinding' },
      { id: 'big/1/1', reason: 'fileTooLarge' },
    ])
    expect(reads.some((read) => read.includes('outside'))).toBe(false)
  })

  it('refuses an unknown preview, and forgets on dispose', async () => {
    const { state, previews, preview } = await singleHeaderPreview()
    expect(preview.snapshot).toBeDefined()
    previews.dispose()
    const result = await previews.confirm(
      { type: 'confirmLegalFix', previewId: preview.previewId },
      {
        ...state,
        applier: { apply: () => Promise.resolve({ applied: [], failed: [] }) },
      },
    )
    expect(result).toMatchObject({ outcome: 'refused', refusal: 'previewExpired' })
  })

  it('rechecks mode, trust, workspace and file bytes at confirm', async () => {
    const entries = { 'src/a.ts': 'header', 'package.json': '{}' }
    const take = () => {
      const { files } = fakeFiles({ ...entries })
      return files
    }
    const request: RequestLegalFixMessage = {
      type: 'requestLegalFix',
      scan: SCAN,
      findings: [HEADER, DEP_META],
      includeProjectLicense: false,
    }
    const applier = { apply: () => Promise.resolve({ applied: ['src/a.ts'], failed: [] }) }

    const plan = new LegalFixPreviews()
    const forPlan = await plan.preview(request, HOST_STATE(take()))
    expect(
      await plan.confirm(
        { type: 'confirmLegalFix', previewId: forPlan.previewId },
        {
          ...HOST_STATE(take(), { permissionMode: 'plan' }),
          applier,
        },
      ),
    ).toMatchObject({ outcome: 'refused', refusal: 'planRefusesWrites' })

    const trust = new LegalFixPreviews()
    const forTrust = await trust.preview(request, HOST_STATE(take()))
    expect(
      await trust.confirm(
        { type: 'confirmLegalFix', previewId: forTrust.previewId },
        {
          ...HOST_STATE(take(), { isTrusted: false }),
          applier,
        },
      ),
    ).toMatchObject({ outcome: 'refused', refusal: 'workspaceUntrusted' })

    const moved = new LegalFixPreviews()
    const forMoved = await moved.preview(request, HOST_STATE(take()))
    expect(
      await moved.confirm(
        { type: 'confirmLegalFix', previewId: forMoved.previewId },
        {
          ...HOST_STATE(take(), { workspacePath: '/elsewhere' }),
          applier,
        },
      ),
    ).toMatchObject({ outcome: 'refused', refusal: 'workspaceChanged' })

    entries['src/a.ts'] = 'header, edited after the preview'
    const stale = new LegalFixPreviews()
    const { files: previewFiles } = fakeFiles({ 'src/a.ts': 'header', 'package.json': '{}' })
    const forStale = await stale.preview(request, HOST_STATE(previewFiles))
    const { files: confirmFiles } = fakeFiles(entries)
    expect(
      await stale.confirm(
        { type: 'confirmLegalFix', previewId: forStale.previewId },
        {
          ...HOST_STATE(confirmFiles),
          applier,
        },
      ),
    ).toMatchObject({ outcome: 'refused', refusal: 'staleEvidence' })
  })

  it('hands the authorized paths to the applier, and lists partial failures', async () => {
    const { files } = fakeFiles({ 'src/a.ts': 'header', 'package.json': '{}' })
    const seen: { findings: readonly string[]; paths: readonly string[] }[] = []
    const applier = {
      apply: (findings: readonly LegalFinding[], paths: readonly string[]) => {
        seen.push({ findings: findings.map((finding) => finding.id), paths })
        return Promise.resolve({
          applied: ['src/a.ts'],
          failed: [{ path: 'package.json', reason: 'locked by another process' }],
        })
      },
    }
    const previews = new LegalFixPreviews()
    const preview = await previews.preview(
      {
        type: 'requestLegalFix',
        scan: SCAN,
        findings: [HEADER, DEP_META],
        includeProjectLicense: false,
      },
      HOST_STATE(files),
    )
    const result = await previews.confirm(
      { type: 'confirmLegalFix', previewId: preview.previewId },
      { ...HOST_STATE(files), applier },
    )
    expect(result.outcome).toBe('partial')
    expect(result.applied).toEqual(['src/a.ts'])
    expect(result.failed).toEqual([{ path: 'package.json', reason: 'locked by another process' }])
    // The batch authorization names only the selected paths.
    expect(seen).toEqual([
      { findings: ['header/1/1', 'dep/1/2'], paths: ['package.json', 'src/a.ts'] },
    ])
    // A consumed preview confirms only once.
    const again = await previews.confirm(
      { type: 'confirmLegalFix', previewId: preview.previewId },
      { ...HOST_STATE(files), applier },
    )
    expect(again).toMatchObject({ outcome: 'refused', refusal: 'previewExpired' })
  })

  it('applies cleanly and reports the applied outcome', async () => {
    const { state, previews, preview } = await singleHeaderPreview()
    const result = await previews.confirm(
      { type: 'confirmLegalFix', previewId: preview.previewId },
      {
        ...state,
        applier: { apply: () => Promise.resolve({ applied: ['src/a.ts'], failed: [] }) },
      },
    )
    expect(result).toMatchObject({ outcome: 'applied', applied: ['src/a.ts'], failed: [] })
  })

  it('refuses a guarded confirm while no applier is wired', async () => {
    const { state, previews, preview } = await singleHeaderPreview()
    const result = await previews.confirm(
      { type: 'confirmLegalFix', previewId: preview.previewId },
      state,
    )
    expect(result).toMatchObject({ outcome: 'refused', refusal: 'fixUnavailable' })
  })

  it('evicts the oldest preview past the bound', async () => {
    const { files } = fakeFiles({ 'src/a.ts': 'header' })
    const previews = new LegalFixPreviews()
    const ids: string[] = []
    for (let index = 0; index < LEGAL_FIX_PREVIEWS_MAX + 1; index += 1) {
      const preview = await previews.preview(
        { type: 'requestLegalFix', scan: SCAN, findings: [HEADER], includeProjectLicense: false },
        HOST_STATE(files),
      )
      ids.push(preview.previewId)
    }
    expect(previews.size).toBe(LEGAL_FIX_PREVIEWS_MAX)
    const oldest = ids[0]
    if (oldest === undefined) {
      throw new Error('expected an evicted preview id')
    }
    const first = await previews.confirm(
      { type: 'confirmLegalFix', previewId: oldest },
      HOST_STATE(files),
    )
    expect(first).toMatchObject({ outcome: 'refused', refusal: 'previewExpired' })
  })
})

describe('a scan result for the report', () => {
  it('parses the lane-0 envelope the dialog renders', () => {
    const result: LegalScanResult = {
      version: LEGAL_RESULT_VERSION,
      ruleVersion: '1',
      dataVersion: '2026-10-04',
      scope: '',
      distribution: 'source checkout, undistributed',
      exclusions: [],
      incompleteChecks: ['private registry names were not queried'],
      findings: FINDINGS,
    }
    expect(parseHostToWebviewMessage({ type: 'legalScanReport', requestId: 'r1', result }).ok).toBe(
      true,
    )
  })
})
