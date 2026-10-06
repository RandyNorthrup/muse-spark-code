import type { AccountsPolicyView } from '../../../../shared/modelsPanel'
import { ACCOUNT_POLICY_RECHECK_DAYS, UI_TEXT } from '../../../../shared/constants'
import { fill, formatDate, formatUnit } from '../../../../shared/l10n/text'
import { ExternalLink } from '../../../components/ExternalLink'

export function PolicyDetails({
  policy,
  onOpenLink,
}: {
  readonly policy: AccountsPolicyView
  readonly onOpenLink: (url: string) => void
}) {
  const multiple = {
    yes: UI_TEXT.accounts.multipleAllowed,
    conditions: UI_TEXT.accounts.multipleConditions,
    onePerPerson: UI_TEXT.accounts.multipleOnePerson,
    unclear: UI_TEXT.accounts.multipleUnclear,
  }
  const pooling = {
    on: UI_TEXT.accounts.policyOn,
    confirm: UI_TEXT.accounts.policyConfirm,
    notOffered: UI_TEXT.accounts.notOffered,
  }
  return (
    <div className="account-policy">
      <p>{pooling[policy.pooling]}</p>
      <p>{multiple[policy.multipleAccounts]}</p>
      <p>
        {fill(UI_TEXT.accounts.checked, {
          date: formatDate(Date.parse(`${policy.checkedAt}T12:00:00`)),
        })}
      </p>
      {policy.isStale ? (
        <p role="status">
          {fill(UI_TEXT.accounts.stale, {
            duration: formatUnit(ACCOUNT_POLICY_RECHECK_DAYS, 'day'),
          })}
        </p>
      ) : null}
      {policy.sources.map((source) => (
        <div key={source.url + source.quote}>
          <blockquote>{source.quote}</blockquote>
          <ExternalLink
            url={source.url}
            title={undefined}
            onOpenLink={onOpenLink}
            onRefuseLink={undefined}
          />
          <p>
            {source.pageDate === null
              ? UI_TEXT.accounts.sourceUndated
              : fill(UI_TEXT.accounts.sourceDate, {
                  date: /^\d{4}-\d{2}-\d{2}$/.test(source.pageDate)
                    ? formatDate(Date.parse(`${source.pageDate}T12:00:00`))
                    : source.pageDate,
                })}
          </p>
        </div>
      ))}
      {policy.recovery === 'none' ? null : (
        <p>
          {policy.recovery === 'chatgptPlan'
            ? UI_TEXT.accounts.chatgptRecovery
            : UI_TEXT.accounts.museCodeRecovery}
        </p>
      )}
      <p>{UI_TEXT.accounts.localConfirmation}</p>
    </div>
  )
}
