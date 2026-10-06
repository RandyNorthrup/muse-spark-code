# Draft Apple Feedback — Xcode Source Editor Extension capabilities

Title: Give Source Editor Extensions a workspace/editor service bridge

Product/version tested: Xcode 26.3 on macOS; a SwiftUI companion app paired
with an XcodeKit extension. This request is unsubmitted; the owner can file it.

We are building an unofficial coding assistant with one shared interface across
editors. XcodeKit can act on a current source buffer and commit changes as a
command transaction. It does not expose the active document's URL or the open
workspace, a panel attachment point, change notifications for background buffers,
project-wide diagnostics, or an inline completion provider.

Please add permission-scoped APIs for the active file/workspace URL, versioned
reads of dirty buffers, transactional edits with one undo across documents,
selection/change notifications, diagnostics and language-service queries, and
an inline completion provider with accept/reject notifications. A native webview
panel attachment would let the assistant remain alongside the source editor.

Our current equivalents are a separate WKWebView app, a user-selected workspace,
authenticated ephemeral callbacks for selection commands, explicit approval before
buffer replacement, and xed for opening files. These preserve a user's review
and cancellation decisions, but require manual workspace selection and invoked
commands. Full controller, completion budget and LSP fallback work belongs to the
assistant runtime; those pending integration items are not Apple API defects.

We request no access to account credentials and no bypass of Xcode's extension
permission, document authorization, signing, or approval policy. Please offer
explicit capability declarations and user consent for these editor services.
