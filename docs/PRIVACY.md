# Privacy

Muse Spark Code (Unofficial) is a VS Code extension that sends what you type
to Meta's Muse Spark model. This page says what leaves your machine, where it
goes, and what stays local. It is written for the extension's users; the
security notes for contributors are in `PLAN.md` §9.

Interactive Model API extras are available by default, but require paid-use
consent before spending. The popup names the price and shared daily budget.
Availability sends no paid request by itself. Images send your image prompt
and selected source images; Auto reviews send the current request, proposed
action and bounded recent tool arguments; child agents, scheduled prompts
and explicit best-of-N attempts send their own conversation context and tool
outputs to Meta. Hosted search would send model-written queries, and Muse
Voice would send microphone audio, but both transports remain refused under
the finite daily cap until their billing bounds are verified. Free OS
dictation remains the default. Explicit false settings stay off.

The local daily extras journal stores dollar reservations, settlements and
today's override under global extension storage (`paid-daily`). All windows,
workspaces and keys in this profile share it; it stores no prompts or keys
and sends nothing. Failed or unreadable storage refuses spending. Tab's
independent $1/day journal is excluded. ACP and headless policies are unchanged.

## What the extension sends, and to whom

- **Your prompts, attachments and mentioned files.** Everything you type into
  the panel, every image or PDF you attach or drop, text files you explicitly
  pick for attachment in a trusted, indexed workspace, the paths you
  `@`-mention (a file's contents go when the agent reads it), the open
  file's path or your selected lines when the "attach open file" setting is
  on, and the outputs of the tools the agent runs (file contents,
  command output, Problems-panel diagnostics, and what VS Code's language
  services answer about your code: definitions, references, symbols, hover
  text) are sent to Meta so the model can answer. Nothing is sent until you
  press Send.
- **Your own shell commands (`!`).** A message that starts with `!` runs on
  your machine, and the command with what it printed goes to Meta with the
  next request, so the model knows what you ran; Muse Code also keeps it in
  its session log. So does what a command moved to the background printed
  when it ends. A command the Model API backend refused at its start (your
  Stop, lost trust, a closing window) did not run and is not sent.
- **A review (`/review`, M70).** A review of git's changes runs git on
  your machine and sends what it printed with the review turn, as your
  message would travel on the backend in use: the diff, the changed and
  untracked files' names, the branch name and, for one commit, its
  message. Environment files, keys and credentials (`.env`, `.env.*`, `*.pem`,
  `*.key`, `id_rsa`, `credentials.json` and the like) are left out of
  the diff and only named. Git metadata is omitted from Reviewer system
  instructions and remains in the review turn's untrusted material block.
  `/review <what to look at>` sends only your
  words. The review pane, its Accept and Revert, stay on your machine; a
  comment on a line is a message, with the changed lines around it. On the
  Model API backend the `/review` you request is part of your own turn
  (PLAN.md D49), and a Reviewer child task remains a paid use under D48; on
  Muse Code it is an ordinary Muse Code turn.
- **Checks after the agent's edits (Model API backend).** After a round of
  edits, the edited files' errors and warnings from VS Code's language
  servers (`museSpark.diagnosticsAfterEdits`, on by default), and the
  commands and output of your check commands (`museSpark.checkCommands`,
  none by default) go to Meta with the next request (at most 64,000
  characters together), and an edit's `then_run` command and output return
  with that edit's result, as the shell tool's output does, with what your tool hooks add about those commands. Files that the
  editor's tools would run as code are not opened for their diagnostics.
  On Muse Code the extension
  sends only a note naming your check commands (with their command lines)
  and, with `museSpark.diagnosticsAfterEdits` on, asking it to read the
  edited files' problems through the extension's tool server; Muse Code runs
  them itself.
- **Through the Muse Code CLI** (what `museSpark.backend` at `auto` picks
  when the CLI is installed and signed in), the extension hands
  your messages to Meta's `muse serve` process on your machine, which talks
  to Meta with Muse Code's own sign-in. **Sign in with your Meta account**
  starts a temporary `muse serve` that asks Meta for an approval code; the
  panel shows the code and opens only a sign-in page on
  `https://auth.meta.com` in your browser, and the credential Muse Code
  saves never passes through the extension. What the CLI sends
  beyond your messages (its system prompt, its own telemetry, if any) is
  governed by Meta's Muse Code terms, not by this extension.
  For the Problems panel, code intelligence, web fetch and, when turned on,
  paid images, the extension serves Muse Code a tool server bound to
  `127.0.0.1` with a per-window token; nothing else on the network can
  reach it.
  A picked text file is sent as named text. Muse Code retains a readable
  `[Muse Spark Code attached text files: …]` annotation in the message's
  display text so the extension can mark its file card after History resume;
  the annotation contains file names only, no file contents. Native Muse Code
  clients may show this line.
- **Git and pull requests (M71).** A commit or push goes through VS Code's
  own Git to the remote you push to, as any push from VS Code does. When you
  open a pull request, the extension sends to `api.github.com`: the
  repository and branch names, the title and the description the form
  showed you (credential-shaped text is masked before anything is sent), and
  whether it is a draft. It reads back the pull request's number, address,
  state, author and head commit, and that commit's checks (names and
  results), to show them above the composer and to open a pull request in a
  conversation. It uses the token of VS Code's GitHub sign-in (scope
  `repo`), read for each call and never stored, logged or passed to a
  process. **Write with Muse** in the commit or pull request form sends your
  own message to the model, with the staged diff (or every change, when
  nothing is staged) and the changed files' names, or the branch's commit
  subjects and changed files, as any message you send does.
- **Installing Muse Code.** **Install Muse Code** shows Meta's install
  command for your system (`irm https://dev.meta.ai/install.ps1 | iex` on
  Windows, `curl -fsSL https://dev.meta.ai/install.sh | sh` elsewhere). Only
  after you choose **Run installer** does it run that command, in a VS Code
  terminal you can watch. The command downloads Meta's installer from
  `dev.meta.ai` and runs it as you, under Meta's terms. The extension sends
  nothing with it; it only watches the known install folders until the
  `muse` program appears.
- **Through the Meta Model API** (when you paste a key), the extension calls
  `https://api.meta.ai/v1` directly with your key. Each turn re-sends the
  conversation so far, because requests are made with `store: false`; Meta's
  Model API terms govern retention on their side. Meta caches the start of
  each request (the instructions, tools and conversation so far) to answer
  the next one faster; the extension asks for Meta's shorter `in_memory`
  retention by default. You may request up to 24 hours with the
  machine-scoped `museSpark.modelApiPromptCacheRetention` setting, a hint
  Meta may cut short. A repository cannot raise your retention choice. Each
  request also carries a cache key: a digest of the model, instructions and
  tools it starts with, which says nothing the request does not, and no
  session or user id. PDF bytes travel inline in
  the request, without a persistent Files API upload. When older media would
  exceed Meta's 50-image and PDF-page budget or the extension's 48-million-
  character combined encoded-media cap, the request names what is left out;
  the panel announces this, and local history still keeps the original bytes.
  Media read by a tool in a stopped or failed turn is removed from later
  replay; the next request gets a path-only explanation instead of its bytes.
- **Auto reviewer (Model API, available by default).** With
  `museSpark.modelApiAutoReviewer` enabled and its paid-use popup accepted,
  a separate request to Meta judges an eligible tool call. It includes your
  latest message, earlier tool names and arguments from that turn, the proposed
  command or arguments, workspace path and platform. The message, action and individual
  earlier-call text are clipped and marked as data. The reviewer has no tools, uses `store: false`,
  and cannot override a forbid, explicit ask rule or file policy. It is billed
  to your Model API key and recorded separately in Account & usage.
- **Auto reviewer (Muse Code, on by default in Auto).** With
  `museSpark.museCodeAutoReviewer` on and the panel in Auto on the Muse Code
  backend, an eligible approval Muse Code raises for the running turn that
  no rule settles is first
  judged by the same reviewer, run as one turn of a hidden side session in
  your own `muse serve`. That turn is sent to Meta through Muse Code, on
  Muse Code's own sign-in (your subscription; the extension's stored key is
  never used, though a `META_API_KEY` set in Muse Code's environment would
  be), and holds: your latest
  message as you typed it, up to eight of the turn's earlier tool names and
  arguments, the proposed command or arguments, the workspace path and the
  platform, each clipped and marked as data, with the reviewer's
  instructions. The side session runs in Plan mode, with thinking off, in an
  empty folder under the extension's global storage, so it is given none of
  your workspace files, rules or skills in the captured setup; CLI-global
  context is not excluded. Muse Code adds its own system prompt and, as
  for any turn, its reminder agents (four model attempts and about 33,000
  input tokens in the live check). Muse Code keeps the side session in its
  own session store like any other session; the extension never lists it in
  History. Native tools cannot be disabled through the SDK's
  `SessionConfig`, which only configures `mcpServers`. Any item other than
  an agent message or reasoning cancels the review turn, shows the generic
  failure card, and recreates the side session. A command covered by your
  always-allow rule could run in the empty folder before cancellation
  lands. The verdict text is never executed: it can only answer an
  approval _Allow once_ or leave it to you. Protected writes, paid calls,
  child tasks, questions, replayed/escalated/unknown requests, requests
  without allow-once and shared-panel sessions are never reviewed. Busy,
  timeout and breaker fallbacks leave the card; host exit recreates the
  side session.
- **Muse Judge (M98 phase 1, `auto` by default).** At an already held approval,
  the conversation's own model receives a redacted risk question containing
  the current request/action and earlier calls selected by the approval path.
  On Muse Code it is a standalone prompt in a fresh hidden Plan session, in
  an empty temporary folder, on your subscription; no Model API price is
  asked. Standing user-level allow rules or unreadable settings disable it.
  Tool-item cancellation reacts after a notification, so native execution
  before notification is a residual. The CLI may retain the hidden session
  in its own store even after the extension removes its temporary folder;
  History hides its id. The bounded result cache is window memory only.
  The Model API source preserves the main request, copying its prefix only
  if redaction changes no byte and no hosted billable tool is present,
  otherwise using a standalone request with no tools. That
  paid source asks for consent before dispatch and uses D78's shared daily
  ledger, retaining liability for a missing receipt. Judge never delays a
  card, allows an action, or adds its result to a main request. Pattern
  redaction does not remove every private fact. Logs contain fixed failures
  and reason words, not judged content or probabilities. See [Judge](judge.md).
- **Best-of-N (Model API, available by default).** After its paid-use popup names
  N and the request ceiling, the same prompt runs in separate local Git
  worktrees. Each attempt sends its conversation and tool outputs to Meta
  under the confirmed key. Worktrees and comparison snapshots remain local;
  choosing a result applies and stages its files without creating a commit.
- **MCP servers on the Model API backend.** In a trusted workspace, the
  extension starts the servers configured in Muse Code's settings when a
  conversation starts. A local server runs as a child process; a remote
  server receives MCP requests at the URL in its settings entry, including
  configured headers. The model can pass arguments drawn from your prompt
  and workspace context to a server tool. The tool's text and supported
  images return to Meta in the conversation. Approval mode controls which
  calls need your consent; a server marked required can stop a turn if it
  cannot start. These servers do not run in Restricted Mode. The extension
  does not pass your Model API key to a server. A remote server's error body
  and authentication challenge parameters are not copied into the model's
  tool error or the extension log; those may echo a configured credential.
  On Windows, the hidden local-server helper receives launch details in a
  private environment value; it removes that value and gives the server
  only the allowed environment and its configured variables. A random
  nonce travels over a separate local control pipe to prove this window
  still owns the launch; neither that nonce nor the pipe enters server
  requests or its environment.
- **Web fetch (both backends, M69).** When the model asks to read a web page
  (`web_fetch` on the Model API backend, `mcp__ide__webFetch` on Muse Code),
  the extension downloads it from your machine and sends its text to Meta
  like any other tool output: the text as served, which can include text
  a browser would not show. The page's site receives the whole address the
  model wrote, from your IP address (or your proxy's), with a user agent
  naming this extension and no cookies or credentials; since the model
  writes that address, it can carry what the conversation holds, which is
  why the request asks first and names it whole: on the Model API backend a
  card per host (Plan refuses, Bypass does not ask), on Muse Code the
  extension's own dialog before every fetch. Only `https://` pages on public
  internet addresses are fetched; the address the extension checked is the
  one it connects to, and nothing is fetched in Restricted Mode. The page's
  name is looked up in DNS only after the fetch is allowed; when an answer
  is IPv6, your resolver, and your configured DNS servers directly, are
  also asked for `ipv4only.arpa`, the standard name that reveals a NAT64
  prefix, which carries nothing of yours. Web fetch
  is free: it is not Meta's paid web search. The log names the host and the
  outcome, never the path, the query or the page.
- **Browser check (both backends, M81).** When the model asks to check a
  page (`browser_check` on the Model API backend, `mcp__ide__browserCheck`
  on Muse Code), the extension opens it in Google's Chrome for Testing
  headless shell, the one version this extension release pins. Before the
  first check the extension asks to download it (about 100 to 120 MB) from
  Google's `storage.googleapis.com`; that request goes to Google like any
  download and carries nothing of yours. Answering Download, or setting
  `museSpark.browserCheckRuntime` to `download`, agrees to that download now
  and, with the setting, for every later pinned version; `off` downloads
  nothing and offers no check. The download is kept in the extension's own
  storage, checked against the pinned length and SHA-256 before anything
  runs, and the browser's file is checked again before each check. Each
  check uses a fresh private profile under that storage, deleted afterwards
  (never your profile, cookies or passwords). The page's console errors,
  its failed and blocked requests and where it ended up go to the model
  like any other tool output, and on the Model API backend so does a
  screenshot of the page, sent to Meta with the next request. All of the
  page's traffic goes to the extension's own proxy on 127.0.0.1 (local
  connections between the browser, the proxy and your dev server): it passes
  plain `http` to this computer and to the hosts you list in
  `museSpark.browserCheckExtraHosts` or allow for one check, taking sign-in
  challenges and credentials out, and refuses the rest. The browser looks up
  no host names itself (its resolver rule fails every name except the
  loopback addresses, as traced on Linux); the proxy looks up a name only
  when you widened it. `https` and WebSockets to a widened host pass through
  the proxy encrypted and unread, so what the page sends there, and any
  sign-in a site there asks of this computer's account (on Windows in
  particular), is between the page and that site. This is a browser and a
  proxy, not an operating-system sandbox: it does not stop software outside
  the browser. The browser talks to the extension over a pipe, never a
  network port, and is told to send no background, sync, update, reliability
  or crash-report traffic. The log says how many other switches the browser
  reported, never their names or values. The check is free.
- **Hooks on the Model API backend (on by default, inert without configured hooks).** With
  `museSpark.modelApiHooks` on, the hook commands in Muse Code's settings
  run on your machine as you, outside the agent's sandbox. That means your
  administrator's, yours and the project's `.muse/hooks.json`. Each hook
  receives JSON on its standard input: the prompt you typed, bounded
  previews of tool arguments and output, and bounded summaries of each
  model request and reply. Image data, credential-named fields and the
  Model API key are left out. What a hook does with that is up to the hook:
  it can write it to disk or send it anywhere, so read a hook before you
  turn the setting on. No hook runs while the folder is in Restricted Mode.
  Hooks imported from other agents into `spark-hooks.json` get the same
  bounded data, in the shape their own agent sends it.
- **Workspace rules, skills, agents and memory.** In a trusted workspace the
  agent reads `AGENTS.md` (or `CLAUDE.md`), the skills under `.agents/skills`
  and `~/.config/muse/skills`, on the Model API backend the custom agents
  under `.agents/agents` and `~/.config/muse/agents`, and Muse Code's memory
  (the project's `.agents/memory`, and your own notes under
  `~/.local/share/muse/memory`), as the README describes. On the Model API
  backend the rules text, the skill catalogue (ids and descriptions), the
  agent catalogue (ids, sources and descriptions, only while paid subagents
  are on) and the memory snapshot (each scope's `MEMORY.md` and its notes'
  names, your personal scopes included) go to Meta with every request as
  part of the instructions, a skill's full text when it is loaded or
  invoked, an agent's full prompt with the requests of the child task that
  runs it (on the model its file names, when it names one), and a note's
  text when the model reads it with `read_memory`. What the model saves
  with `add_memory` is written
  on your machine, in the same files Muse Code uses. On the Muse Code CLI
  backend the CLI reads and sends them under Meta's Muse Code terms. The
  Model API backend reads none of this while VS Code has the folder in
  Restricted Mode; Muse Code's documentation says it still reads a
  repository's committed project memory then.
- **The bundled skills** (M89, PLAN.md D68: `project_setup`,
  `feature_delivery` and `quality_retrofit`, shipped inside the extension).
  On the Model API backend, while `museSpark.bundledSkills` is on (the
  default), their ids and descriptions join the skill catalogue sent with
  every request, and a skill's full text, preceded by one line naming the
  folder the extension is installed in, goes to Meta when the model loads
  it or you invoke it. Their scripts run only as shell commands under the
  conversation's permission mode, on your machine.
- **The Memory view** (M49) reads and writes only those notes on your
  machine; it sends nothing anywhere. A note it deletes goes to your trash.
- **Saved plans** (M79). **Save plan** writes a Plan-mode reply to
  `.agents/plans/` in your workspace, after you say yes, and sends nothing.
  **Implement in a fresh conversation** sends that plan's text, as the
  panel showed it, to the backend in use, as the first message of the new
  conversation, as a picked text file would be. It sends nothing else from
  the planning conversation. **Plans…** only reads the folder. The
  extension's log names a saved plan by a short hash of its file name,
  after its date when the name starts with a real one, never by the name,
  which comes from your words.
- **Environment facts (Model API backend).** The instructions sent with
  every request name the workspace's absolute path, the operating system
  and shell, and today's date. In a trusted workspace that is a git
  repository they also carry the branch name, how many files `git status`
  lists as changed, and the last five commits' short hashes and subjects (never file
  contents or diffs); in Restricted Mode git is not run and none of this is
  sent. The Muse Code CLI assembles its own context under Meta's terms.
- **The repo map (Model API backend, off by default).** With
  `museSpark.modelApiRepoMap` on, in a trusted workspace, the instructions
  sent with every request of a conversation (its child tasks' included)
  carry a map of the workspace made on its first turns: file
  paths, and the names, kinds and lines of the definitions other files use
  most. To make it the extension counts names in your files on your machine
  (their text is not sent) and asks VS Code's language services where each
  is defined. The `repo_map` tool sends the same kind of map when the model
  calls it, setting or not.
- **Contributor-tier models.** Meta may use traffic to the models whose id
  ends in `-contributor` to train its models. The extension asks before a
  panel first uses one (and again for a different contributor model), and
  refuses them at model selection and each message dispatch while
  `museSpark.confidentialWorkspace` is on, even after a prior confirmation.
  Checks repeat after pending confirmations and setup before switching or
  resuming. Turning the setting on cancels and retires contributor sessions;
  select a standard model before sending again. Already dispatched requests
  cannot be recalled.

- **Voice dictation**, the free default, never sends audio to Meta or to
  this extension's author. On Windows, speech is recognised by the
  recogniser built into Windows (`System.Speech`), on your machine, and the
  audio never leaves it. On macOS, Apple's Speech framework recognises on the device when its
  on-device model is installed (Apple silicon with Dictation on);
  otherwise Apple's servers transcribe the audio under Apple's privacy
  terms, and Apple decides which applies. The microphone is only
  open while the button is held or on ("Listening…"), and the recognised
  words go into the composer, where you can edit or delete them before
  anything is sent. The words are not logged (the log records only a
  character count). On macOS the microphone and speech-recognition
  permissions belong to the helper, listed as muse-dictate: macOS asks for
  them the first time you dictate, they cover the helper alone (not
  Visual Studio Code or anything else it starts), and they are revoked
  under System Settings > Privacy & Security > Microphone / Speech
  Recognition. Where macOS offers no way for the helper to ask under its
  own name, it asks as Visual Studio Code, the app that starts it.
  Dictation is off when the extension runs on a remote extension host (in a
  remote window it runs there by default); the microphone is never reached
  across the remote connection.
- **The paid features (off unless you turn them on).** Each is billed to
  your Model API key, never to your Muse Code subscription, and each asks
  you to accept its price when you turn it on, then asks again in a popup
  before each use (web search once per prompt): Allow once, Allow always in
  this workspace (a trusted workspace with a folder open only), or Deny.
  These five, and the Auto reviewer and best-of-N, work on the Model
  API backend; image generation and Muse Voice also work on the Muse Code
  backend while a key is stored, the images made by the extension itself
  (the key is never given to the Muse Code CLI):
  - **Web search** lets the model send search queries it writes, drawn from
    the conversation, to Meta's search; the pages it cites are listed under
    the reply and open in your browser only when you click one.
  - **Image generation** sends the prompt the model writes (you see it in
    the popup and allow each image, unless you allowed images always in
    this workspace) to Meta's image model, and for an edit the workspace images it
    starts from, which the popup names; the image comes back and is saved in
    the workspace as a new file.
  - **Muse Voice** sends your recording to Meta's Muse Voice Transcribe
    instead of your computer's own recogniser: audio leaves the machine only
    while the microphone records on that engine, only to `api.meta.ai`, and
    the transcript comes back into the composer, where you can edit it
    before anything is sent. On Linux the recording is made by the system's
    `arecord` or `parec`. On macOS the microphone permission is asked for
    by muse-dictate, as for the free engine; no speech-recognition permission
    is needed.
  - **Subagents** send each child task's objective, which the model writes
    from the conversation, and the child's own tool results to Meta as
    separate Model API conversations billed to your key. Each new task asks
    you first and names its model and rates, unless you allowed subagents
    always in this workspace (a task on another model still asks).
  - **Scheduled prompts** (`/loop`) save the prompt you typed, its schedule
    and the conversation it belongs to in VS Code's workspace storage for
    the extension. The prompt goes to Meta only when you choose **Run now**
    (and confirm that run, unless you allowed scheduled prompts always in
    this workspace); a due prompt never runs on its own.

The extension itself has **no telemetry**, no analytics, no automatic crash
reporting and no hosted server of its own. **Report a problem** contacts
nothing: it builds a draft that leaves only through an export you choose
(see [Reporting a problem](#reporting-a-problem)). It contacts Meta when you send a message,
sign in, dictate with Muse Voice, use a paid feature, run a scheduled prompt
with **Run now**, or open a panel while signed in (to list models; that request
carries no message). **Install Muse Code** downloads Meta's installer from
`dev.meta.ai`. On the Model API backend it also contacts remote MCP servers
you configured when a conversation starts or uses their tools. On either
backend it contacts the site of a web page the model asks to read, once
allowed (Bypass on the Model API backend does not ask; see **Web fetch**
above). On macOS,
dictation may contact Apple as described above. Behind a proxy, those
requests go through the proxy VS Code is set to use under its `http.*`
settings where VS Code routes them (Muse Voice's socket from VS Code 1.112;
see the README's Proxies and certificates). When neither Muse Code's environment nor
`museSpark.environmentVariables` names a proxy, the extension hands Muse
Code VS Code's `http.proxy` and `http.noProxy` (loopback always bypassed),
so Muse Code's requests use the same proxy; Diagnostics reports only
whether a proxy is set, never its address. **Muse Spark: Diagnostics** runs
`muse config status` to read Muse Code's managed configuration on this
machine. The public-issue report includes only recognized source and
generation fields, never raw configuration or failed-command output.

## Tab completions

Tab is on by default and asks before its first charge in each window. A
stored Model API key pays for its separate requests on either chat backend;
the Muse Code subscription never pays. Each request sends a
workspace-relative path, language id and redacted code around the cursor.
Multi-line requests also send bounded redacted excerpts of recent edits and
symbol definitions. Standard is the default and Meta does not train on this
traffic; the contributor model is a separate choice that permits training.
Requests use `store: false` and their own prompt cache key, with no chat
history, goal or memory.

Private, protected, ignored, excluded, outside-workspace and oversized files
are refused as context as well as as the current file. Related buffers are
opened only after the path, resolved links, ignore rules and disk size pass;
large unsaved buffers are refused conservatively before their text is read.
Secrets are redacted before cutting excerpts. No code, completion or path is
written to the Tab log, and Tab adds no telemetry.

The local-day spend ledger is in the extension's global storage under
`tab-spend/<date>/<window>.json`. It contains request counts and reserved and
reported USD amounts, never code or keys. All windows count toward the hard
daily limit ($1.00 by default). A sent request runs to completion even when
its suggestion is dismissed, so its cost is accounted for. Missing usage
keeps the reservation. The typing-through cache and the recent-edit path
list are kept only in this window's memory.

Tab's hook bridge is prepared for M91/lane K; configuring Cursor's Tab hooks
does not yet execute them in this build. When that lane lands, a local
`beforeTabFileRead` hook sees the full unredacted file and may deny it;
`afterTabFileEdit` observes accepted edits locally.

## Credentials

- A Model API key you paste is stored in VS Code's secret storage (the
  operating system's credential vault), never in settings files, logs or the
  workspace. It is sent only to `api.meta.ai` as a bearer token, and never
  passed to the Muse Code CLI or any other process.
- GitHub: the extension signs in through VS Code's built-in GitHub sign-in
  (`vscode.authentication`), which keeps the token; the extension asks
  VS Code for it at each GitHub call, sends it only to `api.github.com`, and
  keeps no copy. Which pull request each conversation opened is kept in
  VS Code's per-workspace extension state (its number, address and title,
  by session id), and the worktrees the extension made in its global state
  (folder, repository, branch or pull request, and whether you trusted it).
- The Muse Code CLI keeps its own sign-in. On Windows and Linux it is in
  the CLI's credential file (`~/.config/muse/auth.json`). On macOS the token
  is in your login Keychain (item `ai.meta.dev.credentials`, account
  `meta`), and `auth.json` only points to it.
- To tell whether the CLI is signed in, the extension reads only the
  structure of `auth.json`: its schema version, which providers it names
  (only Muse Code's own, `meta`, speaks for the sign-in), the storage lane
  of each (whether one points to the Keychain), and whether `meta` has an
  `api_key` or `access_token` entry, never what the entry holds.
  - Every value in the file, the token included, is dropped while the file
    is parsed. Nothing from it is stored, logged or passed on.
  - When that structure cannot say, the extension asks the CLI itself
    (`account/read` on a short-lived `muse serve` that owns no
    conversation). On macOS that is every file but the empty one a
    sign-out leaves. It keeps the answer until the file changes, or until
    you sign in, sign out or choose **Check again**; on macOS a later click
    asks again.
  - When the file is in a form Muse Code cannot start with here, the panel
    names the file's path; the log says so without the path.
  - The CLI's answer carries your account's e-mail address as a label, and
    the address of your account picture. The extension discards both
    without logging or showing them.
  - On macOS it asks only when you act, since the CLI may read the
    Keychain to answer: a click in the panel (sign-in, sign-out, **Check
    again**), or the **Sign Out** or **Diagnostics** command.
  - It also uses the file's size and modification time, to notice a new
    sign-in.
- When Muse Code ends a browser sign-in, the log says how, in fixed words
  (the code expired, the sign-in was denied, saving failed), never the
  message Muse Code sent with it: a failed save's message names a folder
  in your profile, and any message could name one, or your e-mail address.
- Other text Muse Code writes reaches the log the same way: its error
  messages by their kind and code, the state `account/read` reports and a
  backend's sign-in reason only when shaped like a protocol word, and what
  `muse serve` or `muse skills` writes to stderr as fixed words for the
  lines Muse Code was seen writing (an unsupported credential file, an
  unreadable Keychain item, a failed model-catalog fetch), otherwise only
  its length.
- **Muse Spark: Diagnostics** on macOS looks up the Keychain item by its
  attributes only, with `security find-generic-password` and no `-g` or
  `-w`. That lookup reads no secret and shows no prompt, and the report
  says whether the item is there. Diagnostics also asks the CLI for its
  sign-in (`account/read`); on macOS the CLI may read the Keychain to
  answer, which can show the Keychain's own prompt.
- **Sign out** in the panel (the same action as `/logout` and **Muse Spark:
  Sign Out**) does three things:
  - It deletes the pasted key from secret storage.
  - It signs the CLI out when the CLI is signed in, through the CLI's own
    `account/logout` on a short-lived `muse serve`. If the CLI still reads
    signed in afterwards, it runs `muse logout` in a terminal instead, with
    your `museSpark.environmentVariables`, so the same config home is
    signed out.
  - It records in VS Code's extension state (no credential) that you signed
    out, so an old CLI credential cannot sign the window back in until you
    sign in again.

## What stays on your machine

- Conversation history on the Muse Code backend is the CLI's own session
  store under `~/.local/share/muse` (Meta's format). The extension reads it
  to show the History dialog, and copies it only into the panel's own
  webview state (what the panel shows, for a reload) and into an export you
  save.
- Conversations on the Model API backend are saved, one JSON file each, in
  VS Code's per-workspace storage directory for this extension (the
  `storageUri` VS Code assigns; outside the repository, under your user
  profile). A file holds the messages, the tool calls and their outputs,
  the edit patches, the task list, the model and the settings of that
  conversation, including attached image and PDF bytes, and a SHA-256
  digest of the Model API key that owns it (never the key itself), so
  History opens only that key's conversations. Shared budget records beside
  these files keep the account digest, conversation and random request IDs,
  reserved or settled amounts and whether historical fees are unverified.
  They contain no prompt, attachment or key value. A request that crashed
  without verified usage keeps its possible liability. Budget records are
  retained even when an old conversation file is removed; deleting the
  extension's workspace storage directory removes them all. Scheduled prompts are saved
  beside them, one JSON file per prompt with the same digest, plus a small
  receipt for each run you confirmed. Archiving a conversation in the
  History dialog hides it; deleting the directory removes them all. A
  conversation idle longer than `museSpark.cleanupPeriodDays` (30 days by
  default) is deleted when History is listed.
- Turn checkpoints (M86, on by default, `museSpark.turnCheckpoints`) are
  kept under extension global storage in `checkpoints/<canonical-root-key>`.
  The physical canonical workspace root determines the key; windows in the
  same profile and global-storage namespace share the store. M86 takes no
  workspace captures or ignored-file scans. Only the bytes of files the
  model's own tools write are kept: their contents before and after each
  recorded write, including ignored files those tools write. Restore and
  Redo keep the bytes needed to reverse their writes to those same files.
  Commands, hooks, MCP tools, your edits and writes made by the extension
  for you are not captured. Personal memory outside the workspace is never
  restored.
  The shadow git repository holds file blobs and per-turn or restore/Redo
  records under `refs/muse-spark/m86/`; a per-window-instance journal and
  its copies live in `m86/<instance>/`. Records contain workspace-relative
  paths, write and owner identifiers, sequence numbers, file presence,
  content hashes, modes and created folder names. A boolean records
  whether commands, hooks or MCP tools ran, or background work was alive;
  it stores neither command text nor a list of their file changes. The
  folder is readable by your user only (mode 0700 on macOS and Linux).
  Nothing is written into the workspace's `.git`, and nothing is sent
  anywhere. Earlier M72 captures remain as read-only history; M86 creates
  no new ones.
  Retention retires oldest units by conversation sequence and removes
  their unneeded file copies. Cleanup also sweeps unreferenced copies from
  refused writes and crashes before an intent, after a one-hour grace period
  and while no writer is live. Bounded passes resume on later retention or
  startup maintenance. Small identity-only records preserve owners
  and sequence numbers so retirement differs from unexplained record loss.
  Identity records without file contents may outlive their copies until the window that wrote them retires.
  Shared journal metadata remains until every unit of its instance is
  retired; a live foreign journal is never rewritten. Archiving hides a conversation's records
  from other windows. A reload or a window closing does not by itself
  delete its durable journal. Records use compare-and-swap refs, and one
  shared ref reserves file work for a restore or Redo. Presence files hold
  the window process id, random instance id, running-turn/activity ids and
  fixed fenced/unsafe words, never command text, hook payloads, account
  labels or credentials. Native process uncertainty can outlive window
  closure; process death alone does not prove descendants stopped. M86
  fences older windows, and restores refuse while an older window is live.
  Deleting the checkpoint directory removes these records and copies.
  Restricted Mode records no new tool writes.

- Settings (`museSpark.*`), the archived-session list, the "last session"
  memory per panel, which paid features' prices you accepted, which paid
  features you allowed always in a workspace (kept in that workspace's
  state: feature names and a grant counter), the panel's webview state (a
  snapshot of the conversation it shows and your unsent draft), and whether
  you signed out of Muse Code are stored by VS Code's settings and state
  APIs. On Windows the small job helpers the extension compiles are kept in
  its global storage folder.
- The "Muse Spark" output channel logs what the extension does, with known
  key and token shapes redacted. VS Code keeps the channel as a log file in
  its logs folder; the extension writes no log file of its own. Muse Code
  RPC failures and asynchronous failure reasons are logged in fixed words;
  skill activation stdout/stderr is described by fixed words or length.
  Panel diagnostic events/notices, backend failed-turn reasons, MCP picker
  failures and voice failure notices redact known key/token shapes before
  display and webview snapshots. This covers diagnostic text; ordinary
  conversation and tool content is kept as sent. Unknown credential shapes
  are not recognised by the redactor.
- **The bundled skills for Muse Code** (M89) are installed only when you
  click Install or Update on the panel's offer or run **Muse Spark: Install
  Bundled Skills for Muse Code**. The install writes only under Muse Code's
  config folder (`~/.config/muse`, or `$XDG_CONFIG_HOME/muse`): a copy of
  the package in `skill-sources/high-quality-projects-skill/`, with a mark
  file (`.muse-spark-bundled.json`: the release tag and when it was
  installed), and one link per skill in `skills/`. Nothing is downloaded:
  the files are the release vendored into the extension when it was built.
  **Remove Bundled Skills from Muse Code** deletes only the links that lead
  into the marked copy and the copy itself; a folder without the mark, a
  skill of yours, or a link that leads anywhere else is never touched.
  Whether you answered Not now to the offer is kept in VS Code's extension
  state.
- **Import from other agents** (M83, D64) reads other tools' files only
  when requested, locally, without a model call or sending their contents
  anywhere. Import copies an item only to a place no more exposed than where it was: personal stays personal, a git-ignored file is never copied into a tracked one. It does not look for credentials in what it copies.
  Sources are Claude Code's `~/.claude.json` and `.claude/`, Codex's
  `.codex/` (their configured roots included), Cursor's `.cursor/`, and
  trusted project rules/configuration. Account and usage fields in
  `.claude.json` are discarded. Personal sources outside the home or whose
  exposure cannot be classified are refused. The preview contains names,
  kinds, scopes, target paths and refusal reasons only; picker details give
  scope rather than source path. The log contains counts and fixed reasons
  only. No clipboard API is used. Values are copied unchanged into an
  allowed file or an unsaved target editor edit, which you review and save.
  Only active MCP transport fields are emitted; inactive/unknown fields
  are listed as dropped by name. **Residual:** item names remain visible as
  the source tool shows them, including a name that itself contains a
  credential; generated target paths and dropped field names are visible
  too. **Residual:** an unsaved target edit is bound to its file only until
  you save; the prompt says to save it only to that path, but Save As can
  still put it in a more exposed file, so where you save it is your choice.
  Unsupported agent restrictions never create an executable file.
- A session export (M84) is written only where you save it, after its
  redacted form opened read-only in the editor. It holds the conversation's
  messages, thinking and tool calls with their arguments and visible output,
  the session's name, the model's name and the backend. The key digest and
  every credential of a shape the extension knows (the log redactor's list:
  common services' keys and tokens, bearer credentials, private keys,
  secrets named by their key) are removed, and by default every e-mail
  address and absolute path is replaced, including in item ids and error
  labels: your workspace and home folders to the path's end, spaces and
  all, and any other absolute path, in any script, to its first space (what
  follows a space is left as a word). A secret in any other shape is not recognised and stays, which is
  why the file is shown before it is saved. Ordinary UUIDs and protocol
  words remain intact. **Save without redaction…** keeps paths and e-mail
  addresses.
  Validation failures use localized refusals and scrubbed, bounded field
  names instead of JSON parser snippets from the picked file.
  Importing or opening a share file reads the one file you pick; nothing
  is uploaded, and there is no hosted sharing.

## The agent for other editors

`muse-spark-code-acp` (the npm package, `docs/acp.md`) runs Muse Spark in
editors that speak the Agent Client Protocol. It sends what the editor
hands it and what its tools read or run, the same way the extension does:

- **Your prompts** and what the editor attaches to them (files, excerpts,
  images) go to Meta through the backend the editor started it with, as
  above: the Muse Code CLI under Meta's Muse Code terms, or `api.meta.ai`
  with your key. Which files and selections ride along is the editor's
  choice, not the agent's.
- **The editor's MCP servers** (their commands, arguments, environments,
  URLs and headers) are handed to the Muse Code CLI for the session, which
  starts or calls them; the agent logs only their names. The Model API
  backend runs none.
- **Muse Code's sign-in** is read as the extension reads it (above): the
  structure of `auth.json` only, and `account/read` on a short-lived
  `muse serve` where only the CLI can say.
- **The key** is kept by `auth set` in the operating system's credential
  store under "Muse Spark Code (Unofficial)" (Windows Credential Manager,
  the macOS Keychain, the Secret Service on Linux), never in a file, and
  is never read from an environment variable or an argument, logged, or
  passed to Muse Code. `auth clear` deletes it. On Linux without an
  unlocked Secret Service the Model API backend is unavailable; there is
  no plaintext fallback.
- **Model API conversations** are saved as in the extension, one folder
  per workspace named by a hash of its path, under
  `%LOCALAPPDATA%\Muse Spark Code` on Windows,
  `~/Library/Application Support/Muse Spark Code` on macOS and
  `$XDG_DATA_HOME/muse-spark-code` elsewhere. Muse Code conversations stay
  in the CLI's own store. The paid features you allowed always in a folder
  are kept beside them in `acp/paid-uses.json.d`: feature directories, each
  folder's hash and random generation identifiers used to revoke old grants.
  These records contain no prompt, file content, account or credential. Old
  generations are inert; a stale process cannot restore revoked permission.
  Legacy `paid-uses.json` maps are ignored and their next use asks again.
- **The network**: the agent's own requests go to `api.meta.ai` through
  Node's `fetch` and, with `--trust-workspace` on the Model API backend, to
  the site of a web page the model asks to read once you allow it, and through a proxy only when its environment asks for
  one (`docs/acp.md`, "Networks and proxies"); VS Code's proxy and
  certificate settings do not apply to it.
- **The log** goes to stderr, which the editor shows or keeps as its agent
  log; keys and tokens are redacted.
- **Problem reports**: the agent's failure journals, in `reports/` under
  that data folder, and `muse-spark-code-acp report` are described under
  [Reporting a problem](#reporting-a-problem).
- The folder's rules, skills, custom agents and memory are read only with
  `--trust-workspace` (the agent runs no subagents, so no agent is ever
  offered or sent); contributor-tier models are listed only with
  `--allow-contributor-models`; web search and image generation only with
  `--web-search` or `--image-generation`, and each use only once you allow
  it in the editor's prompt, which names the price (Allow once, Allow
  always in this workspace with `--trust-workspace`, or Deny).
  It has no telemetry either.

## Reporting a problem

**Muse Spark: Report a Problem** (M93) builds a bug report on your machine.
The panel reaches the same dialog from the palette's **Report an issue…**,
from **Report this** on a recorded error notice or failed turn, and from
**Report a problem** on the panel's crash screen. The extension never posts
or uploads the report and calls no network service or model for it; there
is no telemetry and no GitHub access.

- **The flight recorder.** Each VS Code window keeps its own journal in the
  extension's global storage, `reports/journal-<window>.jsonl`, with an
  activation marker, `reports/marker-<window>.json`, beside it. Neither is
  in Settings Sync or in the workspace's storage. In a remote window the
  extension, and so the journal, lives on the remote host. A journal keeps
  records for 7 days and at most 256 KiB, oldest removed first. It is pruned
  when the extension starts, at each new record and each time a report reads
  it, so an editor you have closed cannot prune its journal until you use it
  again. A window records at most 20 failures a minute.
- **What is recorded:** activation failures (once the recorder has started),
  Muse Code process exits nobody asked for, failed turns, failed tool calls,
  the error notices the panel shows, and the panel's own window errors,
  unhandled promise rejections and render failures. For those the panel
  sends only the kind, a known error class and frames inside its own
  bundle.
- **What a record holds:** a fixed event kind (`activationFailed`,
  `backendExit`, `toolCallFailed`, `windowError`, `unhandledRejection`,
  `reactBoundary`, `errorNotice`); a code from a fixed vocabulary
  (JavaScript error class names, errno names such as `ENOENT`, Muse Code
  exit signals such as `SIGKILL` or the word `exited`, the ACP agent's
  fixed failure words) or the word `unknown`; the extension and host
  versions; sometimes the backend; and stack frames inside the extension's
  shipped bundles only (`dist/extension.js:2:345`). Never prompts, code,
  file contents, model output, tool arguments or results, command text,
  messages, absolute paths, URLs, session ids or credentials.
  - Records are scrubbed and validated before they are written and again
    when they are read; a torn or tampered line is skipped.
  - Symbolic links, hard links and unexpected files in the folder are
    refused.
  - If storage fails, the window stops recording with one warning in the
    log, and its report says that recording was unavailable.
- **The crash offer.** The marker is set just after the extension starts
  (when its recorder loads) and cleared when it shuts down normally. At the
  next start, a marker left by a window whose process is gone is removed,
  and the extension offers once: "Muse Spark Code stopped unexpectedly last
  time — report it?" (**Report a problem** or **Not now**). The marker is
  gone, so a dismissal is remembered. A second window that is still running
  is never taken for a crash. The offer cannot tell a crash from a forced
  exit (a killed process, a power loss), and it cannot see a failure before
  the recorder has loaded. The extension starts when the panel opens or a
  command runs, so the offer appears then.
- **The dialog** has a description field, which warns that what you write
  can still disclose confidential information (the description is never
  kept in the journal); switches for **Include support facts** and
  **Include recent events**; a list of every item in the report, each with
  **Remove**; and a read-only preview of the exact final text.
  - Support facts: the extension, VS Code and Node versions, the platform,
    the backend and shell-sandbox settings, whether the Muse Code CLI was
    found and the version its installer recorded, whether it is signed in
    (from the credential file's structure only: no account lookup, no CLI
    started), whether a Model API key is stored and whether `META_API_KEY`
    is set (yes or no only), and the names, never the values, of the Muse
    Spark settings you changed.
  - Recent events: up to the last 50, with relative ages ("3m ago").
  - Building the report starts no session, signs in nowhere and runs no
    workspace command.
- **A second scrub** runs over the whole final draft, the title and your
  description included: workspace roots become `<workspace>` and the home
  folder `~` (on Windows in any letter case, with either separator and in
  the extended `\\?\` spelling); other user paths, Windows network (UNC)
  paths, e-mail addresses, IPv4 and IPv6 addresses,
  URL query strings, fragments and credentials, your login and machine
  names, and every secret pattern the extension's redactor knows are
  removed.
- **The exports** all use the exact previewed text. A change after the
  preview builds a new preview instead of exporting.
  - **Copy report** puts the report on the clipboard.
  - **Open issue page** opens this repository's GitHub new-issue page in
    your browser with the title and body filled in. When the encoded
    address would pass 2,000 characters, the report is copied instead and
    the empty new-issue form opens, with an instruction to paste. If that
    copy fails, nothing opens and the dialog says so.
  - **Save to a file** writes the report to a file you pick.
  - **Use the VS Code issue reporter**, where VS Code has it, opens VS
    Code's own reporter with the title and body. VS Code adds its own data,
    may search GitHub for similar issues, and controls sign-in and
    submission, so what it sends is not only the previewed text.
- Opening the browser hands the draft to GitHub under your account. The
  clipboard's history, a saved file and the browser's history are outside
  the recorder's retention.
- **The agent for other editors.** `muse-spark-code-acp report` builds the
  same kind of scrubbed report from the agent's own journals, in
  `reports/` under the data folder named above, kept under the same
  policy. It prints the report, or writes it to a file with `--out`. It
  starts no backend, signs in nowhere, opens no browser, makes no network or
  model call, and creates or consumes no activation marker. While the agent
  serves an editor it records its own failures there as fixed words
  (`updateNotSent`, `skillsUnavailable`, `permissionRequestFailed`,
  `approvalWithoutDenial`, `questionFailed`) with no frames, and it never
  writes report text to the editor's ACP channel. Its report names no VS
  Code version (`none (standalone agent)`), gives the backend and sandbox as
  `auto`, and lists no setting names; a credential store it cannot read
  counts as no stored key.

## Your choices

- `museSpark.confidentialWorkspace` blocks contributor-tier models and hides
  them from the model list.
- `museSpark.attachOpenFile` controls whether the active editor rides along
  with a message.
- `museSpark.respectGitIgnore` (in a trusted workspace with git present)
  keeps ignored files out of `@`-mention suggestions, and their selections
  and picked text are sent only as paths.
- Permission modes (Manual, Edit automatically, Plan, Auto, Bypass) decide
  which tool calls run without a card; the card shows the command or path
  before anything runs. On the Muse Code backend that holds for commands
  and for writes to `.git`, `.muse` and `.agents` only: Muse Code's file
  tools write every other file without a card in every mode, Plan included.
- `museSpark.shellSandbox` decides whether Muse Code runs inside its OS
  sandbox. With it, Muse Code's file tools cannot write outside the
  workspace. Without it (`off`, or `auto` on Windows for a workspace under
  your user profile) they can write, and
  so copy workspace content, anywhere your account can, without asking; the
  panel warns once per window, and **Muse Spark: Diagnostics** says which
  applies.

## Contact

Questions and reports: <https://github.com/RandyNorthrup/muse-spark-code/issues>.
This project is not affiliated with Meta. "Muse Spark" and "Muse Code" are
Meta trademarks.

## Headless runs and CI (M80 integration pending)

Headless prompt, untrusted resources, PR title/body/diff and ordinary workspace
files the agent reads can reach Meta. Use a secret-free checkout. Contributor
models require explicit opt-in; their content is eligible for Meta training.
The authentication key goes only in the provider auth header, never model
content. Local runs keep existing OS-store auth. CI launcher receives key in its
initial environment, removes variable before children, then sends private stdin
to only trusted exec and scanner commands; both keep it in memory and clear
references in finally. Initial same-user environment/memory inspection remains
possible; removal cannot guarantee zeroization.

Scanner is local-only and sends no file or key to a model. It reports only count.
Exec suppresses all tool output text and withholds incomplete prose whole;
released output uses exact-literal-first redaction plus known token patterns.
This does not catch unknown secrets or prevent readable workspace contents
from entering provider context. GitHub receives only redacted result/events/
eligible comment outputs, plus exact scanned clean text patch and binding
manifest. A binary/image change or detected secret withholds the entire patch;
private staging is not uploaded. Model-generated images are still paid provider
requests; tally records returned/uncertain liability under explicit flag/cap.

Lanes A to D are integrated and the live receipt LA passed on 2026-10-05; L and
LR remain open. Read
[CI guide](ci.md) and [M80 receipts](certification/m80.md) for exact flow,
retention/cleanup bounds, platform limits and support claims.

## Deterministic reports (M113)

`/report` reads bounded workspace plan, package, Git, changelog and certification
facts locally. Report history, normalized check completions and decoded response
cache live in owner-only `reports/v1/` storage outside the workspace. Other agents'
usage files are read only after the corresponding explicit setting opt-in.
The shared export scrub removes secrets, registered values and local profile
paths before canonical hashing, rendering and storage; JSON remains structurally
valid. Account labels and tokens are not report fields.

Editor GitHub reads use an existing silent sign-in and current network setting;
terminal collection requires `--network` and uses `gh`'s own identity. No Model API
key is read or sent to a child process. The check journal retains only the check name, normalized outcome, duration,
Git commit and observation time; it contains no command or stdout. A writer
lease with unprovable ownership is preserved. Manual repair requires all
relevant writers to have stopped.

The network-off setting and cancellation
are checked before dispatch; validated decoded cache entries use ETags. No report
makes a model call. Posting and email are not offered by the integrated report UI;
those adapters require explicit target permission and their missing owning hosts.
