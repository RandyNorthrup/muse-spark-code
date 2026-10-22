import { namedBundleLoader, type LazyBundleLoaderOptions } from '../../host/lazyBundle'
import { UI_TEXT } from '../../shared/constants'
import type * as InputsBundle from './playbookSchedulesInputsEntry'

type Bundle = typeof InputsBundle

export function playbookSchedulesInputsLoader(
  deps: Pick<LazyBundleLoaderOptions<Bundle>, 'bundlePath' | 'log' | 'loadBundle'>,
): () => Bundle {
  return namedBundleLoader({
    ...deps,
    names: [
      'createPlaybookReportReader',
      'createPlaybookReportOrder',
      'createSchedulesReportReader',
    ],
    label: 'report playbook and schedules inputs',
    unavailable: () => UI_TEXT.reportUi.generationFailed,
  })
}
