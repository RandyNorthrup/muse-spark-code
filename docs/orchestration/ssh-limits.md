# SSH connection limits: what they are, how they apply, how to handle them

Researched 2026-10-06 while orchestrating the agent fleet that built this
project. The gotcha register
([`docs/orchestration-gotchas.md`](../orchestration-gotchas.md), G50–G52)
records the rules; the owning milestones (M100, M110, M96c, M107) enforce
them in the app's own orchestrator.

Owner question: are the SSH limits we hit hard limits, how are they applied,
and how should we (and the app) handle them on every platform?

## Measured on our machines (read-only, 2026-10-06)

| Machine       | Server                                           | MaxStartups                      | MaxSessions | PerSourcePenalties                                                                                                             | Other                                       |
| ------------- | ------------------------------------------------ | -------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------- |
| Kubuntu VM    | OpenSSH 10.2p1 (Ubuntu) via systemd `ssh.socket` | 10:30:100                        | 10          | on: crash 90 s, authfail 5 s, noauth 1 s, grace-exceeded 10 s, refuseconnection 10 s; min 15 s, max 600 s; overflow permissive | LoginGraceTime 120                          |
| Linux laptop  | OpenSSH 10.0p2 (Ubuntu 25.10), `ssh.socket`      | 10:30:100                        | 10          | same defaults                                                                                                                  |                                             |
| Mac mini      | OpenSSH 9.9p2 (macOS)                            | 10:30:100                        | 10          | same defaults                                                                                                                  | launchd maxproc 5568/8352                   |
| MacBook Pro   | OpenSSH 9.9p2 (macOS 15.7.9)                     | defaults                         | defaults    | same defaults                                                                                                                  |                                             |
| Windows 11 VM | OpenSSH_9.5p2 for Windows (build 26200)          | 10:30:100 (default, no override) | 10          | **not present** (added in OpenSSH 9.8)                                                                                         | desktop heap `SharedSection=1024,20480,768` |

## How each limit is applied (sshd_config manual, man.openbsd.org/sshd_config)

- **MaxStartups 10:30:100.** This counts only **unauthenticated** connections, those still in key exchange or authentication. With 10 or more pending, sshd refuses new attempts with 30% probability, rising linearly to 100% at 100. It is soft: a server setting, and it applies only to bursts of new handshakes, not to established sessions. The symptom is "kex_exchange_identification: Connection closed by remote host" or a reset during authentication.
- **MaxSessions 10.** This is per TCP connection: at most 10 shell, exec or sftp sessions multiplexed over one authenticated connection (ControlMaster). It is a server setting.
- **PerSourcePenalties (OpenSSH 9.8+; Linux and macOS here, not Windows 9.5).** sshd keeps a penalty per source address:
  - points come from crashes (90 s), failed authentication (5 s), connections that close without authenticating (1 s each, which includes TCP port probes), exceeding LoginGraceTime (10 s) and refused connections (10 s);
  - once a source's penalty passes the 15 s minimum, **all new connections from that address are refused** until it decays, for at most 10 minutes;
  - it is soft and configurable: `PerSourcePenaltyExemptList` exempts addresses or CIDRs, and `PerSourcePenalties no` disables it.
  - What this means for us: about 15 quick port probes, or 3 failed logins, can lock the orchestrator out of a rig for minutes. That looks exactly like "unreachable" even though the machine is fine.
- **Windows desktop heap (not SSH, but it governs SSH sessions on Windows).** Win32-OpenSSH runs every session's processes on a non-interactive desktop. Its heap is the third SharedSection value, **768 KB**, shared by everything on that desktop. Many concurrent processes (each lane's node, git, PowerShell and Chrome children) exhaust it, and new processes then fail to initialize, sshd's own per-session child included. The connection then resets during authentication. This matches what we saw: resets started at about 7 concurrent lanes, and 5 was stable. It is a hard limit until the registry value is raised, which needs a reboot.

## Answer: hard or soft?

- MaxStartups, MaxSessions and PerSourcePenalties are **soft**. They are per-server configuration with safe defaults, applied to unauthenticated bursts, per-connection sessions and misbehaving source addresses.
- The Windows desktop heap is effectively **hard** for a running system. It is set in the registry and changes only after a reboot.
- None of them caps how many lanes a machine can run. They cap **how we connect**: bursts of new handshakes, failed or aborted logins, and on Windows, too many processes under sshd's session.

## How to handle it, per platform

**For our orchestration tooling (now):**

1. **Fewer, longer connections.**
   - Batch every status check into one SSH session per machine per pass. Windows already does this; Linux and Mac should too.
   - Serialize launches per machine.
   - Never open more than 3 new handshakes to one host at once, well under MaxStartups' 10.
2. **No noauth or authfail noise.**
   - No raw TCP port probes (each costs a noauth penalty).
   - Always use the right key with BatchMode.
   - Stop after one failed password attempt.
3. **Treat refusal as "throttled", not "down".**
   - Back off with jitter: 15 s, 30 s, then 60 s, capped at the 600 s maximum penalty.
   - Report "unknown since …" (gotcha G5).
   - Never duplicate the machine's lanes (G6).
4. **Multiplexing (ControlMaster) where the client supports it.**
   - Linux and macOS clients: yes.
   - The Windows OpenSSH client: no Unix-socket multiplexing.
   - Git Bash's ssh: tried and found unreliable; it reset its control socket.
5. **Windows rigs: keep heavy work off sshd's session.**
   - Start lanes as Task Scheduler jobs under the rig user. Each gets its own window station and desktop.
   - Or raise the third SharedSection value (for example to 2048 KB). That is a registry change plus a reboot on the owner's machine, so the owner decides.
   - Until then, cap Windows rigs at 5 concurrent lanes.
6. **Optional, owner's machines only:** add the orchestrator's LAN address to `PerSourcePenaltyExemptList` on each Linux/macOS rig. That is a machine configuration change, so it needs the owner's approval.

**For the app (M100 paired devices, M110 nodes and its SSH route, M96c scheduler):**

- **One long-lived authenticated control channel per device.**
  - Status, heartbeats and job events travel over it.
  - New sessions are queued, never fired in bursts; use at most MaxSessions − 1 multiplexed sessions.
- **Connection pacing per remote host.**
  - Limit pending handshakes (default 3).
  - Use jittered exponential backoff on refusal or reset, capped at 10 minutes.
  - Show the state as "throttled / unknown since …", distinct from "offline".
- **Never probe ports.** Readiness comes from an authenticated health call (`/readyz` or the control channel).
- **Count failed authentications.** Stop and ask the user after one failure; never retry passwords in a loop. Penalties lock the user out of their own machine.
- **Windows hosts:**
  - run worker processes in their own scheduled task or service context, not under the transport session;
  - surface a clear diagnostic when process creation fails with STATUS_DLL_INIT_FAILED (0xC0000142), which is the desktop-heap signature;
  - never change the registry without the user's explicit consent.
- **Calibrate slot caps per device from transport health.** Resets and refusals lower a device's cap automatically (M107 signal, gotcha G12).

## Gotcha register rows

G50–G52 in [`docs/orchestration-gotchas.md`](../orchestration-gotchas.md)
record these as product rules:

- **G50:** pre-authentication limits and per-source penalties (MaxStartups, PerSourcePenalties) can make a healthy machine look unreachable. Owners: M100, M110, M96c.
- **G51:** the Windows non-interactive desktop heap (768 KB) caps concurrent processes under an SSH session. Owners: M100 and M110 (Windows workers), M107.
- **G52:** failed password attempts and port probes add penalties. Owners: M100 pairing and M110's SSH route.
