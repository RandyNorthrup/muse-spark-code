# A credential vault and broker for agents: platform facts and precedents (2026-10-05)

Research for PLAN.md D89/M109. The owner (2026-10-05): "how do our agents
handle auth? i would like ideally for there to be some sort of secure enclave
that passwords and usernames and keys for like unattended access or ssh or
sudo etc is stored safely and the agents can securely call on them if needed
and the orchastrator can restrict the access as needed or maybe the agents
need to ask the orchastrator for permission figure out a good secure plan for
this". Then: "this could even be secure tokens for logins and website account
logins etc", and "and they should be modes for this from the orchastrator as
well like ask, always allow etc".

## Method

- **Read-only.** No credential, key, keychain entry or auth file was read, and
  no model call was made. The repository facts in §1 come from reading the
  source at `1262a926`.
- **Two research passes** with web fetches and searches: one over the
  platform key stores (Apple, Microsoft, freedesktop, TPM2, KDFs, memory),
  one over the brokered uses (SSH agents, git, sudo, WebAuthn and TOTP, MCP,
  SecretStorage). The lead fetched a few pages more (Yama, Windows process
  rights, OWASP's scrypt line, two prompt-injection papers).
- **Quotes** are verbatim unless marked "(paraphrase)". Quotes marked
  **[checked]** were compared word for word with the raw page or source file;
  the others came through a fetch tool's text extraction. M109's lane 0
  re-reads every source and checks each quote before it lands in
  `docs/certification/m109-threat-model.md`.
- **Dates.** Each source gives the date the page shows, or "no date shown".
  Every page was read on 2026-10-05.
- **Conflicts and gaps** are listed in §7, with what lane 0 captures to settle
  each.

## 1. How the agents handle credentials today (the repository)

| What                         | Where it lives today                                                                                                                                                                                                                                         | Who can use it                                                                                                                                                                                      |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The Model API key            | VS Code's SecretStorage, `museSpark.modelApiKey` (`src/host/auth/credentialStore.ts`, `SECRET_KEYS` in `src/shared/constants.ts`)                                                                                                                            | The extension's own HTTP clients (the Model API backend, Muse Voice, Tab, the `ide` server's paid tools). Never a child process (AGENTS.md rule 8)                                                  |
| The same key outside VS Code | The OS store through `@napi-rs/keyring`, service `Muse Spark Code (Unofficial)`, account `museSpark.modelApiKey` (`src/runtime/keyStore.ts`, D61)                                                                                                            | The ACP agent's own clients; entered only by `auth set` on standard input                                                                                                                           |
| Muse Code's sign-in          | The CLI's `auth.json` (and the login Keychain on macOS, D1a)                                                                                                                                                                                                 | Muse Code only. The extension reads the file's structure, never a value (`src/core/backends/musecode/credentialFile.ts`)                                                                            |
| Credential variables         | The user's environment                                                                                                                                                                                                                                       | Hooks never (`hookEnvironment`, `isCredentialVariable` in `src/host/backend/toolIo.ts`). The ACP agent takes them out of its own environment at start (`src/runtime/credentialVariables.ts`)        |
| Agent sockets and CI tokens  | `SSH_AUTH_SOCK`, D-Bus and keyring addresses, `GITHUB_TOKEN` and the Actions token variables                                                                                                                                                                 | Dropped from the ACP agent's tool processes (`EXEC_CHILD_ENV_DROP`, `withoutKeyringRoutes` in `src/runtime/backends.ts`)                                                                            |
| The VS Code shell tool       | `shellEnvironmentOf` in `src/extension.ts` (the extension host's environment with `terminal.integrated.env.*` applied), through `shellEnvironment` in `toolIo.ts`, which removes only the host's own plumbing (`ELECTRON_*`, `VSCODE_*`, Snap and GDK paths) | **An approved command on the Model API backend sees what VS Code's terminal sees:** the user's `*_API_KEY` variables, `SSH_AUTH_SOCK`, token variables, and every credential file the user can read |
| Secrets in approval cards    | A shell command holding a detected secret                                                                                                                                                                                                                    | Redacted for display and offered allow-once only (`src/core/agent/approvalSecrets.ts`, M92e)                                                                                                        |
| Logs, exports, the panel     | Any text                                                                                                                                                                                                                                                     | The shared redactor: literal-first, then the pattern table (`redactSecrets(text, literals)` in `src/shared/redact.ts`; `SECRET_RULES`, `MAY_HOLD_SECRET`)                                           |
| sudo                         | Whatever the machine's sudoers says                                                                                                                                                                                                                          | An approved command that runs `sudo` gets root without a prompt where sudoers says `NOPASSWD` (the owner's Kubuntu and Mac mini rigs), and fails without a terminal elsewhere                       |

Stores planned in milestones that have not merged: M95's provider credentials
(`museSpark.provider.<id>`, a `{v, auth, origin}` record bound to its origin),
M95b's ChatGPT plan tokens, M95c's custom header values, M108's
`museSpark.provider.<id>.account.<accountId>`, M100's per-pair private keys,
M103's machine API keys, M85's TypeSafe key. Each sits in SecretStorage, or
the OS store in the runtime. M96's workers already run with no credential
helper, `GIT_TERMINAL_PROMPT=0`, no askpass, no `SSH_AUTH_SOCK` and an `ssh`
that refuses; M96c's runners connect with `BatchMode=yes`,
`StrictHostKeyChecking=yes` and `ForwardAgent=no`. M50 left OAuth for remote
MCP servers for later, so the extension holds no MCP token today; `muse mcp
login` tokens are Muse Code's and never read (D42).

**The finding.** Agents get no stored secret, by design. In the VS Code
window they do get the user's ambient authority (environment, agent socket,
credential files), and the only way to give an agent a credential on purpose
is to put it where every process can read it. D89 replaces both with
brokered, approved, logged uses.

## 2. Hardware and OS key stores

### 2.1 macOS

- **The Secure Enclave holds only P-256 keys.** "Works only with NIST P-256
  elliptic curve keys. These keys can only be used for creating and verifying
  cryptographic signatures, or for elliptic curve Diffie-Hellman key exchange
  (and by extension, symmetric encryption)." And: "Can't encode preexisting
  keys. You must use the Secure Enclave to create the keys." (Protecting keys
  with the Secure Enclave [1].)
- **Not every Mac with the chip offers the API.** The same page: "Only … a Mac
  with the Touch Bar and Touch ID or with an M1 or later processor support
  this feature." The Platform Security guide places a Secure Enclave in "All
  Intel-based Mac computers that contain the Apple T2 Security Chip" [3]; an
  Intel Mac without Touch ID has the chip and no developer access to it.
- **CryptoKit wraps SE keys as a device-bound blob.** "the Secure Enclave
  exports an encrypted block that only the same Secure Enclave can later use to
  restore the key" [4]. A DTS engineer (June 2022): "The dataRepresentation
  property returns a copy of the key itself, but wrapped in a way such that it
  can only be unwrapped by your SE. You can do whatever you want with that data
  … write it to a file." [14] The initializer takes an access control; its
  default is `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly` with no flags
  [15].
- **Access control flags** [2]: `userPresence` "Constraint to access an item
  with either biometry or passcode"; `biometryCurrentSet` "…Touch ID for
  currently enrolled fingers…"; `devicePasscode`; `privateKeyUsage` "Enable a
  private key to be used in signing a block of data or verifying a signed
  block." `WhenUnlockedThisDeviceOnly` items "do not migrate to a new device".
- **Keychain items protected by the SE need entitlements we cannot get as a
  CLI.** TN3137 [16]: "Some keychain features require the data protection
  keychain, including: … Protecting an item with biometrics (Touch ID and Face
  ID) … Protecting a key with the Secure Enclave." Its access groups come from
  "code signing entitlements … These entitlements must be authorized by a
  provisioning profile … not for command-line tools", and "If you're building
  library code, its data protection keychain access is determined by the
  entitlements of the host process's main executable." "The file-based
  keychain is on the road to deprecation." An October 2021 DTS answer: "To
  interact with keys protected by the SE you must use the iOS-style keychain,
  and that requires an entitlement that's authorised by a provisioning profile."
  [17] (It conflicts with the 2022 answer above for CryptoKit keys that are
  never stored in the keychain; §7.)
- **Keychain data protection.** "Keychain items are encrypted using two
  different AES-256-GCM keys: a table key (metadata) and a per-row key." "The
  metadata key is protected by the Secure Enclave but is cached in the
  Application Processor." [5]
- **A CLI precedent.** age-plugin-se keeps an age identity in the Secure
  Enclave from a command-line tool, with access control "none, passcode,
  any-biometry, any-biometry-or-passcode, any-biometry-and-passcode,
  current-biometry"; "The private key is bound to the secure enclave of your
  machine, so it cannot be transferred to another machine." [36] Its README
  does not say what entitlements it uses.
- **For D89:** the vault key can never live in the SE. The SE slot is an
  ECDH wrap (an ephemeral P-256 key plus the SE key, HKDF, AES-GCM over the
  vault key), only where `SecureEnclave.isAvailable`, only after a capture
  shows our ad hoc signed helper may create the key. Passwords as Keychain
  items with SE-backed access control need our own provisioned `.app`, which
  needs an Apple Developer team. The login (file-based) Keychain stays the
  fallback, as D61 and VS Code use today.

### 2.2 Windows

- **The TPM key storage provider.** `MS_PLATFORM_CRYPTO_PROVIDER` "Identifies
  the TPM key storage provider that is provided by Microsoft." [6] A key
  created without `NCRYPT_MACHINE_KEY_FLAG` "applies to the current user" [7].
  "if a key stored in a TPM has properties that disallow exporting the key,
  that key truly can't leave the TPM." "Keys that a TPM protects can require
  an authorization value such as a PIN." [8] "The TPM protects certificates
  and RSA keys." [9] "TPM key attestation only works for RSA keys." [10]
  "Some TPMs don't support all algorithms." [11] No page we read confirms ECC
  keys on this provider (§7).
- **UI policy.** `NCRYPT_UI_POLICY` with `NCRYPT_UI_FORCE_HIGH_PROTECTION_FLAG`
  ("Force high protection") makes the OS show its own key prompt; the policy
  "can only be set when the key is being generated", and "Microsoft KSPs will
  cache this value so that the user is only prompted once per process." [12]
  [13]
- **Windows Hello signs; it does not decrypt.** KeyCredentialManager: "key
  credentials, which are RSA 2048-bit keys", "Signature Format: PKCS #1 RSA
  PSS with SHA256." [18] The developer guide: "If the device does not have a
  TPM chip, the private key is encrypted and protected by software", "An
  application can never use the keys from another application", and
  `RequestSignAsync` makes "Windows … request the user's PIN or biometrics."
  [19] Desktop callers need a window handle (`RequestVerificationForWindowAsync`).
  `UserConsentVerifier` "performs a verification" and returns only a result
  enum [20]. PSS signatures are randomized, so no stable wrapping key can be
  derived from one; the guide's own sample verifies with PKCS #1 v1.5 padding,
  which conflicts (§7).
- **DPAPI.** "Typically, only a user with the same logon credential as the
  user who encrypted the data can decrypt the data." [21] .NET's
  `CurrentUser` scope: "Only threads running under the current user context
  can unprotect the data." [22] DPAPI-NG protects "to a set of principals",
  with descriptors such as `LOCAL=user` and `SID=…` [23] [24].
- **Credential Manager.** A blob "cannot be larger than
  CRED_MAX_CREDENTIAL_BLOB_SIZE (5\*512) bytes" (2,560); "Network logon
  sessions do not have an associated credential set." [25] [26] Git
  Credential Manager says the same of its Windows store: "Does not work over a
  network/SSH session" [47].
- **Same-user processes can read each other.** A process's default ACLs "come
  from the primary or impersonation token of the creator", and reading its
  memory needs only `PROCESS_VM_READ` against that DACL [27]. Electron:
  DPAPI-protected content "is protected from other users on the same machine,
  but not from other apps running in the same userspace." [41]
- **Elevation cannot be brokered.** Sudo for Windows (Windows 11 24H2 or
  later): "sudo can only be elevated via the User Account Control (UAC)
  security feature… using verification prompt", and "It is possible for
  malicious processes to attempt to drive the elevated process using the
  connection established by the unelevated sudo.exe and the elevated sudo.exe
  process." [44] UAC: "The consent and credential prompts are displayed on the
  secure desktop by default. Only Windows processes can access the secure
  desktop." [45]
- **For D89:** the TPM slot is an RSA-2048 decrypt key on the Platform Crypto
  Provider (OAEP over the vault key), probed with `NCryptIsAlgSupported`. A
  silent TPM key and DPAPI protect against other users and a stolen disk, not
  against a process running as the user. Presence on Windows is the PCP key's
  forced-protection prompt, or a fresh Hello signature over the broker's
  challenge: a gate in the broker, not a key. Credential Manager holds only a
  wrapped key, and SSH sessions into Windows use a DPAPI file instead. Windows
  elevation stays the user's own UAC answer.

### 2.3 Linux

- **The Secret Service isolates nothing inside a session.** "This
  specification does not mandate any form of access control." "the service may
  choose to allow any client application to access items or collections
  unlocked by another client application." [28] GNOME Keyring's own
  philosophy: "An example of security theater is giving the illusion that
  somehow one application running in a security context (such as your user
  session) can keep information from another application running in the same
  security context." [29] KWallet's daemon "exposes the Secret Service DBus
  API" [30].
- **TPM2.** "A sealing object allows to seal user data to the TPM, with a
  maximum size of 128 bytes." [31] `tpm2_unseal`: "The data blob is returned
  in clear." [32] The udev rule: "tss group members can access tpmrm devices."
  [33] `systemd-creds --user`: "Such credentials may only be decrypted from the
  specified user's context, except if privileges can be acquired"; the user's
  UID, name and the machine id "are incorporated into the encryption key.
  Added in version 256." [34] ssh-tpm-agent: "TPM sealed keys are private keys
  created inside the Trusted Platform Module… bound to the hardware they are
  produced on", with "PIN support, dictionary attack protection" [37].
- **The kernel keyring** keeps a "user" key "entirely within kernel memory"
  per UID [35]: a cache, not a store (D61 already refuses it as a store: it
  forgets at reboot).
- **Ptrace.** With Yama's `ptrace_scope` at 1, "a process must have a
  predefined relationship with the inferior it wants to call PTRACE_ATTACH on.
  By default, this relationship is that of only its descendants"; at 0, "any
  other process running under the same uid, as long as it is dumpable." The
  page names ssh-agent's `prctl(PR_SET_DUMPABLE, …)` as the defence. [38]
- **For D89:** a 32-byte vault key fits a sealed object. The TPM2 slot uses
  `systemd-creds --user` on systemd 256 or later, else tpm2-tools, and only
  where the user can open `/dev/tpmrm0`. The Secret Service is the fallback
  and is labelled as protecting data at rest only. Presence on Linux is a TPM2
  PIN or the vault passphrase.

### 2.4 VS Code's SecretStorage and Electron's safeStorage

- SecretStorage: "Represents a storage utility for secrets… that will be
  stored encrypted. The implementation of the secret storage will be different
  on each platform and the secrets will not be synced across machines." [39]
  **[checked]** VS Code 1.80 "started the move from keytar to Electron's
  safeStorage API" [40].
- safeStorage: macOS keys are kept "in a way that prevents other applications
  from loading them without user override"; Windows "content is protected from
  other users on the same machine, but not from other apps running in the same
  userspace"; on Linux, "If no secret store is available… they are encrypted
  via hardcoded plaintext password", the `basic_text` backend [41]
  **[checked]**. VS Code's Settings Sync page: basic text "provides
  obfuscation rather than secure encryption" [42].
- **For D89:** SecretStorage is one keyslot among several, as safe as today's
  storage and no safer. A `basic_text` backend is refused as a slot and the
  panel says why.

### 2.5 Key derivation for the passphrase slot

- RFC 9106 [43]: the first recommended option is "Argon2id with t=1
  iteration, p=4 lanes, m=2^(21) (2 GiB of RAM), 128-bit salt, and 256-bit tag
  size"; the second "t=3 iterations, p=4 lanes, m=2^(16) (64 MiB of RAM)".
- OWASP [46]: Argon2id "m=19456 (19 MiB), t=2, p=1" at minimum; scrypt
  "N=2^17 (128 MiB), r=8 (1024 bytes), p=1".
- Node's `crypto.argon2` exists in current Node; its source says "added:
  v24.7.0" (the rendered page disagreed; §7). VS Code 1.99's extension host
  runs Node 20 (D3's integration minimum), where only `crypto.scrypt` exists.
- **For D89:** Argon2id with RFC 9106's second option where the host's Node
  has it, else scrypt with OWASP's parameters. The KDF and its parameters are
  in the slot record, so a later host can re-wrap. No new dependency.

### 2.6 Memory

- `Buffer.alloc` "ensures that the newly created Buffer instance contents
  will never contain sensitive data"; strings and pooled buffers carry no such
  promise [48]. Node's `--secure-heap` covers "selected types of allocations
  within OpenSSL", "is disabled by default" and "is not available on Windows"
  [49]. Node has no `mlock`.
- `CryptProtectMemory` keeps memory unreadable when paged out but is "not
  secure because the data exists as plaintext in memory before it is
  encrypted" [50]. `mlock(2)` keeps pages from swap [51]; `MADV_DONTDUMP`
  excludes pages from a core dump [52].
- **For D89:** values live in unpooled Buffers, never strings where avoidable,
  zeroed after use. That is best effort, and the threat model says so: a
  process that can read the broker's memory can read what it holds.

## 3. Brokered uses

### 3.1 SSH agents

- **The protocol is RFC 9987** (May 2026, Standards Track) [53]. It defines
  the confirm constraint ("require explicit user confirmation for each private
  key operation using the key") and the lifetime constraint, and: "It is
  critically important that the agent only be exposed to its owner and their
  authorised delegates." "SSH implementations SHOULD NOT forward use of an
  agent by default".
- **The agent can learn the destination.** OpenSSH's `session-bind@openssh.com`
  extension (PROTOCOL.agent v1.26) carries the server's host key, the session
  identifier ("the exchange hash derived from the initial key exchange"), "the
  server's signature of the session identifier using the private hostkey" and
  `is_forwarding` [54]. It "cryptographically links the SSH
  connection's session identifier with the server's hostkey for the life of
  the agent connection"; it "requires protocol extensions in ssh-agent,
  ssh-add, ssh and sshd" (OpenSSH 8.9, 2022-02-23) [55] [56]. It is not in RFC
  9987, so other clients may never send it.
- **OpenSSH's own agent.** `ssh-add -c` makes identities "subject to
  confirmation before being used for authentication" through `ssh-askpass`;
  `-h` sets destination constraints; without `-t`, "the default maximum
  lifetime is forever"; the socket "is accessible only to the current user,
  but is easily abused by root or another instance of the same user." [57]
  [58] **[checked]**
- **1Password.** "Your private key never even leaves the 1Password app." "When
  you approve an SSH key request, you authorize a specific application to use a
  specific SSH key"; later commands in that process use it "without further
  approval until 1Password locks or quits, or for the amount of time set";
  "The authorization prompt indicates which process is requesting permission
  to use which SSH key". On Windows it listens on `\\.\pipe\openssh-ssh-agent`
  after the OpenSSH Authentication Agent service is disabled. [59] [60]
- **Bitwarden** (2025.1.2): "Ask for authorization when using SSH agent" is a
  user setting; a locked vault "Prompts to unlock vault, then prompts to
  authorize"; Ed25519 and RSA keys [61] [62].
- **Secretive.** "If you protect your keys with the Secure Enclave, it's
  impossible to export them, by design"; keys can "require Touch ID (or
  Watch) authentication"; "The Mac's Secure Enclave only supports 256-bit EC
  keys". [63]
- **Windows' pipe.** Win32-OpenSSH's agent: `AGENT_PIPE_ID
L"\\\\.\\pipe\\openssh-ssh-agent"` **[checked]** [64]. Microsoft's key
  management page says ssh-agent keeps keys "within a Windows security context
  that's associated with your Windows account" and that the service is
  disabled by default; it does not document the pipe or `SSH_AUTH_SOCK` [65].
- **For D89:** the broker is an RFC 9987 agent on a socket or pipe of its own
  per requester, never the system pipe. It reads `session-bind` to bind each
  signature to a host key, treats its absence as "destination not proven",
  refuses forwarded use unless granted, and fronts the user's own agent
  instead of hiding it. Hardware-resident keys are ECDSA P-256 only, on both
  the Secure Enclave and the TPM.

### 3.2 git credential helpers

- The protocol is key=value lines "terminated by a blank line or end-of-file",
  and "there is no quoting, and one cannot transmit a value with newline or
  NUL in it" [66]. Helpers answer `get`, `store` and `erase`; "For a store or
  erase operation, the helper's output is ignored." Without a helper git tries
  `GIT_ASKPASS`, `core.askPass`, `SSH_ASKPASS`, then the terminal; a helper
  string beginning with `!` is a shell snippet; `credential.useHttpPath` is
  off by default, so one credential covers every path on a host [67].
- Newer fields: `password_expiry_utc` ("Generated passwords such as an OAuth
  access token may have an expiry date"), `oauth_refresh_token` ("Helpers must
  treat this attribute as confidential like the password attribute"),
  `authtype` and `credential` behind a capability, and `ephemeral` ("should
  not be saved by the credential helper because its usefulness is limited in
  time" **[checked]**) [66].
- GitHub "recommends that you use fine-grained personal access tokens", each
  "limited to only access specific repositories" [68]. Git Credential Manager's
  stores include DPAPI files, the Keychain, the Secret Service and plaintext
  ("This is not a secure method of credential storage!") [47].
- **For D89:** a git credential always ends up in git's memory, so this route
  is a disclosure to the git process tree, scoped by protocol, host and path
  (`useHttpPath=true`), sent `ephemeral` with its expiry. SSH remotes through
  the broker's agent disclose nothing and are preferred.

### 3.3 sudo

- `sudo -A`: "a (possibly graphical) helper program is executed to read the
  user's password and output the password to the standard output"; "If the
  SUDO_ASKPASS environment variable is set, it specifies the path to the helper
  program." `-S`: "read the password from the standard input instead of using
  the terminal device." `-k` with a command: sudo "will prompt for a password
  (if one is required by the security policy) and will not update the user's
  cached credentials." [69] **[checked]**
- sudoers: `timestamp_timeout` is "Number of minutes that can elapse before
  sudo will ask for a password again"; with `timestamp_type=tty`, "If no
  terminal is present, the behavior is the same as ppid", where "Commands run
  via sudo with a different parent process ID… will be authenticated
  separately." [70] **[checked]**
- **For D89:** the brokered form is `sudo -S -k -p '' -- <argv>` started by
  the broker's feeder for one approved command: the password goes from the
  broker to sudo's standard input and nowhere else, and nothing is cached for
  a later command. The askpass form, for a script that calls sudo itself,
  hands the password to whatever runs the helper, so it is a disclosure to
  that command's tree and is labelled so. `NOPASSWD` sudoers bypass all of it;
  the panel says so.

### 3.4 Web logins: TOTP, passkeys and browser automation

- **TOTP** is "TOTP = HOTP(K, T)"; "The keys MAY be stored in a
  tamper-resistant device and SHOULD be protected against unauthorized access
  and usage"; "We RECOMMEND a default time-step size of 30 seconds." [71]
  HOTP: "the protection of shared secrets is of the uttermost importance."
  [72] Whoever holds the seed makes every future code.
- **Passkeys stay with their authenticator.** WebAuthn Level 3 (a W3C
  Recommendation, 25 August 2026): "The credential private key… is expected to
  never be exposed to any other party, not even to the owner of the
  authenticator"; "the public key credential can only be accessed by origins
  belonging to that Relying Party"; user verification is "The technical
  process by which an authenticator locally authorizes the invocation of the
  authenticatorMakeCredential and authenticatorGetAssertion operations." [73]
  **[checked]**
- **Automation gets only virtual authenticators.** WebAuthn §11 provides
  WebDriver commands "For the purposes of user agent automation and web
  application testing"; Chrome's `WebAuthn` domain "allows configuring virtual
  authenticators to test the WebAuthn API" and takes a raw "ECDSA P-256
  private key in PKCS#8 format" [73] [74] **[checked]**.
- **Credential exchange.** Synced passkeys move between a user's devices,
  device-bound ones "cannot leave the device" [75]. FIDO's CXF v1.0 (Proposed
  Standard, 9 March 2026) carries passwords, TOTP, SSH and API keys, and a
  passkey's private key in PKCS#8 [76]; CXP, the transfer protocol, is a
  working draft (3 October 2024) [77].
- **For D89:** the broker keeps TOTP seeds and returns codes. A fill types a
  username, password or code into the harness's own browser (M81's pinned
  Chrome for Testing) only on the bound origin. A passkey sign-in is the
  user's, on the device, in a headed window of that browser, and the vault
  keeps the resulting session cookies, never a passkey. CXF files are not
  imported while CXP is a draft and a CXF passkey would carry a private key.

### 3.5 MCP authorization

- The 2026-07-28 specification: "Implementations using an STDIO transport
  SHOULD NOT follow this specification, and instead retrieve credentials from
  the environment." "MCP clients MUST implement Resource Indicators for OAuth
  2.0 as defined in RFC 8707." "MCP servers MUST validate that access tokens
  were issued specifically for them as the intended audience." Clients "MUST
  keep refresh tokens confidential in transit and storage". [78]
- Security considerations: "Clients and servers MUST implement secure token
  storage"; "The MCP server MUST NOT pass through the token it received from
  the MCP client"; "For public clients, authorization servers MUST rotate
  refresh tokens". [79] Best practices call token passthrough "an
  anti-pattern" and tell local servers to "Use unix domain sockets or other
  Interprocess Communication (IPC) mechanisms with restricted access". [80]
- **For D89:** a stdio server's credential is an environment injection bound
  to that server's command. A remote server's OAuth tokens are born in the
  vault, audience-bound with RFC 8707, refreshed and rotated by the broker,
  and never handed to any other server or process.

## 4. Prompt injection: limit what untrusted text can cause

- CaMeL (Debenedetti et al., v1 24 March 2025): "CaMeL explicitly extracts the
  control and data flows from the (trusted) query; therefore, the untrusted
  data retrieved by the LLM can never impact the program flow", and "uses a
  notion of a capability to prevent the exfiltration of private data over
  unauthorized data flows by enforcing security policies when tools are
  called." [81]
- Beurer-Kellner et al. (10 June 2025): "We propose a set of principled
  design patterns for building AI agents with provable resistance to prompt
  injection." [82]
- **For D89:** a secret use is a capability the harness checks at the tool
  boundary, never a value in the model's context. Once untrusted content is in
  the context that produced a request, the request asks the user, whatever
  standing grant exists.

## 5. Same-user processes: what the vault can and cannot stop

| Attacker                                                           | At rest (vault file)                                                                                                                                                                                                            | In use (the broker's memory)                                                                                                                                                                                                                                   |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Another local user                                                 | Stopped by every slot (DPAPI, Keychain, Secret Service, TPM, SE) and owner-only files                                                                                                                                           | Stopped by owner-only sockets and pipes, and OS process isolation                                                                                                                                                                                              |
| A stolen disk or copied home folder                                | Stopped by TPM and SE slots (the key never leaves the device) and a passphrase slot; DPAPI and Keychain need the password                                                                                                       | Not applicable                                                                                                                                                                                                                                                 |
| A process running as the user (malware, an approved agent command) | **Not stopped** by silent slots: it can ask DPAPI, the Keychain (with a prompt on macOS), the Secret Service or a silent TPM key, as the broker does. Stopped by presence slots, which need the user's touch, PIN or passphrase | Windows: the broker's default DACL comes from the user's own token, so such a process can usually open it with `PROCESS_VM_READ` (lane 0 drills it). Linux: blocked by Yama at 1 or more (the broker is not its descendant); open at 0. macOS: lane 0 measures |
| A process as root or with debug rights                             | Not stopped                                                                                                                                                                                                                     | Not stopped                                                                                                                                                                                                                                                    |

This is why D89's protection is mostly the broker: an agent gets uses, not
values, and every use is approved, scoped and logged. A presence-protected
secret is the one thing a same-user process cannot use silently.

## 6. Conclusions carried into D89

1. One vault file per user, its items encrypted with AES-256-GCM under a
   random vault key, the key wrapped in several keyslots (hardware, OS store,
   SecretStorage, passphrase, recovery code). Any slot unlocks; losing the TPM
   or a Mac does not lose the vault while another slot exists (§2).
2. Hardware tiers exactly as each platform allows: SE P-256 wrap on capable
   Macs, TPM RSA decrypt on Windows, TPM2 sealing on Linux; presence where the
   platform has it (§2.1–2.3).
3. A broker process holds the unwrapped key; agents get handles and brokered
   uses. Disclosure is a separate, explicit, loud permission (§3, §4).
4. SSH by an agent protocol with host binding; sudo by standard input to one
   command; git by a scoped, ephemeral helper; env by injection into one
   process with its output scrubbed; web logins by fill on the bound origin;
   passkeys left to the OS (§3).
5. Per-secret modes and scoped grants, bound approvals with expiry and replay
   protection, and taint from untrusted content forcing an ask (§4).
6. The residuals in §5 are written down, not hidden.

## 7. Unverified, conflicting, and what lane 0 captures

| Question                                                                                                                       | Why it is open                                                                                                                 | Capture                                                                                                                                                         |
| ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| May an ad hoc signed helper create a CryptoKit SE key and keep its `dataRepresentation` in a file?                             | DTS 2021 says SE keys need a provisioned entitlement [17]; DTS 2022 says CryptoKit SE keys are not in the keychain at all [14] | On a Mac where `SecureEnclave.isAvailable` (Apple silicon, or Intel with Touch ID). The owner's Mac mini is Intel without Touch ID, so it cannot answer: Q-M109 |
| Does the Platform Crypto Provider create ECC P-256 keys on the owner's TPMs?                                                   | Only RSA is confirmed [9] [10]                                                                                                 | `NCryptIsAlgSupported` and `NCryptEnumAlgorithms` on the Windows PC and the Win11 VM (vTPM)                                                                     |
| Is a Hello `RequestSignAsync` signature PSS (randomized) or PKCS #1 v1.5 (deterministic)?                                      | The API page says PSS [18]; the guide's sample verifies PKCS #1 [19]                                                           | Sign one challenge twice on the Windows PC; D89 never derives a key from it either way                                                                          |
| Does DPAPI unprotect in an OpenSSH session on Windows (key-based logon)?                                                       | Credential Manager has no credential set in network logons [26]; DPAPI's behaviour there is not documented on the pages read   | Over `ssh -n` into the Win11 VM                                                                                                                                 |
| Does Windows' `ssh.exe` honour `SSH_AUTH_SOCK` naming a pipe, and does Git for Windows' bundled ssh?                           | Only secondary sources say the first; the second uses MSYS sockets                                                             | On the Windows PC: both clients against a fake broker pipe; `GIT_SSH_COMMAND` pins Windows' OpenSSH if needed                                                   |
| Which OpenSSH clients send `session-bind`?                                                                                     | It is a vendor extension [54]                                                                                                  | Windows' bundled OpenSSH, Kubuntu's, macOS's, Git for Windows'                                                                                                  |
| Can the user open `/dev/tpmrm0`, and is systemd at 256 or later?                                                               | `tss` membership depends on the distribution [33]; `--user` needs 256 [34]                                                     | Kubuntu VM                                                                                                                                                      |
| Which Node version added `crypto.argon2`?                                                                                      | The source says v24.7.0; the rendered page said otherwise                                                                      | Read Node's changelog; the code feature-detects either way                                                                                                      |
| What does Yama's `ptrace_scope` read on Kubuntu, and can an unrelated same-user process read a Node process's memory on macOS? | Distribution defaults differ; macOS was not covered                                                                            | A drill on Kubuntu and the Mac mini: an agent command tries to read the broker's memory                                                                         |
| Which authenticators does a headed Chrome for Testing reach (Windows Hello, iCloud Keychain, a phone over hybrid)?             | Not documented for the testing build                                                                                           | One throwaway WebAuthn test page on each rig                                                                                                                    |

## Sources

All read on 2026-10-05.

| #   | Source                                                                                       | URL                                                                                                                                                            | Page date                      |
| --- | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| 1   | Apple, Protecting keys with the Secure Enclave                                               | https://developer.apple.com/documentation/security/protecting-keys-with-the-secure-enclave                                                                     | no date shown                  |
| 2   | Apple, SecAccessControlCreateFlags; Item attribute keys and values                           | https://developer.apple.com/documentation/security/secaccesscontrolcreateflags                                                                                 | no date shown                  |
| 3   | Apple Platform Security, Secure Enclave                                                      | https://support.apple.com/guide/security/secure-enclave-sec59b0b31ff/web                                                                                       | 2024-12-19                     |
| 4   | Apple, Storing CryptoKit keys in the keychain                                                | https://developer.apple.com/documentation/cryptokit/storing-cryptokit-keys-in-the-keychain                                                                     | no date shown                  |
| 5   | Apple Platform Security, Keychain data protection                                            | https://support.apple.com/guide/security/keychain-data-protection-secb0694df1a/web                                                                             | 2024-12-19                     |
| 6   | Microsoft, NCryptOpenStorageProvider                                                         | https://learn.microsoft.com/en-us/windows/win32/api/ncrypt/nf-ncrypt-ncryptopenstorageprovider                                                                 | 2018-12-05                     |
| 7   | Microsoft, NCryptCreatePersistedKey                                                          | https://learn.microsoft.com/en-us/windows/win32/api/ncrypt/nf-ncrypt-ncryptcreatepersistedkey                                                                  | 2024-05-29                     |
| 8   | Microsoft, How Windows uses the TPM                                                          | https://learn.microsoft.com/en-us/windows/security/hardware-security/tpm/how-windows-uses-the-tpm                                                              | 2025-08-15                     |
| 9   | Microsoft, TPM fundamentals                                                                  | https://learn.microsoft.com/en-us/windows/security/hardware-security/tpm/tpm-fundamentals                                                                      | 2025-08-15                     |
| 10  | Microsoft, TPM key attestation                                                               | https://learn.microsoft.com/en-us/windows-server/identity/ad-ds/manage/component-updates/tpm-key-attestation                                                   | 2025-05-12                     |
| 11  | Microsoft, TPM recommendations                                                               | https://learn.microsoft.com/en-us/windows/security/hardware-security/tpm/tpm-recommendations                                                                   | 2025-08-15                     |
| 12  | Microsoft, NCRYPT_UI_POLICY                                                                  | https://learn.microsoft.com/en-us/windows/win32/api/ncrypt/ns-ncrypt-ncrypt_ui_policy                                                                          | 2018-12-05                     |
| 13  | Microsoft, Key storage property identifiers                                                  | https://learn.microsoft.com/en-us/windows/win32/seccng/key-storage-property-identifiers                                                                        | 2025-05-08                     |
| 14  | Apple Developer Forums, thread 708749 (DTS, dataRepresentation)                              | https://developer.apple.com/forums/thread/708749                                                                                                               | June 2022                      |
| 15  | Apple, SecureEnclave.P256.KeyAgreement.PrivateKey init(compactRepresentable:accessControl:…) | https://developer.apple.com/documentation/cryptokit/secureenclave/p256/keyagreement/privatekey/init(compactrepresentable:accesscontrol:authenticationcontext:) | no date shown                  |
| 16  | Apple, TN3137: On Mac keychain APIs and implementations                                      | https://developer.apple.com/documentation/technotes/tn3137-on-mac-keychains                                                                                    | no date shown                  |
| 17  | Apple Developer Forums, thread 125510 (DTS, SE and entitlements)                             | https://developer.apple.com/forums/thread/125510                                                                                                               | October 2021                   |
| 18  | Microsoft, KeyCredentialManager                                                              | https://learn.microsoft.com/en-us/uwp/api/windows.security.credentials.keycredentialmanager                                                                    | updated 2026-09-30             |
| 19  | Microsoft, Windows Hello (developer guide)                                                   | https://learn.microsoft.com/en-us/windows/apps/develop/security/windows-hello                                                                                  | 2026-09-27                     |
| 20  | Microsoft, UserConsentVerifier                                                               | https://learn.microsoft.com/en-us/uwp/api/windows.security.credentials.ui.userconsentverifier                                                                  | 2017-02-08                     |
| 21  | Microsoft, CryptProtectData                                                                  | https://learn.microsoft.com/en-us/windows/win32/api/dpapi/nf-dpapi-cryptprotectdata                                                                            | 2025-11-13                     |
| 22  | Microsoft, DataProtectionScope                                                               | https://learn.microsoft.com/en-us/dotnet/api/system.security.cryptography.dataprotectionscope                                                                  | 2025-07-01                     |
| 23  | Microsoft, CNG DPAPI                                                                         | https://learn.microsoft.com/en-us/windows/win32/seccng/cng-dpapi                                                                                               | 2023-06-06                     |
| 24  | Microsoft, Protection descriptors                                                            | https://learn.microsoft.com/en-us/windows/win32/seccng/protection-descriptors                                                                                  | 2018-05-31                     |
| 25  | Microsoft, CREDENTIALW                                                                       | https://learn.microsoft.com/en-us/windows/win32/api/wincred/ns-wincred-credentialw                                                                             | 2018-12-05                     |
| 26  | Microsoft, CredWriteW                                                                        | https://learn.microsoft.com/en-us/windows/win32/api/wincred/nf-wincred-credwritew                                                                              | 2018-12-05                     |
| 27  | Microsoft, Process security and access rights                                                | https://learn.microsoft.com/en-us/windows/win32/procthread/process-security-and-access-rights                                                                  | 2025-07-14                     |
| 28  | freedesktop, Secret Service API (0.2 draft)                                                  | https://specifications.freedesktop.org/secret-service/latest/                                                                                                  | 2026-10-02                     |
| 29  | GNOME, GnomeKeyring security philosophy                                                      | https://wiki.gnome.org/Projects/GnomeKeyring/SecurityPhilosophy                                                                                                | edited 2024-10-23 (archived)   |
| 30  | KDE, kwallet README                                                                          | https://github.com/KDE/kwallet                                                                                                                                 | master                         |
| 31  | tpm2-tools, tpm2_create                                                                      | https://tpm2-tools.readthedocs.io/en/latest/man/tpm2_create.1/                                                                                                 | no date shown                  |
| 32  | tpm2-tools, tpm2_unseal                                                                      | https://tpm2-tools.readthedocs.io/en/latest/man/tpm2_unseal.1/                                                                                                 | no date shown                  |
| 33  | tpm2-tss, udev rules                                                                         | https://raw.githubusercontent.com/tpm2-software/tpm2-tss/master/dist/tpm-udev.rules                                                                            | master                         |
| 34  | systemd-creds(1)                                                                             | https://man7.org/linux/man-pages/man1/systemd-creds.1.html                                                                                                     | systemd 262~devel              |
| 35  | keyrings(7)                                                                                  | https://man7.org/linux/man-pages/man7/keyrings.7.html                                                                                                          | man-pages 6.19, 2026-02-08     |
| 36  | age-plugin-se README                                                                         | https://github.com/remko/age-plugin-se                                                                                                                         | no date shown                  |
| 37  | ssh-tpm-agent README                                                                         | https://github.com/Foxboron/ssh-tpm-agent                                                                                                                      | no date shown                  |
| 38  | Linux kernel, Yama                                                                           | https://www.kernel.org/doc/html/latest/admin-guide/LSM/Yama.html                                                                                               | latest                         |
| 39  | VS Code API, SecretStorage                                                                   | https://code.visualstudio.com/api/references/vscode-api#SecretStorage                                                                                          | no version shown               |
| 40  | VS Code 1.80 release notes                                                                   | https://code.visualstudio.com/updates/v1_80                                                                                                                    | June 2023                      |
| 41  | Electron, safeStorage                                                                        | https://www.electronjs.org/docs/latest/api/safe-storage                                                                                                        | no version shown               |
| 42  | VS Code, Settings Sync                                                                       | https://code.visualstudio.com/docs/configure/settings-sync                                                                                                     | 2026-09-30                     |
| 43  | RFC 9106, Argon2                                                                             | https://www.rfc-editor.org/rfc/rfc9106.html                                                                                                                    | September 2021                 |
| 44  | Microsoft, Sudo for Windows                                                                  | https://learn.microsoft.com/en-us/windows/advanced-settings/sudo/                                                                                              | 2024-11-21, updated 2026-02-26 |
| 45  | Microsoft, How User Account Control works                                                    | https://learn.microsoft.com/en-us/windows/security/application-security/application-control/user-account-control/how-it-works                                  | 2026-04-23                     |
| 46  | OWASP, Password Storage Cheat Sheet                                                          | https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html                                                                               | no date shown                  |
| 47  | Git Credential Manager, credential stores                                                    | https://github.com/git-ecosystem/git-credential-manager/blob/main/docs/credstores.md                                                                           | main                           |
| 48  | Node.js, Buffer                                                                              | https://nodejs.org/api/buffer.html                                                                                                                             | v26.10.0                       |
| 49  | Node.js, command-line options (`--secure-heap`)                                              | https://github.com/nodejs/node/blob/main/doc/api/cli.md                                                                                                        | main                           |
| 50  | Microsoft, CryptProtectMemory                                                                | https://learn.microsoft.com/en-us/windows/win32/api/dpapi/nf-dpapi-cryptprotectmemory                                                                          | 2018-12-05                     |
| 51  | mlock(2)                                                                                     | https://man7.org/linux/man-pages/man2/mlock.2.html                                                                                                             | 6.19, 2026-02-11               |
| 52  | madvise(2)                                                                                   | https://man7.org/linux/man-pages/man2/madvise.2.html                                                                                                           | 6.19                           |
| 53  | RFC 9987, Secure Shell (SSH) Agent Protocol                                                  | https://www.rfc-editor.org/rfc/rfc9987.html                                                                                                                    | May 2026                       |
| 54  | OpenSSH, PROTOCOL.agent                                                                      | https://raw.githubusercontent.com/openssh/openssh-portable/master/PROTOCOL.agent                                                                               | v 1.26 2026/06/02              |
| 55  | OpenSSH, SSH agent restriction                                                               | https://www.openssh.org/agent-restrict.html                                                                                                                    | 2022-01-10                     |
| 56  | OpenSSH 8.9 release notes                                                                    | https://www.openssh.org/txt/release-8.9                                                                                                                        | 2022-02-23                     |
| 57  | ssh-add(1)                                                                                   | https://man.openbsd.org/ssh-add.1                                                                                                                              | 2026-09-16                     |
| 58  | ssh-agent(1)                                                                                 | https://man.openbsd.org/ssh-agent.1                                                                                                                            | 2026-09-18                     |
| 59  | 1Password, SSH agent and its security                                                        | https://www.1password.dev/ssh/agent/security/                                                                                                                  | no date shown                  |
| 60  | 1Password, Get started with SSH                                                              | https://www.1password.dev/ssh/get-started/                                                                                                                     | no date shown                  |
| 61  | Bitwarden, SSH agent                                                                         | https://bitwarden.com/help/ssh-agent/                                                                                                                          | no date shown                  |
| 62  | Bitwarden blog, SSH agent                                                                    | https://bitwarden.com/blog/ssh-agent/                                                                                                                          | 2025-01-28                     |
| 63  | Secretive README and FAQ                                                                     | https://github.com/maxgoedjen/secretive                                                                                                                        | no date shown                  |
| 64  | Win32-OpenSSH, ssh-agent `agent.c`                                                           | https://raw.githubusercontent.com/PowerShell/openssh-portable/latestw_all/contrib/win32/win32compat/ssh-agent/agent.c                                          | latestw_all                    |
| 65  | Microsoft, OpenSSH key management                                                            | https://learn.microsoft.com/en-us/windows-server/administration/openssh/openssh_keymanagement                                                                  | 2025-10-03, updated 2026-04-21 |
| 66  | git-credential                                                                               | https://git-scm.com/docs/git-credential                                                                                                                        | git 2.46                       |
| 67  | gitcredentials                                                                               | https://git-scm.com/docs/gitcredentials                                                                                                                        | git 2.51                       |
| 68  | GitHub, Managing your personal access tokens                                                 | https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens                                            | no date shown                  |
| 69  | sudo(8), man source                                                                          | https://raw.githubusercontent.com/sudo-project/sudo/main/docs/sudo.mdoc.in                                                                                     | 2025-06-07                     |
| 70  | sudoers(5), man source                                                                       | https://raw.githubusercontent.com/sudo-project/sudo/main/docs/sudoers.mdoc.in                                                                                  | 2026-08-31                     |
| 71  | RFC 6238, TOTP                                                                               | https://www.rfc-editor.org/rfc/rfc6238.html                                                                                                                    | May 2011                       |
| 72  | RFC 4226, HOTP                                                                               | https://www.rfc-editor.org/rfc/rfc4226.html                                                                                                                    | December 2005                  |
| 73  | W3C, Web Authentication Level 3                                                              | https://www.w3.org/TR/webauthn-3/                                                                                                                              | 2026-08-25 (Recommendation)    |
| 74  | Chrome DevTools Protocol, WebAuthn domain                                                    | https://raw.githubusercontent.com/ChromeDevTools/devtools-protocol/master/pdl/domains/WebAuthn.pdl                                                             | master                         |
| 75  | passkeys.dev, Terms                                                                          | https://passkeys.dev/docs/reference/terms/                                                                                                                     | 2026-02-02                     |
| 76  | FIDO Alliance, Credential Exchange Format v1.0                                               | https://fidoalliance.org/specs/cx/cxf-v1.0-ps-errata-20260309.html                                                                                             | 2026-03-09                     |
| 77  | FIDO Alliance, Credential Exchange Protocol v1.0 (working draft)                             | https://fidoalliance.org/specs/cx/cxp-v1.0-wd-20241003.html                                                                                                    | 2024-10-03                     |
| 78  | MCP specification, Authorization                                                             | https://modelcontextprotocol.io/specification/latest/basic/authorization                                                                                       | 2026-07-28                     |
| 79  | MCP specification, Authorization security considerations                                     | https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization/security-considerations                                                           | 2026-07-28                     |
| 80  | MCP specification, Security best practices                                                   | https://modelcontextprotocol.io/specification/latest/basic/security_best_practices                                                                             | 2026-07-28                     |
| 81  | Debenedetti et al., Defeating Prompt Injections by Design (CaMeL)                            | https://arxiv.org/abs/2503.18813                                                                                                                               | v1 2025-03-24, v2 2025-06-24   |
| 82  | Beurer-Kellner et al., Design Patterns for Securing LLM Agents against Prompt Injections     | https://arxiv.org/abs/2506.08837                                                                                                                               | 2025-06-10                     |
