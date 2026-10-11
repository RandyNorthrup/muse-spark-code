// M97 lane 0 (PLAN.md D76): the legal scan's contract. The finding,
// tool-input, tool-result and postMessage schemas accept their documented
// shapes and reject oversize values, unknown keys and out-of-enum values;
// the header-policy setting is wired with its default.

import { describe, expect, it } from 'vitest'
import manifest from '../../package.json'
import { readSettings } from '../../src/host/settings'
import {
  LEGAL_CATEGORIES,
  LEGAL_EVIDENCE_EXCERPT_MAX_CHARS,
  LEGAL_FINDING_ID_MAX_CHARS,
  LEGAL_FINDINGS_MAX,
  LEGAL_HEADER_POLICIES,
  LEGAL_PATH_MAX_CHARS,
  LEGAL_RESULT_VERSION,
  LEGAL_SCAN_PATHS_MAX,
  LEGAL_SEVERITIES,
  LEGAL_TEXT_MAX_CHARS,
  SETTING_DEFAULTS,
} from '../../src/shared/constants'
import {
  legalFindingSchema,
  legalScanInputSchema,
  legalScanReportMessageSchema,
  legalScanRequestMessageSchema,
  legalScanResultSchema,
} from '../../src/shared/legal'
import { parseHostToWebviewMessage, parseWebviewToHostMessage } from '../../src/shared/protocol'
import { FakeLogOutputChannel, fakeSettingsSource } from './helpers/fakes'

const FINDING = {
  id: 'header/1/1',
  severity: 'advice',
  category: 'codeQualityHeader',
  evidenceSource: 'header reader',
  confidence: 1,
  explanation: 'The file has no copyright header.',
  recommendation: 'Add the project copyright header.',
  fixable: true,
}

const long = (n: number): string => 'x'.repeat(n)

const RESULT = {
  version: LEGAL_RESULT_VERSION,
  ruleVersion: '1',
  dataVersion: '2026-10-04',
  scope: '',
  distribution: 'source checkout, undistributed',
  exclusions: [],
  incompleteChecks: [],
  findings: [FINDING],
}

describe('legalFindingSchema', () => {
  it('accepts a minimal finding', () => {
    expect(legalFindingSchema.safeParse(FINDING).success).toBe(true)
  })

  it('accepts a fully populated finding', () => {
    const parsed = legalFindingSchema.safeParse({
      ...FINDING,
      severity: 'blocker',
      file: 'src/example.ts',
      line: 1,
      endLine: 3,
      packageName: 'example',
      packageVersion: '1.2.3',
      licenseExpression: 'MIT',
      confidence: 0.5,
      evidenceExcerpt: '// Copyright 2026 Example',
    })
    expect(parsed.success).toBe(true)
  })

  it('rejects out-of-enum severities and categories', () => {
    expect(legalFindingSchema.safeParse({ ...FINDING, severity: 'urgent' }).success).toBe(false)
    expect(legalFindingSchema.safeParse({ ...FINDING, severity: 'ADVICE' }).success).toBe(false)
    expect(legalFindingSchema.safeParse({ ...FINDING, category: 'trademark' }).success).toBe(false)
  })

  it('rejects an unknown key', () => {
    expect(legalFindingSchema.safeParse({ ...FINDING, verdict: 'guilty' }).success).toBe(false)
  })

  it('rejects oversize values', () => {
    expect(
      legalFindingSchema.safeParse({ ...FINDING, id: long(LEGAL_FINDING_ID_MAX_CHARS + 1) })
        .success,
    ).toBe(false)
    expect(
      legalFindingSchema.safeParse({ ...FINDING, explanation: long(LEGAL_TEXT_MAX_CHARS + 1) })
        .success,
    ).toBe(false)
    expect(
      legalFindingSchema.safeParse({
        ...FINDING,
        evidenceExcerpt: long(LEGAL_EVIDENCE_EXCERPT_MAX_CHARS + 1),
      }).success,
    ).toBe(false)
    expect(
      legalFindingSchema.safeParse({ ...FINDING, file: long(LEGAL_PATH_MAX_CHARS + 1) }).success,
    ).toBe(false)
  })

  it('rejects confidence outside 0 to 1', () => {
    expect(legalFindingSchema.safeParse({ ...FINDING, confidence: -0.5 }).success).toBe(false)
    expect(legalFindingSchema.safeParse({ ...FINDING, confidence: 2 }).success).toBe(false)
  })
})

describe('legalScanInputSchema', () => {
  it('accepts an empty input: the whole workspace under the configured policy', () => {
    expect(legalScanInputSchema.safeParse({}).success).toBe(true)
  })

  it('accepts a file subset with a policy override', () => {
    expect(
      legalScanInputSchema.safeParse({ paths: ['package.json'], headerPolicy: 'required' }).success,
    ).toBe(true)
  })

  it('rejects an unknown key, too many paths and an out-of-enum policy', () => {
    expect(legalScanInputSchema.safeParse({ write: true }).success).toBe(false)
    expect(
      legalScanInputSchema.safeParse({
        paths: Array.from({ length: LEGAL_SCAN_PATHS_MAX + 1 }, () => 'a'),
      }).success,
    ).toBe(false)
    expect(legalScanInputSchema.safeParse({ headerPolicy: 'sometimes' }).success).toBe(false)
  })
})

describe('legalScanResultSchema', () => {
  it('accepts a complete result', () => {
    expect(legalScanResultSchema.safeParse(RESULT).success).toBe(true)
  })

  it('rejects a wrong version, too many findings and an unknown key', () => {
    expect(legalScanResultSchema.safeParse({ ...RESULT, version: 2 }).success).toBe(false)
    expect(
      legalScanResultSchema.safeParse({
        ...RESULT,
        findings: Array.from({ length: LEGAL_FINDINGS_MAX + 1 }, () => ({ ...FINDING })),
      }).success,
    ).toBe(false)
    expect(legalScanResultSchema.safeParse({ ...RESULT, verdict: 'clean' }).success).toBe(false)
  })
})

describe('legal postMessage', () => {
  it('parses a scan request with and without input', () => {
    expect(parseWebviewToHostMessage({ type: 'requestLegalScan' }).ok).toBe(true)
    expect(parseWebviewToHostMessage({ type: 'requestLegalScan', input: {} }).ok).toBe(true)
  })

  it('rejects a scan request with an unknown key', () => {
    expect(parseWebviewToHostMessage({ type: 'requestLegalScan', input: {}, now: true }).ok).toBe(
      false,
    )
    expect(
      legalScanRequestMessageSchema.safeParse({ type: 'requestLegalScan', extra: 1 }).success,
    ).toBe(false)
  })

  it('parses a scan report', () => {
    const parsed = parseHostToWebviewMessage({
      type: 'legalScanReport',
      requestId: 'r1',
      result: RESULT,
    })
    expect(parsed.ok).toBe(true)
  })

  it('rejects a scan report with an out-of-enum finding or an unknown key', () => {
    expect(
      parseHostToWebviewMessage({
        type: 'legalScanReport',
        requestId: 'r1',
        result: { ...RESULT, findings: [{ ...FINDING, severity: 'critical' }] },
      }).ok,
    ).toBe(false)
    expect(
      legalScanReportMessageSchema.safeParse({
        type: 'legalScanReport',
        requestId: 'r1',
        result: RESULT,
        extra: 1,
      }).success,
    ).toBe(false)
  })
})

describe('legalHeaderPolicy setting', () => {
  it('defaults to optional without choosing a license or owner', () => {
    expect(SETTING_DEFAULTS.legalHeaderPolicy).toBe('optional')
    expect(LEGAL_HEADER_POLICIES).toEqual(['required', 'optional', 'off'])
    expect(LEGAL_SEVERITIES).toEqual(['blocker', 'should-fix', 'advice'])
    expect(LEGAL_CATEGORIES).toContain('codeQualityHeader')
  })

  it('declares the manifest enum and default the code uses', () => {
    const properties = manifest.contributes.configuration.properties as Record<
      string,
      { default?: unknown; enum?: readonly unknown[]; scope?: string }
    >
    const entry = properties['museSpark.legalHeaderPolicy']
    expect(entry?.enum).toEqual([...LEGAL_HEADER_POLICIES])
    expect(entry?.default).toBe(SETTING_DEFAULTS.legalHeaderPolicy)
    // A repository may set its own header style: not machine-scoped (D76).
    expect(entry?.scope).toBeUndefined()
  })

  it('reads the configured policy and falls back for an invalid one', () => {
    const log = new FakeLogOutputChannel()
    expect(readSettings(fakeSettingsSource({}), log).legalHeaderPolicy).toBe('optional')
    expect(
      readSettings(fakeSettingsSource({ legalHeaderPolicy: 'off' }), log).legalHeaderPolicy,
    ).toBe('off')
    expect(
      readSettings(fakeSettingsSource({ legalHeaderPolicy: 'sometimes' }), log).legalHeaderPolicy,
    ).toBe('optional')
    expect(log.warn).toHaveBeenCalled()
  })
})
