# M109 X — Exec routes and the fence

Rig: Intel Mac mini, `/Users/randy/lanes/M109X`, branch `m109/x`, base
`8a151dd40`. No credentials read; all test material is generated at runtime.
Model attempts and paid calls: **zero**. No new dependency or machine setting.

Read PLAN D89 and M109, the 82-source research and its lane-0 recheck,
`m109-threat-model.md`, and the shared rig rules. The rig brief overrides the
shared historical merge instructions and aggregate quality requirement:
**no merge, push, rebase or aggregate quality in this lane**. The lead owns
joined-tree quality. `docs/orchestration-gotchas.md` is absent on this base
and the local main reference; no other worktree was read.

## Fence (first piece)

D89.5 now fences existing VS Code Model API shell processes and runtime
credential/keyring routes. Case variants are removed, git config environment
is reset (empty credential.helper, useHttpPath), terminal prompts are disabled,
and inherited askpass paths and agent sockets are removed. The trusted launcher
may supply a refusing helper and a requester-specific socket. Empty helper paths
fail closed while the installed helper binding is pending. The Muse manager
keeps Muse Code's credential variables and replaces only SSH/git/askpass routes.
Its injected fence-off switch is only for the main interactive conversation.
The VS Code shell samples the machine setting per command. Workers and headless
callers retain default-on fencing.

Tests on this rig, default repository timeout, maxWorkers=3:

- execFence + toolIo + acpRuntime: 88 passed; 2 existing platform skips.
- museCodeBackendManager + execFence: 22 passed.
- Full five-project typecheck and targeted ESLint: passed.
- The initial execFence run failed on both the ambient shell credential and
  inherited runtime git helper; both passed after the adapter fixes.

## Red drills

Each mutation ran the entire named test file. Source restored in finally and
SHA-256 compared byte-exact. A nonzero exit and named failure were required.

| Guard / threat                   | Observed named failure                                                                                                     | Restored SHA-256                                                   |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| credential removal (V1/V2/V13)   | fences the existing VS Code shell path by default                                                                          | `928dc8c6dfc3c6424b788d1ca87a3d0604412242d685cb39627d86780b84e2a4` |
| git override removal (V1/V2/V13) | fences the existing VS Code shell path by default; preserves Muse Code credentials while replacing its ambient SSH and git | `928dc8c6dfc3c6424b788d1ca87a3d0604412242d685cb39627d86780b84e2a4` |

## Integration handoffs (owned by W/S/U/H)

- W: bind the Muse manager's `getAgentFence` machine-setting reader; S supplies
  `getVaultFence` requester socket (never the system Windows agent pipe).
- W: install a refusing helper and bind `vaultFence` for tool IO and Muse Code.
- W: README/CHANGELOG/SECURITY/PRIVACY and help reference record the default fence
  and its limit: a command can still read files the user can read. There is no
  featureCatalog on this base. No credential file discovery/import in lane X;
  that is lane M. No plaintext contents are read.

Further exec-route certification is appended in the next piece. This record
certifies the fence adapters, not final product wiring or platform captures.
