// Frames Muse Code 1.4.0 sent in the M79 live capture (2026-09-27, contributor
// model, the empty folder C:\muse-live-m79, approval mode `denyUnmatched` as
// the panel selects for Plan; docs/certification/m79.md). A planning request
// in Plan mode: the model read its bundled `plan` skill, searched, had a
// shell listing denied by policy, asked one question (cancelled), and
// delivered the plan as an ordinary `agentMessage`, opened and closed by the
// skill's handoff. No plan item, no exit-plan request, no plan approval: the
// tests build on these shapes (AGENTS.md rule 13). Cursors, source ranges and
// the reminder children are left out, as nothing here reads them.

const SESSION = '01a0e6c6-63cb-73e2-960d-faf305b7697e'
const TURN = '01a0e6c6-65b8-7000-8d93-7b57b7128fd7'

/** The planning turn: `turn/start`'s turnId and every item's. */
export const CAPTURED_PLAN_TURN_ID = TURN

/** The canonical plan body the reply carries between its two handoff lines. */
export const CAPTURED_PLAN_BODY =
  '## Goal\nAdd a `README.md` to `C:\\muse-live-m79` containing a one-sentence description of the folder.\n\n## Success Criteria\n- `README.md` exists in the folder root.\n- It contains one sentence describing the folder.\n- No other files are created or modified.\n\n## Approach\nWorkspace search found no existing files to infer purpose from, so treat the sentence content as a runtime confirmation and keep the change to a single new file.\n\n## Steps\n1. Confirm current folder state with a non-mutating listing to ensure `README.md` does not already exist.\n2. Confirm the one-sentence description with you during execution.\n3. Create `README.md` with that single sentence.\n\n## Validation Plan\n- Verify `README.md` exists in `C:\\muse-live-m79`.\n- Read it back to verify it is one sentence and renders as Markdown.\n- Check working tree shows only the new `README.md` as added.\n\n## Risks / Open Questions\n- Folder purpose could not be inferred from the workspace since it appears empty — what should the sentence say? Assumption for now: generic folder description, to be replaced by your wording at execution.'

/** The reply's text exactly as `item/completed` and `session/read` carried it. */
export const CAPTURED_PLAN_REPLY = `This is a plan, not a special mode; I haven’t started implementation. Reply \`go\` to execute this plan, or tell me what to change.\n\n${CAPTURED_PLAN_BODY}\n\nReply \`go\` to execute this plan, or tell me what to change.`

/** The prompt, as the panel sent it: typed text, then the choice-steering note. */
export const CAPTURED_PLAN_PROMPT =
  'Plan how to add a README.md to this folder that describes the folder in one sentence. I only want the plan for now.'

/** `item/completed` for the reply. */
export const PLAN_REPLY_COMPLETED = {
  sessionId: SESSION,
  item: {
    itemId: '8e8fc83b-7582-47c5-a67d-322cfdd19369',
    kind: 'agentMessage',
    turnId: TURN,
    revision: 2,
    status: 'completed',
    recordedAt: '2026-09-28T06:50:10.488636Z',
    text: CAPTURED_PLAN_REPLY,
  },
}

/** The prompt's item as `session/read` served it. */
export const PLAN_USER_ITEM = {
  itemId: '7775e6bd-2083-48be-b0b7-83e1118847e5',
  kind: 'userMessage',
  turnId: TURN,
  revision: 2,
  status: 'completed',
  recordedAt: '2026-09-28T06:49:17.019932Z',
  displayText: CAPTURED_PLAN_PROMPT,
  text: `${CAPTURED_PLAN_PROMPT}<harness_note>When you offer the user a choice between options, ask through the request_user_input tool instead of listing the options in prose, so the panel can show a picker.</harness_note>`,
}

/** The tool calls before the reply: the plan skill read, a search. */
const PLAN_TOOL_ITEMS = [
  {
    itemId: '01a0e6c6-7fc8-73b0-b3e4-34fca21ef0e7',
    kind: 'toolCall',
    turnId: TURN,
    revision: 2,
    status: 'completed',
    recordedAt: '2026-09-28T06:49:23.795954Z',
    tool: 'read_skill',
    callId: 'call_01a0e6c680ec73b6b0c7b6145f6ea546',
    args: '{"name":"bundled:plan"}',
  },
  {
    itemId: '01a0e6c6-a202-7342-a975-68059f8137ff',
    kind: 'toolCall',
    turnId: TURN,
    revision: 2,
    status: 'completed',
    recordedAt: '2026-09-28T06:49:32.46005Z',
    tool: 'search',
    callId: 'call_01a0e6c6a16374abaa2776309f9941a9',
    args: '{"glob":["**/*"],"output_mode":"files_with_matches","paths":[],"pattern":"^"}',
    visibleOutput: '',
  },
]

/** `session/read`'s inline history for the turn (reminder children left out). */
export const PLAN_HISTORY_ITEMS = [PLAN_USER_ITEM, ...PLAN_TOOL_ITEMS, PLAN_REPLY_COMPLETED.item]
