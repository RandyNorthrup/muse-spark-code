# RLM95B — M95b ChatGPT and Copilot: land presets and plan routes

Recovery lane, rig `macmini`, worktree `/Users/randy/lanes/RLM95B`,
branch `rec/rlm95b`, base `f3941b854` (0.19.0), 2026-10-22.
No push, no rebase, no main merge. No paid or live model call ran here:
the live ChatGPT, Copilot and plan-key captures wait on the owner (below).

## What landed

Merges, in order, with unchanged hooks (`.husky/_`):

| Source                                 | Merge       | Contents                                                                                                                                                                |
| -------------------------------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/RLM95B/01-c-m95-presets`          | `2a70016fc` | Plan-key presets (MiniMax, Alibaba, Mistral) and cloud presets (Moonshot, Ollama Cloud), Azure deployment wire model + 404 refusal, editor-chat opt-in for VS Code chat |
| rework                                 | `70c68970d` | Removed the source branch's editor-chat daily cap (D121/D208: no cap of ours), deleted its fake-driven tests, added real-code tests                                     |
| `src/RLM95B/02-fix-chatgpt-plan-route` | `a9a4d5399` | Documented plan-refusal sentences, `x-codex-*` limit-header parsing and tally, plan usage UI                                                                            |
| new work                               | `02ac4eb34` | Hugging Face OAuth sign-in, closed until the owner registers the app                                                                                                    |

Conflict policy: docs and generated files resolved to HEAD (current main);
source conflicts unioned so HEAD's architecture stands (the typed
`providerFailureReader`/`rethrowTypedRefusal` in `configured.ts`, vault and
exact-decimal usage logic) with the branches' behaviour ported onto it.
Branch fakes deleted, never carried: the fake-only suites the merge
listed as deleted, the fixed per-slug plan table, and the client-side
output cap (`ResponsesOutputCapError`) — the plan route sends no
`max_output_tokens` (SIWC preview limitations), so the reply ends where
the model's own limit ends it (D121/D208).

## Acceptance 1–10 (archive `docs/plan-archive/milestones.md`)

Built means the code path exists and a real-code test proves it; live
means a real provider answer, which only the owner can produce.

1. **Sign in and run a turn on the plan: built, live waiting.**
   `ChatGptSignIn` (authorize, exchange, refresh-on-use) in
   `src/core/providers/subscriptions/chatgpt.ts`, the loopback callback
   and cross-window refresh lock in `src/host/providers/chatgptSignIn.ts`,
   the plan turn with tools in `src/core/providers/subscriptions/registry.ts`
   over the `chatgpt` Responses profile. Live proof needs the owner's
   ChatGPT Plus/Pro sign-in: one short turn with tools, calls counted.
2. **Free/ineligible refusal in plain words: built, live waiting.**
   Refusal sentences in `src/core/providers/subscriptions/planRefusals.ts`,
   proven by `test/unit/chatgptPlanRefusals.test.ts` (real `Response`
   through `planRequestError`). A live Free-account reply waits on the owner.
3. **Refresh before expiry, once across windows: built, live waiting.**
   Refresh-on-use (`accessToken` with minimum validity) under
   `withRefreshLock`; a revoked grant asks to sign in again.
   Live proof waits on the owner.
4. **Remove revokes and deletes: built; the path-guard test is open.**
   Sign-out revokes the refresh token and deletes the record
   (`ChatGptSignIn`, "Sign out. Revocation and refresh use the same lock").
   The archive's guard test ("the code names none of their paths" for
   Codex/Claude/Gemini/Copilot storage) does not exist; no such test was
   found in the tree.
5. **Preview rules: built; the host-side output cap is superseded.**
   The `chatgpt` profile sends no `max_output_tokens` and no
   `prompt_cache_retention`, `store: false`, full streamed history
   (`test/unit/chatgptResponsesCodec.test.ts`). "A reply that passes the
   output cap is ended by the host" is superseded by D121/D208: no cap of
   ours exists, and none was added.
6. **Plan notice, mark, Manage usage, usage-limit screen: built.**
   `src/webview/components/PlanUi.tsx`: the one-time notice port, the
   "Using ChatGPT plan" mark, Manage usage (the plan's own limits URL),
   and the limit screen with the reported primary/secondary windows.
7. **No paid popup, tallied per provider: built, live waiting.**
   The plan path carries no consent call; attempts tally per provider via
   `recordPlanUsage` and render in Account & usage (`PlanUsageSection`,
   mounted in `UsageDialogContent.tsx`); the credits-beyond-plan notice
   is `UI_TEXT.planUi`'s own sentence. Live tallies wait on the owner.
8. **Copilot: built, live waiting.** `src/host/providers/copilotClient.ts`:
   consent from the click, the tool loop, the Reduced mark, estimated
   token budgets, plain quota errors, the confidential-workspace refusal,
   the AI-content note and Report Harmful Content link. A live run needs
   VS Code with the owner's Copilot grant.
9. **Plan-key preset shows "plan" and links the limits: built.**
   The `plan` price note renders "Plan" (`ModelsSection.tsx`); each plan
   key's `limitsUrl` reaches the Manage-usage link (`planLimitsUrl`
   through `providerRegistry.ts` to `PlanUi.tsx`). Mistral lists (its
   capture is inherited); MiniMax and Alibaba stay unlisted until their
   captures land; Moonshot and Ollama Cloud are uncaptured cloud presets.
10. **Hook events with provider id and qualified model: NOT MET.**
    Extension-hook payloads carry `model` + `model_provider`
    (`extensionHookPayload`), but the provider is hardcoded to `'meta'`
    (`src/core/backends/modelapi/extensionHooks.ts`) and plan-route
    turns emit no hook events at all. Plumbing the real provider through
    and firing on the plan route is a follow-up design, not part of this
    landing.

## Waiting on the owner (named, not built)

- ChatGPT Plus/Pro sign-in: one short turn with tools (acceptance 1),
  a Free/ineligible reply (2), refresh/revoke behaviour (3), live
  tallies (7). State the call count first, count afterwards.
- Copilot: a live run in VS Code with the owner's grant (8).
- Hugging Face: register a public OAuth app at
  `https://huggingface.co/settings/applications/new` with redirect
  `http://127.0.0.1/callback`; the id lands in `HF_OAUTH_CLIENT_ID`
  (`src/host/providers/huggingface.ts`, today `undefined`, and the
  connect command refuses closed until then).
- Plan-key captures: MiniMax M Plan, Alibaba Coding Plan (unlisted
  until captured); Moonshot and Ollama Cloud wires; xAI/Z.ai listing.

## Red/green drills (12)

Each: break on purpose, red run with a non-zero exit, revert, green.
All runs `npx vitest run <file> --maxWorkers=3` on this rig.

| #   | Break                                                          | Suite                            | Red      | Green |
| --- | -------------------------------------------------------------- | -------------------------------- | -------- | ----- |
| D1  | `planRefusalFor` returns `undefined` (`codecs/responses.ts`)   | `chatgptResponsesCodec.test.ts`  | 6 failed | pass  |
| D2  | `listedPlanKeyPresets` lists all (`presets.ts`)                | `planKeyPresets.test.ts`         | 1 failed | pass  |
| D3  | `knownFlag` never `yes` (`modelPolicy.ts`)                     | `modelPolicyReasoning.test.ts`   | 1 failed | pass  |
| D4  | `azureDeploymentError` returns `undefined` (`configured.ts`)   | `azureDeploymentRefusal.test.ts` | 1 failed | pass  |
| D5  | `editorChat` required (`shared/modelsPanel.ts`)                | `modelsPanelSchemas.test.ts`     | 1 failed | pass  |
| D6  | `planOfferedLevels` returns `[]` (`planFacts.ts`)              | `chatgptPlanFacts.test.ts`       | 6 failed | pass  |
| D7  | tab settle always `true` (`host/tab/tabLedger.ts`)             | `tabLedgerFailures.test.ts`      | 2 failed | pass  |
| D8  | journal image gate always true (`core/usage/journalRecord.ts`) | `journalRecord.test.ts`          | 5 failed | pass  |
| D9  | limit sentence replaced (`planRefusals.ts`)                    | `chatgptPlanRefusals.test.ts`    | 1 failed | pass  |
| D10 | limit-header parse returns `undefined` (`planUsage.ts`)        | `chatgptPlanUsageLimits.test.ts` | 2 failed | pass  |
| D11 | `wireModelFor` returns the family (`presets.ts`)               | `providersPresets.test.ts`       | 1 failed | pass  |
| D12 | authorize URL drops `scope` (`huggingface.ts`)                 | `huggingfaceOAuth.test.ts`       | 1 failed | pass  |

No `DRILL-BREAK` marker remains in the tree (`grep` exit 1).
Green totals: D1–D3 34 passed, D4–D6 27 passed, D7–D9 25 passed,
D10–D12 35 passed.

## Gates

Run on this rig; exit codes in the LANE DONE message.
