import { useId, useRef, useState } from 'react'
import {
  accountsPolicyQuestionSchema,
  type AccountsPolicyQuestion,
} from '../../../../shared/modelsPanel'
import type { AccountsRequest } from '../../../../shared/hostApi/accounts'
import { accountIdSchema } from '../../../../shared/accounts'
import { UI_TEXT } from '../../../../shared/constants'
import { fill } from '../../../../shared/l10n/text'
import { Modal } from '../../../components/Modal'
import { PolicyDetails } from './PolicyDetails'

interface QuestionProps {
  readonly provider: string
  readonly providerLabel: string
  readonly onChoose: (
    request: Extract<AccountsRequest, { type: 'accounts/confirm' }>,
  ) => Promise<void>
  readonly onOpenLink: (url: string) => void
}

export function AccountsConfirmationDialog({
  value,
  ...props
}: QuestionProps & { readonly value: unknown }) {
  const parsed = accountsPolicyQuestionSchema.safeParse(value)
  if (!parsed.success || !accountIdSchema.safeParse(props.provider).success)
    return <p role="alert">{UI_TEXT.accounts.invalidAccount}</p>
  return (
    <AccountsQuestion
      key={props.provider + JSON.stringify(parsed.data)}
      {...props}
      question={parsed.data}
    />
  )
}

function AccountsQuestion({
  provider,
  providerLabel,
  question,
  onChoose,
  onOpenLink,
}: QuestionProps & { readonly question: AccountsPolicyQuestion }) {
  const row = question.policy
  const titleId = useId()
  const [hasAcknowledged, setAcknowledged] = useState(false)
  const [isPending, setPending] = useState(false)
  const [hasFailed, setFailed] = useState(false)
  const pending = useRef(false)
  const choose = async (choice: 'confirm' | 'ownCapsOnly' | 'cancel') => {
    if (pending.current || (choice === 'confirm' && !hasAcknowledged)) return
    pending.current = true
    setPending(true)
    try {
      await onChoose({
        type: 'accounts/confirm',
        provider,
        product: row.product,
        questionId: question.questionId,
        providerGeneration: question.providerGeneration,
        choice,
      })
    } catch {
      setFailed(true)
    } finally {
      pending.current = false
      setPending(false)
    }
  }
  return (
    <Modal
      title={UI_TEXT.accounts.policy}
      titleId={titleId}
      onClose={() => {
        void choose('cancel')
      }}
    >
      <p>{fill(UI_TEXT.accounts.confirmWarning, { provider: providerLabel })}</p>
      <PolicyDetails policy={row} onOpenLink={onOpenLink} />
      <label>
        <input
          type="checkbox"
          checked={hasAcknowledged}
          disabled={isPending}
          onChange={(event) => {
            setAcknowledged(event.target.checked)
          }}
        />
        {UI_TEXT.accounts.legitimate}
      </label>
      <div className="account-actions">
        <button
          type="button"
          disabled={!hasAcknowledged || isPending}
          onClick={() => {
            void choose('confirm')
          }}
        >
          {UI_TEXT.accounts.confirm}
        </button>
        <button
          type="button"
          disabled={isPending}
          onClick={() => {
            void choose('ownCapsOnly')
          }}
        >
          {UI_TEXT.accounts.ownCapsOnly}
        </button>
        <button
          type="button"
          disabled={isPending}
          onClick={() => {
            void choose('cancel')
          }}
        >
          {UI_TEXT.accounts.cancel}
        </button>
      </div>
      {hasFailed ? <p role="alert">{UI_TEXT.actionFailed}</p> : null}
    </Modal>
  )
}
