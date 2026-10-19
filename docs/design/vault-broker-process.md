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
Clients use the governed spawn handoff: a separate POSIX session/process group
and null standard streams, outside the client's containment. Readiness is a
successful connection to the published socket, independent of the launcher.
The entry handles errors on stdin/stdout/stderr even if invoked with pipes.
Successful startup emits only `vault-broker-ready` on stdout. SIGINT and
SIGTERM lock, close connections, dispose the broker and release discovery
and the kernel startup lock. Credential variables are removed at entry;
native peer/identity/lock children receive an empty environment.

Clients queue on blocking `flock` over owner-only `launch.lock` and recheck
discovery before handing off a broker; a loser connects to the winner. This
lock is retained on disk, like `startup.lock`, to preserve kernel inode
identity. Startup is serialized by `flock` on an owner-only, single-link regular
`startup.lock`, kept on disk. The helper holds it while private stdin stays
open. EOF releases it after a broker crash. Only a kernel-lock owner can
recover discovery, boot-token and socket files; a live process with the
recorded birth is never removed. Socket and discovery live in the existing
0700 per-session/protocol directory, with a 0600 socket. At most 64 clients
are admitted. The broker locks and exits after 30 seconds without a client;
any connected client suspends that timer. Native identity execution and startup-lock readiness have
five-second response bounds. The client launch-lock response has the same bound
once its governed helper has spawned. Socket-readiness retries use a five-second
window after governed handoff; broker resource admission, native keyring import
and initial protected-anchor read happen during that window. It is checked
between probes, which retain their own native timeout, so an in-flight probe
can finish after the retry window. These are per-operation response/retry
windows, not a five-second bound on the whole launch. Admission before handoff
has the governor's own deadline. A failed client
wait never signals a session broker. A locked keyring or loaded machine can
exceed the readiness bound and receives a real startup failure; a later need
rechecks the broker. Host registrations are removed at client/window shutdown;
startup prunes records whose owner is proven dead or whose PID birth changed. `close()` is idempotent and cleanup still runs when lock
or disposal fails.

CM109JOINB now exports the installed factory through `vaultRuntime.js`, with
child-only bindings in `vaultBrokerBindings.js`, immutable store/error identity
in `vaultStore.js`, and the lazy POSIX client in `vaultPosix.js`. The child
configures the real governor with shared machine settings and a broker-owned
creation registry under its run directory; concurrent editor launches cannot
overwrite that registry. Management and first-party private reads are wired.
Agent execution, ceilings and provenance still require T/X/S/O transport
bindings and refuse explicitly until then. Host registration is owner-only and
checked against kernel PID/UID/birth/image facts, with the same-user rewrite
residual in D89.15; it is not an attestation against hostile code running as the
same OS user.

POSIX audit appends first persist a value-free previous/next head intent in the
protected OS store. The portable audit port's optional prepare hook rechecks the
writer and authorization after that await. A successor under the audit kernel
lock abandons a prepared head with no physical append, or completes its exact
physical/store/protected checkpoint transition; every record still passes the
core hash/MAC chain verification. Unrelated checkpoint advances refuse rollback.
No writer lease or store takeover rule changes here.

The VSIX allowlist and package report frame paths include `vaultStore.js`,
`vaultPosix.js`, `vaultRuntime.js` and `vaultBrokerBindings.js`. Before staging,
`package-vsix.mjs` derives the reachable sibling closure from the production
build outputs/configuration and installed lazy-loader call sites and reports
all omitted bundles. The pinned native keyring module remains a part-A join
obligation.

Availability stays off pending CM109JOINA's shared writer lease, Windows join,
Models & Agents/settings mount and reviewed installed-editor acceptance. Part A
must also package the pinned keyring module for the VSIX (the ACP package already
installs it as a dependency). Kubuntu's generated-only installed launch and
Secret Service receipt is in [join certification](../certification/cm109-join-posix.md).
macOS login Keychain and other editor acceptance remain lead-owned; no trust
settings were changed.
