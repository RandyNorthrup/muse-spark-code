// M115 fake-only scenes, running the shipped lazy component and its injected ports.
export const SCHEDULE_SCENES = [
  'schedules-v2-list',
  'schedules-v2-list-narrow',
  'schedules-v2-editor',
  'schedules-v2-editor-narrow',
  'schedules-v2-timeline',
  'schedules-v2-timeline-narrow',
  'schedule-settlements',
  'schedule-settlements-narrow',
]

async function playScheduleHarness() {
  const { mountScheduleSurface } = await import('../../temp/m115-v/surface/ScheduleSurface.js')
  const scenario = new globalThis.URLSearchParams(globalThis.location.search).get('scenario') ?? ''
  if (scenario.endsWith('-narrow')) {
    if (globalThis.innerWidth !== 320) throw new Error(`${scenario} requires 320 px`)
    globalThis.document.documentElement.style.width = '100%'
    globalThis.document.body.style.width = '100%'
  }
  const nowMs = Date.parse('2026-10-06T12:00:00Z')
  const draft = {
    name: 'Check the build',
    action: { kind: 'prompt', prompt: 'Read the build result and report any failures.' },
    trigger: {
      kind: 'weekly',
      days: [
        { weekday: 1, times: [{ hour: 9, minute: 0 }] },
        { weekday: 5, times: [{ hour: 16, minute: 30 }] },
      ],
    },
    target: { kind: 'conversation', backend: 'modelApi', sessionId: 'build-session' },
    delivery: 'interrupt',
    whenClosed: 'open',
    catchUp: 'runOnce',
    mode: 'manual',
    grant: {
      rules: [{ id: 'read-src', kind: 'path', glob: 'src/**', access: 'read' }],
      destinationIds: [],
      paidCapUsd: 1,
    },
    paidCapUsd: 1,
    parallel: false,
    zone: 'America/Los_Angeles',
    end: { afterRuns: 20 },
    pinned: false,
  }
  const schedules = [0, 1].map((index) => ({
    ...draft,
    id: `schedule-${String(index)}`,
    name: index === 0 ? draft.name : 'Review build warnings',
    version: 2,
    revision: 2,
    workspaceKey: 'workspace-1',
    paused: false,
    createdAtMs: nowMs + index,
    updatedAtMs: nowMs,
    nextFireAtMs: nowMs + 60_000,
    fireCount: 2,
    consecutiveFailures: 0,
    depth: 0,
    allowAgentReschedule: false,
    creator: {
      kind: 'agent',
      agentId: 'lead',
      sessionId: 'planning-session',
      orchestratorId: 'orchestrator',
    },
  }))
  const port = {
    request: async (input) => {
      switch (input.method) {
        case 'schedules/list': {
          return { kind: 'list', schedules }
        }
        case 'schedules/eventSources': {
          return {
            kind: 'eventSources',
            sources: [
              {
                id: 'git',
                kinds: ['branchUpdated', 'tagCreated'],
                capability: { available: true },
              },
              {
                id: 'github',
                kinds: ['pullRequestMerged'],
                capability: { available: false, reason: 'Reports network sources unavailable' },
              },
            ],
          }
        }
        case 'schedules/timeline': {
          return {
            kind: 'timeline',
            entries: schedules.map((schedule) => ({
              scheduleId: schedule.id,
              atMs: schedule.nextFireAtMs,
              target: schedule.target,
              creator: schedule.creator,
              collisionIds: schedules
                .filter((item) => item.id !== schedule.id)
                .map((item) => item.id),
            })),
          }
        }
        case 'schedules/grantAudit': {
          return {
            kind: 'grantAudit',
            scheduleId: input.id,
            entries: [
              { scheduleId: input.id, kind: 'created', atMs: nowMs },
              {
                scheduleId: input.id,
                kind: 'used',
                atMs: nowMs + 1000,
                ruleId: 'read-src',
                runId: 'schedule:occurrence',
                actionClass: 'edit',
              },
            ],
          }
        }
        case 'schedules/historyPreview': {
          return {
            kind: 'historyPreview',
            trigger: input.trigger,
            range: input.range,
            preview: { available: false, reason: 'No retained history' },
          }
        }
        case 'schedules/backgroundStatus': {
          return { kind: 'backgroundStatus', status: { registered: false } }
        }
        default: {
          return { kind: 'refused', reason: 'Harness controls do not run schedules' }
        }
      }
    },
    preview: async () => ({
      available: true,
      times: [nowMs, nowMs + 60_000, nowMs + 120_000, nowMs + 180_000, nowMs + 240_000],
    }),
  }
  let initialView = 'list'
  if (scenario.includes('editor')) initialView = 'editor'
  else if (scenario.includes('timeline')) initialView = 'timeline'
  mountScheduleSurface(globalThis.document.querySelector('#root'), {
    workspaceKey: 'workspace-1',
    port,
    defaultDraft: draft,
    nowMs,
    initialView,
    targets: [
      {
        id: 'current',
        label: 'Build conversation',
        target: draft.target,
        capability: { available: true },
      },
      {
        id: 'fresh',
        label: 'New conversation',
        target: { kind: 'newConversation', backend: 'modelApi' },
        capability: { available: true },
      },
      {
        id: 'team',
        label: 'Team',
        target: { kind: 'team', teamId: 'build-team' },
        capability: { available: false, reason: 'Teams unavailable' },
      },
    ],
  })
  if (initialView !== 'list') return
  const openAudit = () => {
    const card = globalThis.document.querySelector('.schedule-v2-card')
    if (card === null) {
      globalThis.setTimeout(openAudit, 100)
      return
    }
    for (const details of card.querySelectorAll('details')) details.open = true
  }
  openAudit()
}

if (globalThis.document !== undefined) await playScheduleHarness()
