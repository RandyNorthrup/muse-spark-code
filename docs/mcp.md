# Muse Spark Code as an MCP server for other agents (M124)

**Status (2026-10-09; remote phase 2026-10-30): local stdio, plus HTTPS
from your own PC.** Decisions D106 and D217 and milestone M124 in
[PLAN.md](../PLAN.md); design in
[design/mcp-connector.md](design/mcp-connector.md). There is no hosted
connector and no server of ours: the owner decided on 2026-10-23 that the
remote endpoint runs on your PC (D217, closing PLAN Q-M124.1). A client on
another machine — or a hosted chat that can reach an address you publish —
connects to the connector you serve yourself, below.

`muse-spark-code-acp mcp` lets another agent on your machine (Codex, Claude
Code, Gemini CLI) read what you grant it and ask for changes that **you**
approve in Muse Spark Code's own approval page. The other agent keeps its
own model and conversation. No key, token or subscription passes between
them.

## What it offers

| Tool                                                           | Kind  | In this build                                                                                                                                                      |
| -------------------------------------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `muse_prompt_list`                                             | read  | Available: saved prompt metadata (id, title, tags, variables, generation), no bodies                                                                               |
| `muse_prompt_get`                                              | read  | Available with the content grant: the scrubbed body, marked untrusted                                                                                              |
| `muse_prompt_prepare`                                          | read  | Available with the content grant: fills declared input variables, returns text as data, sends nothing                                                              |
| `muse_share_preview`                                           | read  | Available for saved prompts with the content grant; chat sources answer `unavailable`                                                                              |
| `muse_prompt_save`                                             | write | Available: waits for your approval, then saves a new prompt marked untrusted                                                                                       |
| `muse_schedule_list`                                           | read  | Available: id, name, delivery, paused, next fire time; no prompt text                                                                                              |
| `muse_schedule_cancel`                                         | stop  | Available: pauses a schedule; never asks                                                                                                                           |
| `muse_report`                                                  | read  | Available: an M113 report in Markdown, in memory, no network, no history write (project, milestone, release, changes, usage, fleet, estimate, playbook, schedules) |
| `muse_operation_get`                                           | read  | Available: the status of an operation this connection started                                                                                                      |
| `muse_stop`                                                    | stop  | Available for connector operations; lanes and teams answer `unavailable`                                                                                           |
| `muse_fleet_status`, `muse_agent_outcomes`, `muse_receipt_get` | read  | `unavailable`: the Agent map and receipts live inside the running session; no store another process can read                                                       |
| `muse_lane_start`/`_continue`, `muse_team_start`/`_continue`   | run   | `unavailable`: lanes and teams start inside an editor or ACP session                                                                                               |
| `muse_playbook_advice`, `muse_capacity_estimate`               | read  | `unavailable`: their adapters are not built in this phase (`playbook` and `estimate` stay their own commands)                                                      |
| `muse_schedule_create`/`_update`                               | write | `unavailable`: M115's grant consent is not carried by the approval page yet                                                                                        |
| `muse_share_publish`                                           | write | `unavailable`: release waits for M104's final-action share UI                                                                                                      |

A report body is content: without the content grant `muse_report` answers
its kind and format only. `muse_stop` follows the operation's own scope: an
operation in your user library (a `scope: "user"` save, whatever workspace
it named) stops with the user-library grant; one in a workspace stops under
that workspace's grant.
Only available tools your grant allows are listed. Calling an unavailable
one answers `unavailable` with its reason, never an empty success.

## Set it up

1. **Grant a connection, in your own terminal.** A grant names the
   workspaces and the tool families. It lives in your data folder, outside
   every repository; starting the server or trusting a repository grants
   nothing.

   ```sh
   muse-spark-code-acp mcp grant --workspace ~/code/my-project
   ```

   You type `y` to confirm; the command refuses without an interactive
   terminal. The default families are reads of prompts, sharing, schedules,
   reports and operations, plus Stop. Add `--content` to let the connection
   read prompt bodies, previews and report bodies in those workspaces
   (without it a report answers its kind and format only), `--user-library` for
   your user prompt library, and `--scope prompts:write` to let it ask to
   save prompts. Paid authority stays zero; `--scope paid:request` is
   refused. Name a connection with `--connection codex` to keep one grant per
   client.

2. **Add it to your agent.** No environment variable, header or key.
   These recipes follow each vendor's documentation (read 2026-10-09) and
   **have not been run against a real client**: running them writes your
   global client configuration, which this project's checks never do. No
   client is qualified against this server yet.

   **Codex** (CLI, IDE extension and desktop app share `~/.codex/config.toml`):

   ```toml
   [mcp_servers.muse-spark-code]
   command = "muse-spark-code-acp"
   args = ["mcp"]
   ```

   or `codex mcp add muse-spark-code -- muse-spark-code-acp mcp`.

   **Claude Code:**

   ```sh
   claude mcp add --transport stdio --scope user muse-spark-code -- muse-spark-code-acp mcp
   ```

   or a project `.mcp.json`:

   ```json
   {
     "mcpServers": {
       "muse-spark-code": { "type": "stdio", "command": "muse-spark-code-acp", "args": ["mcp"] }
     }
   }
   ```

   **Gemini CLI** (`~/.gemini/settings.json` or the project's
   `.gemini/settings.json`):

   ```json
   { "mcpServers": { "muse-spark-code": { "command": "muse-spark-code-acp", "args": ["mcp"] } } }
   ```

   or `gemini mcp add -s user muse-spark-code muse-spark-code-acp mcp`.

   Add `--connection NAME` to `args` (`["mcp", "--connection", "codex"]`) to
   use a named grant.

3. **Approve in Muse Spark Code, not in the other agent.** When the agent
   asks for a write, it gets an `awaitingApproval` operation and Muse Spark
   Code opens its approval page in your browser (a loopback page with a
   one-use launch code). It shows the client as it names itself, the
   connection, workspace, the exact text, the target generation, the price
   (free) and when it expires (two minutes). **Approve once** or **Deny**.
   The agent's own Allow, Always allow, Auto, Bypass or `trust` settings, any
   argument it sends and any elicitation answer cannot approve it.

   The page closes after 30 minutes of inactivity. The next save request
   starts a fresh page and opens it in your browser. If the browser opener
   fails, the request refuses with `approval_unavailable` and its page closes;
   once the opener recovers, use a fresh request ID to ask for approval again.
   Disconnect closes any open or starting page before the runtime returns.

Sources for the client commands, all read on **2026-10-09**:
[Codex MCP](https://learn.chatgpt.com/docs/extend/mcp?surface=cli) (the old
`developers.openai.com/codex/mcp` URL now redirects there) and its
[configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference);
[Claude Code MCP](https://code.claude.com/docs/en/mcp);
[Gemini CLI MCP servers](https://geminicli.com/docs/tools/mcp-server/). The
Gemini CLI page says unpaid-tier and Google One users were moved to
Antigravity CLI on 2026-06-18; its documentation was not read. None of the
three pages documents a Windows `cmd /c` wrapper for an npm `.cmd` shim; if
your client cannot start `muse-spark-code-acp` on Windows, name
`muse-spark-code-acp.cmd` as the command. No client has been qualified
against this server yet (PLAN M124's platform rows).

## Serve it from your PC over HTTPS (D217)

Grant first (step 1 above), then serve. Nothing listens anywhere until you
start this command, and it stops with Ctrl+C.

```sh
muse-spark-code-acp mcp serve-http --tls-cert cert.pem --tls-key key.pem
```

- **Where it listens is yours.** Loopback (this PC only) unless you pass
  `--bind lan` or one IP address of this PC; a wider address also needs
  `--public-url https://…`, the address clients use to reach this PC, and
  the connector says so in the terminal when it starts. For internet or
  cloud clients, put your own tunnel in front (for example a Cloudflare
  Tunnel you configure) and run with `--tunnel --public-url https://…`:
  the connector then serves plain HTTP on loopback behind your tunnel,
  which supplies the HTTPS. No tunnel, domain or account of ours is
  involved, ever.
- **TLS is your own certificate.** Any certificate valid for the name in
  `--public-url` (or for `localhost` when you stay on this PC) works, from
  your CA, your router, or a public issuer such as Let's Encrypt.
- **Who may sign in is yours.** Register each client yourself:
  `muse-spark-code-acp mcp client add --name "…" --redirect-uri <the client's callback>`,
  confirmed in your terminal; the command prints its `client_id` to give
  the client. `mcp client list` shows them; `mcp client remove
--client-id …` ends that client's sign-ins at once, even while serving.
  Clients that can publish a Client ID Metadata Document are also
  accepted. Only with `--open-registration` may unknown clients register
  themselves; they still get nothing until you approve them, below.
- **You approve every sign-in.** The connector prints an owner code in
  its terminal; the browser consent page asks for it together with your
  Allow. The code changes after every approval and after five wrong
  tries. Sign-ins are bound to this one connector address and expire
  (`--token-minutes`, `--sign-in-days` are yours to set); revoking the
  grant (`mcp revoke`) ends every sign-in at once. Your grant, the
  per-write approvals, Stop, the limits and the audit below are exactly
  the local connector's — the sign-in adds no authority of its own.

## Control it

| Command                                            | Effect                                                                                      |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `muse-spark-code-acp mcp status`                   | The kill switch and every grant with its workspaces                                         |
| `muse-spark-code-acp mcp revoke [--connection ID]` | Revokes a grant at once; the next call refuses                                              |
| `muse-spark-code-acp mcp kill`                     | Switches the connector off: new effects refuse, pending approvals are cancelled, Stop works |
| `muse-spark-code-acp mcp resume`                   | Switches it on again; needs your typed confirmation in a terminal                           |
| `muse-spark-code-acp mcp client add/list/remove`   | The HTTPS clients you registered; removing one ends its sign-ins at once                    |

## Limits

Frames and complete results (text and structured copy together) are capped
at 64 KiB; 60 calls a minute with a burst of 10, at most 4 reads at once and
2 pending approvals per connection. These limits belong to the connection's
grant: every server process started with that connection, in any editor
window, shares them, and a restart keeps them (`connector/limits/`, one
file per generation under a lock that is never taken from a live holder by
its age). An operation may be polled every 2 seconds; a call has
15 seconds, after which it answers `unavailable` at once and a late result
is dropped, even one whose last audit line is still being written; an
approval lasts 120 seconds. One server works on at most 16
requests at once and answers `Server busy` beyond that, keeping room for
Stop; a client that leaves 1 MiB of replies unread, or closes either pipe,
is disconnected, and its pending approvals are cancelled. Stop and schedule
cancel never meet these limits, the kill switch or an audit failure.

Revoking a grant, changing its scopes or workspaces, switching the
connector off or disconnecting stops every call that has not started its
effect, at once: an approved save whose write has not begun is cancelled, a
read in progress is not answered, and no call takes a slot after it ended.
The connector notices a change to its grant or kill-switch file as it
happens, and reads both again right before every effect. A write already
under way finishes (Stop then answers `stopRequested`).

## What it records and returns

Every call leaves one line per step in `connector/audit/<connection>.jsonl`
in the agent's data folder (admitted, awaiting approval, approved,
dispatching, settled) and ends in exactly one line that says how it ended:
`settled`, or `refused`, `cancelled` or `failed` with the reason. Times,
tool, workspace id and a keyed digest of the payload, never the text
itself. A frame refused before any call exists (unreadable, too large, an
unknown method, busy) leaves one `transport` line with its JSON-RPC code
only. Your `mcp grant` and `mcp revoke` leave a `control` line in that
connection's file; `mcp kill` and `mcp resume` in `connector/audit/_owner.jsonl`.
These control lines are best effort: your own command never waits for the
journal. Each step's line is written before the step happens; if the
journal cannot be written, nothing starts and the call refuses with
`audit_unavailable` (that refusal's own line may be missing too), and a read
whose final line cannot be written is never answered `ok`. A read's result
is sent only after its final line is written; if a cancellation, the
deadline or a disconnect comes first, that is what your agent gets, at once,
and the line is still written. A journal that
does not answer within 5 seconds counts as failed until it does. Stop is
the exception: it never waits for the journal. Nothing that reads your
client's frames waits for it either: when 64 lines are being written at
once, further refusal lines are counted into one line with a `count` until
the journal catches up. The live file rotates at 10 MiB; the older segment
is removed after 30 days. Results pass the shared redactor (registered credentials,
known key patterns, your home folder and other absolute paths) and a final
whole-result scrub; a result that still changes there is withheld. Prompt
bodies and previews you allow are returned to the calling agent and may
stay in that agent's conversation and its provider's records.
