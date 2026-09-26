import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { formAnswers, questionForm, questionsText } from '../../src/acp/questions'
import {
  approvalToolCall,
  decidedChoice,
  permissionOptions,
  promptParts,
  toolKind,
  toolName,
  UpdateTranslator,
} from '../../src/acp/translate'
import type { ApprovalChoice, ItemSnapshot, Question } from '../../src/shared/agentEvents'
import {
  ACP_TOOL_OUTPUT_MAX_CHARS,
  SELECTION_TEXT_MAX_CHARS,
  UI_TEXT,
} from '../../src/shared/constants'

// M63 (PLAN.md D62): what an ACP client sees of the panel's events, prompts,
// approvals and questions.

const CWD = path.resolve('/work/app')
// A 1×1 PNG.
const PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

function tool(overrides: Partial<ItemSnapshot>): ItemSnapshot {
  return {
    itemId: 't1',
    kind: 'toolCall',
    status: 'inProgress',
    tool: 'powershell',
    args: JSON.stringify({ command: 'npm test', description: 'Run the tests' }),
    ...overrides,
  }
}

describe('UpdateTranslator', () => {
  it('announces a tool call once, streams nothing of its output, and sends it whole at the end', () => {
    const translator = new UpdateTranslator(CWD, false)
    expect(translator.updates({ type: 'itemStarted', item: tool({}) })).toEqual([
      {
        sessionUpdate: 'tool_call',
        toolCallId: 't1',
        title: 'PowerShell: Run the tests',
        kind: 'execute',
        status: 'in_progress',
        locations: [],
        rawInput: { command: 'npm test', description: 'Run the tests' },
      },
    ])
    expect(
      translator.updates({ type: 'textDelta', itemId: 't1', field: 'output', delta: 'ok ' }),
    ).toEqual([])
    translator.updates({ type: 'textDelta', itemId: 't1', field: 'output', delta: '12 tests' })
    expect(translator.updates({ type: 'itemUpdated', item: tool({}) })).toEqual([
      { sessionUpdate: 'tool_call_update', toolCallId: 't1', status: 'in_progress' },
    ])
    expect(
      translator.updates({ type: 'itemCompleted', item: tool({ status: 'completed' }) }),
    ).toEqual([
      {
        sessionUpdate: 'tool_call_update',
        toolCallId: 't1',
        status: 'completed',
        content: [{ type: 'content', content: { type: 'text', text: 'ok 12 tests' } }],
      },
    ])
  })

  it('shows an edit as a diff with its absolute path, a new file with no old text', () => {
    const translator = new UpdateTranslator(CWD, false)
    const edit = tool({
      tool: 'edit_file',
      status: 'completed',
      args: JSON.stringify({ path: 'src/a.ts', old_str: 'x', new_str: 'y' }),
      visibleOutput: 'Edited src/a.ts',
    })
    const [announced, finished] = translator.updates({ type: 'itemCompleted', item: edit })
    expect(announced).toMatchObject({
      sessionUpdate: 'tool_call',
      kind: 'edit',
      title: 'Edit: src/a.ts',
      status: 'completed',
      locations: [{ path: path.join(CWD, 'src/a.ts') }],
    })
    expect(finished).toMatchObject({
      content: [
        { type: 'diff', path: path.join(CWD, 'src/a.ts'), oldText: 'x', newText: 'y' },
        { type: 'content', content: { type: 'text', text: 'Edited src/a.ts' } },
      ],
    })
    const write = tool({
      itemId: 't2',
      tool: 'write_file',
      status: 'completed',
      args: JSON.stringify({ path: 'new.ts', content: 'hello' }),
    })
    expect(translator.updates({ type: 'itemCompleted', item: write })[1]).toMatchObject({
      content: [{ type: 'diff', path: path.join(CWD, 'new.ts'), oldText: null, newText: 'hello' }],
    })
    const patch = tool({
      itemId: 't3',
      tool: 'apply_patch',
      status: 'completed',
      args: JSON.stringify({ path: 'a.ts' }),
    })
    expect(translator.updates({ type: 'itemCompleted', item: patch })[1]).toMatchObject({
      content: [],
    })
  })

  it('fails a declined or failed call with its reason, clipped output and all', () => {
    const translator = new UpdateTranslator(CWD, false)
    const long = 'x'.repeat(ACP_TOOL_OUTPUT_MAX_CHARS + 10)
    const [, failed] = translator.updates({
      type: 'itemCompleted',
      item: tool({ status: 'failed', visibleOutput: long, failureReason: 'exit code 1' }),
    })
    expect(failed).toMatchObject({ status: 'failed' })
    const content = failed?.sessionUpdate === 'tool_call_update' ? failed.content : undefined
    expect(content?.[1]).toEqual({
      type: 'content',
      content: { type: 'text', text: 'exit code 1' },
    })
    const first = content?.[0]
    expect(
      first?.type === 'content' && first.content.type === 'text' ? first.content.text.length : 0,
    ).toBe(ACP_TOOL_OUTPUT_MAX_CHARS)
    // Muse Code's `declined` and the Model API backend's `rejected` are the user's no.
    for (const status of ['declined', 'rejected']) {
      const [, denied] = translator.updates({
        type: 'itemCompleted',
        item: tool({ itemId: status, status }),
      })
      expect(denied).toMatchObject({ status: 'failed' })
    }
  })

  it('shows a user shell command, a subagent and arguments that are not JSON', () => {
    const translator = new UpdateTranslator(CWD, false)
    expect(
      translator.updates({
        type: 'itemStarted',
        item: { itemId: 's1', kind: 'userShell', status: 'inProgress', args: 'ls -la' },
      })[0],
    ).toMatchObject({ title: 'Shell', kind: 'execute', rawInput: 'ls -la' })
    const subagent: ItemSnapshot = {
      itemId: 'g1',
      kind: 'subagent',
      status: 'completed',
      objective: 'Map the workspace',
      result: { summary: 'Mapped' },
    }
    expect(translator.updates({ type: 'itemCompleted', item: subagent })).toMatchObject([
      { title: 'Spawn agent: Map the workspace', kind: 'other' },
      { rawOutput: { summary: 'Mapped' } },
    ])
  })

  it('streams reasoning as thoughts, a new summary part after a blank line', () => {
    const translator = new UpdateTranslator(CWD, false)
    translator.updates({
      type: 'itemStarted',
      item: { itemId: 'r1', kind: 'reasoning', status: 'inProgress' },
    })
    const deltas = [
      translator.updates({ type: 'textDelta', itemId: 'r1', field: 'summary.0', delta: 'First' }),
      translator.updates({ type: 'textDelta', itemId: 'r1', field: 'summary.0', delta: ' part' }),
      translator.updates({ type: 'textDelta', itemId: 'r1', field: 'summary.1', delta: 'Second' }),
    ].flat()
    expect(deltas.map((update) => update.sessionUpdate)).toEqual([
      'agent_thought_chunk',
      'agent_thought_chunk',
      'agent_thought_chunk',
    ])
    expect(deltas[2]).toMatchObject({ content: { text: '\n\nSecond' } })
    expect(
      translator.updates({
        type: 'itemCompleted',
        item: {
          itemId: 'r1',
          kind: 'reasoning',
          status: 'completed',
          summary: ['First part', 'Second'],
        },
      }),
    ).toEqual([])
    translator.updates({
      type: 'itemStarted',
      item: { itemId: 'r2', kind: 'reasoning', status: 'inProgress' },
    })
    expect(
      translator.updates({ type: 'textDelta', itemId: 'r2', field: 'text', delta: 'raw' }),
    ).toEqual([{ sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'raw' } }])
  })

  it('ignores deltas of items it does not stream and fields it does not know', () => {
    const translator = new UpdateTranslator(CWD, false)
    expect(
      translator.updates({ type: 'textDelta', itemId: 'nobody', field: 'text', delta: 'x' }),
    ).toEqual([])
    translator.updates({
      type: 'itemStarted',
      item: { itemId: 'm1', kind: 'agentMessage', status: 'inProgress' },
    })
    expect(
      translator.updates({ type: 'textDelta', itemId: 'm1', field: 'summary.0', delta: 'x' }),
    ).toEqual([])
    expect(
      translator.updates({ type: 'textDelta', itemId: 'm1', field: 'title', delta: 'x' }),
    ).toEqual([])
    expect(
      translator.updates({
        type: 'itemStarted',
        item: { itemId: 'k', kind: 'reminderChild', status: 'x' },
      }),
    ).toEqual([])
    expect(translator.updates({ type: 'turnStarted', turnId: 'turn-1' })).toEqual([])
  })

  it('replays the user’s messages only from a loaded history', () => {
    const user: ItemSnapshot = {
      itemId: 'u1',
      kind: 'userMessage',
      status: 'completed',
      text: 'Hi',
    }
    expect(new UpdateTranslator(CWD, false).itemUpdates(user, true)).toEqual([])
    expect(new UpdateTranslator(CWD, true).itemUpdates(user, true)).toEqual([
      { sessionUpdate: 'user_message_chunk', content: { type: 'text', text: 'Hi' } },
    ])
  })

  it('sends the session’s name, its context use, the backend’s notices and the todo list', () => {
    const translator = new UpdateTranslator(CWD, false)
    expect(translator.updates({ type: 'sessionNamed', name: 'Refactor' })).toEqual([
      { sessionUpdate: 'session_info_update', title: 'Refactor' },
    ])
    expect(
      translator.updates({
        type: 'contextUsage',
        usedTokens: 10,
        windowTokens: 100,
        pressure: 'low',
      }),
    ).toEqual([{ sessionUpdate: 'usage_update', used: 10, size: 100 }])
    expect(translator.updates({ type: 'contextUsage', usedTokens: 10, pressure: 'low' })).toEqual(
      [],
    )
    expect(translator.updates({ type: 'backendNotice', level: 'warning', text: 'Slow' })).toEqual([
      { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Slow\n\n' } },
    ])
    expect(
      translator.updates({
        type: 'todoChanged',
        items: [
          { text: 'A', status: 'pending' },
          { text: 'B', status: 'inProgress', activeForm: 'Doing B' },
          { text: 'C', status: 'done' },
        ],
      }),
    ).toEqual([
      {
        sessionUpdate: 'plan',
        entries: [
          { content: 'A', priority: 'medium', status: 'pending' },
          { content: 'Doing B', priority: 'medium', status: 'in_progress' },
          { content: 'C', priority: 'medium', status: 'completed' },
        ],
      },
    ])
  })
})

describe('tool names and kinds', () => {
  it('names a tool from the table, an MCP tool by its server, anything else as it came', () => {
    expect(toolName('read_file')).toBe('Read')
    expect(toolName('mcp__github__create_issue')).toBe('create_issue (github)')
    expect(toolName('mystery')).toBe('mystery')
  })

  it('gives each family its kind', () => {
    expect(
      [
        'bash',
        'code_exec',
        'edit_file',
        'generate_image',
        'read_file',
        'read_memory',
        'search',
        'web_search',
        'web_fetch',
        'todo_write',
        'mystery',
      ].map((name) => toolKind(name)),
    ).toEqual([
      'execute',
      'execute',
      'edit',
      'edit',
      'read',
      'read',
      'search',
      'search',
      'fetch',
      'think',
      'other',
    ])
  })
})

describe('approvals', () => {
  const choices: ApprovalChoice[] = [
    { choiceId: 'a1', label: 'Allow once', decision: 'approved', scope: 'once' },
    {
      choiceId: 'a2',
      label: 'Always',
      decision: 'approvedPolicyAmendment',
      scope: 'localPersistent',
    },
    { choiceId: 'd2', label: 'Never', decision: 'abort', scope: 'session' },
    { choiceId: 'd1', label: 'Reject', decision: 'abort', scope: 'once' },
  ]

  it('offers each choice under its own id, label and kind', () => {
    expect(permissionOptions(choices)).toEqual([
      { optionId: 'a1', name: 'Allow once', kind: 'allow_once' },
      { optionId: 'a2', name: 'Always', kind: 'allow_always' },
      { optionId: 'd2', name: 'Never', kind: 'reject_always' },
      { optionId: 'd1', name: 'Reject', kind: 'reject_once' },
    ])
  })

  it('decides with the picked choice, else the backend’s deny-once, else any deny, else none', () => {
    expect(
      decidedChoice({ outcome: { outcome: 'selected', optionId: 'a2' } }, choices)?.choiceId,
    ).toBe('a2')
    expect(decidedChoice({ outcome: { outcome: 'cancelled' } }, choices)?.choiceId).toBe('d1')
    expect(decidedChoice(undefined, choices.slice(0, 3))?.choiceId).toBe('d2')
    expect(decidedChoice(undefined, choices.slice(0, 2))).toBeUndefined()
  })

  it('titles the request by what it is about: the stages, the file, the host', () => {
    const base = {
      type: 'approvalRequested' as const,
      approvalId: 'x',
      itemId: 'i',
      toolName: 'bash',
      rawArgs: '{}',
      requirementId: { approvalId: 'x', sourceIndex: 0 },
      availableChoices: choices,
      isJudgeEscalated: false,
      isProtectedWrite: false,
    }
    const stages = [
      {
        requirementId: { approvalId: 'x', sourceIndex: 0 },
        position: 1,
        totalStages: 2,
        argv: ['git', 'add', '.'],
      },
      {
        requirementId: { approvalId: 'x', sourceIndex: 1 },
        position: 2,
        totalStages: 2,
        argv: ['git', 'commit'],
      },
    ]
    expect(approvalToolCall({ ...base, subject: { kind: 'command', stages } }, CWD).title).toBe(
      'Bash: git add . ; git commit',
    )
    expect(
      approvalToolCall(
        { ...base, toolName: 'write_file', subject: { kind: 'fileWrite', path: '.env' } },
        CWD,
      ).title,
    ).toBe('Write: .env')
    expect(
      approvalToolCall({ ...base, subject: { kind: 'network', host: 'example.com' } }, CWD).title,
    ).toBe('Bash: example.com')
    expect(
      approvalToolCall(
        { ...base, rawArgs: JSON.stringify({ path: 'a.ts' }), subject: { kind: 'other' } },
        CWD,
      ),
    ).toMatchObject({ title: 'Bash: a.ts', locations: [{ path: path.join(CWD, 'a.ts') }] })
  })
})

describe('promptParts', () => {
  it('takes text, images, links inside the folder as mentions and attached text as context', () => {
    const inside = pathToFileURL(path.join(CWD, 'src', 'app.ts')).href
    const outside = pathToFileURL(path.resolve('/elsewhere/x.ts')).href
    const result = promptParts(
      [
        { type: 'text', text: 'Look at' },
        { type: 'resource_link', uri: inside, name: 'app.ts' },
        { type: 'resource_link', uri: outside, name: 'x.ts' },
        { type: 'resource_link', uri: 'https://example.com/doc', name: 'doc' },
        {
          type: 'resource',
          resource: { uri: inside, text: 'y'.repeat(SELECTION_TEXT_MAX_CHARS + 5) },
        },
        { type: 'image', data: PNG, mimeType: 'image/png' },
      ],
      CWD,
    )
    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }
    expect(result.displayText).toBe('Look at')
    expect(result.parts.slice(0, 4)).toEqual([
      { type: 'text', text: 'Look at' },
      { type: 'text', text: '@src/app.ts' },
      { type: 'text', text: outside },
      { type: 'text', text: 'https://example.com/doc' },
    ])
    const attached = result.parts[4]
    expect(attached?.type === 'text' ? attached.text.length : 0).toBeLessThan(
      SELECTION_TEXT_MAX_CHARS + 100,
    )
    expect(result.parts[5]).toEqual({
      type: 'image',
      base64Data: PNG,
      mediaType: 'image/png',
      width: 1,
      height: 1,
    })
  })

  it('refuses a prompt with an image too large, a file that is not one, audio, or a link it cannot map', () => {
    const huge = Buffer.alloc(10 * 1024 * 1024 + 1).toString('base64')
    expect(promptParts([{ type: 'image', data: huge, mimeType: 'image/png' }], CWD)).toEqual({
      ok: false,
      reason: UI_TEXT.attachmentTooLarge,
    })
    expect(
      promptParts([{ type: 'resource', resource: { uri: 'file:///a.bin', blob: 'AAAA' } }], CWD),
    ).toEqual({ ok: false, reason: UI_TEXT.attachmentUnsupported })
    expect(promptParts([{ type: 'audio', data: 'AAAA', mimeType: 'audio/wav' }], CWD)).toEqual({
      ok: false,
      reason: UI_TEXT.attachmentUnsupported,
    })
    const share = 'file://server/share/x.ts'
    const mapped = promptParts([{ type: 'resource_link', uri: share, name: 'x' }], CWD)
    expect(mapped.ok && mapped.parts[0]?.type === 'text' ? mapped.parts[0].text : '').toMatch(
      /x\.ts/,
    )
  })
})

describe('questions', () => {
  const single: Question = {
    id: 'q1',
    header: 'Colour',
    question: 'Which one?',
    selection: { mode: 'single' },
    options: [{ label: 'Blue', description: 'the sea' }, { label: 'Red' }],
  }
  const multiple: Question = {
    id: 'q2',
    header: 'Parts',
    question: 'Which parts?',
    selection: { mode: 'multiple', minSelections: 1, maxSelections: 2 },
    options: [{ label: 'A' }, { label: 'B' }],
  }
  const open: Question = {
    id: 'q3',
    header: 'Name',
    question: 'What name?',
    selection: { mode: 'single' },
    options: [],
  }

  it('asks each question as a required field of the right kind', () => {
    expect(questionForm([single, multiple, open])).toEqual({
      type: 'object',
      properties: {
        q1: {
          type: 'string',
          title: 'Colour',
          description: 'Which one?',
          oneOf: [
            { const: 'Blue', title: 'Blue', description: 'the sea' },
            { const: 'Red', title: 'Red' },
          ],
        },
        q2: {
          type: 'array',
          title: 'Parts',
          description: 'Which parts?',
          items: {
            anyOf: [
              { const: 'A', title: 'A' },
              { const: 'B', title: 'B' },
            ],
          },
          minItems: 1,
          maxItems: 2,
        },
        q3: { type: 'string', title: 'Name', description: 'What name?' },
      },
      required: ['q1', 'q2', 'q3'],
    })
  })

  it('reads the answers: an option, several, free text, nothing for a missing field', () => {
    expect(
      formAnswers([single, multiple, open], {
        action: 'accept',
        content: { q1: 'Blue', q2: ['A', 'B'], q3: 'Muse' },
      }),
    ).toEqual([
      { questionId: 'q1', selectedLabel: 'Blue' },
      { questionId: 'q2', selectedLabels: ['A', 'B'] },
      { questionId: 'q3', freeText: 'Muse' },
    ])
    expect(formAnswers([single], { action: 'accept' })).toEqual([])
    expect(formAnswers([single], { action: 'decline' })).toBeUndefined()
  })

  it('writes the questions as text for a client without forms', () => {
    expect(questionsText([single, open])).toBe(
      `${UI_TEXT.acpQuestionAsked}\nWhich one?\n- Blue\n- Red\nWhat name?`,
    )
  })
})
