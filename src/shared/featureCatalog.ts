import type { UiText } from './l10n/en'

// Documentation inventory. Availability is explicit until installed-host qualification.
interface Feature {
  readonly id: string
  readonly titleKey: keyof UiText['devices']
  readonly detailKey: keyof UiText['devices']
  readonly availability: 'unshipped'
}
export const FEATURE_CATALOG: readonly Feature[] = [
  { id: 'devices.setup', titleKey: 'title', detailKey: 'offHelp', availability: 'unshipped' },
  { id: 'devices.pair', titleKey: 'pair', detailKey: 'pairingHelp', availability: 'unshipped' },
  {
    id: 'devices.invitation',
    titleKey: 'copyInvitation',
    detailKey: 'scan',
    availability: 'unshipped',
  },
  {
    id: 'devices.confirmation',
    titleKey: 'copyConfirmation',
    detailKey: 'compare',
    availability: 'unshipped',
  },
  { id: 'devices.offer', titleKey: 'offer', detailKey: 'grantHelp', availability: 'unshipped' },
  {
    id: 'devices.checks',
    titleKey: 'offerChecks',
    detailKey: 'scopeHelp',
    availability: 'unshipped',
  },
  { id: 'devices.caps', titleKey: 'saveOffer', detailKey: 'capHelp', availability: 'unshipped' },
  {
    id: 'devices.discovery',
    titleKey: 'discovery',
    detailKey: 'discoveryDescription',
    availability: 'unshipped',
  },
  {
    id: 'devices.address',
    titleKey: 'manualAddress',
    detailKey: 'blockedHelp',
    availability: 'unshipped',
  },
  {
    id: 'devices.approval',
    titleKey: 'waitingApproval',
    detailKey: 'localApprovalHelp',
    availability: 'unshipped',
  },
  { id: 'devices.costs', titleKey: 'payer', detailKey: 'costOwnership', availability: 'unshipped' },
  {
    id: 'devices.status',
    titleKey: 'lastObservation',
    detailKey: 'observationHelp',
    availability: 'unshipped',
  },
  { id: 'devices.pause', titleKey: 'pause', detailKey: 'capacityHelp', availability: 'unshipped' },
  {
    id: 'devices.resume',
    titleKey: 'resume',
    detailKey: 'unresolvedHelp',
    availability: 'unshipped',
  },
  {
    id: 'devices.route',
    titleKey: 'rolesModels',
    detailKey: 'scopeHelp',
    availability: 'unshipped',
  },
  {
    id: 'devices.results',
    titleKey: 'taskBranch',
    detailKey: 'scopeHelp',
    availability: 'unshipped',
  },
  { id: 'devices.unlink', titleKey: 'unlink', detailKey: 'unlinkHelp', availability: 'unshipped' },
  {
    id: 'devices.hosts',
    titleKey: 'offer',
    detailKey: 'unsupportedHost',
    availability: 'unshipped',
  },
]
