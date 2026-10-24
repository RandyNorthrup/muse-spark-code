// One single-choice pick in the editor (MHP `ui/pick`) for the host flows that
// take a `PickOne`: the review's commit pick and the Plans… list (M104 lane B).
// A closed pick is no choice; `signal` ends the question with the conversation.
import type { PickOne } from '../../host/commands/pickItem'
import type { HostServices } from '../../shared/hostApi/methods'

export function editorPick(host: HostServices, signal: AbortSignal): PickOne {
  return async (items, title, placeholder) => {
    const picked = await host.request(
      'ui/pick',
      {
        title,
        placeholder,
        items: items.map((item) => ({
          id: item.id,
          title: item.label,
          ...(item.description !== undefined && { description: item.description }),
          ...(item.detail !== undefined && { detail: item.detail }),
        })),
        multiple: false,
      },
      signal,
    )
    return typeof picked?.[0] === 'string' ? picked[0] : undefined
  }
}
