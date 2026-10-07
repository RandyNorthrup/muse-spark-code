import type { ScheduleEventSource } from '../../../shared/scheduleEvents'
import { ScheduleNetworkSource } from './network'
import { SchedulePlanSource } from './plan'
import { ScheduleSignalSource } from './signals'
import {
  unavailableSource,
  type ScheduleNetworkPort,
  type ScheduleSignalPort,
  type ScheduleSnapshotPort,
  type ScheduleWebhookPort,
} from './ports'

interface Dependencies {
  readonly plan?: ScheduleSnapshotPort
  readonly github?: ScheduleNetworkPort
  readonly gitlab?: ScheduleNetworkPort
  readonly stores?: ScheduleNetworkPort
  readonly resources?: ScheduleSignalPort
  readonly usage?: ScheduleSignalPort
  readonly team?: ScheduleSignalPort
  readonly questions?: ScheduleSignalPort
  readonly webhooks?: ScheduleWebhookPort
}
const REPOSITORY_EVENTS = [
  'pullRequestOpened',
  'pullRequestClosed',
  'pullRequestMerged',
  'reviewRequested',
  'ciFinished',
  'releasePublished',
  'issueLabelled',
  'issueOpened',
  'issueReplied',
] as const

/** Missing milestones are visible capabilities; none is silently simulated. */
export function scheduleDependencySources(
  ports: Dependencies,
  now: () => number,
  onRejected: (id: string) => void,
): readonly ScheduleEventSource[] {
  const webhook = ports.webhooks
  const authenticated: ScheduleSignalPort | undefined = webhook && {
    capability: () =>
      webhook.isAuthenticated() ? webhook.capability() : unavailableSource('M110 authentication'),
    subscribe: (listener) => webhook.subscribe(listener),
    history: (range) =>
      webhook.history?.(range) ?? Promise.resolve(unavailableSource('M110 history')),
  }
  return [
    new SchedulePlanSource(ports.plan, now),
    new ScheduleNetworkSource('github', REPOSITORY_EVENTS, ports.github),
    new ScheduleNetworkSource('gitlab', REPOSITORY_EVENTS, ports.gitlab),
    new ScheduleNetworkSource('stores', ['versionPublished'], ports.stores),
    new ScheduleSignalSource(
      'resources',
      ['resourceLevelChanged'],
      'M107 levels',
      ports.resources,
      onRejected,
    ),
    new ScheduleSignalSource(
      'usage',
      ['usageThresholdCrossed'],
      'M108 thresholds',
      ports.usage,
      onRejected,
    ),
    new ScheduleSignalSource(
      'team',
      ['taskFinished', 'teamFinished'],
      'M96 team',
      ports.team,
      onRejected,
    ),
    new ScheduleSignalSource(
      'questions',
      ['questionAnswered'],
      'M112 questions',
      ports.questions,
      onRejected,
    ),
    new ScheduleSignalSource(
      'webhooks',
      [...REPOSITORY_EVENTS, 'manual'],
      'M110 webhooks',
      authenticated,
      onRejected,
    ),
  ]
}
