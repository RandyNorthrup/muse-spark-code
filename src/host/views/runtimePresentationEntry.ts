import type {
  RuntimeFeatureContext,
  RuntimePresentationContribution,
} from '../../runtime/panel/runtimeFeatures'
import type { UiText } from '../../shared/l10n/en'
import { setUiText } from '../../shared/l10n/text'
import { PortableTasks } from './portableTasks'

/** Same-build lazy factory: install this bundle's language before constructing views. */
export function createRuntimePresentation(
  context: RuntimeFeatureContext,
  table: UiText,
  locale: string,
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
  const dispose = () => tasks.dispose()
  context.own(dispose)
  return Promise.resolve({
    features: { tasksTab: tasks },
    view: (binding) => tasks.view(binding),
    dispose,
  })
}
