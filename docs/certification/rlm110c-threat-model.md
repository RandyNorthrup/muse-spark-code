# RLM110C threat model: M110c-h

Lane RLM110C, 2026-10-22. One model per phase, written against the code
this lane landed. Each names its assets, its actors, what threatens them,
what the code does about it, and what still waits (on the owner, on Meta,
or on another lane). Residuals marked REVIEW were accepted in
`rlm110c-review-xaf.md`.

Actors everywhere: the owner (operates nodes), the node's person (uses
one), a network attacker (sees and meddles with traffic), a thief (holds
the hardware), a squatter (races for a shared name), and a bug in our
own code.

## M110c — orchestrator, relay, pages

Assets: the orchestrator's key, the merge queue's order, workers'
liveness, the payer ledger, the pages' honesty.

- **A worker learns the orchestrator's key.** The model-relay envelope
  has no credential field and its schemas are strict: a smuggled key
  fails to parse (tested). The key lives only on the orchestrator and
  is injected server-side. Residual: the provider call itself is M95's
  leg; until it lands, no key moves at all.
- **One attempt settles twice.** `settleModelRelayUsage` settles one
  attempt once (REVIEW XAF-4). The job-level exactly-once is Y3's.
- **A dead worker keeps receiving duties.** Liveness derives from the
  person's own thresholds, never a default; duties go to live workers
  only. A worker from the future counts live (clock skew fails open
  for liveness, closed for money).
- **The queue order lies.** Ordering is M96c's own `orderMergeQueue`,
  not a reimplementation; the duty planner only assigns.
- **Pages show stale or wrong teams.** The pages are pure views over
  the orchestrator's snapshots; mounting and live refresh wait on
  lane N. No page invents state.
- WAITS: M107 lane R (relocation), M108 lane D (pools on the node),
  M109 (vault on the node), M95 (provider calls), M100 lane T
  (transport), lane N (server, mount, refresh).

## M110d — remote reach

Assets: pair keys, sealed traffic, node ids, the relay's availability,
the sealed node's data key, brokered secret uses, remote sessions.

- **A meddler reads or alters pair traffic.** Traffic is sealed for the
  pair; the relay forwards opaque envelopes and parses only routing
  (tested byte-for-byte). Per-message sequence numbers with the pair's
  own replay window refuse replays; the window is person-set.
- **A meddler substitutes keys.** Pairing runs committed SAS: neither
  side can grind a friendly SAS after seeing the other's nonce, and
  the spoken digits authenticate over a trusted channel. Residual
  (REVIEW): SAS binds the secret, not the names; a skipped or
  overheard ceremony is a people-layer failure. Rotation overlaps, so
  no device strands mid-rotation.
- **A lost device keeps its access.** Revocation is subtract-only:
  hash-chained, MACed, verified before every read, and a device takes
  an update only when it extends what it accepted (REVIEW XAF-3).
  Single-use invitations bind to the node's fingerprint.
- **A squatter takes a node id on the relay.** Registration is
  first-wins and loud: the loser hears `node is already on this
relay`. Residual (REVIEW): the relay trusts asserted ids, so a
  squatter can deny relay service for one id until the operator
  clears it. The pair layers authenticate; the relay never claims to.
- **A flood takes the relay.** Pre-registration bytes and connections
  are counted; enforcement is the operator's ceilings only, none by
  default (D121). Refused sockets are tracked, drained and bounded by
  the same ceiling (REVIEW XAF-8). Residual: without operator
  ceilings the relay is unbounded by the operator's choice.
- **A thief boots the sealed node.** It stays sealed: opening needs a
  paired approver's live signature for that node (REVIEW XAF-2), and
  the data key stays wrapped until then. Residual (REVIEW): grants
  are bearer over the sealed pair channel; lane N's store must burn
  used grants.
- **A brokered use leaks the secret or runs stale.** The envelope
  carries the use, never the value; stale epochs, revoked keys,
  never-modes and non-pairs refuse by name. The use itself runs
  through M109's broker, whose remote requester waits.
- **A remote session reads the node's files.** The attach gate denies
  `fs/*` to ACP sessions at both ends (tested). TUI/LSP sessions
  refuse as unready until lanes T and M104e land.
- **A forwarded frame reaches a dying node.** Closing targets report
  unreachable instead of dropping silently (REVIEW).
- WAITS: the owner's server and domain (public listener, relay
  deployment), M100 (authenticated pair transport), M109 (slots,
  broker requester), lane N (node server), lane T (remote TUI),
  M104e (remote LSP), M110b lane K (remote peek/live view).

## M110e — sign-in

Assets: passwords, second factors, recovery codes, OIDC flows, proxy
trust, ACME answers, the installed certificate, passkey enrollments.

- **A stolen password file yields passwords.** Passwords hash with
  scrypt (N=32768, r=8, p=1, recorded in code) and verify in constant
  time; empty hashes and salts refuse (REVIEW XAF-1). Residual: KDF
  parameters ride with the stored hash; rewriting them needs the
  owner-only store itself.
- **A guessed or replayed time code.** TOTP matches RFC 6238's own
  vectors; digits, step and window are the caller's settings, and the
  clock is a parameter so skew never silently stretches. Degenerate
  secrets refuse (REVIEW XAF-5). Residual: sign-in throttling is
  A1's; padding-bit laxity fails closed.
- **A lost second factor locks the person out, or codes leak.**
  Recovery codes are single-use, hashed at rest (plaintext shown once
  at enrollment), and burn loudly on reuse.
- **An OIDC flow is forged or swapped.** PKCE S256 throughout (RFC
  7636's own vector tested); the state echo is checked. Residual: the
  token exchange and userinfo wait on the person's provider choice.
- **A stranger pretends to be the proxy.** Proxy sign-in trusts only
  the configured socket and a named user; anything else refuses by
  name. The socket's filesystem permissions are the operator's.
- **ACME answers wrong or the wrong certificate installs.** Key
  authorizations follow RFC 8557; the install check parses the live
  certificate with node:crypto and judges name and instant (tested
  against a recorded real capture). Residual: the order flow waits on
  the owner's domain and server.
- **Passkeys enroll where they cannot work.** Bare IPs and plain http
  refuse with their reasons; loopback and https pass.
- WAITS: the person's OIDC provider choice, the owner's domain and
  server (ACME, secure origins), A1 (attempt throttling, session
  lifetimes), lane N (sign-in pages serve these cores).

## M110f — rented servers and operations

Assets: the rented machine, the install artifact, backups, the data
key, the disk, the clock's honesty, metrics.

- **A tampered install runs.** The verifier recomputes every hash in
  SHA256SUMS, refuses missing files, escaping entries and private key
  material (tested as a child process on planted violations). The
  artifact signature itself waits on the owner's key ceremony:
  until then, hashes prove integrity against the manifest, not origin.
- **A breached container escapes.** Helm runs restricted PSS
  (non-root, no escalation, read-only root, dropped capabilities,
  RuntimeDefault seccomp); cloud-init and Proxmox run unprivileged
  service users with no new privileges. The node's port opens only at
  `node init`, never by the image.
- **A backup restores garbage or escapes.** Restores verify every hash
  before a byte lands, refuse symlinks on the way in and `..` on the
  way out (tested). Backup encryption is M109's.
- **An upgrade bricks the node.** Upgrades move only past readiness;
  a sick install rolls back to the last good version; anything else
  holds with its reason. The channel transport waits.
- **The disk fills or the clock lies.** Retention and the disk floor
  obey only the person's settings; the clock warns past their skew
  and stops time codes past their refusal. Without settings, nothing
  is removed and TOTP judges by its own window.
- **A decommissioned disk is read.** Wipe overwrites the key file and
  unlinks it before the data goes, inside the node root only; a saved
  volume copy cannot be decrypted afterwards. Residual: SSD wear
  levelling keeps the overwrite from being physical proof; the
  crypto-erase (key destruction) is the guarantee.
- **Metrics leak.** The metrics page prints live readings with
  escaped labels; OTel export stays off until the person names a
  collector.
- WAITS: the owner's key ceremony (artifact signatures, OTA updates),
  qualification on real hosts (the Q matrix), the channel transport,
  M109 (backup encryption, KEK slots), lane N (crash journal, server
  endpoints like /readyz).

## M110g — local models

Assets: model traffic, GPU access, the sidecar images.

- **Model traffic crosses the network plain.** The loopback guard
  refuses any non-loopback sidecar (plain HTTP off loopback by its
  own name), and every recipe binds 127.0.0.1 only. Credentials in
  sidecar URLs refuse.
- **A stale or wrong sidecar image runs.** Recipes pin the verified
  Ollama 0.40.8 release (CPU/CUDA) and 0.40.8-rocm (checked against
  the registry on 2026-10-22). Image signatures wait on the owner's
  ceremony alongside the node's.
- **The wrong backend runs.** Detection reads honest platform facts
  (no spawn, no guesses) and maps them to one recipe; this rig
  (Intel Mac mini, no GPU devices) classifies CPU. A wrong reading
  fails toward CPU, never toward a missing GPU.
- **A sidecar reads node state.** Sidecars mount only their model
  volume. Container breakouts are the engine's and M110a's sandbox
  layers'.
- WAITS: qualification with real Ollama (CPU on this rig's class,
  CUDA/ROCm/Apple on GPU rigs), M95's Ollama capability record
  naming what a local model may do, M110d's pair (remote editors use
  the node's models through it), M104e + M110d (LSP broker).

## M110h — team mode

Assets: per-person credentials, vault items, budgets, the audit log,
the roster itself.

- **One person's credential serves another.** The scoping check throws
  on any person/owner mismatch (tested); namespaces derive per
  person, so sharing one is structurally impossible. The vault's own
  namespaces are M109's leg.
- **A person exceeds their role.** The matrix is code: viewers read,
  members run and spend, admins manage the node, owners manage the
  team; removal takes the owner. Every role/action pair is tested.
- **A person spends past their budget.** Spend admits under the
  person's budget with the remainder named; without a budget nothing
  refuses (D121). Amounts are whole cents; no floats touch money.
- **An action goes unaudited.** Every movement appends (person,
  action, detail, instant) to a grow-only log. The log's store is
  lane N's.
- **Team mode runs before its terms exist.** Admission refuses until
  the owner records the terms decision (tested); the gate is in the
  admit path, not in documentation.
- **An OIDC group grants the wrong role.** Mapping is the person's
  own table, first group wins, unknown groups grant nothing.
- WAITS: Meta's terms decision (Q-M110 — the gate above enforces
  it), M109 (per-person vault namespaces), lane N (roster and ledger
  stores, per-person sign-in homes served), A2 sign-in per person.
