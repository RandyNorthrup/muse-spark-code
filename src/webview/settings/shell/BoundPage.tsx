// Muse Desktop (M111, D91.16) lane ST1: a bound page. The binding reads
// the page's state, draws it, and carries each confirmed change back to
// the service; the frame owns loading, errors and the re-read.

import { useCallback, type ReactNode } from 'react'
import type { SettingsSystemClient } from '../../../shared/desktop/settings'
import type { PageBinding } from '../system/binding'
import { PageFrame, runPageApply } from '../system/frame'

export function BoundPage<Data, Change>({
  binding,
  client,
}: {
  readonly binding: PageBinding<Data, Change>
  readonly client: SettingsSystemClient
}): ReactNode {
  const load = useCallback(() => binding.load(client), [binding, client])
  return (
    <PageFrame load={load}>
      {(data, report) =>
        binding.render(data, (change) => {
          void runPageApply(report, () => binding.apply(client, change))
        })
      }
    </PageFrame>
  )
}
