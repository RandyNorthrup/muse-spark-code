# Privacy

Muse Spark Code (Unofficial) is a VS Code extension that sends what you type
to Meta's Muse Spark model. This page says what leaves your machine, where it
goes, and what stays local. It is written for the extension's users; the
security notes for contributors are in `PLAN.md` §9.

## What the extension sends, and to whom

- **Your prompts, attachments and mentioned files.** Everything you type into
  the panel, every image or PDF you attach or drop, text files you explicitly
  pick for attachment in a trusted, indexed workspace, the contents of files you
  `@`-mention, the open file or selection when the "attach open file" setting
  is on, and the outputs of the tools the agent runs (file contents,
  command output, Problems-panel diagnostics) are sent to Meta so the model
  can answer. Nothing is sent until you press Send.
- **Your own shell commands (`!`).** A message that starts with `!` runs on
  your machine, and the command with what it printed goes to Meta with the
  next request, so the model knows what you ran; Muse Code also keeps it in
  its session log. So does what a command moved to the background printed
  when it ends.
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
  For the Problems panel and, when turned on, paid images, the extension
  serves Muse Code a tool server bound to `127.0.0.1` with a per-window
  token; nothing else on the network can reach it.
  A picked text file is sent as named text. Muse Code retains a readable
  `[Muse Spark Code attached text files: …]` annotation in the message's
  display text so the extension can mark its file card after History resume;
  the annotation contains file names only, no file contents. Native Muse Code
  clients may show this line.
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
- **Hooks on the Model API backend (off by default).** With
  `museSpark.modelApiHooks` on, the hook commands in Muse Code's settings
  run on your machine as you, outside the agent's sandbox. That means your
  administrator's, yours and the project's `.muse/hooks.json`. Each hook
  receives JSON on its standard input: the prompt you typed, bounded
  previews of tool arguments and output, and bounded summaries of each
  model request and reply. Image data, credential-named fields and the
  Model API key are left out. What a hook does with that is up to the hook:
  it can write it to disk or send it anywhere, so read a hook before you
  turn the setting on. No hook runs while the folder is in Restricted Mode.
- **Workspace rules, skills and memory.** In a trusted workspace the agent
  reads `AGENTS.md` (or `CLAUDE.md`), the skills under `.agents/skills` and
  `~/.config/muse/skills`, and Muse Code's memory (the project's
  `.agents/memory`, and your own notes under `~/.local/share/muse/memory`),
  as the README describes. On the Model API backend the rules text, the
  skill catalogue (ids and descriptions) and the memory snapshot (each
  scope's `MEMORY.md` and its notes' names, your personal scopes included)
  go to Meta with every request as part of the instructions, a skill's full
  text when it is loaded or invoked, and a note's text when the model reads
  it with `read_memory`. What the model saves with `add_memory` is written
  on your machine, in the same files Muse Code uses. On the Muse Code CLI
  backend the CLI reads and sends them under Meta's Muse Code terms. The
  Model API backend reads none of this while VS Code has the folder in
  Restricted Mode; Muse Code's documentation says it still reads a
  repository's committed project memory then.
- **The Memory view** (M49) reads and writes only those notes on your
  machine; it sends nothing anywhere. A note it deletes goes to your trash.
- **Environment facts (Model API backend).** The instructions sent with
  every request name the workspace's absolute path, the operating system
  and shell, and today's date. In a trusted workspace that is a git
  repository they also carry the branch name, how many files `git status`
  lists as changed, and the subjects of the last five commits (never file
  contents or diffs); in Restricted Mode git is not run and none of this is
  sent. The Muse Code CLI assembles its own context under Meta's terms.
- **Contributor-tier models.** Meta may use traffic to the models whose id
  ends in `-contributor` to train its models. The extension asks once per
  conversation before using one, and refuses them entirely when the
  `museSpark.confidentialWorkspace` setting is on.

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
  Dictation is off in remote windows.
- **The paid features (off unless you turn them on).** Each is billed to
  your Model API key, never to your Muse Code subscription, and each asks
  you to accept its price when you turn it on, then asks again in a popup
  before each use (Allow once, Allow always in this workspace, or Deny). All five work on the Model
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
    you first and names its model and rates.
  - **Scheduled prompts** (`/loop`) save the prompt you typed, its schedule
    and the conversation it belongs to in VS Code's workspace storage for
    the extension. The prompt goes to Meta only when you choose **Run now**
    and confirm that run; a due prompt never runs on its own.

The extension itself has **no telemetry**, no analytics, no crash reporting
and no hosted server of its own. It contacts Meta when you send a message,
sign in, dictate with Muse Voice, use a paid feature, run a scheduled prompt
you confirmed, or open a panel while signed in (to list models; that request
carries no message). **Install Muse Code** downloads Meta's installer from
`dev.meta.ai`. On the Model API backend it also contacts remote MCP servers
you configured when a conversation starts or uses their tools. On macOS,
dictation may contact Apple as described above. Behind a proxy, those
requests go through the proxy VS Code is set to use under its `http.*`
settings. When neither Muse Code's environment nor
`museSpark.environmentVariables` names a proxy, the extension hands Muse
Code VS Code's `http.proxy` and `http.noProxy` (loopback always bypassed),
so Muse Code's requests use the same proxy; Diagnostics reports only
whether a proxy is set, never its address. **Muse Spark: Diagnostics** runs
`muse config status`, which reads Muse Code's managed configuration on this
machine and contacts no one. The public-issue report includes only recognized source and generation
fields, never raw configuration or failed-command output.

## Credentials

- A Model API key you paste is stored in VS Code's secret storage (the
  operating system's credential vault), never in settings files, logs or the
  workspace. It is sent only to `api.meta.ai` as a bearer token, and never
  passed to the Muse Code CLI or any other process.
- The Muse Code CLI's own sign-in lives in the CLI's credential file
  (`~/.config/muse/auth.json`). The extension checks only whether the file
  exists and when it last changed, never its contents, to decide which
  sign-in path to offer and to confirm that a new sign-in wrote it.
- **Sign out** in the panel (the same action as `/logout` and **Muse Spark:
  Sign Out**) deletes the pasted key from secret storage, runs `muse logout`
  in a terminal when the CLI is signed in, and records in VS Code's
  extension state (no credential) that you signed out, so an old CLI
  credential cannot sign the window back in until you sign in again.

## What stays on your machine

- Conversation history on the Muse Code backend is the CLI's own session
  store under `~/.local/share/muse` (Meta's format). The extension reads it
  to show the History dialog and never copies it anywhere.
- Conversations on the Model API backend are saved, one JSON file each, in
  VS Code's per-workspace storage directory for this extension (the
  `storageUri` VS Code assigns; outside the repository, under your user
  profile). A file holds the messages, the tool calls and their outputs,
  the edit patches, the task list, the model and the settings of that
  conversation, including attached image and PDF bytes, and a SHA-256
  digest of the Model API key that owns it (never the key itself), so
  History opens only that key's conversations. Scheduled prompts are saved
  beside them, one JSON file per prompt with the same digest, plus a small
  receipt for each run you confirmed. Archiving a conversation in the
  History dialog hides it; deleting the directory removes them all.
- Turn checkpoints (M72, on by default, `museSpark.turnCheckpoints`) are
  kept in the same per-workspace storage directory, in a `checkpoints`
  folder: a git repository of the extension's own holding copies of the
  workspace's files at each turn's start and end (tracked and untracked
  files outside the ignore rules), the sizes and times of ignored files
  (never their content), and a copy of an ignored file (a `.env`, say) only
  when the extension's own tools are about to change it. Nothing is written
  into the workspace's `.git`, and nothing is sent anywhere. Archiving a
  conversation deletes its checkpoints; the newest 100 per conversation,
  for 50 conversations, are kept within `museSpark.cleanupPeriodDays`, and
  deleting the directory removes them all. In Restricted Mode none are
  taken.
- Settings (`museSpark.*`), the archived-session list, the "last session"
  memory per panel, which paid features' prices you accepted, which paid
  features you allowed always in a workspace (kept in that workspace's
  state, feature names only), and whether
  you signed out of Muse Code are stored by VS Code's settings and state
  APIs. On Windows the small job helpers the extension compiles are kept in
  its global storage folder.
- The "Muse Spark" output channel logs what the extension does, with keys
  and tokens redacted. It is not written to disk by the extension.

## Your choices

- `museSpark.confidentialWorkspace` blocks contributor-tier models and hides
  them from the model list.
- `museSpark.attachOpenFile` controls whether the active editor rides along
  with a message.
- `museSpark.respectGitIgnore` keeps ignored files out of `@`-mention
  suggestions.
- Permission modes (Manual, Edit automatically, Plan, Auto, Bypass) decide
  which tool calls run without a card; the card shows the command or path
  before anything runs.

## Contact

Questions and reports: <https://github.com/RandyNorthrup/muse-spark-code/issues>.
This project is not affiliated with Meta. "Muse Spark" and "Muse Code" are
Meta trademarks.
