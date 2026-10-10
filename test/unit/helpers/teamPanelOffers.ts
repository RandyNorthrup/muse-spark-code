import type { TeamPanelOffer } from '../../../src/shared/teamPanel'
import { UI_TEXT } from '../../../src/shared/constants'

export function teamOffers(): TeamPanelOffer[] {
  return ['main', 'reviewer'].map((id, index) => ({
    ref: `${id}/${id}`,
    label: id,
    agent: { kind: 'engine', agentId: id, model: id, provider: id, pays: 'key' },
    toolCalling: true,
    contextWindow: 131_072,
    imageInput: true,
    reasoning: true,
    inputRate: 1,
    outputRate: 2,
    cachedRate: 0.1,
    ceiling: 8,
    controls: [
      {
        key: 'effort',
        label: UI_TEXT.effortItem,
        note: UI_TEXT.teamSettingCostEffort,
        kind: 'choice',
        choices: index === 0 ? ['low', 'medium', 'high'] : ['medium', 'high'],
      },
    ],
  }))
}
