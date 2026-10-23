# Serving the home node

`serve` starts the node supervisor: it owns the service lock for the node's
whole life and answers commands until it stops. Today `serve`, `stop`,
`lock` and `unlock` refuse with `The node feature is unavailable.` — the
production binding has no supervisor yet, so there is nothing to serve, stop
or lock, and the binding says so instead of pretending. Enabling those four
commands is the A1/M104 record, not this guide.

## The supervisor's contract (what A1 enables)

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
state the command needs. All three ride the same supervisor the binding has
yet to land, so all three refuse `unavailable` alongside serve today.

## Status while stopped, and while the lock is held

A stopped node — no `service.lock` in the data root — answers `status` from
its files without troubling the binding: its id, `running:false`, a sealed
key store. When the lock exists, status goes to the live service instead;
with no supervisor that question refuses `unavailable` today. A data root
with no store at all is routine setup state and answers `notFound`, exit 1;
anything the CLI cannot name ends with the node's `failed` word on stderr,
never a traceback.
