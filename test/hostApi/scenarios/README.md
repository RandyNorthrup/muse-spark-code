# MHP conformance scenarios (M104g)

One set of scripted host scenarios runs against every adapter: the
in-process VS Code adapter (the integration tests) and each native
plugin in its own headless harness (IntelliJ's test framework, the VS
experimental instance, tycho-surefire under Xvfb, headless Neovim,
Emacs batch ERT, Sublime UnitTesting, Qt Creator Lua, XCTest).
`test/hostApi/run.mjs` feeds `contract.json` to each host's
`conformance` command on stdin and compares every required
observation. It never accepts an exit code or a passed bit as
scenario proof.

Scenario operations are harness driver actions, not new MHP wire
methods. Observations come from the real harness, never copied from
`expected`.

## Backends

Every scenario runs on both backends. A session opens with no key and
no account identity on either backend (the Model API host resolves
identity at the first step that needs a provider; the Muse Code host
spawns `muse serve` and starts a session without turning), so the
host-side scenarios run for real on both backends with no key and no
model call. A scenario whose operations invoke a provider waits until
its legs unblock (below).

## Waiting legs

A `(backend, scenario)` leg waits only on a named need outside the
lane's reach: a Meta Model API key (C2), lead-authorized live model
calls with a named model and call count, an unbuilt adapter, or a
behavior the product refuses by design. Waiting legs are declared in
`contract.json`'s `waiting`
array, which is reviewed like any contract change; a leg with `hosts`
waits only on those hosts. The runner refuses a result for a waiting
leg (it ran, so undeclare it) and reports `waiting` rather than
`conformant` while any leg waits. The receipt and the matrix show
waiting legs as pending with their need, never green. Supplied user
input (texts, decisions, values, edits) is real test input; supplied
model output would stand in for the provider, so the legs that need
it — conversation, approval, session reload and Tab generation — wait
for live calls instead.

## Shims are excepted

The MHP scenarios run on the MHP hosts (VS Code, JetBrains, Visual
Studio, Eclipse, Xcode). The shims (Neovim, Emacs, Sublime, Zed, Qt
Creator) have no MHP surface — edits, approvals and completions reach
them through turns, LSP and the companion page — and the plan's fake
host, the only shim path for MHP-shaped operations, is dropped under
the real-code rule. Their MHP legs are therefore excepted, with the
reason and the equivalent recorded in each shim's receipt: the shim's
own headless harness (launch, ACP registration, LSP wiring and the
companion protocol), which the build runs and the receipt proves.

## The scenarios

- `conversation`: two sends, two turns recorded, two responses. Both
  legs wait: responses are live model calls.
- `approval`: one approval allowed, one denied, one cancelled; the
  allowed action executes once. All legs wait: tool proposals need
  live turns.
- `dirty-buffer`: a saved version-1 document holding `original` is
  dirtied to the action's text (version 2, one undo to the initial
  state), and an edit to it is refused with `MHP_DIRTY_BUFFER`;
  the refused edit changes nothing. A version-1 dirty document is
  unreachable in any real editor — the setup edit always bumps the
  version — so the setup text and version 2 are pinned here.
- `atomic-edit`: an edit applies once, a duplicate-version edit is
  refused with `MHP_VERSION_CONFLICT`, and one undo restores the
  text in a single undo transaction.
- `diff-hunks`: two hunks from one real edit are settled hunk by
  hunk in diff order, and the text shows the accepted hunk kept and
  the rejected hunk reverted. The decision record alone would assert
  only the driver's own input, so the text carries the proof.
- `diagnostics`: a published error is read back by the verify loop.
- `checkpoint`: a checkpoint, an edit, and a restore returning the
  text. Native legs wait on the runtime checkpoint adapter.
- `tab-completion`: a completion accepted into the text. All legs
  wait: the accept machinery tracks only items from live generation,
  and supplied text would stand in for the model.
- `settings`: a setting changed and read back.
- `session-reload`: a send, a reload, the turn kept in the same
  session. Both legs wait: the send starts a live turn.
- `panel-order`: ordered panel delivery; duplicates and gaps are
  refused with `MHP_PANEL_OUT_OF_ORDER`.

`paid-consent` was removed in M104g: its `PAID_BUDGET_EXCEEDED`
refusal without a person-set budget contradicts D208 (no spending
check without a limit the person set), and paid execution needs
paid-call authorization this lane does not have. A paid-authorized
lane re-adds it with a person-set budget.

## Harness contract

The runner (`hosts/<host>/run.mjs`) starts the host's real headless
harness with three environment variables: `MUSE_CONFORMANCE_CONTRACT`
(the validated contract file), `MUSE_CONFORMANCE_OBSERVATIONS` (the
file the harness writes) and `MUSE_CONFORMANCE_RUNTIME` (the
production `dist/acp.js`, run as `node <runtime> <route>`). The
harness executes every runnable leg — contract order, both backends —
in the real editor and writes one JSON object:

```json
{ "observations": { "musecode/approval": { "executions": 1 } } }
```

A skipped test produces no observation, and a missing leg fails the
harness, so a skip can never smuggle green. The runner exits 0 with
the validated report on stdout, 1 when the harness fails, or 3 with a
`MHP_CONFORMANCE_PENDING` need when the machine cannot run the
harness.
