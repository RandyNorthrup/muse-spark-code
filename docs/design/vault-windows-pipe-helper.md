# Vault broker on Windows: the pipe helper contract

Lead decision 4 (2026-10-10, C-M109-1): Node cannot give a named pipe an
owner-only DACL, refuse remote clients, or read the connecting client's
process id. A trusted C# helper owns the pipe and relays each accepted
connection to the broker over its standard streams. It also carries the
owner-only file commands that `VaultFileSecurityPort` and
`VaultPrivateFilesPort` need on Windows. Lane C-M109-1c (Win11 rig) builds it
against this contract. The TypeScript side is
`src/core/vault/broker/windowsPipe.ts`.

## Build and launch

- Source: `native/windows/MuseSparkVaultPipe.cs`. It compiles together with
  `MuseSparkVault.cs`, so `VaultPathGuard` (the handle-based
  `GetSecurityInfo` checks from FIXM109PW3) is shared, not copied.
- The helper builds and runs through the existing guarded path
  (`src/host/vault/slots/windowsVaultBuild.ts`: digest from this process's own
  build, `VaultPathGuard.Launch`, a kill-on-close job object, System32-only
  DLL search). Ship the source in the VSIX and the ACP package beside the other
  `MuseSparkVault*.cs` files (`.vscodeignore`, `scripts/lib/acpNativeSources.mjs`,
  `build.yml`'s package lists).
- Modes:
  - `serve`: the broker starts it once, and it lives as long as the broker.
  - `files`: any other process that opens the store (the host's first-party
    fallback, the CLI). File commands only, no pipe.
- Standard input carries one first line of UTF-8 JSON:
  `{"v":1,"mode":"serve","pipe":"\\\\.\\pipe\\muse-spark-vault-<32 hex>"}`
  (in `files` mode, no `pipe`). After that line, standard input and output
  carry relay frames. Standard error carries only fixed words, never a path,
  SID or byte of payload.

## The pipe

- **Name.** `\\.\pipe\muse-spark-vault-<32 random hex>`, new at each broker
  start. The broker writes it only into the owner-only `run/broker.lock`
  (`socket`). Another user can neither read the name nor create the pipe
  first, because they cannot predict the name.
- **Create.** `CreateNamedPipeW`:
  - flags `PIPE_ACCESS_DUPLEX | FILE_FLAG_OVERLAPPED`, and
    `FILE_FLAG_FIRST_PIPE_INSTANCE` on the first instance;
  - mode `PIPE_TYPE_BYTE | PIPE_READMODE_BYTE | PIPE_REJECT_REMOTE_CLIENTS`;
  - a security descriptor whose owner is the helper's token user and whose
    DACL is protected, with a single ACE: `D:P(A;;GA;;;<user SID>)`. There is
    no ACE for SYSTEM, Administrators, Everyone or anyone else.

  If the first instance fails because the name exists, the helper faults
  `squatted`. Any other failure faults `createFailed`.

- **Read back.** After creating the pipe, the helper reads the DACL back with
  `GetSecurityInfo` on the server handle and checks that it holds exactly that
  one allow ACE. Only then does it send `ready` with
  `{v:1, pipe, ownerSid}`.
- **Per client**, before sending `open`, the helper records:
  - `GetNamedPipeClientProcessId`;
  - the client token's user SID, via `OpenProcess` with
    `PROCESS_QUERY_LIMITED_INFORMATION` and `GetTokenInformation(TokenUser)`;
  - the creation time from `GetProcessTimes`, as Unix milliseconds;
  - the image path from `QueryFullProcessImageNameW`;
  - `remote` (whether `GetNamedPipeClientComputerName` succeeded);
  - `ownerOnlyDacl` (the read-back above).

  If any of these fails, the helper disconnects the client without an `open`
  frame. The broker's `WindowsVaultPeerVerifier` refuses `remote: true`,
  `ownerOnlyDacl: false` and any SID other than the broker's own.

- **Limit.** There are at most 64 simultaneous connections
  (`WINDOWS_VAULT_PIPE_MAX_CONNECTIONS`). The 65th is disconnected at once,
  with no fault.

## Relay frames (standard streams, binary)

Each frame has a 9-byte header (type `uint8`, connection id `uint32` BE,
payload length `uint32` BE) followed by the payload. A payload is at most
`VAULT_LIMITS.frameBytes`. Connection ids are assigned by the helper, start
at 1 and are never reused within one helper's life. Connection 0 is the
helper itself.

| Type | Direction               | Payload                                                               |
| ---- | ----------------------- | --------------------------------------------------------------------- |
| 0x01 | `ready`, to Node        | JSON `windowsVaultPipeReadySchema` (connection 0)                     |
| 0x02 | `open`, to Node         | JSON `windowsVaultPipeClientSchema`                                   |
| 0x03 | `data`, to Node         | client bytes                                                          |
| 0x04 | `end`, to Node          | empty: client closed or broke the pipe                                |
| 0x05 | `fault`, to Node        | one `windowsVaultPipeFaultSchema` word (connection 0), then exit      |
| 0x06 | `fileResult`, to Node   | JSON `windowsVaultPipeFileResultSchema` (connection 0)                |
| 0x07 | `serverResult`, to Node | JSON `windowsVaultPipeServerResultSchema` (connection 0)              |
| 0x13 | `send`, to helper       | bytes for the client                                                  |
| 0x14 | `close`, to helper      | empty: disconnect this client                                         |
| 0x21 | `file`, to helper       | JSON `windowsVaultPipeFileCommandSchema` (connection 0)               |
| 0x22 | `server`, to helper     | JSON `windowsVaultPipeServerQuerySchema` (connection 0), `files` mode |

The helper faults `protocol` and exits on any of these: an unknown type, an
oversized length, a frame for an unknown connection, or malformed JSON. When
standard input reaches EOF, it disconnects every client, closes the pipe and
exits 0. It never logs or inspects payload bytes.

On the Node side, each `open` becomes a `WindowsVaultPipeConnection` (a
`Duplex` carrying `client`). It is handed to `VaultChannelServer.accept` (and
to the exec helpers' and SSH endpoints' `listen`) as the secured listener's
accepted stream. `inspect(stream)` returns its `client`.

## Owner-only file commands

`protect` sets the owner to the user and applies a protected DACL:

- a directory gets `D:P(A;OICI;FA;;;<user SID>)`;
- a file gets `D:P(A;;FA;;;<user SID>)`.

It refuses reparse points.

`verify` runs `VaultPathGuard`'s handle-based check: a non-null DACL, generic
rights mapped, ordered deny/allow evaluation, no access for any principal but
the user, and no reparse point in the path or its lexical ancestors.

Each command answers `ok`, `refused` or `missing`. The TS side maps
`refused` to `VaultError('io')` (store) or `vault.noAccess` (broker files),
and `missing` to an `ENOENT`-coded error, so `isVaultFileMissing` keeps
working.

Budget: `verify` takes at most 5 ms in steady state, because the store
verifies every file it reads, so it never starts a process per check.

## The client side: the server's identity is verified natively

Hosts connect with Node's `net.connect(lock.socket)`. Before a host sends
`hello` (which carries the boot token), its `VaultPeerVerifier` must prove
natively that the pipe's server is this user's broker (RVCM1091A F9). A
random name read from the owner-only lock is not sufficient on its own:

1. The host's helper (`files` mode) receives a `server` command naming the
   pipe from the lock file. It opens the pipe as a client with
   `SECURITY_SQOS_PRESENT | SECURITY_IDENTIFICATION`, so a server can
   neither impersonate the host nor read anything from it. It then reads:
   - `GetNamedPipeServerProcessId`;
   - the server's token user SID, via `OpenProcess` with
     `PROCESS_QUERY_LIMITED_INFORMATION` and `GetTokenInformation(TokenUser)`;
   - its creation time;
   - its image path.

   It closes that probe connection without sending a byte, and answers with
   a `serverResult`.

2. The TS verifier refuses unless all of the following hold, every one of
   them read from the OS:
   - the server's `userId` equals the host helper's own token SID
     (`ownerSid`);
   - its `processId` and `startedAt` equal the lock file's;
   - `remote` is false.
3. Only then does the host connect for real and send `hello`. The broker's
   owner-only DACL denies `FILE_CREATE_PIPE_INSTANCE` to every other user,
   so once step 2 has passed, no other user's process can serve that name.

Code running as the same user remains out of scope, as PLAN D89.15 records.

## What the lane must deliver

1. `MuseSparkVaultPipe.cs` with both modes, compiled through the guard.
2. The TS relay that implements `WindowsVaultPipeHelper`, with fakes for its
   unit tests and a Win11 rig test against the real helper. The rig test
   checks that another SID is refused, that a client gets refused once 64
   connections are open, that a second instance of the name is `squatted`,
   and that both file commands work on a directory and a file. It also
   checks that the client side refuses a pipe served by another user's SID
   (a throwaway local user made for the test and removed after), a server
   whose process id or start time differs from the lock, and a remote
   server.
3. Red drills, recorded in `docs/certification/m109.md`: skip the DACL
   read-back, accept `remote: true`, drop the `protect` call in
   `NodeVaultFiles`, and skip the server SID comparison on the client.
