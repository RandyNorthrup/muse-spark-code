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
import type { UiStore } from '../state/store'
import { webviewErrorReport } from '../errorReport'
import type { WebviewToHostMessage } from '../../shared/protocol'
import { fill, formatNumber, plural } from '../../shared/l10n/text'
import type { PlanUsageRow } from '../../shared/usage'
import type { ModelOption } from '../../shared/protocol'
import { Modal } from './Modal'

/** Keyed persistence: provider plus verified account-id hash; never email/token. */
export interface PlanNoticePort {
  readonly isAcknowledged: (key: string) => boolean
  readonly acknowledge: (key: string) => void
}
const browserPlanNotice: PlanNoticePort = {
  isAcknowledged: (key) => window.localStorage.getItem(key) === '1',
  acknowledge: (key) => {
    window.localStorage.setItem(key, '1')
  },
}

export function PlanSurface({
  state,
  providerId,
  isOtherModalOpen,
  onModalChange,
  onChooseModel,
  onDismissLimit,
  postMessage,
  port = browserPlanNotice,
}: {
  readonly state: UiState
  readonly providerId: string | undefined
  readonly isOtherModalOpen: boolean
  readonly onModalChange: (isOpen: boolean) => void
  readonly onChooseModel: () => void
  readonly onDismissLimit: (turnId: string) => void
  readonly postMessage: (message: WebviewToHostMessage) => void
  readonly port?: PlanNoticePort | undefined
}) {
  const account = state.auth.planAccount
  const key =
    account !== undefined && account.providerId === providerId
      ? `${CHATGPT_PLAN_NOTICE_STORAGE_KEY}:${account.providerId}:${account.accountIdHash}`
      : undefined
  const readNotice = () => {
    let isAcknowledged = false
    try {
      isAcknowledged = key !== undefined && port.isAcknowledged(key)
    } catch {
      // An unavailable store cannot suppress the allowance/credit disclosure.
    }
    return { port, key, auth: state.auth, isAcknowledged }
  }
  const [notice, setNotice] = useState(readNotice)
  // React restarts this render before committing, so a changed account has
  // its own acknowledgement before either the dialog or composer can paint.
  if (
    notice.port !== port ||
    notice.key !== key ||
    (key === undefined && notice.auth !== state.auth)
  ) {
    setNotice(readNotice())
  }
  const failedTurnId = state.lastCompletedTurnId
  const failure = state.transcript.findLast((entry) => entry.kind === 'error')
  const isChatGptPlan = state.auth.status === 'signedIn' && providerId === 'chatgpt'
  const isLimit =
    isChatGptPlan &&
    failure?.kind === 'error' &&
    failedTurnId !== undefined &&
    failure.id === `error:${failedTurnId}` &&
    (failure.errorKind === CHATGPT_PLAN_LIMIT_ERROR_KIND ||
      failure.text.includes(CHATGPT_PLAN_LIMIT_MESSAGE)) &&
    failedTurnId !== state.dismissedPlanTurnId
  const isOpen =
    !isOtherModalOpen &&
    state.handoff === undefined &&
    (isLimit || (isChatGptPlan && !notice.isAcknowledged))
  useLayoutEffect(() => {
    onModalChange(isOpen)
  }, [isOpen, onModalChange])
  const onClose = () => {
    if (isLimit) onDismissLimit(failedTurnId)
    else {
      try {
        if (key !== undefined) port.acknowledge(key)
      } catch (error: unknown) {
        postMessage(webviewErrorReport('window', error))
      }
      setNotice({ ...notice, isAcknowledged: true })
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

function PlanMark({
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

function CopilotNote({ onOpenExternal }: { readonly onOpenExternal: (url: string) => void }) {
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
              <dd>{plural(UI_TEXT.bestOfNRequests, row.requests)}</dd>
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
                  <dd>{plural(UI_TEXT.bestOfNRequests, unknown)}</dd>
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

/** One deferred entry for the plan's modal, pill and Copilot note. */
export function PlanUi(
  props:
    | ({ readonly surface: 'dialog'; readonly store: UiStore } & Omit<
        Parameters<typeof PlanSurface>[0],
        'onDismissLimit'
      >)
    | ({ readonly surface: 'mark' } & Parameters<typeof PlanMark>[0])
    | ({ readonly surface: 'note' } & Parameters<typeof CopilotNote>[0]),
) {
  if (props.surface === 'dialog')
    return (
      <PlanSurface
        {...props}
        onDismissLimit={(turnId) => {
          props.store.dispatch({ type: 'planLimitDismissed', turnId })
        }}
      />
    )
  return props.surface === 'mark' ? <PlanMark {...props} /> : <CopilotNote {...props} />
}
