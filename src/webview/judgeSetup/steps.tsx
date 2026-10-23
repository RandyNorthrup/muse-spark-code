// D107 (M125 lane W): the wizard's step bodies. Presentational: each
// renders its snapshot slice, and the recommendation's Advanced block
// posts the choice commands. Summaries, reasons and model ids render
// as they came; counts and bytes go through the Intl helpers.
import { Fragment } from 'react'
import { UI_TEXT } from '../../shared/constants'
import type {
  JudgeSetupCommandMessage,
  JudgeSetupPhase,
  JudgeSetupSnapshot,
} from '../../shared/judgeSetupSchema'
import { fill, formatBytes, formatList, formatNumber } from '../../shared/l10n/text'

type ScanSnapshot = Extract<JudgeSetupSnapshot, { step: 'scan' }>
type RecommendationSnapshot = Extract<JudgeSetupSnapshot, { step: 'recommendation' }>
type LicenceSnapshot = Extract<JudgeSetupSnapshot, { step: 'licence' }>
type InstallSnapshot = Extract<JudgeSetupSnapshot, { step: 'install' }>
type DoneSnapshot = Extract<JudgeSetupSnapshot, { step: 'done' }>

export function ScanStep({ snapshot }: { readonly snapshot: ScanSnapshot }) {
  const text = UI_TEXT.judgeSetupWizard
  return (
    <section aria-labelledby="js-scan-title">
      <h3 id="js-scan-title">{text.scanTitle}</h3>
      <p className="js-hint">{text.scanBody}</p>
      {snapshot.running ? <p role="status">{text.scanning}</p> : null}
      {snapshot.summary.length > 0 ? (
        <ul className="js-list">
          {snapshot.summary.map((line) => (
            <li key={line} dir="auto">
              {line}
            </li>
          ))}
        </ul>
      ) : null}
      {snapshot.error === undefined ? null : (
        <p role="alert" className="js-error">
          {fill(text.scanFailed, { error: snapshot.error })}
        </p>
      )}
    </section>
  )
}

function AdvancedBlock({
  snapshot,
  post,
}: {
  readonly snapshot: RecommendationSnapshot
  readonly post: (message: JudgeSetupCommandMessage) => void
}) {
  const text = UI_TEXT.judgeSetupWizard
  return (
    <details className="js-advanced">
      <summary>{text.advanced}</summary>
      <div className="js-advanced-body">
        <label className="js-field" htmlFor="js-advanced-model">
          {text.advancedModel}
        </label>
        <select
          id="js-advanced-model"
          value={snapshot.model ?? ''}
          disabled={snapshot.fitting.length === 0}
          onChange={(event) => {
            const model = event.target.value
            if (model !== '') post({ command: 'chooseModel', model })
          }}
        >
          {snapshot.model === undefined ? <option value="" /> : null}
          {snapshot.fitting.map((model) => (
            <option key={model} value={model}>
              {model}
            </option>
          ))}
        </select>
        <label className="js-check" htmlFor="js-cpu-only">
          <input
            id="js-cpu-only"
            type="checkbox"
            checked={snapshot.cpuOnly}
            onChange={() => {
              post({ command: 'chooseCpuOnly' })
            }}
          />
          {text.cpuOnly}
        </label>
        <div className="js-row-actions">
          <button
            type="button"
            className="js-button"
            onClick={() => {
              post({ command: 'chooseHosted' })
            }}
          >
            {text.hosted}
          </button>
          <button
            type="button"
            className="js-button"
            onClick={() => {
              post({ command: 'chooseSkip' })
            }}
          >
            {text.skip}
          </button>
        </div>
      </div>
    </details>
  )
}

export function RecommendationStep({
  snapshot,
  post,
}: {
  readonly snapshot: RecommendationSnapshot
  readonly post: (message: JudgeSetupCommandMessage) => void
}) {
  const text = UI_TEXT.judgeSetupWizard
  return (
    <section aria-labelledby="js-recommend-title">
      <h3 id="js-recommend-title">{text.recommendTitle}</h3>
      {snapshot.model === undefined ? (
        <p role="status">{text.fitsNothing}</p>
      ) : (
        <>
          <p className="js-pick" dir="auto">
            {snapshot.model}
          </p>
          <ul className="js-list">
            {snapshot.downloadBytes === undefined ? null : (
              <li dir="auto">
                {fill(text.downloadSize, { bytes: formatBytes(snapshot.downloadBytes) })}
              </li>
            )}
            <li dir="auto">{fill(text.backendName, { backend: snapshot.backend })}</li>
            {snapshot.p95Ms === undefined ? null : (
              <li dir="auto">{fill(text.p95, { p95: `${formatNumber(snapshot.p95Ms)} ms` })}</li>
            )}
            <li dir="auto">{fill(text.classes, { classes: formatList(snapshot.classes) })}</li>
          </ul>
        </>
      )}
      {snapshot.reasons.length > 0 ? (
        <>
          <h4>{text.reasonsTitle}</h4>
          <ul className="js-list">
            {snapshot.reasons.map((reason) => (
              <li key={reason} dir="auto">
                {reason}
              </li>
            ))}
          </ul>
        </>
      ) : null}
      <AdvancedBlock snapshot={snapshot} post={post} />
    </section>
  )
}

export function LicenceStep({
  snapshot,
  openExternal,
}: {
  readonly snapshot: LicenceSnapshot
  readonly openExternal: (url: string) => void
}) {
  const text = UI_TEXT.judgeSetupWizard
  const url = snapshot.url
  return (
    <section aria-labelledby="js-licence-title">
      <h3 id="js-licence-title">{text.licenceTitle}</h3>
      <p dir="auto">{fill(text.licenceBody, { model: snapshot.model, name: snapshot.name })}</p>
      {url === undefined ? null : (
        <p>
          <button
            type="button"
            className="js-link-button"
            onClick={() => {
              openExternal(url)
            }}
          >
            {text.licenceLink}
          </button>
        </p>
      )}
    </section>
  )
}

function phaseLabel(phase: JudgeSetupPhase): string {
  const text = UI_TEXT.judgeSetupWizard
  switch (phase) {
    case 'fetch': {
      return text.phaseFetch
    }
    case 'verify': {
      return text.phaseVerify
    }
    case 'install': {
      return text.phaseInstall
    }
    case 'register': {
      return text.phaseRegister
    }
    case 'preload': {
      return text.phasePreload
    }
    case 'health': {
      return text.phaseHealth
    }
    case 'smoke': {
      return text.phaseSmoke
    }
  }
}

export function InstallStep({ snapshot }: { readonly snapshot: InstallSnapshot }) {
  const text = UI_TEXT.judgeSetupWizard
  const doneBytes = snapshot.doneBytes
  const totalBytes = snapshot.totalBytes
  const isBounded = doneBytes !== undefined && totalBytes !== undefined && totalBytes > 0
  return (
    <section aria-labelledby="js-install-title">
      <h3 id="js-install-title">{fill(text.installTitle, { model: snapshot.model })}</h3>
      <p role="status" dir="auto">
        {phaseLabel(snapshot.phase)}
      </p>
      {isBounded ? (
        <>
          <progress
            className="js-progress"
            value={doneBytes}
            max={totalBytes}
            aria-label={phaseLabel(snapshot.phase)}
          />
          <p className="js-hint" dir="auto">
            {fill(text.progressBytes, {
              done: formatBytes(doneBytes),
              total: formatBytes(totalBytes),
            })}
          </p>
        </>
      ) : null}
      {snapshot.error === undefined ? null : (
        <p role="alert" className="js-error">
          {fill(text.installFailed, { error: snapshot.error })}
        </p>
      )}
    </section>
  )
}

export function DoneStep({ snapshot }: { readonly snapshot: DoneSnapshot }) {
  const text = UI_TEXT.judgeSetupWizard
  return (
    <section aria-labelledby="js-done-title">
      <h3 id="js-done-title">{text.doneTitle}</h3>
      <h4>{text.classesTitle}</h4>
      <dl className="js-facts">
        {snapshot.classes.map((row) => (
          <Fragment key={row.timingClass}>
            <dt dir="auto">{row.timingClass}</dt>
            <dd dir="auto">{row.reason}</dd>
          </Fragment>
        ))}
      </dl>
      <h4>{text.checksTitle}</h4>
      <dl className="js-facts">
        {snapshot.checks.map((row) => (
          <Fragment key={row.family}>
            <dt dir="auto">{row.family}</dt>
            <dd dir="auto">{row.reason}</dd>
          </Fragment>
        ))}
      </dl>
      <p className="js-hint" dir="auto">
        {fill(text.smoke, {
          correct: formatNumber(snapshot.smokeCorrect),
          total: formatNumber(snapshot.smokeTotal),
        })}
      </p>
    </section>
  )
}
