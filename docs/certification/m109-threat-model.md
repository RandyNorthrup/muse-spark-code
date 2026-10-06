# M109 lane 0: threat model and contract boundaries

This is the lane-0 record for PLAN D89.15. Runtime enforcement belongs to the
named lanes below. A contract rejection proves validation, not OS isolation,
scrubbing, policy enforcement or revocation. Fakes are under `test/**` only.
No credential store is read and no model call is required by these tests.

Research: [82-source recheck and corrections](m109-research-check.md).

## Trust boundaries

The model and its tool arguments are untrusted. The host registers only
requesters it started; the broker derives identity from the connection and
checks peer credentials. An identity in a frame is never authentication.
Only the host's authenticated UI answers approvals. Presence is a separate
OS challenge. A grant never authorizes a paid call.

Item metadata is deliberately separate from secret material. Public lists,
panel state, approvals, audit records and device requests carry metadata
only. First-party keys remain an exceptional per-request read by trusted
HTTPS clients. Feeder material travels only on the authenticated broker
channel and its single-use ticket travels on an inherited pipe.

## Threats, tests and remaining enforcement

| Threat                             | Lane-0 check                                                                         | Runtime proof owner                                               | Residual                                                               |
| ---------------------------------- | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------- | ---------------------------------------------------------------------- |
| V1 Prompt injection                | Taint and disclosure are explicit; no values in metadata or answers                  | T provenance, B forced ask, X handles-only; adversarial injection | A user can approve the injection's use                                 |
| V2 Exfiltration by granted command | Digest binds command, cwd and environment names; process disclosure is represented   | X feeder and scrub tests                                          | A program with a value can send arbitrary encodings or use its network |
| V3 Malicious MCP                   | MCP command and server name, header origin and OAuth resource are separate bindings  | O audience, rotation and no passthrough; T MCP taint              | A server holds its approved values                                     |
| V4 Compromised extension host      | Presence and first-party visibility are explicit; public protocol has no secret read | B/P peer, first-party and presence tests                          | Host can read first-party keys and forge non-presence UI answers       |
| V5 Other user                      | Host registration and authenticated channel are separate injected ports              | B/P owner-only socket/DACL and foreign-user captures              | Root and administrators                                                |
| V6 Same-user malware               | Slots identify silent versus presence tiers, with no basic_text slot                 | C/P slot tests and captures                                       | Silent slots remain accessible to same-user code                       |
| V7 Memory reads                    | Private material ports use Uint8Array ownership, disposed by caller                  | C/P/B/X unpooled Buffer and zeroing; memory captures              | JS copies, swap, debuggers, Windows same-user process rights           |
| V8 Clipboard                       | Public SSH key is metadata; no clipboard operation in protocol                       | U public-key-only clipboard test                                  | User may copy a value outside the vault                                |
| V9 Logs/exports                    | Strict audit and panel schemas reject value-shaped extra fields                      | T scrub boundaries; B authenticated audit; W semgrep              | Unknown values and arbitrary encodings                                 |
| V10 Devices                        | Remote protocol admits only signatures and codes; no items, grants or env            | R per-use approval on owner and channel frame test                | Codes and signatures are usable capabilities                           |
| V11 Replay                         | Answer/ticket bind id, digest, nonce, epoch and expiry; generation is bounded        | B counters, expiry, replay and audit; C rollback                  | Same-user attacker may restore all non-hardware rollback state         |
| V12 Unattended                     | Requester names unattended kind; presence/unattended conflict rejected               | B/R/H fail-closed admission and headless flag                     | Approved unattended scope                                              |
| V13 Impersonation                  | Requester registration and use proposals are separate; tickets bind requester        | B peer checks; X inherited pipe; R per-worker sockets             | Same-user socket discovery without extra OS isolation                  |
| V14 Fill spoofing                  | Fill requires exact HTTPS top/frame origins and valid certificate fact               | L current CDP frame/element/certificate check                     | Page scripts can observe a filled value                                |
| V15 sudo swap                      | Digest includes absolute sudo path, argv and canonical cwd                           | X realpath/fence, -k/-K, askpass bounds; sudo capture             | NOPASSWD and executable replacement outside isolation                  |
| V16 Concentrated vault             | Slot generations and lock epochs are explicit; lock messages carry no values         | C/P/B per-item crypto, idle/screen/exit/epoch lock                | Unlocked vault is exposed to same-user memory attacks                  |

## Capture plan (zero model attempts)

Use an owner-approved scratch folder and generated throwaway material only.
Record OS, tool versions, workspace, input/output frame hashes and counted
model attempts (zero). Redact usernames and home paths in published receipts.
Never inspect the user's existing credentials or automate an OS consent.

| Capture                                  | Rig / owner                | Evidence required                                                                                            |
| ---------------------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------ |
| PCP algorithms and presence cache        | Windows PC and Win11 VM, P | NCrypt probes; RSA OAEP wrap; prompt count per process; ECC only if probed                                   |
| Hello padding                            | Windows PC, P              | Same generated challenge twice, padding verification; used only as a gate                                    |
| DPAPI / Credential Manager network logon | Win11 VM, P                | Generated wrapped key through ssh -n; no real store entry                                                    |
| SSH pipe and session-bind                | Windows, Kubuntu, Mac, S   | Generated host/client keys, identities/sign/extension frames; Windows and Git-for-Windows clients separately |
| TPM access and systemd user credentials  | Kubuntu, P                 | Device readability without writing, group and systemd version, generated seal/unseal                         |
| Memory access                            | Kubuntu and Mac, P/B       | Generated broker canary, unrelated same-user reader; Yama value; never existing process memory               |
| sudo stdin / askpass / NOPASSWD          | Kubuntu and Mac, X         | Throwaway user/password removed after; -k refuses cache; -K clears askpass; rig warning case                 |
| Keychain and SE unavailable              | Intel Mac mini, P          | Generated slot; SecureEnclave.isAvailable false; no SE success claim                                         |
| SE ECDH and userPresence                 | Capable Mac, P / Q-M109    | Ad hoc helper creation, blob reload, ECDH wrap, actual prompt; blocked until owner has capable Mac           |
| Headed browser authenticators and fill   | Every rig, L               | Pinned runtime digest, local HTTPS/WebAuthn test page, exact frame checks; no real login                     |

These are plans, not performed captures. RFC fixtures follow published primary
protocols; no Muse Code or Model API wire shape is invented here. Each runtime
lane records its own live platform captures before claiming support.
