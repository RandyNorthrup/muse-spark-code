import type {
  RuntimeFeatureContext,
  RuntimeFeatureFactories,
  RuntimePresentationContribution,
} from '../../runtime/panel/runtimeFeatures'
import type { UiText } from '../../shared/l10n/en'
import { setUiText } from '../../shared/l10n/text'
import { PortableTasks } from './portableTasks'
import { PortableWhatsNew, type PortableWhatsNewDeps } from '../whatsNew/portableWhatsNew'
import { createPortableReports, type PortableReportDeps } from '../support/portableReports'

export interface RuntimePresentationOptions {
  readonly whatsNew?: Omit<PortableWhatsNewDeps, 'host' | 'sessionId' | 'log'>
  readonly reports?: {
    readonly deps: Omit<PortableReportDeps, 'host' | 'own'>
    /** Queue the existing openReport flow after the conversation's UI is ready. */
    readonly onCrashOffer: () => void
  }
  readonly onSurfaceClosed?: (listener: (id: string) => void) => () => void
}

/** Same-build lazy factory: install this bundle's language before constructing views. */
export function createRuntimePresentation(
  context: RuntimeFeatureContext,
  table: UiText,
  locale: string,
): Promise<RuntimePresentationContribution> {
  return constructPresentation(context, table, locale, {})
}

/** A's loader supplies installed assets, local report facts and native save/HTML operations. */
export function createRuntimePresentationFactory(
  configure: (context: RuntimeFeatureContext) => RuntimePresentationOptions,
): NonNullable<RuntimeFeatureFactories['presentation']> {
  return async (context, table, locale) => {
    // Configuration can read localized titles before constructing its ports.
    setUiText(table, locale)
    return await constructPresentation(context, table, locale, configure(context))
  }
}

async function constructPresentation(
  context: RuntimeFeatureContext,
  table: UiText,
  locale: string,
  options: RuntimePresentationOptions,
): Promise<RuntimePresentationContribution> {
  setUiText(table, locale)
  const { ports } = context
  const tasks = new PortableTasks(
    ports.host,
    () => ports.surface.takeRestoredSessionId() ?? ports.surface.id,
    () => {
      ports.surface.reveal()
    },
    ports.log,
    (text) => {
      ports.surface.post({ type: 'notice', level: 'warning', text })
    },
  )
  const disposeTasks = () => tasks.dispose()
  const cleanups = [disposeTasks]
  context.own(disposeTasks)
  const whatsNew =
    options.whatsNew === undefined
      ? undefined
      : new PortableWhatsNew({
          ...options.whatsNew,
          host: ports.host,
          sessionId: () => ports.surface.takeRestoredSessionId() ?? ports.surface.id,
          log: ports.log,
        })
  if (whatsNew !== undefined) {
    const disposeWhatsNew = () => whatsNew.dispose()
    cleanups.push(disposeWhatsNew)
    context.own(disposeWhatsNew)
  }
  if (options.onSurfaceClosed !== undefined) {
    const stop = options.onSurfaceClosed((id) => {
      tasks.closed(id)
      whatsNew?.closed(id)
    })
    let isStopped = false
    const stopListening = () => {
      if (!isStopped) {
        isStopped = true
        stop()
      }
      return Promise.resolve()
    }
    cleanups.push(stopListening)
    context.own(stopListening)
  }
  let reports: Awaited<ReturnType<typeof createPortableReports>> | undefined
  if (options.reports !== undefined) {
    reports = await createPortableReports({
      ...options.reports.deps,
      host: ports.host,
      own: (dispose) => {
        context.own(dispose)
      },
    })
    cleanups.push(reports.dispose)
    if (reports.offerReport) options.reports.onCrashOffer()
  }
  let disposal: Promise<void> | undefined
  return {
    features: { tasksTab: tasks, ...(reports !== undefined && { reports: reports.reports }) },
    ...(whatsNew !== undefined && { actions: { showWhatsNew: () => whatsNew.show() } }),
    view: (binding) => tasks.view(binding) ?? whatsNew?.view(binding),
    dispose: () => {
      disposal ??= (async () => {
        const results = await Promise.allSettled(cleanups.map((dispose) => dispose()))
        if (results.some((result) => result.status === 'rejected'))
          throw new Error('MHP_PRESENTATION_CLEANUP_FAILED')
      })()
      return disposal
    },
  }
}
