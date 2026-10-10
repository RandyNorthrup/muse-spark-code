# POSIX vault broker process contract — C-M109-1b

`dist/vaultBroker.js` exports `createVaultBrokerProcess(context, bindings)`.
It composes the existing `VaultStoreRepository`, `VaultSlotUnlock`,
`VaultManagement` and `KeyringVaultAnchor`, and serves protocol v2 through
`VaultChannelServer`. There is no alternate repository, management layer,
anchor or wire protocol.

The context has absolute `dataDir`, `runDirectory` and `installRoot` paths
and an OS `userSession`. The helper is selected only under that installation:
`native/linux/{x64,arm64}/muse-vault-peer` or
`native/darwin/muse-vault-peer`. CI builds and packages those artifacts
beside `muse-created`; the macOS executable is universal and ad-hoc signed.
Node's internal live socket descriptor is schema-checked before inheritance
as fd 3; the helper reads kernel peer credentials and restores nonblocking
mode. Every foreign UID is refused before a frame is parsed. Its identity
mode captures process UID, birth and executable and checks birth again.

The installed runtime must call the broker bundle's exported `setUiText(table,
locale)` before use; setting its own bundle's language does not install this
bundle's table. The bindings provide the trusted host/launch registry, audit factory over
that repository, execution lifetime/dispatch, taint, ceiling, scrub, file
importer and audit-failure notice. They must configure the shared resource
admission service before any native launch. They may provide platform
slots, keyring factory, peer verifier and private-file port for their host.
The default slots are Secret Service on Linux and login Keychain on macOS.
Presence is denied; enabling screen-lock handling requires a real binding.
Touch ID / Keychain biometry is not offered (lead decision 10). Linux
hardware and screen-lock integration belong to C-M109-2.

The internal child entry takes this context as one JSON argument. It loads
only its installed sibling `dist/vaultRuntime.js`, whose
`createVaultBrokerBindings(context)` export must return those bindings.
`installRoot/dist` must name the entry's own directory. Missing or invalid
binding installation exits 1 with only `vault-broker-refused` on stderr;
there is no workspace-selected module, fake port or silent fallback.
Successful startup emits only `vault-broker-ready` on stdout. SIGINT and
SIGTERM lock, close connections, dispose the broker and release discovery
and the kernel startup lock. Credential variables are removed at entry;
native peer/identity/lock children receive an empty environment.

Startup is serialized by `flock` on an owner-only, single-link regular
`startup.lock`, kept on disk. The helper holds it while private stdin stays
open. EOF releases it after a broker crash. Only a kernel-lock owner can
recover discovery, boot-token and socket files; a live process with the
recorded birth is never removed. Socket and discovery live in the existing
0700 per-session/protocol directory, with a 0600 socket. At most 64 clients
are admitted. The broker locks and exits after 30 seconds without a client;
any connected client suspends that timer. Native identity execution and startup-lock readiness have
five-second response bounds. `close()` is idempotent and cleanup still runs when lock
or disposal fails.

Part A's merged building-block commit does not yet export the installed
binding factory. The released editor surfaces remain closed. Part A must
also package the pinned keyring module for the VSIX (the ACP package already
installs it as a dependency). Installed VS Code/CLI/ACP/headless receipts
belong to that integration; the other editor receipts belong to C-M109-10.
The Mac mini native receipt is blocked by SSH host-key verification; no
trust settings were changed. See [certification](../certification/cm109-1b.md).
