// C-M115-9: the native panel's schedules bundle entry.
// dist/runtimePanelSchedules.js: the runtime schedules binding behind the
// same session factory and engine module the ACP agent uses, loaded on the
// first native schedule hold, never with the panel.
import path from 'node:path'
import type { AcpBackend } from '../acp/agent'
import type { Logger } from '../host/logger'
import { UI_TEXT } from '../shared/constants'
import { uiLocale } from '../shared/l10n/text'
import type { RuntimeBackend } from './backends'
import { runtimeScheduleSessionFactory } from './schedules/sessionFactory'
import { runtimeSchedulesBinding, type RuntimeSchedulesBinding } from './schedules/binding'

export { createPanelScheduleHold } from './panel/panelSchedules'

export interface PanelSchedulesBindingInput {
  readonly distDir: string
  readonly dataDir: string
  readonly log: Logger
  readonly allowsContributorModels: boolean
  readonly current: RuntimeBackend
  readonly create: (backend: AcpBackend['kind']) => Promise<RuntimeBackend>
}

export async function loadPanelSchedulesBinding(
  input: PanelSchedulesBindingInput,
): Promise<RuntimeSchedulesBinding> {
  const engineModule = await import('./runtimeEngineEntry')
  engineModule.setUiText(UI_TEXT, uiLocale())
  const sessions = runtimeScheduleSessionFactory({
    create: input.create,
    current: input.current,
    distDir: input.distDir,
    dataDir: input.dataDir,
    log: input.log,
    allowsContributorModels: input.allowsContributorModels,
  })
  const load = runtimeSchedulesBinding(
    path.join(input.distDir, 'schedules.js'),
    input.log,
    undefined,
    undefined,
    sessions.ports,
    undefined,
    {
      createRuntimeScheduleDelivery: engineModule.createRuntimeScheduleDelivery,
      setUiText: engineModule.setUiText,
    },
  )
  return await load()
}
