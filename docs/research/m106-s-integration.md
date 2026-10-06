# M106 S integration handoffs

Lane S is based on `ec10db4ad`. It changes only its assigned production
files, adds its feedback modules and owning tests, and records evidence.
The shared bridge, controller, menu, bundles, strings and product docs
belong to lanes 0/W and are not edited here.

## S1 — Supply recorded MSP feature frames and bind the readers

The supplied lane-0 fixtures contain Model API evidence. SDK142 records the
1.4.2 fingerprint, but does not include the raw effort, feedback or delete
frames. The lane requested their location. The independent credential-free
echo probe captured a handshake and an empty catalogue only; it establishes
no entry, feedback receipt or deletion terminal shape. No raw parser is
guessed from the SDK declarations.

`MuseCodeHost` accepts an optional fourth constructor argument,
`MuseCodeFeaturePorts`:

- `modelEfforts.parseModel(row)` validates the captured extra catalogue
  fields with zod and returns `MuseCodeEffortInfo`. The existing required
  row fields are already validated. Return the complete ordered `variants`
  (including `none`, `ultra`, or future received strings), the described
  tiers and `defaultReasoningEffort`; preserve the explicit `unknown` case.
- `feedback.parseOutcome(receipt)` validates the captured receipt with zod
  and returns the exact outcome, including future outcomes. The host sends
  this query once through the existing deadline/watchdog, without a
  `commandId` or retry. No raw receipt, path or error is logged.
- `lifecycle.parseNotification({ method, params })` validates captured
  `session/started` and `session/deleteCompleted` frames with zod and returns
  `MuseCodeLifecycleEvent`. `parseDeleteAdmission(receipt, commandId)` must
  validate the captured admission, its echoed identity and its acceptance;
  reject refusals or malformed data. Enforce failed terminal obligations
  (`reason` and `physicalChange`) and completed terminal obligations from
  the captured frames. Unknown outcomes remain representable and never
  settle deletion as success.

Bind these readers at **both** the extension's `MuseCodeBackendManager`
construction and the shared runtime backend construction. They must not
be fake readers or declarations presented as captured frames. Until bound,
model listing remains the old projection and feedback/deletion refuse
before sending. Production has no empty-success implementation.

The owning tests explicitly use already-parsed internal domain fixtures,
opaque reader input and empty notification params. They test orchestration,
not an invented MSP shape. Capture/schema tests remain required for S1.

## S2 — Carry model effort metadata through the shared bridge

`listModels` returns `MuseCodeModelSummary`, which extends the existing
summary with `MuseCodeEffortInfo`. Extend the shared model option schema
and controller projection to carry those fields before feeding them into
`EffortSlider.model`. That prop accepts the complete variants, described
tiers, default, current selection and a string-valued selection callback.
It preserves catalogue order, supports tiers outside the old static union,
uses the default only without a selection, and respects known empty lists.
`unknown` or no catalogue retains the existing family-table behavior.

Map `none` to the shared Thinking control and carry other returned tiers
without narrowing them to the old static `EffortLevel` union. The same
React control and core host serve every editor. With no metadata injected,
the old callbacks, labels and selection bytes remain unchanged.

## S3 — Bind the lazy turn-menu feedback dialog

Request MSP's `feedback` capability and offer the turn-menu action only on
Muse Code when it is granted and the captured receipt reader is installed.
Load `FeedbackDialog.tsx` lazily into an optional webview chunk. Bridge its
`FeedbackSubmitPort` to `MuseCodeHost.submitFeedback` through zod-validated
shared messages and responses, using the clicked turn's owning session.
Bind `FeedbackSubmitPort.scrubNote` to `MuseCodeHost.previewFeedbackNote`
over that bridge too. Supply `feedback.secretLiterals` from the host's
registered secret store; only scrubbed text crosses back to the webview.
Preview scrubs the note before Send becomes available. The displayed note
is read-only until Edit starts a new preview; dispatch refuses a changed
preview, including a newly registered literal secret. The host independently
refuses notes that have not already passed its scrubber.

The dialog requires localized labels for `bug`, `badResult`, `goodResult`
and `other`. Those four labels need new English keys and real translations
in every table; the remaining feedback text was supplied by lane 0. Both
disclosures begin off. A session record requires files consent and the
bug/bad-result classification. Changing files/classification revokes record
consent; changing the session resets the whole form. A blank bug note,
missing choice, or duplicate pending submit sends nothing. Display the
returned outcome, rather than reporting every outcome as an upload success.
The existing modal supplies Escape, focus trapping and accessible labels.

The SDK declares an always-written local bundle even without disclosure;
document that separately from remote uploads. Captured privacy notes should
be shown if the receipt supplies them; no private bundle path needs to
leave the host. This is a manual feedback action, not a paid model call.

## S4 — Bind History deletion and terminal refresh

Supply `HistoryDialog.onDelete` only for Muse Code with the lifecycle
reader installed. The host callback owns localized permanent-deletion
confirmation before calling `deleteSession`. Add the confirmation text to
the English and all 14 translated tables. Ordinary Delete still archives;
Shift+Delete invokes permanent deletion and the mouse action does not
resume/archive the row. Search edits never delete a session. No callback
preserves the old behavior. The generic existing translated Delete label
is reused for the affordance.

Listen to `onMuseCodeLifecycleEvent` and refresh History after a completed
delete; display failures and their physical-change evidence, conservatively
refreshing after partial erasure. The operation listens before admission,
matches both session and command, waits for a known terminal, stops its
temporary listener in `finally`, and disposes tracked handles only on
`completed`. Unknown outcomes remain visible and pending until a known
terminal or deadline. Use the host's localized failure text at wiring.
The host now supplies localized errors for connection close, process exit,
explicit host close and the named terminal deadline. Public observers run
through a guarded dispatcher with fixed-label failure logging; deletion's
terminal subscription and session disposal are private bookkeeping. An
uncertain outcome emits no deletion success and leaves stored History
listed. Explicit host close still releases its in-memory handles normally.
The existing `session/closed` and `session/listChanged` streams stay intact;
parsed `started` records feed the existing changed-record stream.

## S5 — Product docs, reference, certification and final installed-SDK gates

No `src/shared/featureCatalog.ts` exists on this base. Integration must add
or update help entries for catalogue-driven effort, the turn feedback
action and History permanent deletion/Shift+Delete, plus README and ACP
guidance and CHANGELOG under Unreleased. PLAN's M80 router register row
must say **ACP SDK 1.5.0**, not Muse Code SDK 1.4.0. No cast/suppression was
added by this lane.

The SDK pin is 1.4.2 with the published exact integrity and peer evidence
in [the certification](../certification/m106-s.md). Normal installation
from the lock uses that SDK; the immutable inherited install on this rig
was not overwritten. Lead aggregate quality, accessibility of the bound
dialog, actual shipped lazy chunks and cross-editor bridges remain the
integration gates. No cap, timeout, lint level or ignore was changed.
The isolated SDK 1.4.2 production build passes all existing gates, but the
deferred webview total leaves only 17 bytes. The unbound feedback dialog is
not in that total; fit it and the other added optional UI within the caps.

The [upstream media draft](m106-sdk-media-parts.md) is ready for the lead's
dedupe search and comment on
[SDK issue 48](https://github.com/meta-models/muse-code-sdk/issues/48).
It is not posted and has no posted-comment URL. No sign-in, credential
read, inference attempt or feedback upload was made by the lane.
