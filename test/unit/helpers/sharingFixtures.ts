import type { ItemSnapshot } from '../../../src/shared/agentEvents'
import type { SavedPrompt } from '../../../src/shared/prompts'
import type { TranscriptEntry } from '../../../src/webview/state/transcriptEntries'

export const savedPromptFixture: SavedPrompt = {
  schemaVersion: 1,
  id: 'prompt-a',
  title: 'Review a selection',
  body: 'Review {{selection}} in {{file}} with {{clipboard}} for {{audience}}.\n\n```ts\nconst n = 1\n```\n',
  tags: ['review', '日本語'],
  variables: [
    { name: 'selection', source: 'selection' },
    { name: 'file', source: 'file' },
    { name: 'clipboard', source: 'clipboard' },
    { name: 'audience', source: 'input' },
  ],
  scope: 'user',
  createdAt: '2026-10-05T10:00:00Z',
  updatedAt: '2026-10-05T11:00:00Z',
  untrusted: false,
}

// A new webview union member requires a fixture here at typecheck time.
export const transcriptKindFixtures: Record<TranscriptEntry['kind'], TranscriptEntry> = {
  user: {
    kind: 'user',
    id: 'u1',
    seq: 1,
    text: 'Please review.\n```ts\nconst n = 1\n```',
    status: 'sent',
    attachments: [{ id: 'a1', name: 'notes.txt' }],
  },
  assistant: { kind: 'assistant', id: 'a1', text: 'Here is the review.', isStreaming: false },
  reasoning: {
    kind: 'reasoning',
    id: 'r1',
    parts: ['Private thought'],
    isStreaming: false,
    startedAt: 1,
  },
  tool: {
    kind: 'tool',
    id: 't1',
    tool: 'edit_file',
    args: '{}',
    status: 'completed',
    output: 'Tool output',
    isBackground: false,
    patchRef: { id: 'patch', byteLen: 1 },
    approvalOutcome: { decision: 'allow', resolvedBy: 'user' },
  },
  userShell: {
    kind: 'userShell',
    id: 's1',
    command: 'pwd',
    status: 'completed',
    output: 'Shell output',
  },
  subagent: {
    kind: 'subagent',
    id: 'sub1',
    seq: 2,
    status: 'completed',
    resultText: 'Child output',
  },
  workflow: {
    kind: 'workflow',
    id: 'w1',
    status: 'completed',
    children: [],
    message: 'Workflow output',
  },
  item: { kind: 'item', id: 'i1', itemKind: 'checkpoint', status: 'completed', text: 'Checkpoint' },
  teamPlan: { kind: 'teamPlan', id: 'tp1', status: 'completed', dryRun: true, items: [] },
  teamSwitch: {
    kind: 'teamSwitch',
    id: 'ts1',
    status: 'completed',
    roleId: 'engineering',
    fromEntry: 'entry1',
    toEntry: 'entry2',
    reason: 'cap',
  },
  teamWaiting: {
    kind: 'teamWaiting',
    id: 'tw1',
    status: 'inProgress',
    waitingId: 'wait1',
    roleId: 'engineering',
    brief: 'Run checks',
    reasonText: 'Entry capped',
  },
  teamMerge: {
    kind: 'teamMerge',
    id: 'tm1',
    status: 'inProgress',
    taskId: 'task1',
    roleId: 'engineering',
    brief: 'Review changes',
    branch: 'agents/engineering/task1',
    filesChanged: 1,
    affectedFiles: ['src/main.ts'],
    protectedPaths: [],
    review: 'reviewed',
  },
  teamReport: {
    kind: 'teamReport',
    id: 'tr1',
    status: 'completed',
    taskId: 'task1',
    roleId: 'engineering',
    brief: 'Run checks',
    summary: 'Checks passed',
  },
  error: { kind: 'error', id: 'e1', text: 'Error detail' },
  notice: { kind: 'notice', id: 'n1', level: 'info', text: 'Notice detail' },
}

/** Our existing snapshot schema is open-ended; these are fake history, not wire captures. */
export const snapshotKindFixtures: readonly ItemSnapshot[] = [
  { itemId: 'u1', kind: 'userMessage', status: 'completed', text: 'User text' },
  { itemId: 'a1', kind: 'agentMessage', status: 'completed', text: 'Assistant text' },
  ...[
    'toolCall',
    'userShell',
    'reasoning',
    'subagent',
    'workflow',
    'approval',
    'decision',
    'diff',
    'checkpoint',
    'notice',
    'command',
    'system',
    'internal',
    'reminderChild',
    'futureDummy',
  ].map((kind) => ({ itemId: kind, kind, status: 'completed', text: 'Excluded fake text' })),
]

export const shareChatFixture = {
  schemaVersion: 1,
  target: 'chat',
  title: 'A review',
  createdAt: '2026-10-05T12:00:00Z',
  scrubbed: true,
  mode: 'conversation',
  options: { codeBlocks: true, attachmentNames: true, diffs: false, attachmentContents: [] },
  items: [
    {
      id: 'u1',
      kind: 'userMessage',
      text: 'Review this.',
      attachments: [{ id: 'attach1', name: 'notes.txt' }],
    },
    { id: 'a1', kind: 'agentMessage', text: 'Review complete.' },
  ],
} as const
