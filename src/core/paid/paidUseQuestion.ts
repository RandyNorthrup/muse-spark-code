// The paid popup's formatter loads with the existing imported-hook runtime on first use.
import { EXEC_USD_DECIMALS, UI_TEXT } from '../../shared/constants'
import { fill, formatNumber, uiLocale } from '../../shared/l10n/text'
import { formatDailyBudget, formatUsd } from '../../shared/l10n/exactUsd'
import { Usd } from '../../shared/usd'
import {
  paidFeaturePrice,
  paidFeatureName,
  autoReviewPrice,
  bestOfNPrice,
  modelApiPaidTier,
  hookModelPrice,
  paidStoreReasonText,
  scheduledRunPrice,
  subagentTaskPrice,
  type PaidUseRequest,
} from '../../shared/paid'

/** The popup's question and what it says about the use, in the display language. */
export async function paidUseQuestion(request: PaidUseRequest): Promise<{
  readonly title: string
  readonly detail: string
}> {
  switch (request.feature) {
    case 'autoCompaction': {
      return {
        title: fill(UI_TEXT.paidConfirmTitle, { feature: UI_TEXT.autoCompactionName }),
        detail: `${request.modelId}: ${scheduledRunPrice(request.modelId)}\n${fill(UI_TEXT.paidDailyBudgetLine, { budget: formatDailyBudget(request.dailyBudgetUsd) })}`,
      }
    }
    case 'judge': {
      // A priced judge route (paid embeddings, an experimental SystemOne
      // judge) names its per-request ceiling and the shared daily budget.
      const ceiling = request.systemOne ?? request.embedding
      if (ceiling !== undefined) {
        if (
          Usd.from(ceiling.worstCaseUsd).compare(Usd.from(0)) <= 0 ||
          Usd.from(request.dailyBudgetUsd).compare(Usd.from(0)) < 0
        )
          throw new Error('Judge route needs a verified tariff and daily budget')
        const values = {
          model: request.modelId,
          price: formatUsd(ceiling.worstCaseUsd, EXEC_USD_DECIMALS),
          budget: formatDailyBudget(request.dailyBudgetUsd),
        }
        return {
          title: fill(UI_TEXT.paidConfirmTitle, { feature: UI_TEXT.paidJudgeName }),
          detail:
            request.systemOne === undefined
              ? fill(UI_TEXT.paidConfirmJudgeEmbedding, values)
              : fill(UI_TEXT.paidConfirmJudgeSystemOne, {
                  ...values,
                  recipient: request.systemOne.recipient,
                }),
        }
      }
      const price = autoReviewPrice(request.modelId)
      if (price === undefined || Usd.from(request.dailyBudgetUsd).compare(Usd.from(0)) < 0)
        throw new Error('Judge use needs a verified tariff and daily budget')
      return {
        title: fill(UI_TEXT.paidConfirmTitle, { feature: UI_TEXT.paidJudgeName }),
        detail: fill(UI_TEXT.paidConfirmJudge, {
          price,
          budget: formatDailyBudget(request.dailyBudgetUsd),
        }),
      }
    }
    case 'webSearch': {
      return {
        title: UI_TEXT.paidUseWebSearchTitle,
        detail: [
          fill(UI_TEXT.paidUseWebSearchDetail, {
            price: paidFeaturePrice('webSearch', request.quote?.tariffUsd ?? request.priceUsd),
          }),
          ...(request.quote === undefined
            ? []
            : [
                fill(UI_TEXT.paidSearchQuote, {
                  provider: request.quote.provider,
                  model: request.quote.model,
                }),
              ]),
          ...(request.paidModelId === undefined
            ? []
            : [
                fill(UI_TEXT.subscriptionKey.paidSearch, {
                  price: hookModelPrice(request.paidModelId),
                }),
              ]),
          ...(request.quoteNotice === undefined
            ? []
            : [
                fill(UI_TEXT.paidQuoteChoicesUnreadable, {
                  kind: paidStoreReasonText(request.quoteNotice.kind),
                }),
              ]),
        ].join('\n'),
      }
    }
    case 'voice': {
      return {
        title: UI_TEXT.paidUseVoiceTitle,
        detail: fill(UI_TEXT.paidUseVoiceDetail, { price: paidFeaturePrice('voice') }),
      }
    }
    case 'imageGeneration': {
      // Every image, whatever the backend or permission mode: what is made,
      // from what, and that the key pays for it (M34, M44).
      const sources = request.sources.join(', ')
      return {
        title: fill(request.kind === 'edit' ? UI_TEXT.imageBuyEditTitle : UI_TEXT.imageBuyTitle, {
          path: request.path,
        }),
        detail: [
          fill(UI_TEXT.imageBuyPrompt, { prompt: request.prompt }),
          ...(sources === '' ? [] : [fill(UI_TEXT.imageBuySources, { paths: sources })]),
          fill(UI_TEXT.imageBuyBilling, { price: paidFeaturePrice('imageGeneration') }),
        ].join('\n\n'),
      }
    }
    case 'scheduledPrompts': {
      if (request.schedule !== undefined) {
        const scope = request.schedule
        return {
          title: fill(UI_TEXT.paidConfirmTitle, { feature: UI_TEXT.paidScheduledName }),
          detail:
            fill(UI_TEXT.scheduleV2.messages.paidConsent, {
              prompt: request.prompt,
              model: request.modelId,
              price: scope.price,
              cadence: scope.cadence,
              cap: formatUsd(scope.dailyCapUsd, 2),
              budget: formatUsd(scope.sharedDailyBudgetUsd, 2),
            }) +
            (scope.extras.length === 0
              ? ''
              : `\n${scope.extras.map((feature) => `${paidFeatureName(feature)}: ${paidFeaturePrice(feature)}`).join(', ')}`),
        }
      }
      return {
        title: fill(UI_TEXT.scheduleRunConfirmTitle, { model: request.modelId }),
        detail: [
          fill(UI_TEXT.scheduleRunConfirmPrompt, { prompt: request.prompt }),
          fill(UI_TEXT.scheduleRunConfirmPrice, { price: scheduledRunPrice(request.modelId) }),
          UI_TEXT.scheduleRunConfirmExtras,
        ].join('\n\n'),
      }
    }
    case 'subagents': {
      const { task } = request
      return {
        title: fill(UI_TEXT.paidSubagentTaskTitle, { role: task.role }),
        detail: fill(UI_TEXT.paidSubagentTaskDetail, {
          objective: task.objective,
          price: subagentTaskPrice(task.modelId),
        }),
      }
    }
    case 'autoReviewer': {
      const price = autoReviewPrice(request.modelId, request.pricing)
      if (price === undefined) throw new Error(UI_TEXT.autoReviewerFailed)
      return {
        title: fill(UI_TEXT.paidUseAutoReviewerTitle, { tool: request.tool }),
        detail: fill(UI_TEXT.paidUseAutoReviewerDetail, {
          action: request.action,
          model: request.modelId,
          price,
        }),
      }
    }
    case 'legalExplanation': {
      const price = autoReviewPrice(request.modelId)
      if (price === undefined) throw new Error(UI_TEXT.subagentTariffUnknown)
      return {
        title: UI_TEXT.legalExplainPaid,
        detail: fill(UI_TEXT.legalExplainConsent, { price, model: request.modelId }),
      }
    }
    case 'bestOfN': {
      return {
        title: fill(UI_TEXT.paidBestOfNTitle, { attempts: formatNumber(request.attempts) }),
        detail: fill(UI_TEXT.paidBestOfNDetail, {
          prompt: request.prompt,
          price: bestOfNPrice(request.modelId, request.attempts, request.requestCeilingPerAttempt),
        }),
      }
    }
    case 'teamWorkers': {
      const { createTeamRuntime } = await import('../team/teamEntry')
      return createTeamRuntime(UI_TEXT, uiLocale()).teamWorkerQuestion(request)
    }
    case 'hookModels': {
      return {
        title: fill(UI_TEXT.paidHookModelTitle, { event: request.event }),
        detail: fill(UI_TEXT.paidHookModelDetail, {
          kind: request.kind,
          model: request.modelId,
          price:
            request.dailyBudgetUsd === undefined
              ? hookModelPrice(request.modelId)
              : `${hookModelPrice(request.modelId)} ${fill(UI_TEXT.paidHookModelDailyBudget, { budget: formatDailyBudget(request.dailyBudgetUsd) })}`,
        }),
      }
    }
    case 'tab': {
      // Tab bills the request's model per token (M94, PLAN.md D73): the
      // popup names its rates, today's budget and the training note. With no
      // budget set it says so instead of naming one. An unpriced model has
      // no rate to quote, so it never reaches a popup.
      const tier = modelApiPaidTier(request.modelId)
      if (tier === undefined) {
        throw new Error(UI_TEXT.subagentTariffUnknown)
      }
      const training = tier === 'contributor' ? UI_TEXT.tabTrainingContributor : ''
      if (Usd.from(request.budgetUsd).compare(Usd.from(0)) === 0) {
        return {
          title: UI_TEXT.paidUseTabTitle,
          detail: fill(UI_TEXT.paidUseTabDetailNoBudget, {
            model: request.modelId,
            price: scheduledRunPrice(request.modelId),
            training,
          }),
        }
      }
      return {
        title: UI_TEXT.paidUseTabTitle,
        detail: fill(UI_TEXT.paidUseTabDetail, {
          model: request.modelId,
          price: scheduledRunPrice(request.modelId),
          budget: formatUsd(request.budgetUsd, 2),
          training,
        }),
      }
    }
  }
}
