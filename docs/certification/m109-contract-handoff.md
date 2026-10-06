# M109 lane 0 integration contract

The broker protocol is owned by this project, not a guessed Muse Code, Meta,
CDP or OS-helper frame. External formats require the captures listed in the
threat model. No runtime is enabled on this base.

## Consumers

| Lane                  | Supplied contract                                                                    | Integration obligation                                                                                                                                                                      |
| --------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C                     | VaultStorePort, private item/material schemas, slot and audit records                | Per-item/index encryption, generations, atomic persistence, byte ownership and erasure; reject rollback before returning material                                                           |
| P                     | VaultSlotPort, tier/provider/KDF records and pinned constants                        | Probe actual capability; authenticated provider-specific wrappedKey container; per-use presence; safeStorage backend check; no basic_text                                                   |
| B                     | requester, use proposal, approval, answer, ticket, audit and versioned broker frames | Authenticate peer and boot token; register only launched requesters; bind a connection to its requester; enforce mode/grant/ceiling/taint/presence, digest, counters, TTL, replay and epoch |
| S                     | ssh/sshSign uses and bindings; generated-key RFC 9987 pair                           | Parse SSHUSERAUTH and SSHSIG, verify session-bind/known_hosts, external-agent discovery, forwarding, per-requester sockets and Windows compatibility                                        |
| X                     | command/argv/cwd/environment digest, sudo/askpass/git/stdin/MCP uses                 | Resolve actual paths before hashing; verify execution-time identity; inherited ticket pipe; bounded askpass; current Git capability negotiation; fences, lifetime and scrub                 |
| T                     | taint provenance, hidden/first-party metadata, disclosure binding                    | Tools and delegate ceilings; no model/hook/reviewer approval; byte redaction at every output boundary                                                                                       |
| L                     | exact HTTPS fill/browser/frame facts, session and TOTP material                      | Validate current CDP origin, frame, certificate and field; never read password back; cookies expire within the configured 30-day bound; capture actual CDP responses                        |
| O                     | MCP command/name binding, header origin and OAuth issuer/resource                    | Resolve only MCP references at launch; PKCE/discovery/audience/refresh rotation; no token passthrough                                                                                       |
| M                     | private material and metadata separation                                             | Copy/decrypt/hash verify, retain/mirror for two minor releases, undo and only then removal                                                                                                  |
| U / M95 / M104        | isolated modelsPanel vault state and hostApi/vaultMessages                           | Merge the vault slice and value-free frames into actual Models & Agents and authenticated bridges; native password box or terminal for values                                               |
| H / M80               | unattended requester, approval/session semantics, denied reason                      | CLI/ACP watch and commands; exec --vault admission, schemas check, no CI behavior change                                                                                                    |
| R / M96 / M100 / M107 | ceiling/grant fields and restricted remote-use schema                                | Runtime role ceilings and authenticated pinned device channel; owner-side selection/approval every time; no items, grants, approvals or values forwarded                                    |
| W                     | constants, strings, test fakes and certification records                             | Bundles/split readers, semgrep, complete quality/editor matrix, documentation and release integration                                                                                       |

## Canonical use

`canonicalVaultUse` validates a resolved use, then serializes `{v:1,use}`.
Object keys use UTF-16 code-unit ordering; strings use JSON escaping without
Unicode normalization; argv and other arrays preserve order. Environment/MCP
names are unique sets and are sorted before serialization, on the parsed copy.
`vaultUseDigest` hashes these UTF-8 bytes with SHA-256. The golden test pins the
format. Changing any executable, argument, cwd, sudo path, SSH destination,
host key, remote user/session/forwarding, Git scope, browser/frame/field,
header name, OAuth resource or disclosure recipient changes the digest.

A digest is not authentication or path resolution. The caller first resolves
real paths and live destinations. B recomputes the digest and compares actual
use again at dispatch. Clock is injected; the schema validates relative TTL,
while B enforces the current deadline. Approval answers cannot express Always.
The supplied broker fake always asks and does not implement runtime policy.

Slot `wrappedKey` is an opaque bounded base64 provider container. P validates
its provider-specific fields and exact cryptographic lengths before unwrap;
the lane-0 schema does not pretend to know a captured OS-helper shape. Private
material uses owned byte arrays; final consumers erase them. The in-memory
fake uses copies and deletes its held bytes on lock; it makes no claim about
JavaScript copies or memory zeroization guarantees.

## Strings, manifest and reference

All 125 vault labels, route names, warnings and complete approval/configuration
templates are in EN and all fourteen UI tables. Read `UI_TEXT.vault.*` only
inside runtime functions. Format substituted values with `fill`, counts with
existing localized plural forms and numbers/dates with Intl helpers. A technical
label may be spliced with its technical detail; a sentence uses one template.

`m109-manifest-strings.json` supplies the exact English plus fourteen translated
NLS additions for U: the Vault and Lock vault now commands, five machine-scoped
settings and all four protection choices. It is a registration handoff, not a
new shipped translation format. U copies each locale into `package.nls*.json`
when registering its corresponding package.json keys. Adding those keys before
U’s registrations fails the existing unused-manifest-key gate; lane 0 leaves
that gate intact and does not edit U’s manifest.

`featureCatalog.ts` and the reference generator are absent on this base.
Integration must register the two commands, five settings, the vault CLI
subcommands (`status`, `unlock`, `lock`, `list`, `add`, `remove`, `grant`,
`revoke`, `audit`, `import`, `public-key`, `watch`), ACP `/vault` and local exec
`--vault`. Run each implemented command before documenting it as supported.

`m109-model-text.json` supplies the English tool/policy text for T's lazy tool bundle. It is an integration artifact, not a runtime lookup. W must register its declared
bundle readers in the split check together with T's `VAULT_MODEL_TEXT` block;
no unused block or activation-bundle placeholder is added on this base.

## W host API record handoff

`npm run check:host-api` fails solely on `node:crypto` imports 46 → 47,
from the canonical digest. The 332 VS Code APIs, 31 adapter files, 25
built-ins and 61 theme variables are unchanged. W owns the generated
`docs/ide-compatibility/host-api.md`; lane 0 leaves it untouched under the
brief's file-ownership rule. W regenerates with
`npm run check:host-api -- --write`, reviews the full integrated diff and
reruns the check. No gate ignore or alternative hash implementation is added.
