# Serving the home node

`serve` starts the node supervisor: it owns the service lock for the node's
whole life and answers commands until it stops. The A1/M104 binding serves
for real: `serve` boots the service, takes the exclusive lock, loads the
passkey verifier and the pinned TLS leaf, and listens on the interface `init`
selected, printing the full SHA-256 fingerprint. `stop` signals the serving
node and waits for it to go. `lock` and `unlock` still refuse with `The node
feature is unavailable.` — the operator control transport that carries them
to the running node has yet to land — and the binding says so instead of
pretending.

## The supervisor's contract

Serve scans the data root before leading: when the store is empty and no
`service.lock` exists, it leads straight away. Otherwise it does the two
checks in a fixed order — first the state root, then the lock — and fails
closed: a failed root means `The node store failed to open.`, a failed lock
means `The node is locked.`, and serve starts nothing. Both failures keep
the node down with their exact words, and serve never half-starts: either
leading owns the lock or nothing owns it.

Once leading, serve owns the lock until it stops; stopping releases it, so
a `status` read between two serves can watch ownership change hands. The
lock is a file, and files survive crashes: while `service.lock` exists, the
CLI treats the node as running and refuses, and the recovery is the
operator's — check no node runs, remove the lock, carry on — as the home
guide shows.

## Stop and the lock commands

`stop` ends the serving node and releases the lock. `lock` and `unlock` are
the operator commands on the same lock: `lock` claims a free lock,
`unlock` releases it, and either refuses loudly when the lock is not in the
state the command needs. Both ride the control transport to the running
node, which has yet to land, so both refuse `unavailable` until it does.

## Status while stopped, and while the lock is held

A stopped node — no `service.lock` in the data root — answers `status` from
its files without troubling the binding: its id, `running:false`, a sealed
key store. When the lock exists, status goes to the live service instead;
until the control transport lands that question refuses `unavailable`. A data root
with no store at all is routine setup state and answers `notFound`, exit 1;
anything the CLI cannot name ends with the node's `failed` word on stderr,
never a traceback.
