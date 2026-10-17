// Frames Muse Code 1.4.0 sent in the M79 live capture (2026-09-27, contributor
// model, the empty folder C:\muse-live-m79, approval mode `denyUnmatched` as
// the panel selects for Plan; docs/certification/m79.md). A planning request
// in Plan mode: the model read its bundled `plan` skill, searched, had a
// shell listing denied by policy, asked one question (cancelled), and
// delivered the plan as an ordinary `agentMessage`. The tests build on these
// shapes (AGENTS.md rule 13).

/** The canonical plan body the reply carries between its two handoff lines. */
export const CAPTURED_PLAN_BODY =
  '## Goal\nAdd a `README.md` to `C:\\muse-live-m79` containing a one-sentence description of the folder.\n\n## Success Criteria\n- `README.md` exists in the folder root.\n- It contains one sentence describing the folder.\n- No other files are created or modified.\n\n## Approach\nWorkspace search found no existing files to infer purpose from, so treat the sentence content as a runtime confirmation and keep the change to a single new file.\n\n## Steps\n1. Confirm current folder state with a non-mutating listing to ensure `README.md` does not already exist.\n2. Confirm the one-sentence description with you during execution.\n3. Create `README.md` with that single sentence.\n\n## Validation Plan\n- Verify `README.md` exists in `C:\\muse-live-m79`.\n- Read it back to verify it is one sentence and renders as Markdown.\n- Check working tree shows only the new `README.md` as added.\n\n## Risks / Open Questions\n- Folder purpose could not be inferred from the workspace since it appears empty — what should the sentence say? Assumption for now: generic folder description, to be replaced by your wording at execution.'

/** The reply's text exactly as `item/completed` and `session/read` carried it. */
export const CAPTURED_PLAN_REPLY = `This is a plan, not a special mode; I haven’t started implementation. Reply \`go\` to execute this plan, or tell me what to change.\n\n${CAPTURED_PLAN_BODY}\n\nReply \`go\` to execute this plan, or tell me what to change.`

/** The prompt, as the panel sent it: typed text, then the choice-steering note. */
export const CAPTURED_PLAN_PROMPT =
  'Plan how to add a README.md to this folder that describes the folder in one sentence. I only want the plan for now.'
