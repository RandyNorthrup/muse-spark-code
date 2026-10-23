// The Models & Agents Judge section (M98 phase 2, lane FP). It renders the
// host's snapshot and asks the host to open the first-charge question only
// when that snapshot says one is due. A subscription with no paid source
// shows its notice and no question. M125 lane W adds the local-judge
// setup it manages: set up, re-scan, change the model, or remove.

import { UI_TEXT } from '../../../../shared/constants'
import { unavailableJudgePanel, type JudgePanelSnapshot } from '../../../../shared/judgePanel'
import { judgePanelRows, judgePanelStatusText } from '../../../../shared/judgePanelText'
import type { SectionProps } from '../../sections'

export function JudgeSection({ panelState, post }: SectionProps) {
  const snapshot: JudgePanelSnapshot = panelState.judge ?? unavailableJudgePanel()
  const rows = judgePanelRows(snapshot)
  const statusId = 'judge-panel-status'
  const setup = panelState.judgeSetup
  const text = UI_TEXT.judgeSetupWizard
  return (
    <section className="judge-panel" aria-labelledby="judge-panel-title">
      <h2 id="judge-panel-title">{UI_TEXT.paidJudgeName}</h2>
      <p id={statusId} className="models-hint" role="status">
        {judgePanelStatusText(snapshot)}
      </p>
      {setup === undefined ? null : (
        <div className="models-row-actions">
          {setup.isInstalled ? (
            <>
              <span className="models-hint" dir="auto">
                {setup.model}
              </span>
              <button
                type="button"
                className="models-button"
                onClick={() => {
                  post({ type: 'judge/setupOpen' })
                }}
              >
                {text.sectionRescan}
              </button>
              <button
                type="button"
                className="models-button"
                onClick={() => {
                  post({ type: 'judge/setupChange' })
                }}
              >
                {text.sectionChange}
              </button>
              <button
                type="button"
                className="models-button"
                onClick={() => {
                  post({ type: 'judge/setupRemove' })
                }}
              >
                {text.sectionRemove}
              </button>
            </>
          ) : (
            <>
              <span className="models-hint">{text.sectionNotInstalled}</span>
              <button
                type="button"
                className="models-button-primary"
                onClick={() => {
                  post({ type: 'judge/setupOpen' })
                }}
              >
                {text.sectionSetup}
              </button>
            </>
          )}
        </div>
      )}
      <dl className="models-usage">
        {rows.map((row) => (
          <div key={row.term} className="models-usage-row">
            <dt>{row.term}</dt>
            <dd dir="auto">{row.detail}</dd>
          </div>
        ))}
      </dl>
      {snapshot.showSubscriptionNote ? (
        <p className="models-notice">{UI_TEXT.judgeSubscriptionNotice}</p>
      ) : null}
      {snapshot.untested && snapshot.reason !== 'source-untested' ? (
        <p className="models-notice">{UI_TEXT.judgeSourceUntested}</p>
      ) : null}
      {snapshot.askFirstCharge ? (
        <button
          type="button"
          className="models-button-primary"
          aria-describedby={statusId}
          onClick={() => {
            post({ type: 'judge/askConsent' })
          }}
        >
          {UI_TEXT.judgePanel.askOnce}
        </button>
      ) : null}
    </section>
  )
}
