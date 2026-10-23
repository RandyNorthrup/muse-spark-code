# The workspace volume and the tool host

A home node carries two things: its state root (identity, key slots, setup
code, the service lock) and its workspaces — the workspace volume,
`workspaces/` under the data root by default, or wherever `--workspace-root`
pointed at `init`.

## Pointing init at a workspace volume

`init` takes the volume as `--workspace-root` (or `-w`) and records it. The
default workspace directory is created when it is missing, and init refuses
on an unknown flag or a bad path instead of guessing. The recorded path is
the one `wipe` destroys; init records exactly what it was given.

## Wipe destroys both

`wipe --confirm-wipe` holds the lock, destroys the key slots and the
identity, then removes the state root and the recorded workspace volume
together. Without the flag it refuses and keeps everything; on a running
node it refuses even with the flag. The CLI's contract is absolute: wipe
removes what init recorded — a nested volume path inside the state root and
a volume elsewhere on disk are both removed, and after wipe neither
directory exists.

## The tool host unit

`muse-node-toolhost.service` is the second unit the installer lays down. It
runs as the `muse-tools` user with no write access to the node's state —
its slice of the system is the tool bundles and the task workspace. Until a
release ships its bundle, the unit is installed but inert: the installer
verifies the bundle only when `.toolhost-shipped` says it is there, skips
the check otherwise, and never starts a host that has nothing to run. A
bundle's arrival is a release event, not an operator one: the release that
ships the tool host flips the marker, and the installer verifies the bundle
from that release on.
