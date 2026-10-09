import type { PaidUseRequest } from './paid'
import { paidFeatureName } from './paid'
import { UI_TEXT, MODEL_API_PRICE_DECIMALS, ACP_PAID_OPTIONS } from './constants'
import { fill } from './l10n/text'
import { formatUsd } from './l10n/exactUsd'
import { Usd, type UsdAmount } from './usd'

/** The catalog's complete worst-case quote, including hosted fees, for this exact selected dispatch. */
export interface VerifiedPaidQuote {
  readonly providerId: string
  readonly providerName: string
  readonly modelId: string
  readonly maximumUsd: number
  readonly isCurrent: () => boolean
}
export function verifiedPaidQuestion(
  request: PaidUseRequest,
  quote: VerifiedPaidQuote | undefined,
  budgetUsd: UsdAmount,
) {
  if (
    quote === undefined ||
    !quote.isCurrent() ||
    quote.providerId === '' ||
    quote.providerName === '' ||
    quote.modelId === '' ||
    !Number.isFinite(quote.maximumUsd) ||
    quote.maximumUsd < 0 ||
    Usd.from(budgetUsd).compare(Usd.from(quote.maximumUsd)) < 0
  )
    return
  let model: string | undefined
  if ('modelId' in request) model = request.modelId
  else if (request.feature === 'subagents') model = request.task.modelId
  if (model !== undefined && model !== quote.modelId) return
  const name = paidFeatureName(request.feature)
  let subject = `${name} (${quote.modelId})`
  if (request.feature === 'imageGeneration')
    subject = fill(UI_TEXT.imageBuyPrompt, { prompt: request.prompt })
  else if (request.feature === 'subagents') subject = request.task.objective
  else if ('prompt' in request) subject = request.prompt
  return {
    title: fill(UI_TEXT.paidConfirmTitle, { feature: name }),
    detail: fill(UI_TEXT.paidProviderUseDetail, {
      subject,
      price: formatUsd(quote.maximumUsd, MODEL_API_PRICE_DECIMALS),
      provider: quote.providerName,
      budget: formatUsd(budgetUsd, MODEL_API_PRICE_DECIMALS),
    }),
    isCurrent: quote.isCurrent,
  }
}

/** Native and browser dialogs show the same ordered D48 choices, read in the installed language. */
export function paidConsentChoices(canRemember: boolean) {
  const choices: { id: string; title: string }[] = [
    { id: ACP_PAID_OPTIONS.allowOnce, title: UI_TEXT.allowOnce },
  ]
  if (canRemember)
    choices.push({ id: ACP_PAID_OPTIONS.allowAlways, title: UI_TEXT.paidAllowAlways })
  choices.push({ id: ACP_PAID_OPTIONS.deny, title: UI_TEXT.paidDeny })
  return choices
}
