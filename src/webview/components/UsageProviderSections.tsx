import { UI_TEXT, type ModelPricing } from '../../shared/constants'
import { fill } from '../../shared/l10n/text'
import { backendLabel } from '../../shared/l10n/text'
import { planLabel, type AccountFacts } from '../../shared/usage'
import type { UsageReport } from '../state/uiState'
export { PlanUsageSection } from './PlanUi'

function signInLabel(method: AccountFacts['signInMethod'] | undefined): string {
  if (method === 'cli') {
    return UI_TEXT.usageAuthCli
  }
  return method === 'apiKey' ? UI_TEXT.usageAuthKey : UI_TEXT.usageAuthNone
}

function planFor(report: UsageReport): string {
  if (report.subscription !== undefined) {
    return planLabel(report.subscription.tier)
  }
  return report.backend === 'modelApi' ? UI_TEXT.usagePlanPayAsYouGo : UI_TEXT.usagePlanUnknown
}

export function AccountSection({
  report,
  modelId,
  modelPricing,
  providerId,
  provider,
}: {
  readonly report: UsageReport
  readonly modelId: string | undefined
  readonly modelPricing: ModelPricing | undefined
  readonly providerId: string | undefined
  readonly provider: string
}) {
  const { account } = report
  const signIn =
    providerId === 'chatgpt' || providerId === 'copilot'
      ? fill(UI_TEXT.planUi.providerMark, { provider })
      : signInLabel(account?.signInMethod)
  const plan = modelPricing === 'plan' ? UI_TEXT.modelPlan : planFor(report)
  return (
    <dl className="usage-facts">
      <dt>{UI_TEXT.usageAuthMethod}</dt>
      <dd>{signIn}</dd>
      <dt>{UI_TEXT.usagePlan}</dt>
      <dd>{plan}</dd>
      <dt>{UI_TEXT.usageBackend}</dt>
      <dd>{modelPricing === 'plan' ? provider : backendLabel(report.backend)}</dd>
      {account?.cliVersion === undefined ? null : (
        <>
          <dt>{UI_TEXT.usageCliVersion}</dt>
          <dd>{account.cliVersion}</dd>
        </>
      )}
      {modelId === undefined ? null : (
        <>
          <dt>{UI_TEXT.usageModel}</dt>
          <dd>{modelId}</dd>
        </>
      )}
    </dl>
  )
}
