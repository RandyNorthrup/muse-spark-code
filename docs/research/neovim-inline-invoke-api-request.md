# Draft: public invoked inline-completion API for Neovim

Owner review/submission only; no upstream message has been sent.

The macmini rig has Neovim 0.12.5. Its installed primary source,
`runtime/lua/vim/lsp/inline_completion.lua`, exposes `enable`, `is_enabled`,
`select` and `get`. `get` accepts an existing displayed item. The internal
`Completor:request(kind)` constructs a request with the given trigger kind;
its automatic timer calls it with `InlineCompletionTriggerKind.Automatic`.
The public surface has no fresh invoked-request entry point.

Muse Spark Code (Unofficial) defaults to paid Invoke-only Tab, matching M94's
measured latency policy. Automatically requesting never authorizes a paid
dispatch. The LSP supports both ordinary invoked items (native omnifunc) and
negotiated inline requests. The headless native fixture proves both protocol
routes, but that does not establish a public user-triggered ghost-text flow.

Proposed upstream request:

> Add `vim.lsp.inline_completion.request({ bufnr = ... })` that sends a fresh
> `textDocument/inlineCompletion` with `triggerKind = Invoked`, and feeds the
> returned candidates through the existing inline display, cancellation and
> buffer-version handling. It should not apply an item until the user accepts
> it through `get`, and should remain separate from automatic debouncing.

This lets extensions offer an explicit completion shortcut without depending
on private `Completor` state or treating automatic traffic as paid consent.
Native omnifunc remains a working fallback. No Neovim API incompatibility is
claimed beyond the inspected version, and no network lookup was performed.
