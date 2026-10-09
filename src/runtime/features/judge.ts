import { judgeWindowPort, type JudgeWindowDeps } from '../../host/judge/judgeBundle'
import type { JudgeEntryParts } from '../../core/judge/entries'
import type { JudgeTokenPrices } from '../../core/judge/admission'
import type { ResponseAttemptGuard } from '../../core/backends/modelapi/client'
import { nonnegativeUsdSchema } from '../../shared/usdSchema'
import { UI_TEXT } from '../../shared/constants'
import type { UiText } from '../../shared/l10n/en'
import { setUiText } from '../../shared/l10n/text'
import { logRejection } from '../../host/logger'
import { runtimeFeatureLifetime } from './lifetime'

export interface RuntimeJudgeDeps extends JudgeWindowDeps {
  readonly bundlePath: string
  readonly loadBundle?: ((file: string) => unknown) | undefined
  readonly priceOf: (modelId: string) => JudgeTokenPrices | undefined
  /** Selected captured support for this stated-confidence/cache/request mode. */
  readonly canJudge: (modelId: string, backend: 'museCode' | 'modelApi') => boolean
  readonly assertCurrent: () => void
  readonly cancelNative: () => void
  readonly drainNative: () => Promise<void>
}

/** The existing advisory source stays lazy and drains before its native services or ledger. */
export function createRuntimeJudge(deps: RuntimeJudgeDeps, table: UiText, locale: string) {
  setUiText(table, locale)
  const lifetime = runtimeFeatureLifetime(deps.assertCurrent, deps.cancelNative)
  const context = (action: JudgeEntryParts) => {
    try {
      lifetime.check()
      const current = deps.context(action)
      if (current === undefined || !deps.canJudge(current.modelId, current.backend)) return
      if (current.backend === 'modelApi') {
        const price = deps.priceOf(current.modelId)
        if (
          price === undefined ||
          Object.values(price).some((rate) => !nonnegativeUsdSchema.safeParse(rate).success)
        )
          return
      }
      return current
    } catch {
      return
    }
  }
  const check = (modelId: string, backend: 'museCode' | 'modelApi') => {
    lifetime.check()
    if (!deps.canJudge(modelId, backend)) throw new Error(UI_TEXT.judgeStatusUnavailable)
  }
  const deliver = (work: () => void) => {
    try {
      lifetime.check()
    } catch {
      return
    }
    work()
  }
  const port = judgeWindowPort({
    ...deps,
    context,
    engine: () => {
      try {
        lifetime.check()
        return deps.engine()
      } catch {
        return 'off'
      }
    },
    startSession: async (options) => {
      check(options.modelId, 'museCode')
      const session = await deps.startSession(options)
      try {
        check(options.modelId, 'museCode')
      } catch (error: unknown) {
        session.dispose()
        throw error
      }
      return session
    },
    modelApi: (action) => {
      const current = context(action)
      if (current === undefined) return
      const connection = deps.modelApi(action)
      if (connection === undefined) return
      return {
        ...connection,
        transport: {
          send: async (body, signal, guard) => {
            const beforeSend: ResponseAttemptGuard = Object.assign(
              (digest: string | undefined) => {
                check(body.model, 'modelApi')
                guard?.(digest)
              },
              {
                onRequestStarted: () => {
                  check(body.model, 'modelApi')
                  guard?.onRequestStarted?.()
                },
              },
            )
            return await connection.transport.send(
              body,
              AbortSignal.any([signal, lifetime.signal]),
              beforeSend,
            )
          },
        },
      }
    },
    emit: (action, event) => {
      deliver(() => {
        deps.emit(action, event)
      })
    },
    status: (action, status) => {
      deliver(() => {
        deps.status(action, status)
      })
    },
    notice: (text) => {
      deliver(() => {
        deps.notice(text)
      })
    },
  })
  let closing: Promise<void> | undefined
  const dispose = () => {
    port.dispose()
    closing ??= (async () => {
      try {
        await lifetime.dispose()
        await port.settled?.()
      } finally {
        await deps.drainNative()
      }
    })()
    return closing
  }
  return {
    judge: {
      ...port,
      start: (action: JudgeEntryParts, text: string) =>
        context(action) === undefined ? undefined : port.start(action, text),
      dispose: () => {
        void dispose().catch(logRejection(deps.log, 'portable Judge release'))
      },
    },
    dispose,
  }
}
