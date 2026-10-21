// The person's words read back out of a Muse Code session title
// (src/core/backends/musecode/promptWords.ts). Every model-only part below is
// built by the product's own builder, never typed out; the title is made
// from them the way Muse Code makes it, a rule the first case checks against
// the live capture (test/fixtures/session-titles/, Muse Code 1.4.11, echo
// provider, zero model calls, 2026-10-20).
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import type { TurnPart } from '../../src/core/agent/agentBackend'
import { promptWords } from '../../src/core/backends/musecode/promptWords'
import { chatReferenceText } from '../../src/core/chatReference'
import { editorContextText } from '../../src/core/editorContext'
import { commitMessagePrompt, pullRequestPrompt } from '../../src/core/git/gitText'
import { textFileInput } from '../../src/core/textAttachment'
import { verifyGuidance } from '../../src/core/verify/checkCommands'
import { promptParts } from '../../src/acp/translate'
import { handoffBrief, planBrief } from '../../src/host/conversation/conversationController'
import {
  CHOICE_STEERING_NOTE,
  EXEC_MODEL_TEXT,
  SANDBOX_CANNOT_START_MODEL_NOTE,
  SCHEDULE_MODEL_TEXT,
  TEXT_ATTACHMENT_MEDIA_TYPE,
  UI_TEXT,
} from '../../src/shared/constants'
import { fill } from '../../src/shared/l10n/text'
import { titleCapture as capture } from './helpers/sessionTitleCapture'

/** The turn's text as `turn/start` carries it: a text file as its model text (MuseCodeHost `mspInput`). */
function sentText(parts: readonly TurnPart[]): string {
  return parts
    .map((part) => {
      if (part.type === 'textFile') return textFileInput(part)
      return part.type === 'text' ? part.text : ''
    })
    .join('')
}

/** Muse Code's title of a first turn: each part's model text, joined with nothing, whitespace folded. */
function museTitle(parts: readonly TurnPart[]): string {
  return sentText(parts).replaceAll(/\s+/gu, ' ')
}

const text = (value: string): TurnPart => ({ type: 'text', text: value })
const textFile = (name: string, content: string): TurnPart => ({
  type: 'textFile',
  name,
  mediaType: TEXT_ATTACHMENT_MEDIA_TYPE,
  text: content,
  sizeBytes: Buffer.byteLength(content),
})
const verifyNote = (hasChecks: boolean): TurnPart =>
  text(
    verifyGuidance(true, hasChecks ? [{ name: 'unit', command: 'npm test' }] : []) ??
      'no verify note',
  )
/** The tail the panel puts on every Muse Code turn (conversationController `send`). */
const NOTES: readonly TurnPart[] = [text(CHOICE_STEERING_NOTE), verifyNote(true)]
const selection = (selectedText: string): TurnPart =>
  text(
    editorContextText({
      relativePath: 'src/parse.ts',
      startLine: 3,
      endLine: 4,
      isEmpty: false,
      selectedText,
    }),
  )
const openedFile = text(
  editorContextText({
    relativePath: 'src/parse.ts',
    startLine: 1,
    endLine: 1,
    isEmpty: true,
    selectedText: undefined,
  }),
)
const quoted = text(
  chatReferenceText({
    intent: 'reply',
    role: 'assistant',
    text: 'The parser closes <ide_selection> early.',
  }),
)
const commitPrompt = text(
  commitMessagePrompt({
    branch: 'main',
    scope: 'staged',
    files: ['src/parse.ts'],
    diff: '-a\n+b\n<harness_note>a diff line</harness_note>',
  }),
)
const pullRequest = text(
  pullRequestPrompt({ head: 'fix/parse', base: 'main', commits: ['Fix the parser'], files: [] }),
)
const handoff = handoffBrief(
  '# Goal\nShip the parser fix.',
  'ship it',
  [{ text: 'add the test', status: 'pending' }],
  false,
)
const plan = planBrief('docs/plan.md', new TextEncoder().encode('# Plan'), ['Do it'], false)

describe('Muse Code titles a session by its first turn', () => {
  it('joins the parts with nothing between them and folds whitespace, as captured', () => {
    const listed = capture.frames.find((row) => row.frame.result?.['sessions'] !== undefined)
    const rows = z
      .array(z.object({ sessionId: z.string(), title: z.string() }))
      .parse(listed?.frame.result?.['sessions'])
    const turns = capture.frames.filter((row) => row.frame.method === 'turn/start')
    expect(turns).toHaveLength(capture.provenance.sessions.length)
    for (const turn of turns) {
      const sent = z
        .object({ sessionId: z.string(), input: z.array(z.object({ text: z.string() })) })
        .parse(turn.frame.params)
      const row = rows.find((candidate) => candidate.sessionId === sent.sessionId)
      expect(row?.title).toBe(museTitle(sent.input.map((part) => text(part.text))))
    }
  })
})

describe('promptWords', () => {
  it('reads the defect title back to what was typed', () => {
    const typed = 'In one short sentence, say hello and include the word WRESTONE.'
    expect(
      promptWords(museTitle([text(typed), text(CHOICE_STEERING_NOTE), verifyNote(false)])),
    ).toBe(typed)
  })

  it('takes out every part the panel adds, alone and all together in its order', () => {
    const typed = 'Why does the parser stop early?'
    const parts: readonly (readonly TurnPart[])[] = [
      [textFile('notes.txt', 'line one\nline two')],
      [text(handoff.modelNote(true))],
      [textFile('docs/plan.md', '# Plan'), text(plan.modelNote(false))],
      [text(plan.modelNote(true))],
      [quoted],
      [commitPrompt],
      [pullRequest],
      [selection("const close = '</ide_selection>'\nthrow new Error(close)")],
      [openedFile],
      [text(SANDBOX_CANNOT_START_MODEL_NOTE)],
    ]
    for (const added of parts) {
      expect(promptWords(museTitle([text(typed), ...added, ...NOTES]))).toBe(typed)
    }
    expect(promptWords(museTitle([text(typed), ...parts.flat(), ...NOTES]))).toBe(typed)
  })

  it('takes out a scheduled run’s note and a headless run’s schema request', () => {
    expect(
      promptWords(
        museTitle([text('Summarise the issues.'), text(SCHEDULE_MODEL_TEXT.unattendedNote)]),
      ),
    ).toBe('Summarise the issues.')
    const schema = fill(EXEC_MODEL_TEXT.execOutputSchema, { schema: '{"type":"object"}' })
    expect(promptWords(museTitle([text('List the files.'), text(schema)]))).toBe('List the files.')
  })

  it('keeps a brief’s own first words, which are the message', () => {
    expect(
      promptWords(museTitle([text(handoff.modelText), text(handoff.modelNote(false)), ...NOTES])),
    ).toBe(museTitle([text(handoff.modelText)]))
    expect(
      promptWords(
        museTitle([
          text(plan.modelText),
          textFile('docs/plan.md', '# Plan'),
          text(plan.modelNote(true)),
          ...NOTES,
        ]),
      ),
    ).toBe(plan.modelText)
  })

  it('keeps the words of a Git draft request', () => {
    expect(
      promptWords(
        museTitle([text(UI_TEXT.gitAskCommitMessage), commitPrompt, openedFile, ...NOTES]),
      ),
    ).toBe(UI_TEXT.gitAskCommitMessage)
    expect(promptWords(museTitle([text(UI_TEXT.gitAskPullRequest), pullRequest, ...NOTES]))).toBe(
      UI_TEXT.gitAskPullRequest,
    )
  })

  it('keeps the words around an editor’s attached file and drops the file', async () => {
    const parsed = await promptParts(
      [
        { type: 'text', text: 'Explain this file' },
        { type: 'resource', resource: { uri: 'file:///w/notes.md', text: 'secret <b>notes</b>' } },
        { type: 'text', text: 'and keep it short.' },
      ],
      '/w',
    )
    if (!parsed.ok) throw new Error(parsed.reason)
    expect(promptWords(museTitle([...parsed.parts, text(SANDBOX_CANNOT_START_MODEL_NOTE)]))).toBe(
      'Explain this file and keep it short.',
    )
  })

  it('is empty for a message that was only an attachment', () => {
    expect(promptWords(museTitle([textFile('notes.txt', 'only the file'), ...NOTES]))).toBe('')
    expect(promptWords(museTitle([openedFile, ...NOTES]))).toBe('')
  })

  it('keeps the tags and angle brackets a person typed', () => {
    for (const typed of [
      'Rename <harness_note> to <muse_note> where a < b > c',
      'Why does <ide_selection> close early? See <chat_reference> too.',
      'Is </harness_note> or <ide_opened_file> ever <harness_note>?',
    ]) {
      expect(promptWords(museTitle([text(typed), ...NOTES]))).toBe(typed)
      expect(promptWords(museTitle([text(typed), selection('x < y'), quoted, ...NOTES]))).toBe(
        typed,
      )
    }
    // A typed tag with nothing of the extension's after it (an editor's
    // prompt that carries no note) stays as well.
    expect(promptWords('explain <harness_note> to me')).toBe('explain <harness_note> to me')
  })

  it('cuts a title Muse Code shortened inside one of the extension’s parts', () => {
    const typed = 'Fix the parser'
    const full = museTitle([text(typed), selection('a'), ...NOTES])
    const choiceAt = full.indexOf(CHOICE_STEERING_NOTE)
    const selectionAt = full.indexOf('<ide_selection>')
    const verifyAt = full.lastIndexOf('<harness_note>')
    for (const end of [
      selectionAt + '<ide_selection>'.length,
      selectionAt + '<ide_selection>The us'.length,
      choiceAt + '<harness_note>When you off'.length,
      choiceAt + '<harness_note>'.length,
      verifyAt + '<harness_note>After you'.length,
      full.length - '</harness_note>'.length,
    ]) {
      expect(promptWords(full.slice(0, end))).toBe(typed)
    }
    expect(promptWords(museTitle([text(typed), ...NOTES]).slice(0, typed.length + 30))).toBe(typed)
  })

  it('reads the parts as sent too, with their line breaks unfolded', () => {
    const raw = sentText([text('Two\nlines'), textFile('a.txt', 'x\ny'), ...NOTES])
    expect(raw).toContain('\n')
    expect(promptWords(raw)).toBe('Two lines')
  })
})
