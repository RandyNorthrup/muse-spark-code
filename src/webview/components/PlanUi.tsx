// Shared React UI: editor hosts and companion pages use the same surfaces.
import { Fragment, useLayoutEffect, useState } from 'react'
import {
  CHATGPT_MANAGE_USAGE_URL,
  COPILOT_MANAGE_USAGE_URL,
  COPILOT_REPORT_URL,
  CHATGPT_PLAN_NOTICE_STORAGE_KEY,
  CHATGPT_PLAN_LIMIT_ERROR_KIND,
  CHATGPT_PLAN_LIMIT_MESSAGE,
  UI_TEXT,
} from '../../shared/constants'
import type { UiState } from '../state/uiState'
import { webviewErrorReport } from '../errorReport'
import type { WebviewToHostMessage } from '../../shared/protocol'
import { fill, formatNumber } from '../../shared/l10n/text'
import type { PlanUsageRow } from '../../shared/usage'
import type { ModelOption } from '../../shared/protocol'
import { Modal } from './Modal'

/** Hosts can persist the acknowledgement once per profile; browsers use their origin. */
export interface PlanNoticePort {
  readonly isAcknowledged: () => boolean
  readonly acknowledge: () => void
}
const browserPlanNotice: PlanNoticePort = {
  isAcknowledged: () => window.localStorage.getItem(CHATGPT_PLAN_NOTICE_STORAGE_KEY) === '1',
  acknowledge: () => {
    window.localStorage.setItem(CHATGPT_PLAN_NOTICE_STORAGE_KEY, '1')
  },
}

export function PlanSurface({
  state,
  providerId,
  isOtherModalOpen,
  onModalChange,
  onChooseModel,
  postMessage,
  port = browserPlanNotice,
}: {
  readonly state: UiState
  readonly providerId: string | undefined
  readonly isOtherModalOpen: boolean
  readonly onModalChange: (isOpen: boolean) => void
  readonly onChooseModel: () => void
  readonly postMessage: (message: WebviewToHostMessage) => void
  readonly port?: PlanNoticePort | undefined
}) {
  const [isAcknowledged, setAcknowledged] = useState(() => {
    try {
      return port.isAcknowledged()
    } catch {
      return false
    }
  })
  const [dismissed, setDismissed] = useState<string | undefined>(undefined)
  const failure = state.transcript.findLast((entry) => entry.kind === 'error')
  const isChatGptPlan = state.auth.status === 'signedIn' && providerId === 'chatgpt'
  const isLimit =
    isChatGptPlan &&
    failure?.kind === 'error' &&
    failure.id === `error:${state.lastCompletedTurnId ?? ''}` &&
    (failure.errorKind === CHATGPT_PLAN_LIMIT_ERROR_KIND ||
      failure.text.includes(CHATGPT_PLAN_LIMIT_MESSAGE)) &&
    failure.id !== dismissed
  const isOpen = !isOtherModalOpen && (isLimit || (isChatGptPlan && !isAcknowledged))
  useLayoutEffect(() => {
    onModalChange(isOpen)
  }, [isOpen, onModalChange])
  const onClose = () => {
    if (isLimit) setDismissed(failure.id)
    else {
      try {
        port.acknowledge()
      } catch (error: unknown) {
        postMessage(webviewErrorReport('window', error))
      }
      setAcknowledged(true)
    }
  }
  return isOpen ? (
    <PlanDialog
      isLimit={isLimit}
      onClose={onClose}
      onOpenExternal={(url) => {
        postMessage({ type: 'openExternal', url })
      }}
      onChooseModel={() => {
        onClose()
        onChooseModel()
      }}
    />
  ) : null
}

export function PlanMark({
  model,
  providerId,
  onOpenExternal,
}: {
  readonly model: ModelOption | undefined
  readonly providerId: string | undefined
  readonly onOpenExternal: (url: string) => void
}) {
  const isChatGpt = providerId === 'chatgpt'
  const url = managementUrl(providerId, model)
  return (
    <span className="plan-mark">
      {isChatGpt
        ? UI_TEXT.planUi.chatGptMark
        : fill(UI_TEXT.planUi.providerMark, { provider: model?.providerLabel ?? providerId ?? '' })}
      {url === undefined ? null : (
        <button
          type="button"
          className="usage-link"
          onClick={() => {
            onOpenExternal(url)
          }}
        >
          {UI_TEXT.planUi.manage}
        </button>
      )}
      {providerId === 'copilot' ? <span>{UI_TEXT.planUi.reduced}</span> : null}
    </span>
  )
}

function managementUrl(providerId: string | undefined, model: ModelOption | undefined) {
  if (providerId === 'chatgpt') return CHATGPT_MANAGE_USAGE_URL
  return providerId === 'copilot' ? COPILOT_MANAGE_USAGE_URL : model?.planLimitsUrl
}

export function CopilotNote({
  onOpenExternal,
}: {
  readonly onOpenExternal: (url: string) => void
}) {
  return (
    <p className="usage-row-meta copilot-note">
      {UI_TEXT.planUi.aiContent}{' '}
      <button
        type="button"
        className="usage-link"
        onClick={() => {
          onOpenExternal(COPILOT_REPORT_URL)
        }}
      >
        {UI_TEXT.planUi.reportContent}
      </button>
    </p>
  )
}

function PlanDialog({
  isLimit,
  onClose,
  onOpenExternal,
  onChooseModel,
}: {
  readonly isLimit: boolean
  readonly onClose: () => void
  readonly onOpenExternal: (url: string) => void
  readonly onChooseModel: () => void
}) {
  return (
    <Modal
      title={isLimit ? UI_TEXT.planUi.limitTitle : UI_TEXT.planUi.noticeTitle}
      titleId="chatgpt-plan-title"
      onClose={onClose}
    >
      <p>{isLimit ? UI_TEXT.planUi.limitDetail : UI_TEXT.planUi.noticeDetail}</p>
      <p className="usage-row-meta">{UI_TEXT.planUi.credits}</p>
      <div className="plan-actions">
        <button
          type="button"
          className="button-secondary"
          onClick={() => {
            onOpenExternal(CHATGPT_MANAGE_USAGE_URL)
          }}
        >
          {UI_TEXT.planUi.manage}
        </button>
        {isLimit ? (
          <button type="button" className="button-secondary" onClick={onChooseModel}>
            {UI_TEXT.planUi.chooseModel}
          </button>
        ) : null}
        <button type="button" className="button-primary" onClick={onClose}>
          {isLimit ? UI_TEXT.usageClose : UI_TEXT.planUi.understood}
        </button>
      </div>
    </Modal>
  )
}

export function PlanUsageSection({
  rows,
  models,
  onOpenExternal,
}: {
  readonly rows: readonly PlanUsageRow[]
  readonly models: readonly ModelOption[]
  readonly onOpenExternal: (url: string) => void
}) {
  return (
    <section aria-label={UI_TEXT.planUi.usageHeading}>
      <h3 className="usage-heading">{UI_TEXT.planUi.usageHeading}</h3>
      <p className="usage-row-meta">{UI_TEXT.planUi.usageDetail}</p>
      {rows.map((row) => {
        const model = models.find((option) => option.providerId === row.providerId)
        const url = managementUrl(row.providerId, model)
        const unknown = row.requests - row.reported.requests - row.estimated.requests
        return (
          <div key={row.providerId}>
            <h4>
              {model?.providerLabel ?? row.providerId} · {UI_TEXT.modelPlan}
            </h4>
            <dl className="usage-facts plan-usage-facts">
              <dt>{UI_TEXT.planUi.requests}</dt>
              <dd>{formatNumber(row.requests)}</dd>
              {(['reported', 'estimated'] as const).map((source) =>
                row[source].requests === 0 ? null : (
                  <Fragment key={source}>
                    <dt>
                      {source === 'reported'
                        ? UI_TEXT.planUi.reportedTokens
                        : UI_TEXT.planUi.estimatedTokens}
                    </dt>
                    <dd>
                      {fill(UI_TEXT.planUi.tokenCounts, {
                        input: formatNumber(row[source].inputTokens),
                        output: formatNumber(row[source].outputTokens),
                        requests: formatNumber(row[source].requests),
                      })}
                    </dd>
                  </Fragment>
                ),
              )}
              {unknown === 0 ? null : (
                <>
                  <dt>{UI_TEXT.planUi.unknownTokens}</dt>
                  <dd>{formatNumber(unknown)}</dd>
                </>
              )}
            </dl>
            {url === undefined ? null : (
              <button
                type="button"
                className="usage-link"
                onClick={() => {
                  onOpenExternal(url)
                }}
              >
                {UI_TEXT.planUi.manage}
              </button>
            )}
          </div>
        )
      })}
    </section>
  )
}
