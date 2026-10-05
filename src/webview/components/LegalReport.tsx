// The legal scan's report (M97 lane W, PLAN.md D76): the deterministic
// findings in severity groups with their evidence, uncertainty and
// fixability, the disclaimer every surface shows, labelled checkboxes that
// select exactly the findings to fix, and the preview the host answers with
// before anything is confirmed. Nothing is pre-authorized by the scan: even
// in Bypass the user selects, and Plan never writes (the host refuses; the
// dialog says so upfront).

import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { LEGAL_SEVERITIES, UI_TEXT, type PermissionMode } from '../../shared/constants'
import {
  eligibleFixTargets,
  isProjectLicenseChange,
  legalFixExclusionText,
  legalFixRefusalText,
} from '../../core/legalFix'
import type { LegalFinding, LegalScanResult } from '../../shared/legal'
import type { LegalFixPreviewMessage, LegalFixResultMessage } from '../../shared/legalFix'
import type { LineRange } from '../../shared/protocol'
import { fill, formatNumber, formatPercent, plural } from '../../shared/l10n/text'
import { linkTarget } from '../links'
import { Modal } from './Modal'

export interface LegalReportProps {
  readonly result: LegalScanResult
  readonly preview: LegalFixPreviewMessage | undefined
  readonly fixResult: LegalFixResultMessage | undefined
  readonly permissionMode: PermissionMode
  readonly onRequestFix: (
    findings: readonly LegalFinding[],
    isProjectLicenseIncluded: boolean,
  ) => void
  readonly onConfirm: (previewId: string) => void
  readonly onRescan: () => void
  readonly onOpenFile: (path: string, range: LineRange | undefined) => void
  readonly onClose: () => void
}

type Flow = 'select' | 'preview' | 'done'

function rangeOf(finding: LegalFinding): LineRange | undefined {
  return finding.file === undefined || finding.line === undefined
    ? undefined
    : { startLine: finding.line, endLine: finding.endLine ?? finding.line }
}

/** `src/a.ts:12` or `src/a.ts:12-14`, as the finding names it. */
function locationOf(finding: LegalFinding): string | undefined {
  if (finding.file === undefined) {
    return undefined
  }
  if (finding.line === undefined) {
    return finding.file
  }
  const end = finding.endLine ?? finding.line
  return end === finding.line
    ? `${finding.file}:${String(finding.line)}`
    : `${finding.file}:${String(finding.line)}-${String(end)}`
}

/**
 * A finding's location: a button opening the workspace file at its lines,
 * or plain text when it climbs out of the workspace (shown, never opened).
 */
function locationLine(
  location: string | undefined,
  target: ReturnType<typeof linkTarget> | undefined,
  range: LineRange | undefined,
  onOpenFile: LegalReportProps['onOpenFile'],
) {
  if (location === undefined) {
    return null
  }
  if (target?.kind === 'file') {
    return (
      <button
        type="button"
        className="tool-more legal-location"
        onClick={() => {
          onOpenFile(target.path, range ?? target.range)
        }}
      >
        {location}
      </button>
    )
  }
  return <code className="markdown-inline">{location}</code>
}

function FindingRow({
  finding,
  checkboxId,
  checked,
  isPlan,
  onToggle,
  onOpenFile,
}: {
  readonly finding: LegalFinding
  readonly checkboxId: string
  readonly checked: boolean
  readonly isPlan: boolean
  readonly onToggle: (id: string, isChecked: boolean) => void
  readonly onOpenFile: LegalReportProps['onOpenFile']
}) {
  const location = locationOf(finding)
  const range = rangeOf(finding)
  const target = finding.file === undefined ? undefined : linkTarget(finding.file)
  return (
    <li className="legal-finding">
      <p className="legal-finding-head">
        <span className="legal-severity">{UI_TEXT.legalSeverities[finding.severity]}</span>
        <span className="legal-category">{UI_TEXT.legalCategories[finding.category]}</span>
        <code className="legal-id" dir="auto">
          {finding.id}
        </code>
      </p>
      {locationLine(location, target, range, onOpenFile)}
      {finding.packageName === undefined ? null : (
        <p className="legal-meta" dir="auto">
          <code>
            {finding.packageName}
            {finding.packageVersion === undefined ? '' : `@${finding.packageVersion}`}
          </code>
        </p>
      )}
      {finding.licenseExpression === undefined ? null : (
        <p className="legal-meta" dir="auto">
          <code>{finding.licenseExpression}</code>
        </p>
      )}
      <p className="legal-text" dir="auto">
        {finding.explanation}
      </p>
      <p className="legal-text" dir="auto">
        {finding.recommendation}
      </p>
      <p className="legal-meta">
        {fill(UI_TEXT.legalEvidenceLabel, { evidence: finding.evidenceSource })}
      </p>
      <p className="legal-meta">
        {fill(UI_TEXT.legalConfidenceLabel, {
          confidence: formatPercent(finding.confidence * 100),
        })}
      </p>
      {finding.evidenceExcerpt === undefined ? null : (
        <pre className="legal-excerpt" dir="auto">
          {finding.evidenceExcerpt}
        </pre>
      )}
      <p className="legal-meta">
        {finding.fixable ? UI_TEXT.legalFixable : UI_TEXT.legalNotFixable}
      </p>
      <div className="legal-select">
        <input
          type="checkbox"
          id={checkboxId}
          checked={checked}
          disabled={isPlan || !finding.fixable}
          onChange={(event) => {
            onToggle(finding.id, event.target.checked)
          }}
        />
        <label htmlFor={checkboxId}>{fill(UI_TEXT.legalFixSelect, { id: finding.id })}</label>
      </div>
    </li>
  )
}

export function LegalReport({
  result,
  preview,
  fixResult,
  permissionMode,
  onRequestFix,
  onConfirm,
  onRescan,
  onOpenFile,
  onClose,
}: LegalReportProps) {
  const titleId = useId()
  const previewHeadingId = useId()
  const resultHeadingId = useId()
  const isPlan = permissionMode === 'plan'
  const [selected, setSelected] = useState<readonly string[]>([])
  const [separateConfirm, setSeparateConfirm] = useState(false)
  const [showsNothingSelected, setShowsNothingSelected] = useState(false)
  const [flow, setFlow] = useState<Flow>('select')
  const previewHeading = useRef<HTMLHeadingElement>(null)
  const resultHeading = useRef<HTMLHeadingElement>(null)
  const byId = useMemo(
    () => new Map(result.findings.map((finding) => [finding.id, finding])),
    [result],
  )
  const selectedFindings = useMemo(
    () =>
      selected.flatMap((id) => {
        const finding = byId.get(id)
        return finding === undefined ? [] : [finding]
      }),
    [selected, byId],
  )
  const isSeparateConfirmationNeeded = selectedFindings.some(
    (finding) => finding.fixable && isProjectLicenseChange(finding),
  )
  const safeIds = useMemo(
    () =>
      eligibleFixTargets(
        result.findings,
        result.findings.map((finding) => finding.id),
        false,
      ).eligible.map((finding) => finding.id),
    [result],
  )

  // The preview and the outcome arrive after their request: move keyboard
  // focus to their heading once each, so keyboard and screen-reader users
  // land on what changed (the Modal keeps Tab inside the dialog).
  const focusedPreview = useRef<string | undefined>(undefined)
  const focusedResult = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (
      preview === undefined ||
      flow === 'select' ||
      focusedPreview.current === preview.previewId
    ) {
      return
    }
    focusedPreview.current = preview.previewId
    previewHeading.current?.focus()
  }, [preview, flow])
  useEffect(() => {
    if (
      fixResult === undefined ||
      flow !== 'done' ||
      focusedResult.current === fixResult.previewId
    ) {
      return
    }
    focusedResult.current = fixResult.previewId
    resultHeading.current?.focus()
  }, [fixResult, flow])

  const toggle = (id: string, isChecked: boolean) => {
    setShowsNothingSelected(false)
    setFlow('select')
    setSelected(isChecked ? [...selected, id] : selected.filter((candidate) => candidate !== id))
  }
  const requestPreview = (findings: readonly LegalFinding[], isProjectLicenseIncluded: boolean) => {
    if (findings.length === 0) {
      // Bypass still requires the user's selection: nothing is pre-authorized.
      setShowsNothingSelected(true)
      return
    }
    setShowsNothingSelected(false)
    setFlow('preview')
    onRequestFix(findings, isProjectLicenseIncluded)
  }
  const fixAllSafe = () => {
    const findings = safeIds.flatMap((id) => {
      const finding = byId.get(id)
      return finding === undefined ? [] : [finding]
    })
    setSelected(safeIds)
    requestPreview(findings, false)
  }

  const summary =
    result.findings.length === 0
      ? UI_TEXT.legalScanEmpty
      : plural(UI_TEXT.legalFindingsCount, result.findings.length)
  return (
    <Modal title={UI_TEXT.legalScanTitle} titleId={titleId} isWide onClose={onClose}>
      <div className="legal-report">
        <p className="legal-disclaimer">{UI_TEXT.legalScanDisclaimer}</p>
        <p className="legal-meta" dir="auto">
          {fill(UI_TEXT.legalDistributionLine, { distribution: result.distribution })}
        </p>
        {result.exclusions.length === 0 ? null : (
          <p className="legal-meta" dir="auto">
            {fill(UI_TEXT.legalExclusionsLine, { exclusions: result.exclusions.join('; ') })}
          </p>
        )}
        <p className="legal-summary">{summary}</p>
        <p className="legal-meta" dir="auto">
          {result.scope}
        </p>
        {result.incompleteChecks.length === 0 ? null : (
          <p className="legal-meta">
            {fill(UI_TEXT.legalScanIncomplete, { checks: result.incompleteChecks.join(', ') })}
          </p>
        )}
        {isPlan ? (
          <p className="notice-warning" role="note">
            {UI_TEXT.legalFixRefusedPlan}
          </p>
        ) : null}
        {result.findings.length === 0 ? null : (
          <section aria-label={UI_TEXT.legalReportFindings}>
            {LEGAL_SEVERITIES.map((severity) => {
              const group = result.findings.filter((finding) => finding.severity === severity)
              if (group.length === 0) {
                return null
              }
              return (
                <section
                  key={severity}
                  aria-label={`${UI_TEXT.legalSeverities[severity]}: ${formatNumber(group.length)}`}
                >
                  <h3 className="legal-group-heading">
                    {UI_TEXT.legalSeverities[severity]} · {formatNumber(group.length)}
                  </h3>
                  <ul className="legal-findings">
                    {group.map((finding) => (
                      <FindingRow
                        key={finding.id}
                        finding={finding}
                        checkboxId={`legal-fix-${finding.id}`}
                        checked={selected.includes(finding.id)}
                        isPlan={isPlan}
                        onToggle={toggle}
                        onOpenFile={onOpenFile}
                      />
                    ))}
                  </ul>
                </section>
              )
            })}
          </section>
        )}
        {isPlan || result.findings.length === 0 ? null : (
          <div className="legal-actions">
            <p className="legal-meta" role="status">
              {plural(UI_TEXT.legalSelectedCount, selected.length)}
            </p>
            {isSeparateConfirmationNeeded ? (
              <div className="legal-select">
                <input
                  type="checkbox"
                  id="legal-separate-confirm"
                  checked={separateConfirm}
                  onChange={(event) => {
                    setSeparateConfirm(event.target.checked)
                    setFlow('select')
                  }}
                />
                <label htmlFor="legal-separate-confirm">{UI_TEXT.legalFixSeparateConfirm}</label>
              </div>
            ) : null}
            <div className="legal-buttons">
              <button
                type="button"
                className="button-primary"
                onClick={fixAllSafe}
                disabled={safeIds.length === 0}
              >
                {UI_TEXT.legalFixAllSafe}
              </button>
              <button
                type="button"
                className="button-secondary"
                onClick={() => {
                  requestPreview(selectedFindings, separateConfirm)
                }}
              >
                {UI_TEXT.legalPreviewFixes}
              </button>
            </div>
            {showsNothingSelected ? (
              <p className="notice-warning" role="alert">
                {UI_TEXT.legalFixNothingSelected}
              </p>
            ) : null}
          </div>
        )}
        {preview === undefined || flow === 'select' ? null : (
          <section aria-label={UI_TEXT.legalFixPreviewTitle}>
            <h3
              id={previewHeadingId}
              className="legal-group-heading"
              tabIndex={-1}
              ref={previewHeading}
            >
              {UI_TEXT.legalFixPreviewTitle}
            </h3>
            {preview.refusal === undefined ? (
              <div role="status">
                <h4 className="legal-subheading">{UI_TEXT.legalFixFiles}</h4>
                {preview.paths.length === 0 ? null : (
                  <ul className="legal-paths">
                    {preview.paths.map((path) => (
                      <li key={path}>
                        <code dir="auto">{path}</code>
                      </li>
                    ))}
                  </ul>
                )}
                <ul className="legal-eligible">
                  {preview.eligible.map((id) => (
                    <li key={id} dir="auto">
                      {id}
                    </li>
                  ))}
                </ul>
                {preview.excluded.length === 0 ? null : (
                  <>
                    <h4 className="legal-subheading">{UI_TEXT.legalFixExcluded}</h4>
                    <ul className="legal-excluded">
                      {preview.excluded.map((entry) => (
                        <li key={entry.id} dir="auto">
                          {entry.id}: {legalFixExclusionText(entry.reason)}
                        </li>
                      ))}
                    </ul>
                  </>
                )}
                {preview.patches?.map((patch) => (
                  <pre key={patch.path} className="legal-excerpt" dir="auto">
                    {patch.diff}
                  </pre>
                ))}
                {preview.eligible.length === 0 ? null : (
                  <div className="legal-buttons">
                    <button
                      type="button"
                      className="button-primary"
                      disabled={flow !== 'preview' || (preview.patches?.length ?? 0) === 0}
                      onClick={() => {
                        setFlow('done')
                        onConfirm(preview.previewId)
                      }}
                    >
                      {UI_TEXT.legalFixApply}
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <p className="notice-warning" role="alert">
                {legalFixRefusalText(preview.refusal)}
              </p>
            )}
          </section>
        )}
        {fixResult === undefined || flow !== 'done' ? null : (
          <section aria-label={UI_TEXT.legalFixPreviewTitle}>
            <h3
              id={resultHeadingId}
              className="legal-group-heading"
              tabIndex={-1}
              ref={resultHeading}
            >
              {UI_TEXT.legalFixPreviewTitle}
            </h3>
            <div role="status">
              {fixResult.outcome === 'refused' ? (
                <p className="notice-warning">
                  {fixResult.refusal === undefined
                    ? UI_TEXT.legalFixNothingSelected
                    : legalFixRefusalText(fixResult.refusal)}
                </p>
              ) : (
                <>
                  {fixResult.applied.length === 0 ? null : (
                    <ul className="legal-paths">
                      {fixResult.applied.map((path) => (
                        <li key={path}>
                          <code dir="auto">{path}</code>
                        </li>
                      ))}
                    </ul>
                  )}
                  {fixResult.failed.map((failure) => (
                    <p key={failure.path} className="notice-warning" dir="auto">
                      {failure.path}: {failure.reason}
                    </p>
                  ))}
                </>
              )}
              <p className="legal-meta">{UI_TEXT.legalFixRescanHint}</p>
            </div>
          </section>
        )}
        <div className="legal-buttons">
          <button type="button" className="button-secondary" onClick={onRescan}>
            {UI_TEXT.legalScanAgain}
          </button>
          <button type="button" className="button-secondary" onClick={onClose}>
            {UI_TEXT.questionCancel}
          </button>
        </div>
      </div>
    </Modal>
  )
}
