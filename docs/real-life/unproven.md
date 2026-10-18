# Unproven behaviours: the real-use backlog

On 2026-10-17 the owner ordered every fake test removed ("there can be no more fakes at all everything needs to be tested meaningfully or in actual use cases"). This list names every test that went, with the behaviours it claimed to cover, so each behaviour can be proven again by real use of the packed product (the real-life run). It is a backlog, not a test: nothing here runs, and a behaviour leaves this list only when a real-use run proves it.

A test was deleted when it:

- used a stand-in or invented data: `vi.fn`/`vi.spyOn`/`vi.stubGlobal` returning made-up answers, the hand-written `vscode` module (`test/unit/mocks/vscode.ts`), the fake Muse Code CLI (`test/e2e/fake-muse/`), the Action's fake agent and scripted transport (`test/action/`), a fake Model API, Git, GitHub or MCP server, or a helper built on one of those;
- or only checked that some text, key, name or file exists (in source, config, a workflow, docs, a manifest, a build output or a list the test pinned itself).

Counts: 187 test files deleted (1943 test titles), 99 tests removed from 31 files that keep real tests, and 74 helpers, fixtures and fake-suite scripts deleted with them.

## Deleted test files

### test/e2e/acpStdio.e2e.test.ts

- `the ACP agent over stdio (M63) > loads the real question bundles, defers without forms, and drains an idle answer once`
- `the ACP agent over stdio (M63) > prints its version and help, and refuses an argument it does not know`
- `the ACP agent over stdio (M63) > prints the complete translated usage and reference hint from the installed table`
- `the ACP agent over stdio (M63) > binds saved prompts and sharing help over real ACP stdio without a model send (M118)`
- `the ACP agent over stdio (M63) > streams a reply, runs an allowed tool call and skips a denied one, on Muse Code`
- `the ACP agent over stdio (M63) > cancels a running turn and lists the session afterwards`
- `the ACP agent over stdio (M63) > asks for sign-in when Muse Code is signed out, and for the key on the Model API backend`
- `the ACP agent over stdio (M63) > says at start that a proxy will not be used by the Model API backend, until Node’s switch is on (Q66)`
- `the ACP agent over stdio (M63) > refuses environment credentials as Muse Code Sign-In (FIXM95X)`
- ``the ACP agent over stdio (M63) > asks for sign-in after `muse logout`, whose file stays behind (PR #49)``
- `the ACP agent over stdio (M63) > reads Muse Code’s readiness from the credential file, and asks the CLI where only it can say (PR #49)`
- `the ACP agent over stdio (M63) > ships the Model API backend beside the agent, where the runtime loads it (M57)`
- `the ACP registry release gate > offers terminal sign-in for auth.terminal and for the older _meta flag, and to no one else`

### test/e2e/execStdio.e2e.test.ts

- `M80 D package guards > ships exact committed schemas, keeps production bin, and never packs the test launcher`
- `M80 D package guards > refuses %s schema before replacing stage`
- `M80 D package guards > packs distinct private fake-only tarball without changing production stage or digest`
- `M80 D package guards > refuses missing test launcher rather than emitting a product-like test success`
- `M80 D package guards > build tarball guard rejects missing %s`
- `M80 D package guards > refuses wrong production %s before test staging`
- `M80 D package guards > refuses a directory in place of a required test-package schema`
- `M80 D package guards > refuses %s npm pack output instead of renaming a directory`
- `M80 D package guards > host store guard/cleanup: %s`
- `M80 E1-E7 built exec > E1/H4 built help names exec/scanner and package schemas are valid`
- `M80 E1-E7 built exec > E2/H1 refuses %s with usage/2`
- `M80 E1-E7 built exec > E3/E4/H2 completes using test-owned %s auth and real built engine`
- `M80 E1-E7 built exec > E8 completes one plan-mode turn on a configured provider through the built bundles`
- `M80 E1-E7 built exec > E9 refuses the turn in the agent’s words when the packed helpers bundle is gone`
- `M80 E1-E7 built exec > E5 %s while streaming is bounded`
- `M80 E1-E7 built exec > E5 unread output cannot block bounded signal exit`
- `M80 E1-E7 built exec > E6 redacts exact percent-legacy key from startup failure stderr`
- `M80 E1-E7 built exec > E7 installed scanner %s is counts-only with no keyring`

### test/e2e/execTestLauncher.e2e.test.ts

- `M80 W fake-only test package > packs the real launcher as a private, separately named, unsigned test variant`
- `M80 W fake-only test package > routes only the Model API origin to the script and reports hashes, never values`
- `M80 W fake-only test package > a local W rehearsal: run-exec with the test package as agent > W-%s passes the action-check checker`

### test/e2e/modelApi.live.e2e.test.ts

- `live Model API sweep (MUSE_LIVE_MODEL_API=1) > case01 plain reply: the catalogue, a turn, and one with thinking off`
- `live Model API sweep (MUSE_LIVE_MODEL_API=1) > case02 tools: read, edit and a shell command, each through the Manual card`
- `live Model API sweep (MUSE_LIVE_MODEL_API=1) > case03 replay: a second turn that needs the first (M42)`
- `live Model API sweep (MUSE_LIVE_MODEL_API=1) > case04 images: one attached, one read by read_file (M54)`
- `live Model API sweep (MUSE_LIVE_MODEL_API=1) > case05 PDFs: one attached, one read by read_file (M54)`
- `live Model API sweep (MUSE_LIVE_MODEL_API=1) > case06 goals: a goal set by the user wakes a turn that closes it (M45)`
- `live Model API sweep (MUSE_LIVE_MODEL_API=1) > case07 memory: a fact remembered where the memory store places it (M49)`
- `live Model API sweep (MUSE_LIVE_MODEL_API=1) > case08 MCP: a stdio server from Muse Code settings, its tool called (M50)`
- `live Model API sweep (MUSE_LIVE_MODEL_API=1) > case09 hooks: a UserPromptSubmit hook runs when trusted, never when not (M51)`
- `live Model API sweep (MUSE_LIVE_MODEL_API=1) > case10 subagents: a child task, its price accepted, runs and returns (M48)`
- `live Model API sweep (MUSE_LIVE_MODEL_API=1) > case11 web search: a search runs, is counted, and replays (M33)`
- `live Model API sweep (MUSE_LIVE_MODEL_API=1) > case12 images: one generated, then edited, each confirmed (M34, M44)`
- `live Model API sweep (MUSE_LIVE_MODEL_API=1) > case13 scheduled prompt: a /loop schedule run through its confirmed Run now (M52)`
- `live Model API sweep (MUSE_LIVE_MODEL_API=1) > case14 Muse Voice: a spoken sentence streamed and transcribed (M35)`
- `live Model API sweep (MUSE_LIVE_MODEL_API=1) > case15 compaction: /compact after a tool call, and the next turn replays the summary`
- `live Model API sweep (MUSE_LIVE_MODEL_API=1) > case16 resume and rewind: a stored session in a new window, a fork and a side chat (D14, M53)`
- `live Model API sweep (MUSE_LIVE_MODEL_API=1) > case17 workspace context: the rules file and a project skill (D13, M10)`
- `live Model API sweep (MUSE_LIVE_MODEL_API=1) > case21 verify loop: then_run, the automatic check and the diagnostics after an edit (M68)`
- `live Model API sweep (MUSE_LIVE_MODEL_API=1) > case18 a question, and Stop while a card is open, then the next turn (M16, D26)`
- `live Model API sweep (MUSE_LIVE_MODEL_API=1) > case21 git drafts: a commit message and a pull request, each as the user’s own turn (M71)`
- `live Model API sweep (MUSE_LIVE_MODEL_API=1) > case23 /review as the Reviewer: git’s material marked untrusted, tools that only read, findings the panel lists (M70)`
- `live Model API sweep (MUSE_LIVE_MODEL_API=1) > case20 plans as files: through the panel’s controller, a Plan-mode reply saved byte for byte, then implemented in a fresh conversation with its steps as the todo list (M79)`
- `live Model API sweep (MUSE_LIVE_MODEL_API=1) > case19 code intelligence: references, then a rename through its card (M67, D49)`
- `live Model API sweep (MUSE_LIVE_MODEL_API=1) > case22 session budget: each request estimated at or above what Meta counts, and one that cannot fit never sent (M82)`

### test/integration/tab.test.ts

- `tab completions > trigger then commit accepts, and acceptNextWord infers, past the redactor`

### test/unit/a11yScheduling.test.mjs

- `scans every page once and gives complete streamed replies an uncontended browser`

### test/unit/accountUsage.test.ts

- `M108 J account aggregation > isolates provider and account identities, resolves legacy default locally and never writes labels`
- `M108 J account aggregation > keeps exact nano-USD liability and safe counts across settlement, reservation and uncertainty`
- `M108 J account aggregation > matches admission exactly on a sub-nano spend cap instead of flooring it`
- `M108 J account aggregation > keeps sub-nano spend below nearby caps instead of rounding up through nano-USD`
- `M108 J account aggregation > includes configured idle accounts and removed event identities without inventing usage`
- `M108 J account aggregation > uses half-open local calendar periods for selected totals and each threshold meter`
- `M108 J account aggregation > handles a week crossing a month, leap months and DST midnight normalization`
- `M108 J account aggregation > carries outstanding liability across calendar resets and matches admission without counting old settlements or duplicating current claims`
- `M108 J account aggregation > lists canonical committed swaps, spreads and stops chronologically in the selected interval`
- `M108 J account aggregation > includes reservations and committed events at the observation instant and excludes future data`
- `M108 J account aggregation > rejects malformed records, labels or credentials in the journal, invalid clocks and duplicate catalogs`
- `M108 J account aggregation > shows missing or expired live meters as unavailable, scoped by both identities`
- `M108 J account aggregation > uses exact headroom cross multiplication and rejects malformed normalized buckets`
- `M108 J account aggregation > validates captured plan percentages and reset timestamps rather than displaying malformed snapshots`
- `M108 J account aggregation > preserves fractional plan percentages and matches admission without money quantization`
- `M108 J account aggregation > matches independently generated journals and the admission evaluator for every account and user meter`

### test/unit/acpMedia.test.ts

- `ACP media admission > honors a selected model record that accepts WebM without a Meta format default`
- `ACP media admission > refuses invalid or oversized media names before preparation`
- `ACP media admission > sniffs a media path with no media suffix instead of trusting its name`
- `ACP media admission > dispatches sniffed video and audio blobs through the selected model gate`
- `ACP media admission > refuses standalone audio on Meta rather than forwarding ignored input_audio`
- `ACP media admission > refuses unknown video support, MIME mismatch, malformed base64 and Muse Code media`
- `ACP media admission > confines resource links and checks policy before any media read or preparation`
- `ACP media admission > refuses a symlink escape and declared MIME mismatch before preparing a linked file`
- `ACP media admission > names a missing recorder, not a missing converter`
- `ACP media admission > suffixes embedded audio blocks by their sniffed bytes`
- `ACP media admission > never starts a recording in headless mode and disposes a refused preview`

### test/unit/acpNpmReadme.test.ts

- `the ACP agent npm landing page > requires the lazy estimator in both production and private package inputs`
- `the ACP agent npm landing page > is packed as the package README instead of the detailed guide`
- `the ACP agent npm landing page > keeps the linked STAR sentence near the top of the npm landing page`
- `the ACP agent npm landing page > has no relative link or image target`
- `the ACP agent npm landing page > declares the improved npm manifest fields`

### test/unit/acpPackageFixtures.test.ts

- `ACP packaging fixtures > lay out every native file the packager copies, its runner helpers and its list`
- `ACP packaging fixtures > the packager takes its native files from the shared list only`
- `ACP packaging fixtures > every packaging fixture uses the shared layout and keeps no list of its own`

### test/unit/acpPlaybook.test.ts

- `ACP /playbook local command > renders status, record and settings through the same port as the CLI`
- `ACP /playbook local command > records a reason and trusted actor/time, with no rule nine mutation`
- `ACP /playbook local command > does not drop attachments, leak failures or touch the port for ordinary prompts`
- `ACP /playbook local command > answers unavailable when the journal bundle cannot load`

### test/unit/acpTranslate.test.ts

- `UpdateTranslator > announces a tool call once, streams nothing of its output, and sends it whole at the end`
- `UpdateTranslator > shows an edit as a diff with its absolute path, a new file with no old text`
- `UpdateTranslator > fails a declined or failed call with its reason, clipped output and all`
- `UpdateTranslator > shows a user shell command, a subagent and arguments that are not JSON`
- `UpdateTranslator > streams reasoning as thoughts, a new summary part after a blank line`
- `UpdateTranslator > ignores deltas of items it does not stream and fields it does not know`
- `UpdateTranslator > sends nothing when a message reaches a request, since ACP never queues one (M87)`
- `UpdateTranslator > replays the user’s messages only from a loaded history`
- `UpdateTranslator > sends the session’s name, its context use, the backend’s notices and the todo list`
- `tool names and kinds > names a tool from the table, an MCP tool by its server, anything else as it came`
- `tool names and kinds > gives each family its kind`
- `approvals > reads a permission answer only in its schema, and anything else as a cancel (rule 7)`
- `approvals > offers each choice under its own id, label and kind`
- `approvals > decides with the picked choice, else the backend’s deny-once, else any deny, else none`
- `approvals > titles the request by what it is about: the stages, the file, the host`
- `promptParts > bounds encoded blobs before decoding and refuses MIME mismatches on direct images`
- `promptParts > dispatches a PDF blob as a document and checks MIME against its bytes`
- `promptParts > routes video and audio to the injected media path, refusing the whole prompt on a refusal`
- `promptParts > refuses a media link when no confined reader is installed`
- `promptParts > keeps ordinary links as mentions even when the media port is bound`
- `promptParts > reads a file whose name begins with two dots as inside the folder`
- `promptParts > takes text, images, links inside the folder as mentions and attached text as context`
- `promptParts > refuses a prompt with an image too large, a file that is not one, audio, or a link it cannot map`
- `mcpServersFrom (M63c) > keeps stdio and HTTP servers by name, and leaves out SSE, the ACP transport and a repeated name`
- `mcpServersFrom (M63c) > takes a stdio server sent with an explicit type, as some clients do`
- `questions > asks each question as a required field of the right kind`
- `questions > reads the answers: an option, several, free text`
- `questions > answers nothing on %s (rule 7)`
- `questions > answers nothing for a multiple choice with %s`
- `questions > answers nothing for blank free text or an answer to a question it did not ask`
- `questions > declines a form whose answers do not fit the questions (AGENTS.md rule 7)`
- `questions > writes the questions as text for a client without forms`
- `FIXM101T ACP path parity > shows the tool target in permissions and write previews (%s)`
- `FIXM101T ACP path parity > omits locations and previews for an escaping normalized path`

### test/unit/actionApply.test.ts

- `the apply sub-action (G25) > prepares the exact patch on the exact head, then pushes it with a lease`
- `the apply sub-action (G25) > starts no Git maintenance in the fixture repositories: not from a push, not from a commit`
- `the apply sub-action (G25) > refuses a changed digest, a missing patch, another run and a malformed manifest before any Git`
- `the apply sub-action (G25) > push refuses a head that moved (API) and a lease that no longer holds (origin)`
- `the apply sub-action (G25) > runs no inherited or planted Git program while preparing and pushing`
- `the apply sub-action (G25) > reads the pull request head ref only after validating it`

### test/unit/actionGate.test.ts

- `the gate decision (pure) > G1 allows a same-repository OWNER pull request whose API view agrees`
- `the gate decision (pure) > G2 refuses a fork pull request by its event and by its API head`
- `the gate decision (pure) > G3 refuses pull_request_target and every event outside the allow-list`
- `the gate decision (pure) > G4 refuses comments from contributors, outsiders and first-timers`
- `the gate decision (pure) > G5 refuses a member comment on a fork pull request (API head)`
- `the gate decision (pure) > G6 refuses a comment on a plain issue and names no pull request`
- `the gate decision (pure) > G7 refuses a public repository on a self-hosted runner and warns for a private one`
- `the gate decision (pure) > G8 refuses a bot sender, by type or by login`
- `the gate decision (pure) > G9 allows a dispatch only for a positive integer, open, same-repository pull request`
- `the gate decision (pure) > G10 refuses a comment without the trigger, an edited comment and a review-comment edit`
- `the gate decision (pure) > takes the task after the trigger and bounds it at 4,000 characters`
- `the gate decision (pure) > G15 refuses when the event head differs from the API head`
- `the gate decision (pure) > G16 refuses image generation in review mode`
- `the gate decision (pure) > refuses malformed API heads, bases, refs and repository names`
- `gate-cli under its owner > reads the pull request once with the token and writes the private decision`
- `gate-cli under its owner > G2/G3 refuse before any API read and write allowed=false`
- `gate-cli under its owner > refuses when the API answers an error status`

### test/unit/actionGit.test.ts

- `source parity with the host policy > reproduces GIT_METADATA_OPTIONS exactly`
- `source parity with the host policy > adds the Action overrides to every command`
- `configuration closed by its shape (RVM80CD P1) > accepts what a fresh git init writes and the command’s own overrides`
- `configuration closed by its shape (RVM80CD P1) > refuses %s from every file scope, naming no key`
- `configuration closed by its shape (RVM80CD P1) > fails closed on a malformed listing`
- `configuration closed by its shape (RVM80CD P1) > lets a network command use only the validated remote’s own transport`
- `the Git environment > drops every inherited GIT_* name and never carries the key`
- `the Git environment > stops repository discovery above the working directory and pins one transport`
- `the Git environment > carries the token only as the one authenticated command header, after a reset`
- `safeGit against armed fixture programs (G23) > the fixture is armed: plain Git runs the planted programs`
- `safeGit against armed fixture programs (G23) > works in a clean checkout, then refuses every phase once configuration names a program`
- `safeGit against armed fixture programs (G23) > re-reads the configuration before every command (configuration changed in between)`
- `safeGit against armed fixture programs (G23) > the route fixture is armed: plain Git runs its rewrite, ssh, include and upload-pack programs`
- `safeGit against armed fixture programs (G23) > refuses fetch, push and status through those routes; no program runs`
- `safeGit against armed fixture programs (G23) > never acts on a repository above its working directory`
- `safeGit against armed fixture programs (G23) > the transport pin alone refuses a rewrite to another protocol`
- `safeGit against armed fixture programs (G23) > refuses a token on the wrong command and a read-only flag on a writing command`

### test/unit/actionInputs.test.ts

- `Action inputs > parses the documented defaults`
- `Action inputs > accepts exactly the budget strings exec accepts (F1 grammar and range)`
- `Action inputs > refuses every malformed input by name`
- `Action inputs > builds exec arguments as one array with the mode and flags`
- `allocation, paths and outputs > allocates one exclusive private invocation and never reuses it`
- `allocation, paths and outputs > finds later steps’ invocation only where step 2 allocated it`
- `allocation, paths and outputs > tidy deletes only work/ and keeps out/`
- `allocation, paths and outputs > confines the checkout path inside the workspace`
- `allocation, paths and outputs > refuses a checkout path through a link (POSIX)`
- `allocation, paths and outputs > skips a git inside the workspace on PATH`
- `allocation, paths and outputs > writes outputs that a value cannot forge`
- `staging and the prompt (G12) > cuts UTF-8 only between code points`
- `staging and the prompt (G12) > bounds title and body together and declares the cut`
- `staging and the prompt (G12) > keeps the whole pr.md, envelope included, within the cap when title and body fill it`
- `staging and the prompt (G12) > refuses a stored task over 4,000 characters`
- `staging and the prompt (G12) > cuts an oversize diff, keeps it valid UTF-8, and says so in the trusted prompt`
- `staging and the prompt (G12) > drops an incomplete UTF-8 code point at the retained Git prefix`
- `staging and the prompt (G12) > retains only the review prefix when the real Git diff exceeds the ordinary child cap`
- `staging and the prompt (G12) > fills each placeholder once and refuses a prompt larger than exec accepts`

### test/unit/actionManifest.test.ts

- `the main manifest (G17) > declares the specified inputs, defaults and outputs`
- `the main manifest (G17) > orders the steps: tools before the gate, install before checkout, upload/post/tidy last`
- `the main manifest (G17) > clears every startup hook in every step of both manifests`
- `the main manifest (G17) > gives the key only to the run step and the token only to gate, checkout and post`
- `the main manifest (G17) > runs each script by direct exec of the trusted Node, with no expression and no bash -c`
- `the main manifest (G17) > conditions every later step on the gate`
- `the main manifest (G17) > pins every action to the commit the repository workflows use`
- `the apply manifest (G17) > declares its inputs, outputs and steps, with no key and no proposal script`
- `the apply manifest (G17) > reads the YAML subset strictly`
- `builds and downloads every real native helper before packaging the fake-only Action candidate`

### test/unit/activityIcon.test.mjs

- `activity-bar icon > is a 24-grid mask with no text, image, script or external reference`
- `activity-bar icon > is single colour: only currentColor or none, no gradient or hex colour`
- `activity-bar icon > stays under 2 KB`
- `activity-bar icon > has no trace of the old Meta path anywhere under media/ or resources/`

### test/unit/agentImport.test.ts

- `scanAgentImports > does not resolve project folders without live %s`
- `scanAgentImports > finds every tool’s entries and sends each only where its scope allows`
- `scanAgentImports > reads no repository file in an untrusted workspace (the scope drill)`
- `scanAgentImports > offers a repository’s entries only for the project and the user’s only for theirs`
- `scanAgentImports > refuses a repository folder or file that leads outside the workspace`
- `scanAgentImports > follows the user’s own links, which are theirs to make`
- `scanAgentImports > reads the home folder’s tool folders once, as the user’s, when it is the workspace`
- `scanAgentImports > honours CLAUDE_CONFIG_DIR and CODEX_HOME and refuses a relative one`
- `scanAgentImports > warns in fixed words, never with a file’s content`
- `scanAgentImports > copies every active server env value unchanged at conversion, keeping its name`
- `scanAgentImports: entries that may hold a credential > keeps credential spellings unchanged in same-exposure targets`
- `importDisplayPath > shows workspace paths relative, home paths under ~, and others whole`
- `planImportApply > writes files that do not exist, appends rules, and gives servers and hooks as copies`
- `planImportApply > never replaces what exists, keeps the first of two with one place, and skips known servers`
- `applyImportWrites > creates and appends, and refuses a destination that now leads outside`
- `applyImportWrites > never replaces a file that appeared since the preview, and reports a failure by its code`
- `applyImportWrites > does not add a rules section that reached AGENTS.md while the preview was open`
- `applyImportWrites > confines a user write by its text to the Muse config folder`
- `refusals > does not turn a restricted command into an unrestricted skill: %s`
- `refusals > writes a compatible agent as its own bytes, keeping every restriction it names`
- `refusals > retains qualified BYO model references when importing an agent`
- `refusals > lists an unsupported agent restriction without writing it: %s`
- `refusals > lists an agent missing required metadata as unsupported`
- `refusals > reads namespaced Claude Code agents to the promised depth, retaining their front matter`
- `refusals > offers nothing for a file it could not read or one that leads outside`
- `refusals > keeps AGENTS.md within the size Muse Code loads, planned and written`
- `scanAgentImports: every agent’s hooks > converts Codex into Muse files and everything else into spark files, refusals listed`
- `scanAgentImports: every agent’s hooks > plans Muse copies without records and spark copies with each source’s record`
- `scanAgentImports: every agent’s hooks > notes the Kiro task meaning in plain words on its candidates`
- `scanAgentImports: every agent’s hooks > shows metadata only: no command text reaches labels, notes, dropped fields or reasons`
- `scanAgentImports: every agent’s hooks > reads no project hook without live trust (the scope drill)`
- `scanAgentImports: every agent’s hooks > lists a broken Kiro file in fixed words, never with its content`
- `scanAgentImports: RVM91I scanner regressions > RVM91I-2 reads Gemini and Codex switches before their hooks, across user and project`
- `scanAgentImports: RVM91I scanner regressions > RVM91I-6 refuses a personal Cline script that leads into the open project`
- `scanAgentImports: RVM91I scanner regressions > RVM91I-8/9 offers each lifecycle script once, and only by Cline’s discovery rules`
- `scanAgentImports: RVM91I scanner regressions > RVM91I-14 takes .devin/hooks.json over the legacy .windsurf/hooks.json`
- `scanAgentImports: RVM91I scanner regressions > RVM91I-15 reads the repository settings blocks as project hooks and honours COPILOT_HOME`
- `scanAgentImports: RVM91I scanner regressions > RVM91I-2 keeps every Copilot hook off under a repository disableAllHooks`
- `scanAgentImports: RVM91I2 regressions > R2-1 refuses %s hooks when a source switch file is oversized or unreadable`
- `scanAgentImports: RVM91I2 regressions > R2-1 allows personal hooks when optional source switch files are absent`
- `scanAgentImports: RVM91I2 regressions > R2-2 rechecks a Cline link retargeted during the executable await and trust loss`
- `scanAgentImports: RVM91I2 regressions > R2-2 refuses a personal Cline executable retargeted after preview during planning`
- `scanAgentImports: RVM91I2 regressions > R2-4 refuses valid Copilot inline siblings beside a malformed item`
- `scanAgentImports: RVM91I2 regressions > R2-9 refuses Gemini sequential event siblings across user and project files`
- `scanAgentImports: RVM91I2 regressions > R2-11 refuses a discovered Cursor file with no required version`
- `RVM91I2 Cline await boundaries > R2-2 checks project script confinement again after its executable await`
- `RVM91I2 Cline await boundaries > R2-2 refuses a personal link retargeted at final exposure classification`
- `RVM91I2 Cline source workspace identity > R2-2 confines a project executable to its original workspace again during planning`
- `RVM91I2 Cline source workspace identity > R2-2 rechecks project trust after exposure classification awaits`
- `R2-gates never treats an unsupported Codex event as a Claude extension hook`

### test/unit/AgentMap.test.tsx

- `formatDurationMs > reads seconds and minutes`
- `AgentMap > keeps the lazy team tree and opens a failed agent with recovery controls`
- `AgentMap > offers recovery for a background task whose reported final exit is nonzero`
- `AgentMap > shows an incomplete receipt, linked files and requested recovery controls`
- `AgentMap > shows trusted per-agent strike facts and opens the shared settings surface`
- `AgentMap > shows policy why-notes in the selected agent details`
- `AgentMap > labels a billed Model API child in the map`
- `AgentMap > draws the conversation, its agents with duration and tokens, and the background tasks`
- `AgentMap > stops one background task or all of them, and only running ones (M46)`
- `AgentMap > waits on a Stop already asked (M46)`
- `AgentMap > offers no Stop All when every background task has ended (M46)`
- `AgentMap > shows an agent’s details and transcript, and a running one without a transcript`
- `AgentMap > explains delegation being off and opens the settings file`
- `AgentMap > says nothing about delegation on the Model API backend`
- `AgentMap owner controls (M18, M48) > keeps Muse Code owner controls on the captured verbs and reserves read/reopen for Model API`
- `AgentMap owner controls (M18, M48) > offers interrupt and stop while running, result consumption when ready, and reopen when closed`
- `AgentMap workflows (M47) > lists the runs and agents read-only, and notes the trigger mode beside delegation`
- `AgentMap workflows (M47) > notes the trigger mode alone when delegation needs no word`
- `agentStatusLabel (M40) > says a known status in the installed table and shows an unknown one as it came`

### test/unit/agentOutcome.test.ts

- `D101 structured outcomes > maps %j to %s`
- `D101 structured outcomes > never turns a clean end or a free-text claim into success`
- `D101 structured outcomes > maps the captured Muse and workflow states, and owned Model API waiting`
- `D101 structured outcomes > bounds the recent-output window`
- `D101 structured outcomes > uses the last structured check and configured command, not its output text`
- `D101 structured outcomes > lists subagents, workflow children and background tasks with the same mapping`
- `agent receipts and recovery > keeps recovery confirmation valid as elapsed duration changes, and invalidates a new attempt`
- `agent receipts and recovery > adds captured child check evidence without certifying an unknown native stop`
- `agent receipts and recovery > preserves archived native receipts while a new attempt is active or mismatched`
- `agent receipts and recovery > keeps observed native attempts and trusts the workflow attempt number`
- `agent receipts and recovery > reads captured patch refs locally within a hard page budget and refuses partial evidence`
- `agent receipts and recovery > keeps command exits, duration and Windows-normalized file counts, and redacts before clipping`
- `agent receipts and recovery > keeps the original objective verbatim after failure context, and refuses unsupported retries`

### test/unit/ApprovalDock.test.tsx

- `ApprovalDock (D26) > selects the Russian form for %i waiting approvals`
- `ApprovalDock (D26) > shows nothing while no approval waits`
- `ApprovalDock (D26) > docks the oldest approval, with how many wait, and decides it`
- `ApprovalDock (D26) > says no count for a single approval`
- `ApprovalDock (D26) > moves focus to an arriving card, onto the card and not a choice`
- `ApprovalDock (D26) > leaves focus where the user types; the live region announces the card instead`
- `ApprovalDock (D26) > takes focus from an empty composer that only kept it after a send`
- `ApprovalDock (D26) > takes no focus behind a modal`
- `ApprovalDock (D26) > starts the feedback box empty on every stage of a multi-command approval (M25)`

### test/unit/AttachmentMediaCost.test.tsx

- `lazy media chip cost > shows both positive U4 prices with two significant digits and ceilings the charge`
- `lazy media chip cost > shows duration, bytes, sound and tokens marked as an estimate beside both prices`
- `lazy media chip cost > warns about screen content every time, including Standard`
- `lazy media chip cost > keeps unknown duration and sound visible, and does not invent tokens or a price`
- `lazy media chip cost > formats localized numbers, durations, currency and labels at render time`
- `lazy media chip cost > keeps old image, PDF and text summaries and removal behavior unchanged`

### test/unit/attentionDock.test.tsx

- `real question dock and draft surface > keeps a focused draft through deferral and submits that same late answer`
- `real question dock and draft surface > does not replace the focused question when another waiting question arrives`
- `real question dock and draft surface > discards the old session draft and remains inert behind a modal`

### test/unit/AudioAttachmentActions.test.tsx

- `M105-A lazy chip sound controls > shows the paid transcription price and selected default, and emits metadata-only choices`
- `M105-A lazy chip sound controls > leaves existing chips unchanged when capability options are absent`
- `M105-A lazy chip sound controls > offers wrapping for audio only when the host provides that capability choice`
- `M105-A lazy chip sound controls > renders a refusal without actionable buttons when capabilities permit nothing`

### test/unit/autoCompactionBundle.test.mjs

- `recognizes compaction authorization refusal across independently loaded bundles`
- `classifies compaction admission in the actual mandatory bundle-split inventory`

### test/unit/backendSelection.test.ts

- `selectBackend > auto: the CLI session wins, then a stored key, then the gate`
- `selectBackend > museCode: only the CLI counts, and a stored key never signs it in`
- `selectBackend > modelApi: only the stored key counts, with or without the CLI`
- `readBackendChoice > never asks for the CLI’s sign-in when the backend is forced to the Model API`
- `readBackendChoice > asks for it when the setting is %s`

### test/unit/backgroundRows.test.tsx

- `a running shell call (M46) > offers Move to Background, which asks the host once`
- `a running shell call (M46) > waits on a request already made`
- `a running shell call (M46) > offers nothing while its approval waits, once it ended, or for a tool that is no shell`
- `a background task (M46) > says it runs in the background and offers Stop`
- `a background task (M46) > reads stopped once stopped, with the host’s reason`
- `the user’s own command (M46) > shows what they ran, how it ended and what it printed, opened whole on click`
- `the user’s own command (M46) > marks a failing one failed, and says a signal and a stop`
- `the user’s own command (M46) > offers Stop on a running one only where the backend can stop it`
- `the user’s own command (M46) > stops a running one on the Model API, and waits once asked`
- `the header pill (M46) > shows running background tasks when no agent is there, and opens the map`
- `the header pill (M46) > names agents and running tasks together`

### test/unit/BestOfNDialog.test.tsx

- `BestOfNDialog > validates the form before it starts`
- `BestOfNDialog > says the feature is off instead of starting`
- `BestOfNDialog > shows running attempts and cancels the run`
- `BestOfNDialog > takes a finished attempt and compares two diffs side by side`
- `BestOfNDialog > keeps the form after Start until the host publishes the new run`
- `BestOfNDialog > keeps a reopened form over the finished run when the host refuses its Start`
- `BestOfNDialog > offers Open only for an attempt whose worktree was made`
- `BestOfNDialog > marks the taken branch and closes with Escape`

### test/unit/bridgeChecks.test.ts

- `bridge run_checks and engine test-command region > offers the existing run_checks definition, quotes paths, runs guards and packs the full output`
- `bridge run_checks and engine test-command region > quotes scoped files for the declared runner OS and guards the final command`
- `bridge run_checks and engine test-command region > refuses Windows-unsafe scoped paths on a Windows runner from a POSIX host`
- `bridge run_checks and engine test-command region > rechecks trust, cancellation and refusal after the destination-command guard`
- `bridge run_checks and engine test-command region > dispatches the command after a hook rewrite and refuses an empty hook command`
- `bridge run_checks and engine test-command region > refuses guarded tests and then_run before any runner probe, snapshot or install`
- `bridge run_checks and engine test-command region > rejects unknown fields, missing checks, unknown names, unsafe paths and oversized calls`
- `bridge run_checks and engine test-command region > binds access to the current authenticated attempt and rechecks it after waits`

### test/unit/browserRestartReadiness.test.mjs

- `leaves the discovery budget untouched until runtime preparation settles`
- `ends the preparation wait when admission refuses before acquiring a runtime`

### test/unit/canaries.test.ts

- `the canaries’ loopback fixture (M81 A1) > answers only its phase’s nonce, records its paths, and challenges its sign-in paths`
- `the canaries’ loopback fixture (M81 A1) > gives each phase ports and listeners of its own, so no phase answers or counts for another`
- `the canaries’ loopback fixture (M81 A1) > counts any request that carries a credential, whatever its path or phase`
- `the canaries’ loopback fixture (M81 A1) > answers on 127.0.0.2 where the OS has it (not macOS) and on ::1 where it has IPv6`
- `the canaries’ loopback fixture (M81 A1) > counts connections and datagrams on this machine’s own address, and has none without one`
- `the canaries’ loopback fixture (M81 A1) > opens nothing once it has closed`
- `a canary phase’s plan (M81 A1) > binds the default phase to its routing probes and the probe page to its nonce and port`
- `a canary phase’s plan (M81 A1) > adds the sign-in, alias, link-local, ICE and WebTransport probes in the page and audit phases`
- `a canary phase’s plan (M81 A1) > probes a subdomain of a widened name and a neighbour of a widened address, never the widened host itself`
- `a canary phase’s plan (M81 A1) > refuses only destinations outside the frozen scope, whatever loopback the user widened`
- `a canary phase’s plan (M81 A1) > names every refusal it needs by the phase alone: a host with its nonce, or the phase’s own port`
- `a canary phase’s verdict (M81 A1) > holds when every probe arrived where the construction routes it`
- `a canary phase’s verdict (M81 A1) > names each failure by the canary that found it, and the audit’s all auditFailed`
- `a canary phase’s verdict (M81 A1) > never counts a late answer to an earlier phase’s probes as this phase’s evidence (A1-1)`
- `a canary phase’s verdict (M81 A1) > accepts ICE TCP the proxy tunnelled to this machine’s own address when the user widened it, and nothing more`
- `a canary phase’s verdict (M81 A1) > requires the widened host’s neighbours refused too`
- `a phase’s probes through the real proxy (M81 A1) > holds at every loopback widening the setting allows: localhost, 127.0.0.1 and ::1 (A1-3)`
- `a phase’s probes through the real proxy (M81 A1) > never reads a CONNECT the proxy admitted as a refusal, even when its lookup fails (A1-2)`

### test/unit/cards.test.tsx

- `ApprovalCard > shows the current stage, flags, and sends the chosen decision with feedback`
- `ApprovalCard > sends one decision for its stage, however fast the clicks, until the host reopens it (D26)`
- `ApprovalCard > locks every control once the current stage has been decided`
- `ApprovalCard > keeps each choice in its DOM order, with its full text as its title for an ellipsized label`
- `ApprovalCard > falls back to the subject fields and hides the feedback box without such a choice`
- `ApprovalCard > names the page a web fetch will read (M69)`
- `ApprovalCard > names the page a browser check opens, and says when it is beyond this computer (M81)`
- `TodoPanel > collapses to progress and current task, expands back, and reopens expanded on mount`
- `TodoPanel > offers tab opening only when provided, and preserves the inert modal guard`
- `TodoPanel > lists tasks with their status marks and the active form, and hides when empty`
- `TodoPanel > keeps two tasks with the same text apart`
- `ApprovalCard tool subjects (M18) > says "use" before a bare tool name, as for subagent_spawn`
- `ApprovalCard reviewer and rule reasons (M78) > says why it asks beyond the mode: the Auto Reviewer’s reason, or the user’s rule (M78)`

### test/unit/chatColumn.test.mjs

- `the chat column (the owner’s requests of 2026-10-04) > names its width, and takes its inset from the panel rather than the scroller`
- `the chat column (the owner’s requests of 2026-10-04) > holds the transcript, the panes above the composer, the dock and the composer`
- `the chat column (the owner’s requests of 2026-10-04) > keeps the shared hover rule covering the task buttons (no per-button override)`
- `the approval choices and the composer toolbar > gives every approval choice one height and one line`
- `the approval choices and the composer toolbar > paints the model pill at the chips’ height inside a whole control`
- `the browser checks > opens the column at the default width, 320 px and 1400 px (with a scrollbar)`
- `the browser checks > measures the column in each of those scenarios`

### test/unit/ChatShareDialog.test.tsx

- `M118 preview dialog and header > keeps the replacement session dialog open when an old confirmation completes (keyed=%s)`
- `M118 preview dialog and header > invalidates on unmount and ignores a late committed confirmation`
- `M118 preview dialog and header > opens from the header only when supplied by the host`
- `M118 preview dialog and header > shows exact scrubbed bytes with every redaction highlighted and dispatches only on final confirmation`
- `M118 preview dialog and header > invalidates on range, options, mode, format, attachment and destination edits, and exposes only local destinations`
- `M118 preview dialog and header > remembers workspace mode and format edits even when closed without previewing`
- `M118 preview dialog and header > shows confidential refusal and never enables release`
- `M118 preview dialog and header > does not accept a malformed or mismatched host preview`
- `M118 preview dialog and header > rejects a valid host preview for different options`
- `M118 preview dialog and header > ignores an asynchronous preview that finishes after close and invalidates its host token`

### test/unit/checkPlan.test.ts

- `check:plan > is mandatory in quality:gates and runs the entire repository without a baseline`
- `check:plan > fails $code with the parser message and original line`
- `check:plan > accepts the defined formats without inventing a plan`
- `check:plan > selects exact ids and returns exit 3 with nearest ids for an unknown milestone`
- `check:plan > fails malformed ledgers and missing files explicitly`
- `check:plan > scrubs synthetic credential canaries from plan diagnostics and unknown ids`
- `check:plan > scrubs the decoded Unicode-escaped ledger reference canary from gate diagnostics`
- `check:plan > refuses an oversized file with an explicit input-size diagnostic`
- `check:plan > archive guard > passes a plan at exactly 85% of the reader bound`
- `check:plan > archive guard > fails one byte over, with the size, the line it crossed and the archive procedure`
- `check:plan > archive guard > reports format drift first, as before, when an over-size plan also has it`
- `check:plan > archive guard > names a procedure that CONTRIBUTING.md has, and applies to the repository plan`
- `check:plan > bounds the actual gate file read for an %s file and always closes it`

### test/unit/checkSlots.test.ts

- `persistent check slots > scrubs broad credential names from every Git, setup and check child`
- `persistent check slots > keeps the sentence-case busy error when the host is busy`
- `persistent check slots > snapshots working edits and untracked files without touching the real index or refs`
- `persistent check slots > resets source and installs once per exact lockfile hash in each slot`
- `persistent check slots > owns persistent objects after the first task copy is removed`
- `persistent check slots > releases snapshot ownership on cancellation and Git failures with proven retirement`
- `persistent check slots > hashes binary lockfiles without collapsing distinct invalid UTF-8 bytes`
- `persistent check slots > isolates installs between concurrent slots and never shares mutable cache files`
- `persistent check slots > copies the install per working copy and keeps the slot cache pristine`
- `persistent check slots > keeps slots occupied for uncertain descendants or transport failure: %j`
- `persistent check slots > refuses the user checkout, host pressure, untrusted work, escaped installs and missing lockfiles`
- `persistent check slots > refuses late trust loss and cancellation before starting another child`
- `persistent check slots > does not run checks after a failed install and strips credentials from every child`

### test/unit/companionCertification.test.ts

- `companion certification digest > records the 64-hex SHA-256 of server.ts at HEAD`

### test/unit/companionMediaTransport.test.ts

- `companion browser transport > sends the File as the HTTP body with guards and no content in bridge metadata`
- `companion browser transport > encodes Unicode and percent signs without encoding file bytes`
- `companion browser transport > rejects an invalid %s in the response`
- `companion browser transport > refuses redirects and HTTP failures`
- `companion browser transport > reports %s failure without completion progress`
- `companion browser transport > rejects an HTTP error even if its body contains valid upload metadata`
- `companion browser transport > refuses endpoint %s before dispatch`
- `companion browser transport > ignores a late response after Stop`
- `companion browser transport > keeps the sentence-case stop error when an upload is aborted`
- `companion browser transport > Stop aborts the request; no stale token survives it`
- `companion browser transport > refuses an already aborted request before dispatch`

### test/unit/confirmedDispatchInventory.test.ts

- `confirmed-dispatch inventory (RVCM1062H) > knows every file that references a confirmed dispatch`
- `confirmed-dispatch inventory (RVCM1062H) > lets no site but the helper refuse a confirmed dispatch`
- `confirmed-dispatch inventory (RVCM1062H) > builds the stale refusal sentence only in the helper module`

### test/unit/ContextMeter.test.tsx

- `ContextMeter (M87 item 1) > draws %s%% clockwise with %s inside, at level %s`
- `ContextMeter (M87 item 1) > hides a missing window: %j`
- `ContextMeter (M87 item 1) > compacts on click and reads the installed locale at render time`

### test/unit/cx1r6HostCommands.test.ts

- `CX1R6 hidden editor command invocation > the installed estimate shim refuses before opening a conversation or inserting a draft`
- `CX1R6 hidden editor command invocation > all three installed schedule command shims refuse even with the setting on`

### test/unit/cyclesRoots.test.ts

- `dependency-cycle root coverage (FIXCYCLES, G77) > retains dpdm circular failures and covers every build entry, including pages and workers`
- `dependency-cycle root coverage (FIXCYCLES, G77) > covers every repository runtime lazy import target`
- `dependency-cycle root coverage (FIXCYCLES, G77) > covers every entry-named source module, including lowercase entry.ts`
- `dependency-cycle root coverage (FIXCYCLES, G77) > covers every knip entry, including expanded test and script globs`

### test/unit/developerOptions.test.ts

- `machine-local Developer options > rejects an unknown removal without changing state or live resources`
- `machine-local Developer options > stops profiles before a failed %s save`
- `machine-local Developer options > starts locked and refuses multiple accounts and profiles before unlock`
- `machine-local Developer options > unlocks through %s but never enables profiles implicitly`
- `machine-local Developer options > requires seven version clicks on the same surface within the complete time window`
- `machine-local Developer options > does not extend the click window on each click`
- `machine-local Developer options > requires separate explicit confirmation for the visible setting`
- `machine-local Developer options > invalidates a late enable confirmation synchronously on disable`
- `machine-local Developer options > cannot publish a stale enabled state after a pending write and Reset`
- `machine-local Developer options > records profiles before launch and refuses an ineligible account before creating resources`
- `machine-local Developer options > expires at the exact boundary, withdraws admission immediately and retains profile ownership`
- `machine-local Developer options > fences a pending account check before it can create a profile`
- `machine-local Developer options > stops a late profile launch after Reset without losing its cleanup ledger`
- `machine-local Developer options > denied Reset still stops profiles but never deletes resources`
- `machine-local Developer options > persists disable before a failed stop and preserves failed removals for retry`
- `machine-local Developer options > removal disables and stops all profiles, and never invents a cleanup target`
- `machine-local Developer options > refuses enabling after audit/storage failure without a successful publication`
- `machine-local Developer options > restores only this machine’s unexpired grant without extending expiry`
- `machine-local Developer options > clears an expired restored grant before any process starts`

### test/unit/developerOptionsPage.test.tsx

- `Developer options page and badge > badges a surface only while developer mode is unlocked`
- `Developer options page and badge > locks the visible setting until unlock and never badges it`
- `Developer options page and badge > posts the setting, profile and reset requests from the unlocked page`
- `Developer options page and badge > shows fixed error text without echoing the rejected payload`
- `Developer options page and badge > keeps the lazy UI under its own budget on the shared runtime`

### test/unit/developerSurfaces.test.ts

- `Developer options on every surface > audits a terminal %s with the actual caller source`
- `Developer options on every surface > audits enable and disable from the real %s source`
- `Developer options on every surface > uses the shared owner and badge for %s`
- `Developer options on every surface > lets a companion display state but refuses every authority-changing request`
- `Developer options on every surface > refuses direct page unlock and spoofed confirmations or credentials`
- `Developer options on every surface > redacts raw adapter failures to fixed errors`
- `Developer options on every surface > routes the visible setting through unlock and its own confirmation and leaves denied changes off`
- `Developer options on every surface > has strict terminal commands without a credential or authority argument`
- `Developer options on every surface > reads installed localization at operation time for help, confirmation and badges`

### test/unit/DiffTallyRow.test.tsx

- `DiffTally > renders nothing for a conversation without edits, even with Review available`
- `DiffTally > shows singular files, formatted line totals, and the scope tooltip from real edits`
- `DiffTally > uses the plural file form and keeps a zero-line edit visible`
- `DiffTally > offers Review only with its callback and invokes it once`
- `DiffTally > reads installed text at render time and preserves translated order and number grouping`

### test/unit/EffortSlider.test.tsx

- `EffortSlider > fills the dots up to the current tier and selects on click without taking focus or bubbling`
- `EffortSlider > renders read-only dots without a handler`
- `EffortSlider > uses the catalogue order, descriptions and default, including tiers outside the old family table`
- `EffortSlider > keeps the selected catalogue tier ahead of the default and stays read-only without its handler`
- `EffortSlider > keeps the legacy range when capabilities are unknown and respects a known empty range`
- `EffortSlider > keeps catalogue variants inside an option mouse-only`

### test/unit/elicitationCard.test.tsx

- `MCP elicitation card > labels every control and enum group and validates format and bounds`
- `MCP elicitation card > submits with the form keyboard path and cancels with Escape`
- `MCP elicitation card > declines and cancels without forwarding draft values`
- `MCP elicitation card > locks submitted forms until a host refusal unlocks them`
- `MCP elicitation card > isolates enum radio names across concurrent cards`
- `elicitation reducer and persistence > keeps drafts out of persistence and clears the form on settlement`

### test/unit/ErrorBoundary.test.tsx

- `ErrorBoundary > renders its children while nothing throws`
- `ErrorBoundary > shows the error with a Reload button that asks the host for a fresh document`
- `ErrorBoundary > describes a non-Error throw by its string form`

### test/unit/execOutput.test.ts

- `M106 structured exec egress > bounds cyclic and oversized additive records before recursive parsing`
- `M106 structured exec egress > fails forbidden answer key %s without rewriting it into a completed result`
- `M106 structured exec egress > refuses forbidden record key %s in additive result and event readers at every level`
- `M106 structured exec egress > serialises decoded redaction once and keeps message/result JSON identical: %s`
- `M106 structured exec egress > retains integral large-number output and accounting at egress`
- `M106 structured exec egress > reports answer validation work exhaustion as its named failure while retaining accounting`
- `M106 structured exec egress > returns validated output and exact digest in %s`
- `M106 structured exec egress > refuses a mismatched final answer: %s`
- `M106 structured exec egress > redacts decoded sensitive fields and validates after redaction, including escaped field names`
- `M106 structured exec egress > never promotes earlier valid commentary over a withheld final response or a stop`
- `M106 structured exec egress > rejects malformed additive fields and retains the base accounting guards`
- `M106 structured exec egress > keeps no-schema result bytes equal to the existing v1 contract`
- `M80 egress (A12–A14, A17, A19, A20) > B/D27 authoritative withholding cannot reuse earlier completed commentary`
- `M80 egress (A12–A14, A17, A19, A20) > A12 emits valid increasing JSONL envelopes with one final result and a summary`
- `M80 egress (A12–A14, A17, A19, A20) > A12 keeps %s stdout in its selected format only`
- `M80 egress (A12–A14, A17, A19, A20) > A13 redacts a whole completed item literal-first, the key assembled before emission`
- `M80 egress (A12–A14, A17, A19, A20) > A13 withholds a cut-short final message whole, never reuses an earlier response`
- `M80 egress (A12–A14, A17, A19, A20) > A17 preserves unknown non-tool updates and redacts all nested string leaves`
- `M80 egress (A12–A14, A17, A19, A20) > A17 serializes a BigInt leaf of a loose update instead of throwing (RVM80A P3-4)`
- `M80 egress (A12–A14, A17, A19, A20) > A20 rejects prohibited caller payload before writing`
- `M80 egress (A12–A14, A17, A19, A20) > rejects repeated whole items`
- `M80 egress (A12–A14, A17, A19, A20) > redacts before JSON serialization, preserving escaped strings and wire fields`
- `M80 egress (A12–A14, A17, A19, A20) > A19 masks structured credential fields without corrupting JSON strings`
- `M80 egress (A12–A14, A17, A19, A20) > A14 notices a closed writer and an unsuccessful flush once`
- `M80 egress (A12–A14, A17, A19, A20) > A14 notices a writer above the queue limit once and emits no more bytes`
- `M80 egress (A12–A14, A17, A19, A20) > A19 redacts exact percent/punctuation keys longest first and literal-safely`
- `M80 egress (A12–A14, A17, A19, A20) > A19 percent key traverses the real exec → stderrLogger → createLogger chain`
- `M80 egress (A12–A14, A17, A19, A20) > reports a refused providers file as its own sentence instead of a raw stack`

### test/unit/execSchema.test.ts

- `M80 schemas (A15/A16/F1) > A16 enforces %s = %i, error and null signal`
- `M80 schemas (A15/A16/F1) > A16 requires %s for cancelled/%i`
- `M80 schemas (A15/A16/F1) > A16/F1 compares mixed total costs in integer micro-USD, not binary equality`
- `M80 schemas (A15/A16/F1) > rejects a sub-micro USD field independently of cost addition`
- `M80 schemas (A15/A16/F1) > rejects missing fields, unsafe counters, absolute paths, raw fields and incorrect uncertainty`
- `M80 schemas (A15/A16/F1) > keeps terminal/reason/usage after transport loss without allowing a priced claim`
- `M80 schemas (A15/A16/F1) > R32 refuses completed without latest verified completion evidence`
- `M80 schemas (A15/A16/F1) > bounds HTTP metadata, attempt ordinals and result limits`
- `M80 schemas (A15/A16/F1) > keeps accounting fields consistent with the backend and cap`
- `M80 schemas (A15/A16/F1) > enforces event required fields, envelope enums and integer ledger identity`
- `M80 schemas (A15/A16/F1) > A15 matches deterministic committed schemas and fails on field drift`
- `M80 schemas (A15/A16/F1) > M107 publishes the complete v2 event/result envelope alongside the frozen v1 schemas and update privacy rule`
- `M80 schemas (A15/A16/F1) > npm run package:acp checks schema freshness before it packs`
- `M80 schemas (A15/A16/F1) > RVM80A P2-2 the shipped event schema itself refuses what execEventSchema refuses in update`
- `M80 schemas (A15/A16/F1) > RVM80A P3-1 refuses, never throws on, an amount past toFixed’s fixed-point range`
- `M80 schemas (A15/A16/F1) > exercises the lane-owned constant contract, including F1 units`
- `R4 P3: ACP guide links canonical v2 decimal schemas and labels the v1 reader legacy`

### test/unit/feedback.test.ts

- `Muse Code feedback: user choices before an injected receipt reader > scrubs M84 patterns even without a host literal scrubber`
- `Muse Code feedback: user choices before an injected receipt reader > scrubs a registered literal and an M84 credential pattern before dispatch`
- `Muse Code feedback: user choices before an injected receipt reader > refuses dispatch when scrubbing changes the approved preview`
- `Muse Code feedback: user choices before an injected receipt reader > keeps the client-selected classification vocabulary closed`
- `Muse Code feedback: user choices before an injected receipt reader > refuses non-boolean %s consent before dispatch`
- `Muse Code feedback: user choices before an injected receipt reader > defaults both disclosures to false and sends only the selected parameters`
- `Muse Code feedback: user choices before an injected receipt reader > preserves explicit files and session-record consent for a bad result`
- `Muse Code feedback: user choices before an injected receipt reader > refuses a blank bug note before dispatch`
- `Muse Code feedback: user choices before an injected receipt reader > refuses a record for %s before dispatch`
- `Muse Code feedback: user choices before an injected receipt reader > refuses a record without files consent before dispatch`
- `Muse Code feedback: user choices before an injected receipt reader > refuses an empty session before dispatch`
- `Muse Code feedback: user choices before an injected receipt reader > refuses a non-string domain outcome and does not retry`

### test/unit/fileSessionStore.test.ts

- `real session files > round-trips, renames and removes a saved conversation across store instances`
- `real session files > lists intact headers of damaged conversations but refuses to open corrupt replay`
- `real session files > keeps sessions at the retention boundary and with retention off, deleting only older sessions`
- `real session files > refuses traversal IDs before a save, load or removal can leave its directory`

### test/unit/fontPreferences.test.ts

- `D94 appearance settings in every standalone host > defaults to the chosen standalone stacks and validates saved choices`
- `D94 appearance settings in every standalone host > leaves every editor host font under its own settings`
- `D94 appearance settings in every standalone host > applies user choices, system fallback and optional ligatures to standalone tokens`
- `D94 appearance settings in every standalone host > reads labels after the host installs its language table`

### test/unit/fsAtomic.test.ts

- `compares exact inode identities and captured metadata for owned-file cleanup`
- `writeFileAtomically (D27) > rechecks its owner after a busy publication attempt without replacing the target`
- `writeFileAtomically (D27) > creates the folder, replaces the file and leaves no temporary file`
- `writeFileAtomically (D27) > tries a busy rename again, the wait doubling, then gives up and cleans up`
- `writeFileAtomically (D27) > replaces the file a link leads to, never the link`
- `writeFileAtomically (D27) > keeps a real symbolic link and the permission bits of the file it replaces`
- `writeFileAtomically (D27) > refuses a read-only file at once, leaving it as it was`
- `writeFileIfUnchanged > replaces the file only while it holds the expected text`
- `writeFileIfUnchanged > asks its last word right before the rename, and leaves the file when told no`
- `writeFileIfUnchanged > compares immediately before each rename, so a change during the write stands`
- `deleteFileIfUnchanged > removes the file only while it holds the expected text, unchanged since it was compared`
- `deleteFileIfUnchanged > refuses a folder swapped for a junction, removing nothing behind it`
- `isSamePath (D27) > ignores case and separators on Windows only`
- `createFileExclusively (M79) > rechecks its owner after awaited staging before publishing a private new file`
- `createFileExclusively (M79) > publishes a new file and names a taken name as such, leaving the old file and no stage`
- `createFileExclusively (M79) > says a file where the folder should be is not a folder, never that the name is taken`
- `createFileExclusively (M79) > refuses a folder that leads elsewhere than the checked one, writing nothing there`
- `createFileExclusively (M79) > refuses a folder swapped for a junction once the stage is written, publishing nothing`
- `createFileExclusively (M79) > refuses a swapped ancestor before mkdir can create an outside plans folder`
- `createFileExclusively (M79) > refuses a replaced stage before publication and leaves the replacement untouched`
- `createFileExclusively (M79) > preserves both a moved owned stage and a same-name foreign file behind a swapped folder`
- `createFileExclusively (M79) > removes a held stage again, and says whether the file was published when it cannot`

### test/unit/git.test.ts

- `createGitRunner (D24) > refuses an unrepresentable hook name %j before running a complete held command`
- `createGitRunner (D24) > switches named hooks off, reads no filter or attribute, and leaves ordinary Git alone`
- `createGitRunner (D24) > enters no checkout after trust ends during names-only configuration discovery`
- `createGitRunner (D24) > reports a lost owner as it is when it ends after the version check, never as a missing Git feature`
- `createGitRunner (D24) > asks for the version again after a failed read instead of refusing every later checkout`
- `createGitRunner (D24) > fails explicitly before checkout when safe program controls are unsupported`
- `createGitRunner (D24) > refuses automatic configured program %s without running the requested command`
- `createGitRunner (D24) > checks the current owner after automatic configuration awaits and before actual spawn`
- `createGitRunner (D24) > runs final preparation after configuration and refuses changed ownership before apply entry`
- `createGitRunner (D24) > refuses automatic Git before 2.36 rather than treating fsmonitor false as an executable`
- `createGitRunner (D24) > runs git by absolute path with a timeout, no window, no prompt and no optional locks`
- `createGitRunner (D24) > gives a call that does real work its own timeout (M32)`
- `createGitRunner (D24) > rejects without running anything when git is only reachable relatively`
- `createGitRunner (D24) > finds git installed after a miss`
- `gitExitCode (REVIEWEXIT) > reads the production runner’s GitExitError first`
- `gitExitCode (REVIEWEXIT) > falls back to a Node error’s numeric code`
- `gitExitCode (REVIEWEXIT) > reads no code from anything else`

### test/unit/gitActivationWiring.test.ts

- `activation wires git and pull requests to the window’s guards (M71) > admits a commit and a push as a process that may write the workspace`
- `activation wires git and pull requests to the window’s guards (M71) > gives the window the folder as selected, and its own closing as its activation`
- `activation wires git and pull requests to the window’s guards (M71) > builds every conversation adapter and the pull request command over the one lazy window`
- `activation wires git and pull requests to the window’s guards (M71) > carries a worktree command’s last check through the admission to Git`
- `activation wires git and pull requests to the window’s guards (M71) > reads a held pull request worktree as untrusted wherever git or the shell would run`
- `activation wires git and pull requests to the window’s guards (M71) > uses held-project trust for Tab admission and at its ignore-check native Git entry`
- `activation wires git and pull requests to the window’s guards (M71) > admits Best-of-N’s git at its native entry by project trust, and reads VS Code’s alone nowhere git follows`

### test/unit/HistoryDialog.test.tsx

- `layoutHistory > numbers rows across groups`
- `HistoryDialog: injected Muse Code deletion > offers deletion only with the host callback and keeps archive separate`
- `HistoryDialog: injected Muse Code deletion > supports the mouse delete affordance without resuming or archiving the row`
- `HistoryDialog: injected Muse Code deletion > keeps today’s behavior without deletion and never deletes while editing search text`
- `HistoryDialog: injected Muse Code deletion > never deletes a highlighted session while the user is editing search text`
- `HistoryDialog > groups the visible sessions, marks the current one and shows the row details`
- `HistoryDialog > marks known sessions with localized singular/plural open counts and clears zero counts`
- `HistoryDialog > shows archived and stale rows behind the switch, with Unarchive on the archived one`
- `HistoryDialog > filters on title and branch and says when nothing matches`
- `HistoryDialog > resumes with Enter on the arrowed row or with a click, closes on Escape`
- `HistoryDialog > explains the loading and the empty states`
- `HistoryDialog > says when the workspace has no sessions`
- `HistoryDialog > keeps the keyboard in the search box through a Show Archived toggle`
- `HistoryDialog > archives and unarchives the highlighted row with Delete, and only with an empty search`
- `HistoryDialog > makes the list a Tab stop that keeps the dialog open and closes on Escape`
- `offers Save Prompt on history right-click without resuming or losing archive`
- `keeps Save actions keyboard reachable beside noninteractive listbox options`

### test/unit/hookFormatsGemini.test.ts

- `RVM91P3 tool guards and source scripts > #1 the saved secret scanner cannot allow an unsupported edit`
- `RVM91P3 tool guards and source scripts > #1 a captured file_path guard sees the actual read path and range`
- `RVM91P3 tool guards and source scripts > #1 the saved scanner selectors see a source-shaped write`
- `RVM91P3 tool guards and source scripts > #1 unsupported %s arguments refuse the blocking operation`
- `RVM91P3 tool guards and source scripts > #1 an overflowing captured read range refuses the blocking operation`
- `RVM91P3 tool guards and source scripts > #1 MCP argument objects keep legitimate path and replace keys untouched`
- `RVM91P3 tool guards and source scripts > #2 the verbatim filter-tools.js whitelist survives its ANY mode`
- `RVM91P3 tool guards and source scripts > #2 ANY without a whitelist vetoes instead of dropping a forced-selection guard`
- `RVM91P3 tool guards and source scripts > #2 malformed selection output cannot erase a guard`
- `RVM91P3 tool guards and source scripts > #2 an untranslatable selection input refuses the guarded operation`
- `RVM91P3 tool guards and source scripts > #7 source-script fixtures retain their provenance and data selectors`
- `RVM91P3 model and observation contracts > #3 invalid request $index refuses every model event`
- `RVM91P3 model and observation contracts > #3 invalid response $index refuses AfterModel`
- `RVM91P3 model and observation contracts > #3 every captured model chunk remains unchanged, including empty candidates and parts`
- `RVM91P3 model and observation contracts > #4 a shell patch merges against the full execution input, never the clipped stdin preview`
- `RVM91P3 model and observation contracts > #4 a patch without the original execution input vetoes instead of returning an incomplete call`
- `RVM91P3 model and observation contracts > #4 translated path patches update the Muse execution argument and retain content`
- `RVM91P3 model and observation contracts > #4 a patch with incomplete original arguments vetoes`
- `RVM91P3 model and observation contracts > #4 MCP patches merge without translating server-owned file_path keys`
- `RVM91P3 model and observation contracts > #4 unsupported patch value types veto`
- `RVM91P3 model and observation contracts > #4 unsupported translated range patches veto rather than silently changing arguments`
- `RVM91P3 model and observation contracts > #5 %s ignores lifecycle controls and retains independent observations`
- `RVM91P3 model and observation contracts > #6 Notification retains documented details without inventing missing data (GR:277-281, doc-derived)`

### test/unit/hookHttpHandlers.test.ts

- `http handler config (M91 D70) > refuses managed HTTP handlers and another handler type's fields`
- `http handler config (M91 D70) > parses an https http handler from a user file`
- `http handler config (M91 D70) > refuses http in project files, plain HTTP, and bad urls`
- `http handler config (M91 D70) > refuses mixed handler fields and unknown types`
- `http handler config (M91 D70) > parses mcp_tool and prompt/agent fields, and limits prompt/agent events`
- `http allowlist matching (M91 D70) > matches exact hosts, case-insensitively, with a trailing dot`
- `http allowlist matching (M91 D70) > matches subdomains only for wildcard entries, never the bare domain`
- `http allowlist matching (M91 D70) > refuses IP literals except loopback, which still needs its entry`
- `http allowlist matching (M91 D70) > ignores empty, overlong and bare-star entries, and needs a host`
- `http allowlist matching (M91 D70) > recognises loopback literals`
- `http handler runs (M91 D70) > refuses an oversized payload before sending it`
- `http handler runs (M91 D70) > ends a wait on an HTTP runner that ignores cancellation`
- `http handler runs (M91 D70) > typed handlers cannot grant a PermissionRequest approval`
- `http handler runs (M91 D70) > sends the bounded payload and parses the answer like a command`
- `http handler runs (M91 D70) > refuses off-list hosts, plain HTTP, project scope and a blocked network`
- `http handler runs (M91 D70) > refuses redirects without following them`
- `http handler runs (M91 D70) > fails on errors and non-2xx answers, and rethrows on abort`
- `http handler runs (M91 D70) > sends fixed headers with no credential names`
- `http handler runs (M91 D70) > skips typed handlers without runners, through the dispatcher`
- `http handler runs (M91 D70) > skips a typed handler when the host lends no runner from the hook runtime (M91)`
- `http handler runs (M91 D70) > runs an http hook through the dispatcher and keeps its context`

### test/unit/hookHttpRequest.test.ts

- `pinnedPostRequest (M91) > POSTs to the pinned address with the page name in TLS and the Host header`
- `pinnedPostRequest (M91) > sends the body and hands over the first response, following nothing`
- `postHookPayload (M91) > POSTs the payload and returns the status, headers and body`
- `postHookPayload (M91) > refuses plain HTTP, unresolvable hosts and aborts`
- `postHookPayload (M91) > tries the next address when one refuses the connection`
- `postHookPayload (M91) > bounds the answer body`

### test/unit/integrationPackaging.test.mjs

- `ships the newly shared Node dependencies and first-use features in the VSIX`
- `downloads and restores executable mode for the native vault before packaging`

### test/unit/jobSource.test.ts

- `the Windows job helpers' shipped C# (PLAN.md D6) > packages every file the helpers read`
- `the Windows job helpers' shipped C# (PLAN.md D6) > declares the shell job type the host joins and terminates by name`
- `the Windows job helpers' shipped C# (PLAN.md D6) > answers the launcher's self-test and takes its configuration from the host's variable`
- `the Windows job helpers' shipped C# (PLAN.md D6) > puts every using directive of %s's source before its first type`

### test/unit/judgeAdmission.test.ts

- `worstCaseJudgeCostUsd > reserves the uncached worst case at list price`
- `worstCaseJudgeCostUsd > refuses an unpriced model instead of estimating`
- `worstCaseJudgeCostUsd > throws on caller-bug counts, never reserving nonsense`
- `worstCaseJudgeCostUsd > reads an injected tariff and rejects an unusable one`
- `admitJudgeCall > rechecks a lowered budget after the %s wait`
- `admitJudgeCall > rebinds revoked consent after the nonsent cleanup wait`
- `admitJudgeCall > requires an affirmative paid grant for a metered binding`
- `admitJudgeCall > rebinds $field after the $wait wait`
- `admitJudgeCall > commits the durable reservation before the dispatch runs`
- `admitJudgeCall > refuses an over-budget call and reserves nothing`
- `admitJudgeCall > refuses an unpriced call without touching the ledger`
- `admitJudgeCall > refuses without paid consent, needed and declined`
- `admitJudgeCall > refuses an invalid binding and a backend without its billing`
- `admitJudgeCall > fails closed when the ledger is unreadable, before or during reserve`
- `admitJudgeCall > fails closed on a ledger that reports nonsense or echoes the wrong claim`
- `admitJudgeCall > admits a subscription call with no ledger claim`
- `admitJudgeCall > makes a retry a new claim`
- `JudgeAdmissionClaim settlement > shares an in-flight settlement by claim id and rejects an overlapping conflict`
- `JudgeAdmissionClaim settlement > settles with the injected verified tariff and %s cached tokens`
- `JudgeAdmissionClaim settlement > settles known usage at the actual cost with the cache discount`
- `JudgeAdmissionClaim settlement > refunds a known non-send to zero`
- `JudgeAdmissionClaim settlement > keeps the full liability for an uncertain outcome`
- `JudgeAdmissionClaim settlement > settles idempotently for the same value and refuses a conflict`
- `JudgeAdmissionClaim settlement > keeps liability when the store fails at settlement`
- `JudgeAdmissionClaim settlement > keeps liability when the tariff vanished before settlement`
- `JudgeAdmissionClaim settlement > rejects garbage usage instead of settling it`
- `rebindJudgeClaim > rebounds an unchanged binding`
- `rebindJudgeClaim > refuses each changed field with its reason`
- `verifyJudgeDispatch > reads a replaced consent binding after the dispatch ledger wait`
- `verifyJudgeDispatch > rechecks claim closure after its own dispatch ledger wait`
- `verifyJudgeDispatch > checks the remaining shared budget synchronously per claim before dispatch`
- `verifyJudgeDispatch > rebinds $reason after the dispatch ledger wait`
- `verifyJudgeDispatch > refuses a paid binding that carries subscription consent`
- `verifyJudgeDispatch > refuses a settled claim even when its actual cost equals its reservation`
- `verifyJudgeDispatch > refuses dispatch while a non-send refund is waiting on the store`
- `verifyJudgeDispatch > proceeds when the binding is current and the ledger answers`
- `verifyJudgeDispatch > refuses after a held modal revoked consent`
- `verifyJudgeDispatch > refuses when the ledger went away during the wait`
- `verifyJudgeDispatch > refuses a claim that is already settled`
- `verifyJudgeDispatch > proceeds for a subscription claim with no ledger to ping`
- `verifyJudgeDispatch > needs the ledger for a billed claim`

### test/unit/judgeSameModelApi.test.ts

- `ModelApiSameJudge > uses the selected schema, rejects extra authority, and repairs before advisory settlement`
- `ModelApiSameJudge > takes its own fresh text path after one invalid repair without inheriting the main draft schema or granting permission`
- `ModelApiSameJudge > sends the prefix exactly with the question at the tail and settles caution`
- `ModelApiSameJudge > settles none on a safe answer, changing no verdict`
- `ModelApiSameJudge > sends standalone when redaction changes the prefix`
- `ModelApiSameJudge > sends standalone below the cacheable minimum`
- `ModelApiSameJudge > refuses a model switch without sending`
- `ModelApiSameJudge > drops a result that arrives after its fence`
- `ModelApiSameJudge > settles a repeated action from the cache without sending`
- `ModelApiSameJudge > settles failed on an unparseable reply and caches nothing`
- `ModelApiSameJudge > uses a standalone body when a prefix carries a billable hosted tool`
- `ModelApiSameJudge > forwards the action lifetime to an in-flight batch transport`
- `ModelApiSameJudge > settles failed when the transport throws`

### test/unit/judgeUi.test.tsx

- `Judge card note and status > validates extension-owned messages and refuses invalid shapes at the boundary`
- `Judge card note and status > adds only a fixed caution and one announcement, preserving the user choices`
- `Judge card note and status > drops a caution after the user decides, after resolution, and for a replaced stage or conversation`
- `Judge card note and status > shows the same model and subscription, and names the measured default-off reason`

### test/unit/legalRegistry.test.ts

- `M97 registry targets (lane R) > accepts %s %s@%s: %s`
- `M97 registry targets (lane R) > refuses an overlong name and a non-object`
- `M97 registry reads (lane R) > refuses every redirect and discloses exactly the attempted requests`
- `M97 registry reads (lane R) > reads npm and PyPI licenses from the captured shapes`
- `M97 registry reads (lane R) > encodes a scoped npm name the captured way`
- `M97 registry reads (lane R) > keeps missing packages unknown with the captured 404 bodies`
- `M97 registry reads (lane R) > marks errors without failing its siblings`
- `M97 registry reads (lane R) > prefers the PyPI expression over the legacy license field`
- `M97 registry reads (lane R) > refuses a response past the byte bound instead of buffering it`
- `M97 registry reads (lane R) > dedupes repeat targets and stops at the query bound`
- `M97 registry reads (lane R) > builds only the documented hosts over HTTPS by default`
- `M97 registry reads (lane R) > aborts promptly on the caller’s signal`
- `M97 registry reads (lane R) > marks a hanging registry without losing its siblings`

### test/unit/legalScanTool.test.ts

- `ideLegalScanTools > lists one read-only tool in a trusted workspace, none untrusted`
- `ideLegalScanTools > runs the scan and returns its validated result as JSON`
- `ideLegalScanTools > scans the whole workspace on empty arguments`
- `ideLegalScanTools > refuses a write/exec attempt without running the scan: %j`
- `ideLegalScanTools > lists no tool after trust went away, and a stale handle refuses`
- `ideLegalScanTools > refuses evidence after trust is revoked during the scan`
- `ideLegalScanTools > starts nothing for a caller that already stopped waiting`
- `ideLegalScanTools > reports a scan cancelled in flight instead of answering late`
- `ideLegalScanTools > lets a scan failure through as the tool error`
- `ideLegalScanTools > refuses an invalid result and logs its shape, never the raw value`

### test/unit/localDeveloperProfiles.test.ts

- `isolated local Developer profiles > gives each account its own credential slot, folder, process and local device`
- `isolated local Developer profiles > refuses stale authority before credential provisioning`
- `isolated local Developer profiles > refuses a stale continuation after preparing %s`
- `isolated local Developer profiles > stops a late child instead of registering it after expiry or Reset`
- `isolated local Developer profiles > stops the child if local-device registration fails`
- `isolated local Developer profiles > keeps a failed child stop for retry, withdraws it before the await and never deletes live state`
- `isolated local Developer profiles > reuses an active profile process and cleans recorded resources when it never started`

### test/unit/m101P2Documentation.test.ts

- `M101 P2 release claims (RVM101P2 F7) > separates pending provider retry binding from the shipped P2 improvements`

### test/unit/m105CaptureScrub.test.ts

- `m105 capture scrub > keeps no UUID or partial-UUID material in any capture file`
- `m105 capture scrub > keeps no raw file-/msg_/resp_/req_ ids, emails or user paths`
- `m105 capture scrub > keeps no long hex run outside fixture hashes and public build metadata`
- `m105 capture scrub > replaced each of the 16 leaky round-1 item ids with a bare placeholder`

### test/unit/m106Build.test.mjs

- `round trips the exact generated reference and retains its runtime schema in the real Node artifact`
- `refuses a generated reference whose factory disappeared`

### test/unit/m113cLaneClosure.test.ts

- `C-M113-1 lane records > certifies the independent RVCM1131 review instead of a self-review substitute`
- `C-M113-1 lane records > records C-M113-1 in PLAN M113 without declaring the milestone certified`

### test/unit/m94kTabHookDocs.test.ts

- `Tab hook documentation (RVM94KR 5) > says configured Cursor Tab hooks run and what they receive, everywhere it is told`

### test/unit/manifest.test.ts

- `package.json manifest > describes the visible automatic compaction setting by what it does while inactive`
- `package.json manifest > never puts settings below a scalar setting that VS Code would ignore`
- `package.json manifest > offers paid Tab by default while retaining its machine scope and daily cap`
- `package.json manifest > identifies the extension the way constants.ts expects`
- `package.json manifest > points the Marketplace Sponsor button at the same link as the repository`
- `package.json manifest > contributes the chat view the provider registers`
- `package.json manifest > contributes exactly the commands the extension registers`
- `package.json manifest > binds the Claude Code parity shortcuts to registered commands`
- `package.json manifest > declares every setting with its runtime default`
- `package.json manifest > offers the Claude Code archive periods for archiveInactiveSessions`
- `package.json manifest > activates at startup for Tab and for restored chat panels (D15, D73)`
- `package.json manifest > machine-scopes the settings that choose what runs and what is billed (D15)`
- `package.json manifest > keeps prompt-cache retention under the user’s control, not repository settings (M56)`
- `package.json manifest > keeps the session budget a machine choice, and claims no more than it keeps (M82)`
- `package.json manifest > claims only the GitHub reads the wired network port can make (M113W)`
- `package.json manifest > notifies about background turns until turned off, a choice a workspace may make (M82)`
- `package.json manifest > gates the chords that would otherwise fire anywhere (D15)`
- `package.json manifest > contributes the walkthrough the command opens, completed by our own events (D15)`
- `package.json manifest > binds nothing on Windows that Windows itself takes first (M26)`
- `package.json manifest > lists a command in the Command Palette only where it can act (M26)`
- `package.json manifest > links What’s New to the repository the manifest names (M99)`
- `package.json manifest > lists the extension under the AI and Chat categories only (M26)`
- `package.json manifest > pins @types/vscode to the engines.vscode minimum`
- `packaging (M26) > ships the licence, the third-party notices, both dictation helpers and the capture script`
- `packaging (M26) > ships What’s New: its bundle, its content and its page (M99)`
- `packaging (M26) > ships the manifest strings and the translated tables, not the harness (M40)`
- `packaging (M26) > bounds every CI job, keeps tokens out of checkouts and the PAT in one step (M26)`
- `packaging (M26) > takes the macOS helper’s version from package.json when it is built, never by hand`
- `packaging (M26) > keeps exact-tree reuse behind tag checks and preserves full-build fallback (RELFAST)`
- `packaging (M26) > keeps manual recovery on the shared verified staging path and never rebuilds it (RELFAST2)`
- `packaging (M26) > blocks every release publisher and tag mover after cancellation (RELFAST2)`
- `packaging (M26) > starts the live Action receipt by the owner’s hand only, under a hard cap (M80 LA)`
- `tiered CI (CIFLOW) > checks PRs quickly and merge groups/manual calls fully, on the event commit`
- `tiered CI (CIFLOW) > carries the whole production dist, not a hand list, to the accessibility job`
- `tiered CI (CIFLOW) > runs every shard per OS (eight on Windows and macOS, four on Ubuntu) with no coverage gate`
- `tiered CI (CIFLOW) > keeps all required names and wires fail-closed checks for each selected-tier dependency`
- `tiered CI (CIFLOW) > scans a merge group with the checked CLI, since the action refuses that event`
- `tiered CI (CIFLOW) > passes a required name only when its whole tier succeeded`
- `toolchain pins (AGENTS.md) > keeps Dependabot from proposing TypeScript 7 while typescript-eslint cannot take it`
- `npm scripts on Windows (CIFIX017W2) > fit cmd.exe’s command line as npm runs them and as a node_modules/.bin shim expands them`

### test/unit/mcp.test.ts

- `handleMcpMessage > answers initialize with the client protocol version, tools capability and server info`
- `handleMcpMessage > falls back to its own protocol version when the client names none`
- `handleMcpMessage > accepts notifications without a body`
- `handleMcpMessage > lists the tools with their schemas and calls one`
- `handleMcpMessage > hands the call the stop its caller gave`
- `handleMcpMessage > reports an unknown tool and a throwing tool as tool errors, not protocol errors`
- `handleMcpMessage > answers ping, rejects unknown methods, bad JSON and non-requests`
- `mcpRequestKeys (M69) > keys a request by its id and a cancellation by the id it names`

### test/unit/mediaLimits.test.ts

- `M105 media admission > enforces default/configured/hard byte limits and exact boundary acceptance`
- `M105 media admission > enforces duration and refuses unknown duration under a cap/model maximum`
- `M105 media admission > refuses WebM/Matroska/m4a with conversion offered only after the machine probe`
- `M105 media admission > refuses empty/invalid metadata before admission`
- `M105 media admission > offers conversion only when the selected model accepts the resulting mp4`
- `M105 lazy AttachmentStore media port > installs the lazy media port after construction without losing existing attachments`
- `M105 lazy AttachmentStore media port > dispatches renamed video by bytes before PDF/text/image names and gates before storing`
- `M105 lazy AttachmentStore media port > keeps host-file metadata only, applies the injected model gate, and preserves mixed budgets`
- `M105 lazy AttachmentStore media port > refuses media when the port is absent or denies the chosen model`
- `M105 lazy AttachmentStore media port > enforces the composer count for streamed and embedded media and names malformed input`

### test/unit/mediaProviders.test.ts

- `M105 W host media providers > reads upload and recording limits from settings`
- `M105 W host media providers > forwards picker filters to the native dialog shape, copying extensions`
- `M105 W host media providers > projects established image/document support and unknown video/audio`
- `M105 W host media providers > issues unique tokens and refuses binding until the upload work lands`
- `M105 W host media providers > refuses %s at the gate before binding`

### test/unit/mediaSniff.test.ts

- `M105 bounded media sniffing > reads %s metadata with moov first/last, sound and fragmentation`
- `M105 bounded media sniffing > finds a tail moov by skipping a large mdat while total reads stay bounded`
- `M105 bounded media sniffing > refuses unknown track kind when moov is outside both windows and ignores payload decoys`
- `M105 bounded media sniffing > reads version-one headers, extended boxes and compatible brands`
- `M105 bounded media sniffing > keeps zero, unknown and invalid metadata unknown instead of inventing values`
- `M105 bounded media sniffing > rejects truncated files, huge/unsafe boxes and malformed nested boxes`
- `M105 bounded media sniffing > distinguishes WebM, Matroska and m4a by bytes, independent of filenames`
- `M105 bounded media sniffing > classifies M4A and audio-only MP4 from tracks and blocks video-only admission`
- `M105 bounded media sniffing > reads wav duration from fmt/data, skips padded chunks, refuses truncation`
- `M105 bounded media sniffing > validates mp3 with ID3=%s and counts complete frames`
- `M105 bounded media sniffing > refuses invalid ID3 sizes, reserved/free-rate frames and trailing garbage`
- `M105 bounded media sniffing > uses Xing/VBRI frame counts, and never guesses duration for partial CBR/VBR`
- `M105 bounded media sniffing > rejects invalid size, short/oversized reads and reader failures explicitly`

### test/unit/MentionMenu.test.tsx

- `MentionMenu > marks the active row, hovers to move it, and selects on click without stealing focus`
- `MentionMenu > says so when nothing matches`

### test/unit/Modal.test.tsx

- `Modal > C05 documents both focus directions from the table used by the modal handler`
- `Modal > is a labelled dialog that focuses its close button and closes on Escape, the button and the backdrop`
- `Modal > keeps Tab inside the dialog, wrapping at both ends (M25)`

### test/unit/modelApiEntryExports.test.ts

- `the Model API bundle exports what other bundles import from its shared modules > exports every value imported from transport, sse and ndjson outside the bundle`
- `the Model API bundle exports what other bundles import from its shared modules > reads the imports it claims to check`
- `the Model API bundle exports what other bundles import from its shared modules > leaves out only files the split gate keeps in the Model API bundle alone`

### test/unit/modelsApp.test.tsx

- `ModelsApp shared host contract > subscribes before ready, renders host state, follows navigation and posts top-level requests`
- `ModelsApp shared host contract > rejects the incompatible legacy envelope and preserves the displayed state`

### test/unit/modelsComponents.test.tsx

- `Badge > shows each badge by its rule text`
- `InlineError > renders nothing without messages, one alert, or a list`
- `KeyState > names a missing key, a bound origin, or a moved file — never the key`
- `CostNotice > asks before the paid check while the exact cost loads (STARTUP017)`
- `CostNotice > keeps a fraction of a cent readable`
- `UndoBar > offers Undo per removal and stays silent otherwise`
- `ScanStatus > asks for the first scan, reports a running one, and can cancel it`
- `ScanStatus > names a failed scan and diffs a finished one`
- `SuggestionCard > shows the value with its reason, and Accept or Change`
- `SuggestionCard > disables Accept once accepted`
- `SuggestionCard > never offers Accept for a value not yet stated (STARTUP017)`
- `SearchableSelect > filters by name and description as it is typed`
- `SearchableSelect > walks with arrows and picks with Enter, and leaves with Escape`
- `SearchableSelect > closes on Escape without picking`
- `SearchableSelect > clears active references on blur and when filtering removes all options`
- `SearchableSelect > keeps the custom server under every chip`
- `DataTable > leaves Enter and arrow keys from child controls to those controls`
- `DataTable > clears the active descendant when filtering removes its row`
- `DataTable > sorts from its headers and activates rows from the keyboard`
- `DataTable > names an empty table instead of an empty grid`
- `FilterBar > toggles facets, types ranges, and clears`

### test/unit/modelsPanelSections.test.tsx

- `ProvidersSection > hides unavailable OpenRouter connect and usage with an honest status (PR136 VE)`
- `ProvidersSection > connects subscription actions from explicit clicks and hides Copilot when the host refuses it`
- `ProvidersSection > requests an edit draft and targets changes and cancellation to that provider`
- `ProvidersSection > offers the wizard from an empty first run`
- `ProvidersSection > shows and edits a saved custom provider's model limits`
- `ProvidersSection > disables both wizard Save controls while the host owns its save`
- `ProvidersSection > lists a provider with its key state and removes with Undo`
- `ProvidersSection > picks a provider from the wizard search`
- `ProvidersSection > hides Copilot in a confidential workspace and offers ChatGPT`
- `ProvidersSection > disables ChatGPT in a remote window with its reason and never selects it`
- `ProvidersSection > disables a sign-in with no connector as not offered, and picks an offered one`
- `ProvidersSection > prefills the loopback port where the preset allows it`
- `ProvidersSection > offers each answering server and fills its port on choice`
- `ProvidersSection > says nothing is running and names each usual port`
- `ProvidersSection > enters the key outside the webview and connects OAuth`
- `ProvidersSection > tests free, then accepts the paid check only after its cost`
- `ProvidersSection > ticks the draft models as a delta`
- `ProvidersSection > asks each ticked custom model for its limits and gates Continue on them`
- `ProvidersSection > shows a saved provider with a refused card as unavailable with its reason`
- `ProvidersSection > keeps OpenRouter private by default and routes on choice`
- `ProvidersSection > accepts the suggested default and commits the typed spending limit on Continue`
- `ProvidersSection > keeps Save disabled until the form is valid, with each blocker inline`
- `ProvidersSection > shows a stored key bound to its origin and the key usage`
- `ProvidersSection > previews an import as a diff with every provider needing a key`
- `Wizard > renders every step`
- `Wizard > shows the spending limit as the conversation setting, prefilled with what it is now`
- `Wizard > commits the typed spending limit on Continue, with no separate Change press`
- `Wizard > retains the edit and prefill only when edited (initial=$initial)`
- `Wizard > disables Continue while the spending limit is not a non-negative amount`
- `ModelsSection > F7: $name clears failed scanning/cancel and offers retry`
- `ModelsSection > shows badged rows, ticks as a delta, and pins`
- `ModelsSection > sorts from its headers and filters from the bar`
- `ModelsSection > activates a row with Enter to tick it`

### test/unit/moneyDisplay.test.tsx

- `loadMoneyDisplay > shares one load per document, and a failure stays said rather than retried in place`
- `loadMoneyDisplay > states every exact display the direct arithmetic states`
- `money hooks > withholds the price while loading, then states it exactly`
- `money hooks > withholds every price until each is known`
- `money hooks > states the reply usage line exactly once loaded`
- `money hooks > formats amounts with the stated precision once loaded`
- `money hooks > keeps conservative display for sub-dollar picker rates`
- `money hooks > states the test cost exactly once loaded`
- `money hooks > leaves the price out when the chunk fails, without throwing`
- `money hooks > leaves the price out when the tariff refuses, without throwing`
- `MoneyUnavailable > says a failed load in words and retries by rebuilding the document`
- `MoneyUnavailable > only reports: a view showing no price starts no load`
- `MoneyUnavailable > names no price and loads nothing for a feature not on show`
- `PaidBadge > paints the badge at once and states only the exact tooltip`

### test/unit/ndjson.test.ts

- `parseNdjson > reads split JSON, CRLF, blanks and an unterminated final frame`
- `parseNdjson > preserves a UTF-8 character split between bytes`
- `parseNdjson > rejects %s and never repeats raw frame text`
- `parseNdjson > closes the source after parse failure and early return`

### test/unit/paidMoneyPorts.test.ts

- `R3 P3 exact money ports > %s has no numeric or legacy-union current money port`
- `R3 P3: no current USD money port anywhere in src accepts a JavaScript number`

### test/unit/Palette.test.tsx

- `Palette (actions view) > focuses the filter, lists the groups, and activates the first row on Enter`
- `Palette (actions view) > filters rows by text and reports no matches`
- `Palette (actions view) > moves with the arrow keys, wrapping at both ends`
- `Palette (actions view) > steps the effort slider with Left/Right, Enter and the step buttons`
- `Palette (actions view) > offers only the tiers the current model serves`
- `Palette (actions view) > ignores Left/Right on ordinary rows and activates rows by click`
- `Palette (actions view) > shows toggles and values, and closes on Escape or blur`
- `Palette (actions view) > stays open while the focus moves into the list, and closes on Escape from there`
- `Palette (actions view) > leaves the loading skill note unselectable`
- `Palette (models view) > keeps the single bare Muse picker and its arrow wrapping unchanged`
- `Palette (models view) > lists models with their context window, marks the current one, and selects`
- `Palette (models view) > filters models and goes back on Escape or the back button`
- `Palette (models view) > groups by provider with pinned favourites first and the provider rows last`
- `Palette (models view) > marks unpriced models and filters by provider`
- `Palette (attached to the prompt) > has no filter box, takes the prompt’s keys through its handle, and reports the active row`
- `M87 palette descriptions > gives each action row the same pointer tooltip and accessible description`
- `M87 palette descriptions > describes a skill with an empty or blank description: %j`

### test/unit/planArchive.test.ts

- `PLAN.md archive > holds decisions, gate records and milestone sections`
- `PLAN.md archive > keeps every marked passage of %s byte for byte`
- `PLAN.md archive > gives every passage its own id`
- `PLAN.md archive > notices a changed, shortened or unmarked passage`
- `PLAN.md archive > is where every archive link in PLAN.md leads`

### test/unit/playbookCommand.test.ts

- `M116 CLI and shared settings adapter > runs all three CLI views without any model dependency`
- `M116 CLI and shared settings adapter > runs rule mutations through the CLI with the trusted scoped port`
- `M116 CLI and shared settings adapter > requires a reason, forbids the safety switch, and refuses a raised ceiling`
- `M116 CLI and shared settings adapter > persists disabled reasons with trusted identity/time and can enable again`
- `M116 CLI and shared settings adapter > bounds disable reasons and journal snapshots before presentation`
- `M116 CLI and shared settings adapter > fails loudly for unavailable, malformed or failed journal reads and writes`
- `M116 CLI and shared settings adapter > shows owner items first and retains stable module/class counts and caught outcomes`
- `M116 CLI and shared settings adapter > renders explicit override evidence and each redesign finding outcome`
- `M116 CLI and shared settings adapter > puts failure notes before progress in both status and record`
- `M116 CLI and shared settings adapter > keeps design status current while the record preserves outcome history`
- `M116 CLI and shared settings adapter > reads %s at runtime for every surface`

### test/unit/playbookStrings.test.ts

- `M116 shared strings > has labels for every rule, class, resolution and every schema note code`
- `M116 shared strings > installs %s after import and fills the shared note, immutable safety rule and count`

### test/unit/promptBridge.test.ts

- `M118 native/companion menu adapter handoff > aborts a pending native %s UI without resolving its promise`
- `M118 native/companion menu adapter handoff > validates a native snapshot before constructing its menus: %j`
- `M118 native/companion menu adapter handoff > rejects undeclared fields on the native invocation`
- `M118 native/companion menu adapter handoff > keeps the exact lane-0 menu ids, commands, scopes and installed-language labels`
- `M118 native/companion menu adapter handoff > hides Save on ineligible transcript sources: %j`
- `M118 native/companion menu adapter handoff > saves the current exact snapshot for %s`
- `M118 native/companion menu adapter handoff > loads through the shared insert-only native/companion adapter port`
- `M118 native/companion menu adapter handoff > refuses a forged/stale save: %s`
- `M118 native/companion menu adapter handoff > rejects a stale or executing prompt load: %s`
- `M118 native/companion menu adapter handoff > cancels a picker without inserting or saving`

### test/unit/promptImport.test.ts

- `prompt import > previews all text/variables, imports untrusted, and never resolves or runs anything`
- `prompt import > rejects stale/cancelled previews and isolates returned preview mutations`
- `prompt import > fences overlapping and cancelled reads before a stale preview can be accepted`
- `prompt import > enforces the byte cap even on otherwise valid portable files`
- `prompt import > refuses malformed/oversized inputs and remote import in a confidential workspace`
- `prompt sharing > invalidates an in-flight release on %s`
- `prompt sharing > scrubs preview and exports valid portable Markdown only on the final click`
- `prompt sharing > keeps ordinary export bytes deterministic and round trips without losing metadata`
- `prompt sharing > refuses stale previews, cancellation, changed secrets and changed/unknown policy`

### test/unit/promptLibrary.test.tsx

- `shared prompt library > associates a created draft with its saved id so the next save edits it`
- `shared prompt library > retains a failed draft for retry and blocks duplicate in-flight saves`
- `shared prompt library > mounts the screenshot harness over the shared component`
- `shared prompt library > labels both scopes and duplicates; filters by search and tag`
- `shared prompt library > edits exact text, confirms delete, copies to user and routes insert/run/share explicitly`
- `shared prompt library > keeps imports idle until accepted and shares idle until confirmed`
- `shared prompt library > supports a user-only library, creates drafts, and traps focus`

### test/unit/promptStore.test.ts

- `portable prompt store and library > keeps the healthy scope usable and reports damaged scopes with their files retained`
- `portable prompt store and library > rechecks the chosen sync revision under the lock after another window saves`
- `portable prompt store and library > validates editable fields and strips caller-owned trust and identities`
- `portable prompt store and library > round trips exact Markdown and shows both scopes in any workspace`
- `portable prompt store and library > retains damaged files and refuses every mutation`
- `portable prompt store and library > rejects conflicting ids, wrong scopes, symlinks and overlarge files`
- `portable prompt store and library > enforces title/body/count limits and preserves untrusted status on edit`
- `portable prompt store and library > refuses a concurrent writer and preserves the lock`
- `portable prompt store and library > syncs only user scope, newest wins, and validates before any writes`
- `portable prompt store and library > merges unrelated remote edits while keeping an explicitly removed prompt deleted`
- `insert-only variable review > reviews all sources and expanded text before inserting, without recursive substitution`
- `insert-only variable review > cancelled variables/review and oversized expansion never insert`

### test/unit/promptWorkspaceIntegration.test.ts

- `loads a real user prompt into a new empty workspace composer without sending`

### test/unit/providerModelScans.test.ts

- `shared scan persistence > retains simultaneous scans for different providers`
- `diffScans > names added, removed and repriced models`
- `diffScans > compares ids exactly, not case-insensitively`
- `diffScans > says the diff in words, and nothing when empty`
- `createModelScanner > scans a new provider and caches the rows with their time`
- `createModelScanner > reuses a fresh scan and refreshes a stale one with its diff`
- `createModelScanner > stales on a newer catalogue snapshot`
- `createModelScanner > runs one scan per provider at a time`
- `createModelScanner > leaves the last scan on cancellation`
- `createModelScanner > fails a scan the provider refused`

### test/unit/providerOpenRouter.test.ts

- `openRouterAuthorizeUrl > registers the loopback callback with the challenge and state`
- `openRouterAuthorizeUrl > omits the callback in a remote window`
- `openRouterSpendPage > deep-links the key page by the key SHA-256`
- `connectOpenRouterAccount > exchanges the loopback code once and binds the record`
- `connectOpenRouterAccount > closes the loopback when the callback fails`
- `connectOpenRouterAccount > takes the pasted code in a remote window, and cancels on dismiss`
- `connectOpenRouterAccount > refuses an empty exchanged key`
- `readOpenRouterKeyUsage > passes valid numbers through`
- `readOpenRouterKeyUsage > refuses invalid numbers before they reach a tally`

### test/unit/QuestionCard.test.tsx

- `QuestionCard (M16) > stacks a single choice as radio buttons with an Other row, Submit off until a pick`
- `QuestionCard (M16) > sends a typed Other answer as free text and drops the radio pick`
- `QuestionCard (M16) > stacks a multiple choice as checkboxes, honours the maximum, and adds Other as text`
- `QuestionCard (M16) > tabs between several questions and enables Submit only once every one is answered`
- `QuestionCard (M16) > cancels the prompt from the Cancel button`
- `QuestionCard: Explain Instead (M46) > sends an explanation in place of the options, trimmed, up to the limit`
- `QuestionCard: Explain Instead (M46) > goes back to the choices, and locks while the host settles it`

### test/unit/questionStrings.test.ts

- `M112 strings handed to U and A > provides the identifiable open label, distinct settlement labels and announcements`
- `M112 strings handed to U and A > has real, slot-safe translations and count forms in %s`
- `M112 strings handed to U and A > provides translated manifest keys for U in %s`
- `M112 strings handed to U and A > hands off the same command labels and the complete machine setting description`

### test/unit/QuoteMenu.test.tsx

- `QuoteMenu > relays %s unchanged`

### test/unit/readmeVersion.test.ts

- `the README's What's new section and the manifest version > keeps the same quiet star link in the READMEs and first-run welcome`
- `` the README's What's new section and the manifest version > `README.md has exactly one What's new section, for ${manifest.version}` ``
- `the README's What's new section and the manifest version > README.md's contents line links to that section`
- `` the README's What's new section and the manifest version > `the Marketplace README has the same section, for ${manifest.version}` ``

### test/unit/redact.test.ts

- `redactSecrets > redacts Meta Model API keys wherever they appear`
- `redactSecrets > redacts all of %j, a shape the key store accepts`
- `redactSecrets > leaves short LLM_ names alone`
- `redactSecrets > redacts bearer tokens but keeps the scheme`
- `redactSecrets > redacts META_API_KEY and MODEL_API_KEY assignments`
- `redactSecrets > redacts JWTs, basic credentials, token fields and URL user-info (D24)`
- `redactSecrets > redacts %s from its first eyJ on`
- `redactSecrets > redacts every span the old JWT pattern did, and every token-shaped one`
- `redactSecrets > reads a 128,000-character line of %s in linear time`
- `redactSecrets > scans a long dotted run in linear time (M84 exports whole conversations)`
- `redactSecrets > leaves ordinary text untouched`
- `redactSecrets > redacts %s`
- `redactSecrets > Muse Gadgets SDK tokens (M92) > redacts a valid token on its own and inside a sentence`
- `redactSecrets > Muse Gadgets SDK tokens (M92) > leaves a token with a bad final character alone`
- `redactSecrets > Muse Gadgets SDK tokens (M92) > leaves a %i-character body alone`
- `redactSecrets > Muse Gadgets SDK tokens (M92) > leaves mgst_ inside a longer word alone`
- `redactSecrets > Muse Gadgets SDK tokens (M92) > leaves a valid token glued to a hyphen run alone`
- `redactSecrets > Muse Gadgets SDK tokens (M92) > redacts every valid final character`
- `redactSecrets > leaves ordinary words, counts, prefixes and code with those names alone`
- `redactSecrets > does not treat a lone LLM prefix as a key`
- `redactSecrets > redacts a whole quoted field, including whitespace and escaped quotes`
- `redactSecrets > redacts the GitHub token %j (M71)`
- `redactSecrets > redacts private key blocks, AWS key ids and Slack tokens (M71)`
- `redactSecrets > keeps the M71 Slack prefix xox%s in the merged redactor`
- `redactSecrets > redacts the whole M71 Slack token beyond the old main rule cap`
- `redactSecrets > keeps legacy encrypted PEM headers inside the M71 whole-block redaction`
- `redactSecrets > leaves near misses alone`
- `secretRedactor, one stream's redaction > redacts exactly as redactSecrets, with and without the patterns`
- `secretRedactor, one stream's redaction > derives its literals' forms once and still sees a secret registered later`
- `MAY_HOLD_SECRET, the prefilter in front of every rule > finds every literal each rule says its matches hold`
- `MAY_HOLD_SECRET, the prefilter in front of every rule > lets every real-shaped match of the rule needing %s through, and the redactor removes it`
- `M80 countSecretMatches (A19/A21) > uses literal-first coverage and counts overlapping patterns only once`
- `M80 countSecretMatches (A19/A21) > removes the entire long %s token`
- `M80 countSecretMatches (A19/A21) > removes what an earlier pattern-only pass left of an exact literal (M80 E6)`
- `M80 countSecretMatches (A19/A21) > removes an exact literal in its percent-encoded form (RVM80A P3-3)`
- `M80 countSecretMatches (A19/A21) > redacts %s from %i characters, shorter than SPEC §4.2 asks (RVM80A P3-5)`
- `M80 countSecretMatches (A19/A21) > redacts a %s access key id of exactly 16 more`
- `redactableSlices > cuts only where the pieces redact as the whole text does`
- `redactableSlices > keeps a PEM key longer than a slice in one piece, so none of its body is left`
- `redactableSlices > cuts a long text of ordinary lines near the slice size, and leaves one long line whole`
- `redactableSlices > finds its cuts in linear time where every line could start a match`
- `diagnostic event boundary > redacts retry, withdrawal, completion and notice diagnostics`
- `diagnostic event boundary > preserves ordinary streamed conversation text`

### test/unit/reducedMotion.test.ts

- `webview reduced motion (M87) > disables every animated or transitioned selector under reduced motion`

### test/unit/referenceEntry.test.ts

- `reference host actions and command line > RVHELPREF4 renders localized enum and fact conditions in terminal help`
- `reference host actions and command line > C06 prints typed conditions and rejects malformed condition data at the model boundary`
- `reference host actions and command line > reads every current value, keeps sensitive variables off the bridge and sends a valid model`
- `reference host actions and command line > opens an exact known setting key, including native-host dotted anchors`
- `reference host actions and command line > allows only reviewed context-free commands and rejects destructive or foreign commands`
- `reference host actions and command line > validates messages, translated dictionaries and the nested reference model`
- `reference host actions and command line > lists reserved ACP help once alongside the installed skills`
- `reference host actions and command line > prints every category without starting a backend and parses full help strictly`
- `RVHELPREF host and terminal regressions > R16 prints applicability, billing, setting type, CLI contracts and unavailable values`
- `RVHELPREF host and terminal regressions > R20 leaves an unsupported host value set empty without reading sensitive values`
- `RVHELPREF host and terminal regressions > R21 answers malformed or unreadable NLS with an explicit retryable error`
- `RVHELPREF host and terminal regressions > R22 uses installed manifest titles, setting prose and enum translations in full help`
- `R21 reports a synchronous lazy bundle failure through the real activation wiring`
- `round-trips the entire compressed reference without losing any fact`
- `RVHELPREF4 rejects a corrupt packed technical-prefix index`

### test/unit/referenceKeyboardTruth.test.tsx

- `reference keyboard behaviour truth > opens the full tool output with %s`
- `reference keyboard behaviour truth > rename Enter commits the new title and Escape abandons it`

### test/unit/releaseIntegrity.test.mjs

- `GitHub Release reruns > creates only after a definite not-found, with the original files`
- `GitHub Release reruns > never creates after %s`
- `GitHub Release reruns > accepts identical existing assets and adds only missing ones, without clobber`
- `GitHub Release reruns > rejects a stray asset outside this run before uploading anything`
- `GitHub Release reruns > publishes a recovered draft only after every asset matches`
- `GitHub Release reruns > uploads missing assets before publishing a recovered draft`
- `GitHub Release reruns > refuses differing bytes before uploading anything`
- `GitHub Release reruns > fails closed on malformed release metadata and empty asset lists`
- `compressed universal VSIX budget > accepts exactly the measured budget`
- `compressed universal VSIX budget > refuses one byte over budget`
- `compressed universal VSIX budget > refuses a missing package`
- `bundled extension and ACP CycloneDX inventories > refuses a missing ACP package stage before invoking npm`
- `bundled extension and ACP CycloneDX inventories > keeps shipped devDeps, excludes tools, prunes omitted references and gives ACP its identity`
- `bundled extension and ACP CycloneDX inventories > gives each derived SBOM a unique identity and a clean root`
- `bundled extension and ACP CycloneDX inventories > marks bundled devDeps required while native-only platform packages stay optional`
- `bundled extension and ACP CycloneDX inventories > uses output contributions, including scoped/nested packages, never zero-byte inputs`
- `bundled extension and ACP CycloneDX inventories > includes the namespaced shipped contribution %s`
- `bundled extension and ACP CycloneDX inventories > selects staged lazy and browser outputs, excluding extension-only contributions`
- `bundled extension and ACP CycloneDX inventories > includes every optional native platform and nested runtime dependency from the lock`

### test/unit/releaseMajorTag.test.mjs

- `M80 major-tag release outcomes (RELFAST3) > keeps a tag failure nonblocking and reports its real outcome after channel reporting`
- `M80 major-tag release outcomes (RELFAST3) > preserves HTTP 422 as a failed update/create when tag exists=%s`
- `M80 major-tag release outcomes (RELFAST3) > requests only a fast-forward update`
- `M80 major-tag release outcomes (RELFAST3) > creates a missing major tag`
- `M80 major-tag release outcomes (RELFAST3) > keeps a current or newer descendant without an API call`
- `M80 major-tag release outcomes (RELFAST3) > refuses divergent history before an API call`
- `M80 major-tag release outcomes (RELFAST3) > reports admin recovery after failure and preserves all four published channel rows`
- `M80 major-tag release outcomes (RELFAST3) > reports success without requesting an admin move`

### test/unit/releasePublish.test.mjs

- `registry recovery > retries fetch timeouts by their error name`
- `registry recovery > retries %s exactly three times with 20/60-second backoff`
- `registry recovery > never retries permanent failure %s`
- `registry recovery > recovers after two resets using the real publish wrapper`
- `registry recovery > keeps npm provenance, script suppression and the ./ tarball prefix`
- `registry recovery > accepts existing Marketplace bytes only after decoding gallery gzip`
- `registry recovery > refuses a different existing %s artifact`
- `registry recovery > follows Open VSX files.download, then verifies actual bytes`
- `registry recovery > validates malformed Open VSX metadata at the schema boundary`
- `registry recovery > refuses HTTP download URLs even when their bytes would match`
- `registry recovery > refuses HTTP %s even with matching artifact bytes`
- `registry recovery > refuses malformed metadata`
- `registry recovery > does not convert an existing-version error into success on mismatch`
- `registry recovery > compares npm sha512 integrity to our tarball, not just the version`
- `registry recovery > validates npm integrity at the schema boundary`
- `registry recovery > creates an absent namespace and retries transient Open VSX publishing`
- `registry recovery > refuses auth errors while checking namespace`
- `registry visibility poll > backs off 30 s, 60 s, then caps at 120 s`
- `registry visibility poll > resolves visible at once without sleeping`
- `registry visibility poll > polls a lagging registry with backoff until the bytes match`
- `registry visibility poll > fails a live integrity mismatch at once instead of polling`
- `registry visibility poll > returns pending on timeout while the publish itself stands`
- `registry visibility poll > warns loudly without failing on pending, and confirms visible`
- `release visibility budgets > gives the %s job room for the 30-minute visibility poll`
- `publish failure labels > labels %j as %s`
- `publish failure labels > labels a mismatch from our own check, not from the CLI`
- `publish failure labels > never carries the CLI text, so a token in it cannot reach the log`
- `partial release summary dry exercise > writes the actual CLI step summary and exits correctly for %s`
- `partial release summary dry exercise > reports each channel and allows the M80 tag only when all published`
- `partial release summary dry exercise > fails a half-published release when %s fails`
- `partial release summary dry exercise > reports missing secrets distinctly and holds the major tag`
- `partial release summary dry exercise > refuses %s without a channel output`
- `exact-tree CI release reuse > matches the recorded merge tree even when the PR head SHA is different`
- `exact-tree CI release reuse > refuses an ineligible run %j before reading its artifacts`
- `exact-tree CI release reuse > accepts own-repository pushes to main`
- `exact-tree CI release reuse > pins earlier same-tag Release bytes despite later publication failure or recovery fixes`
- `exact-tree CI release reuse > refuses an ineligible recovery source %j before reading jobs`
- `exact-tree CI release reuse > requires every successful build job and every nonexpired package artifact for recovery`
- `exact-tree CI release reuse > validates recovery ids and all three API boundaries`
- `exact-tree CI release reuse > accepts a successful own-repository merge queue run by its recorded checkout tree`
- `exact-tree CI release reuse > falls back when no run exists, the tree differs, or any artifact expired/missing`
- `exact-tree CI release reuse > continues to the next page and rejects malformed API data`
- `exact-tree CI release reuse > checks both actual package manifests after all recorded hashes`
- `exact-tree CI release reuse > admits pre-receipt recovery only explicitly and keeps inventory and manifest checks`
- `exact-tree CI release reuse > refuses a different receipt tree`
- `exact-tree CI release reuse > refuses the wrong version or identity in %s`
- `exact-tree CI release reuse > refuses changed bytes in each of the four assets`
- `exact-tree CI release reuse > refuses extra assets, omitted hashes and malformed receipts`
- `exact-tree CI release reuse > the %s CLI reports fallback without failing its job`
- `exact-tree CI release reuse > the recovery %s CLI fails closed instead of rebuilding`

### test/unit/reportProblemDialog.test.tsx

- `ReportDialog > lists every item with a Remove each and shows the draft exactly`
- `ReportDialog > removes the facts section and single events`
- `ReportDialog > posts description edits and section switches`
- `ReportDialog > exports through every offered channel with the seal of the draft on screen`
- `ReportDialog > hides the VS Code reporter action while its command is missing`
- `ReportDialog > disables exports while a rebuilt preview is on its way`
- `ReportDialog > says the recording gap instead of listing events that do not exist`
- `ReportDialog > cancels without exporting`
- `` reportDialogStatusText > `reads ${JSON.stringify(status)} as ${JSON.stringify(text)}` ``
- `reportDialogStatusText > reads the updating state while a rebuilt preview is on its way`
- `returns focus to the report opener after the first deferred load`
- `ReportDialogHost > keeps newer typing and the exports locked while an older reply arrives (RVM93W 2)`
- `ReportDialogHost > settles a reply that changed neither the draft nor the description (RVM93W 3)`

### test/unit/reportProblemRows.test.tsx

- `report entry points > offers "Report This" on an error row that carries a reference, with the reference only`
- `report entry points > offers "Report This" on a recorded notice without spending its actions`
- `report entry points > offers nothing without a reference or a handler`
- `report on the crash screen > keeps only the reload without a report handler`
- `report on the crash screen > hands the render failure to the report workflow with no row text`
- `report dialog state > keeps the row reference from a recorded notice`
- `report dialog state > opens, answers and closes the dialog`
- `report dialog state > never reopens a cancelled dialog for its late draft (RVM93W 4)`
- `report dialog state > keeps the newest choice when an older reply arrives late (RVM93W 2)`
- `report dialog state > shows an export answer only beside the draft it exported (RVM93W 7)`
- `report dialog state > clears the last export answer on a fresh draft`

### test/unit/review.test.ts

- `parseReviewPrompt > reads the presets, the security preset and custom instructions`
- `parseReviewPrompt > reads a keyword with more than one word after it as custom text, and a revision that could be an option too`
- `parseReviewPrompt > reads a word too long for a revision as custom text, so the wire schema takes every request it reads (M70 review finding 4)`
- `parseReviewPrompt > leaves every other prompt alone`
- `parseReviewPrompt > writes a palette request as the command that asks for it`
- `parseReviewPrompt > needs git for every preset but custom instructions`
- `parseReviewPrompt > the wire schema refuses a revision that reads as an option or holds whitespace, and over-long instructions`
- `isPrivateFileName > names environment files, keys and credentials, by path or name, whatever the case`
- `reviewTurnText > puts everything git said between random markers that call it untrusted, the branch name included`
- `reviewTurnText > opens with the role and the method where the backend has no Reviewer, and adds the security focus`
- `reviewTurnText > takes custom instructions as the user wrote them, with no material and no markers`
- `reviewTurnText > tries a fresh marker when the material holds one, and refuses when it holds every one`
- `reviewTurnText > says when the diff was cut`
- `parseReviewFindings > reads the findings, a model-chosen severity kept as it came`
- `parseReviewFindings > refuses anything that is not the review’s shape`
- `the Reviewer’s tools > omits repository-owned git facts from Reviewer system instructions (RV70 finding 4)`
- `the Reviewer’s tools > are the workspace readers and the Problems panel, and nothing that writes, runs or reaches the network`
- `PlanModeHold > sets Plan mode before the review turn and the user’s mode back when that turn ends`
- `PlanModeHold > puts the mode back when the turn ended before its acknowledgement`
- `PlanModeHold > corrects a revoked restore and waits through the fallback before a newer user mode`
- `PlanModeHold > puts the mode back when the send fails, and when the session changed first`
- `PlanModeHold > reports a refused restore, and puts nothing back once released`
- `PlanModeHold > cancels a released hold before send and lets a user mode wait for the outstanding change`
- `PlanModeHold > holds Plan mode around work and puts the mode back after`
- `PlanModeHold > puts the mode back when the work throws`
- `PlanModeHold > runs nothing once released or stale, restoring what it set`

### test/unit/reviewMaterial.test.ts

- `the uncommitted changes > diffs staged and unstaged changes against HEAD, names untracked files, and leaves out files that may hold secrets`
- `the uncommitted changes > reads a repository with no commit yet: what is staged, then what changed since`
- `the uncommitted changes > refuses a clean tree, a tree where only secrets changed, and a folder outside git, with no material`
- `the uncommitted changes > cuts a long diff after its last whole line and says how long it was`
- `the uncommitted changes > keeps no more than the cap when a line ends exactly at it (M70 review finding 2)`
- `the uncommitted changes > lists changed files by path, a renamed one as old → new (M70 review finding 1)`
- `the uncommitted changes > reads paths as stored, so a file that may hold secrets in a folder git would quote is still left out (M70 review)`
- `a branch against its base > diffs from the merge base, so the base branch’s own later commits are not the branch’s`
- `a branch against its base > asks for the base with the default one first, and a dismissed picker is a cancel`
- `a branch against its base > refuses a base git does not know, and one that would read as an option`
- `one commit > diffs a commit against its parent, with its message, and lists the latest commits to pick from`
- `one commit > reads a root commit whole`
- `one commit > refuses a commit git does not know`
- `one commit > shows the commit as history holds it, never what a replace ref in the repository substitutes`
- `review collection ownership and trust > runs no git after collection admission was withdrawn`
- `review collection ownership and trust > held native base picker, allowed=%s > checks actual git admission after the held choice`
- `review collection ownership and trust > starts no subsequent git call after a running git query loses its owner`
- `physical review request ownership > keeps physical ownership through a held $scope picker, change=$change`
- `physical review request ownership > discards an awaited native Git result after physical root %s`
- `physical review request ownership > enters actual Git at its captured canonical cwd even if the alias retargets at runner entry`
- `physical review request ownership > keeps released material bound to its original physical root`
- `review Git programs > suppresses a real configured %s filter and keeps raw worktree changes`
- `review Git programs > refreshes configured filters after a base picker without executing a newly configured program`
- `review Git programs > suppresses an actual fsmonitor hook whose seeded index makes an ordinary status invoke it`
- `bounded names-only filter discovery > reads no values and overrides clean, process and required for every review command`
- `bounded names-only filter discovery > refuses malformed, excessive or unreadable filter discovery before a diff: %s`
- `bounded names-only filter discovery > treats only Git no-match exit 1 as an empty filter inventory`
- `bounded names-only filter discovery > treats the production runner’s exit 1 as an empty filter inventory`
- `filter discovery over real git > reads the production runner’s exit 1 as no filters and proceeds`
- `filter discovery over real git > proceeds when the test-owned global configuration defines an LFS filter`
- `filter discovery over real git > carries a configured clean, process and required filter as scoped overrides`
- `filter discovery over real git > keeps review closed when the names read fails with %s`
- `reviewMarker > is fresh random hexadecimal each time`
- `a git failure > is gitFailed, named in the log by its subcommand and exit, never by what git printed`

### test/unit/rowMenus.test.tsx

- `M87 F2 row menus > opens from %s and returns focus to the sole opener`
- `M87 F2 row menus > routes all offered user actions and keeps checkpoint guards`
- `M87 F2 row menus > routes fork and rewind on a card without a checkpoint`
- `M87 F2 row menus > keeps copy and reply handlers on a finished reply`
- `M87 F2 row menus > keeps Redo pending and spent guards`
- `M87 F2 row menus > routes Redo with the restore id`
- `M87 F2 row menus > routes tool output and landed edit review without exposing unfinished edits`
- `M87 F2 row menus > routes a landed edit’s Revert with its stored patch`
- `M87 F2 row menus > offers no Revert %s`
- `M87 F2 row menus > withholds edit review before edits land and offers stored output with no preview`
- `M87 F2 row menus > offers the shell output even before the command prints text`
- `M87 F2 row menus > shows no opener or menu on rows with no actions`
- `M87 F2 row menus > shows only the quote menu while a row has highlighted-text actions`
- `M87 F2 row menus > opens the right-clicked row’s menu while text is selected in another row (P1)`
- `M87 F2 row menus > shows the Copied feedback on the row’s "…" once Copy closes the menu (P2)`
- `M87 F2 row menus > keeps one row menu open when another row’s opens by %s (P3)`
- `M87 F2 row menus > opens nothing on a bare F10, nor on Shift+F10 or the menu key on a row with no actions (P3)`
- `M87 F2 row menus > keeps the Rewind group’s notes in its second burst, present and inert (P3)`
- `M87 F2 row menus > labels every pill of the user, reply and tool menus`
- `M87 F2 row menus > leaves selected text to the enclosing quote menu`

### test/unit/runnerRouting.test.ts

- `user-level runner config > scrubs %s from local, transport and explicitly selected remote environments`
- `user-level runner config > reads only the config-home file and refuses unknown authority and oversized data`
- `user-level runner config > drops credential names case-insensitively even when allowlisted, and keeps the SSH agent only for transport`
- `user-level runner config > expires health, refuses malformed measurements, and treats a clock rewind as unknown`
- `check routing after shell guards > runs every shell guard before any probe or dispatch`
- `check routing after shell guards > refuses untrusted work and trust lost while sampling`
- `check routing after shell guards > matches Windows-only labels and command classes instead of routing to a Mac`
- `check routing after shell guards > refuses a Windows-only job when no Windows runner or local slot is available`
- `check routing after shell guards > tries affinity first, then falls back from offline, busy and uncertain runners`
- `check routing after shell guards > samples before dispatch and refuses overloaded, full, input-hung and offline runners`
- `check routing after shell guards > rejects late remote and local answers by run id, and respects cancellation`

### test/unit/runtimeAccountsService.test.ts

- `installed runtime account service > lists the migrated default with no pre-existing file`
- `installed runtime account service > adds, thresholds, orders and removes a meta account`
- `installed runtime account service > sets a per-account credential from standard input only`
- `installed runtime account service > serves ACP list/current/thresholds from the same store`
- `installed runtime account service > refuses an in-session switch with the stay-put text`
- `installed runtime account service > reports unavailable for an unconfigured provider and never writes it`
- `installed runtime account service > reports a corrupt file instead of clobbering it`
- `installed runtime account service > refuses a %s with the providers-file sentence instead of the connection one`
- `installed runtime account service > reads a refused providers file as its own sentence through the shared metadata port`
- `installed runtime account service > keeps the branded refusal through session reads and ACP operations after the file corrupts`

### test/unit/runtimeAccountStore.test.ts

- `M108 Meta password flow and runtime OS binding > uses the existing password flow for a second key without replacing default`
- `M108 Meta password flow and runtime OS binding > handles cancellation, invalid input and an unknown account without storing a key`
- `M108 Meta password flow and runtime OS binding > routes storage through the injected vault instead of opening the OS adapter`

### test/unit/runtimeChatGptCallback.test.ts

- `ACP ChatGPT callback > binds the exact loopback route and returns one captured callback with a plain localized page`
- `ACP ChatGPT callback > rejects malformed, forged or refused callback %s without reflecting it`
- `ACP ChatGPT callback > ignores wrong paths, methods and Host headers without consuming the callback`
- `ACP ChatGPT callback > starts its deadline before wait and closes on timeout`
- `ACP ChatGPT callback > cancels and destroys incomplete requests, including cancellation before wait`
- `ACP ChatGPT callback > makes close idempotent and rejects a waiting callback`
- `ACP ChatGPT callback > refuses an invalid callback lifetime %s`
- `ACP ChatGPT callback > refuses an invalid state and an already cancelled start`

### test/unit/runtimeChatGptPackage.test.ts

- `ChatGPT ACP package > ships the lazy ChatGPT runtime in the actual npm tarball`
- `ChatGPT ACP package > writes real third-party notices naming the staged bundles’ packages`
- `ChatGPT ACP package > refuses a missing providers bundle before replacing the package stage`

### test/unit/runtimeServices.test.ts

- `createRuntimeAccountServices > manages accounts through the file-backed store`
- `createRuntimeAccountServices > publishes fresh state to subscribers after a mutation`
- `createRuntimeAccountServices > reads state and re-adopts the current account only`
- `createRuntimeAccountServices > keeps the actual default identity through reorder and removal instead of adopting another account`
- `createRuntimeAccountServices > binds the headless port to its requested credential and publishes that fixed identity`
- `createRuntimeAccountServices > refuses --account-pool with the pool limitation instead of the connection text`
- `createRuntimeAccountServices > serves the stored default key with no file; a user file without meta refuses`
- `createRuntimeAccountServices > refuses malformed Meta metadata before reading any legacy key`
- `createRuntimeAccountServices > serves the fixed account key through the backend secrets`
- `createRuntimeAccountServices > reports a refused providers file as its own refusal from exec readiness: %s`
- `createRuntimeAccountServices > reads a refused providers file as its own refusal through the ACP session port`
- `createRuntimeAccountServices > opens developer multiple-accounts with the providers-file sentence instead of a raw failure`
- `createRuntimeAccountServices > keeps the start refusal when enabling multiple accounts over a refused file`
- `createRuntimeAccountServices > refuses unbound profile cleanup and retains ownership after a failed launch`
- `createRuntimeAccountServices > opens a locked developer owner without profile bindings`

### test/unit/runtimeStore.test.ts

- `the runtime store (M81 A1) > asks, downloads the exact pinned URL, verifies, extracts and publishes once, and leaves no stage`
- `the runtime store (M81 A1) > uses a published runtime without asking or downloading, hashing it again only when its metadata changed`
- `the runtime store (M81 A1) > refuses a published folder whose receipt is missing, malformed or another pin’s`
- `the runtime store (M81 A1) > downloads nothing without consent, and creates nothing when the user declined`
- `the runtime store (M81 A1) > refuses an unsupported platform, a stale pin and a manifest that is not one, before any download`
- `the runtime store (M81 A1) > refuses when admission is gone, before and after the consent`
- `the runtime store (M81 A1) > follows at most three redirects within the pinned storage path, and refuses any other`
- `the runtime store (M81 A1) > stops reading an endless transfer at the pinned length plus 1%`
- `the runtime store (M81 A1) > delivered`
- `the runtime store (M81 A1) > refuses a valid archive of the pinned length whose bytes are not the pin’s (its hash, not the ZIP reader)`
- `the runtime store (M81 A1) > refuses a failed request, a wrong length, a transfer past its 1% slack and a wrong hash`
- `the runtime store (M81 A1) > refuses a pinned archive the ZIP reader refuses, and an executable that is not the pin’s`
- `the runtime store (M81 A1) > lets two windows install at once: each its own stage, one winner, both verified`
- `the runtime store (M81 A1) > hashes the winner of a publication race, so a corrupt one with a matching receipt is refused (A1-6)`
- `the runtime store (M81 A1) > reads the pin’s freshness again before it returns a ready runtime, however it became ready (A1-4)`
- `the runtime store (M81 A1) > refuses a corrupt winner and never overwrites or merges it`
- `the runtime store (M81 A1) > stops a transfer under way when the preparation ends, and at its own bound`
- `the runtime store (M81 A1) > sweeps a stage whose owner process is gone, and keeps one whose owner is unknown`

### test/unit/sampler.test.ts

- `machine resource sampler > starts no work at construction; uses CPU deltas even on Windows with zero loadavg`
- `machine resource sampler > weights heterogeneous CPU deltas and resets on empty, failed, changed or rolled-back counters`
- `machine resource sampler > keeps failed readings unknown while preserving genuine idle and exhausted-memory zeros`
- `machine resource sampler > uses availableMemory on Darwin without confusing free pages or memorystatus_level with bytes`
- `machine resource sampler > does not fabricate total, oversized, fractional or negative memory readings`
- `machine resource sampler > rejects invalid CPU counters and aggregate overflow rather than reporting recovery`
- `machine resource sampler > rejects malformed pressure averages and counters independently of memory readings`
- `machine resource sampler > reads Linux pressure independently, retaining unknown fields on missing or malformed rows`
- `machine resource sampler > uses nested container limits and parent headroom rather than host RAM`
- `machine resource sampler > handles mounted cgroup subtrees and namespaces without reading outside their root`
- `machine resource sampler > honours cgroup v1 memory capacity and hierarchical headroom instead of host RAM`
- `machine resource sampler > rejects noncanonical cgroup membership, mount roots and directories before any ancestor reads`
- `machine resource sampler > distinguishes missing root/controller attributes from denied cgroup reads`
- `machine resource sampler > keeps malformed or empty cgroup membership unknown instead of assuming no container limit`
- `machine resource sampler > refuses malformed cgroup paths, counters and unavailable hierarchy without treating them as unlimited`
- `machine resource sampler > loads optional probes only when enabled and set, then clears caches when unset`
- `machine resource sampler > bounds probe cadence, shares concurrent samples and retries unknown failed probes`

### test/unit/samplerProbes.test.ts

- `optional resource probes > starts no discovery at construction and uses Linux GPU busy files without connectors`
- `optional resource probes > rejects failed or malformed GPU files rather than calling them idle`
- `optional resource probes > uses installed absolute nvidia-smi with argument arrays and the busiest returned GPU`
- `optional resource probes > merges independently probed Nvidia and DRM GPUs and keeps failed installed probes unknown`
- `optional resource probes > refuses relative executables for nvidia and Windows counters`
- `optional resource probes > uses Windows GPU engine utilization and disk idle counters without aggregate duplication`
- `optional resource probes > validates every Windows counter response; absent counters remain unknown`
- `optional resource probes > preserves missing and null Windows CIM properties in the projection before validating counters`
- `optional resource probes > reports Darwin GPU/disk unavailable without root, throughput substitution or child probes`
- `optional resource probes > uses Linux whole-device busy deltas, excluding partitions and memory disks`
- `optional resource probes > resets disk baselines across failures, hotplug, reused identities, rollback and disabled intervals`
- `optional resource probes > rejects malformed disk counters, duplicate rows and unavailable device lists`
- `optional resource probes > rejects failed monotonic clocks instead of clearing disk pressure`

### test/unit/scanSecrets.test.ts

- `M80 scanner (A21) > counts without excerpts: %s`
- `M80 scanner (A21) > refuses %s with 2 and no file content`
- `M80 scanner (A21) > aborts a hung key reader and never reads the file or prints`
- `M80 scanner (A21) > refuses cancellation before reading and after the file read`

### test/unit/scheduleBinding.test.ts

- `lazy runtime schedule binding > loads once on use and installs the caller table before creating the runtime`
- `lazy runtime schedule binding > rejects a missing factory and retries a failed engine creation`

### test/unit/scheduleEvents.signals.test.ts

- `host signals, manual fire and milestone capability bindings > publishes %s with isolated validated data and disposes`
- `host signals, manual fire and milestone capability bindings > manual fire has a fresh opaque identity and names only the requested schedule`
- `host signals, manual fire and milestone capability bindings > binds %s / %s without guessing a provider frame`
- `host signals, manual fire and milestone capability bindings > a disposed source refuses late callbacks even when the host watcher races`
- `host signals, manual fire and milestone capability bindings > lists all missing dependencies as unavailable and refuses subscription/polling`
- `host signals, manual fire and milestone capability bindings > webhooks require authenticated M110 admission, including after subscription`

### test/unit/SchedulePanel.test.tsx

- `SchedulePanel (M52) > renders the injected schedule list and preserves inert=%s`
- `SchedulePanel (M52) > shows only extension-owned jobs with accessible run and cancel controls`
- `SchedulePanel (M52) > offers the paid gate when it is off, without sending a turn`
- `SchedulePanel (M52) > shows the next local time and hides Run before the occurrence is due`
- `SchedulePanel (M52) > renders no panel for a session without schedules`

### test/unit/searchWorker.test.ts

- `searchOnWorker > reports the matching lines with their numbers, skipping binary and missing files`
- `searchOnWorker > skips a file reached through a link that leaves the workspace (D24)`
- `searchOnWorker > skips a file the deny-read globs cover, by its canonical path through a link too (M78)`
- `searchOnWorker > reports an invalid pattern`
- `searchOnWorker > stops a catastrophic pattern at the time budget, keeping what it found first (D27)`
- `searchOnWorker > parses its job and reports a malformed one instead of searching`
- `searchOnWorker > reports a worker that cannot start`
- `searchOnWorker > cuts one minified hit to about 500 characters, saying so (M101 item 14)`
- `searchOnWorker > terminates an in-flight worker on Stop without waiting for its search deadline`

### test/unit/selectedHost.test.ts

- `host selection after authentication > does not inspect raw credentials or open a host during a logout hold`
- `host selection after authentication > refuses a sign-out that begins during the raw credential read`
- `host selection after authentication > leaves a manager-owned host to its manager after sign-out revokes admission`
- `host selection after authentication > refuses a host selection begun before sign-out even after same-kind sign-in`
- `host selection after authentication > does not kill a cached CLI host when only its secondary key changes`
- `host selection after authentication > opens only the backend admitted by auth and current raw facts`

### test/unit/SessionBoardDialog.test.tsx

- `SessionBoardDialog > shows every conversation with its state, branch, changes and approvals`
- `SessionBoardDialog > marks rows with unknown change counts`
- `SessionBoardDialog > filters by title or branch and resumes with Enter`
- `SessionBoardDialog > opens best-of-N and closes with Escape`
- `SessionBoardDialog > says when no conversation matches, and while the host has not answered`

### test/unit/sessionBudget.test.ts

- `requestParts > is the instructions, the tools and each input item, as JSON`
- `estimateInput > refuses fractional, negative and overflowing input token counts`
- `estimateInput > counts every UTF-8 byte of every part as a token when there is no base`
- `estimateInput > adds to the reported tokens only the parts the base did not carry`
- `estimateInput > never subtracts a part the base carried and this request does not`
- `estimateInput > returns its own parts, to become the next base`
- `calibrated media budget parts > uses the upper bound independently of encoded size and a 170-token count base`
- `calibrated media budget parts > keeps a media identity from hiding a newly added text part with the same text`
- `calibrated media budget parts > rejects an unsafe calibrated token allowance`
- `reserveRequest > admits one output token when search and input consume the exact remaining allowance`
- `reserveRequest > holds the search bound times its price before allocating output tokens`
- `reserveRequest > refuses an invalid hosted-call bound of %s`
- `reserveRequest > refuses an unverified or invalid search price of %s`
- `reserveRequest > refuses search when its allowance leaves no room for a reply`
- `reserveRequest > keeps exactly one output token affordable after decimal cap subtraction`
- `reserveRequest > lowers max_output_tokens so input plus output at list price fits what is left`
- `reserveRequest > keeps the usual maximum when the cap has room for it`
- `reserveRequest > clamps the selected model cap to affordable tokens without enlarging smaller caps`
- `reserveRequest > prices a contributor model at its own tier`
- `reserveRequest > sends a request that has room for a single output token`
- `reserveRequest > refuses a request with no room for one output token, and says why`
- `reserveRequest > refuses once the spend has reached the cap, whatever the request`
- `reserveRequest > refuses a model whose price it does not know: the cap could not be kept`
- `reserveRequest > never reserves more than what is left`
- `reserveRequest > provider minimum output tokens > refuses a budget that affords 15 tokens when the minimum is 16, and says why`
- `reserveRequest > provider minimum output tokens > sends 16 when the provider minimum exactly fits, without rounding up`
- `reserveRequest > provider minimum output tokens > still sends 1 for a provider with no captured minimum`
- `reserveRequest > provider minimum output tokens > refuses an invalid provider minimum without sending`
- `reserveRequest > price-card provider minimum output tokens > refuses 15 affordable tokens against a minimum of 16 without sending`
- `reserveRequest > price-card provider minimum output tokens > sends 16 when the minimum exactly fits`
- `reserveRequest > price-card provider minimum output tokens > still sends 1 when no minimum was captured`
- `settles helper token costs exactly and retains unknown sent liability`
- `M108 T account budget admission > keeps an unbound claim identical and binds a guard once for initial and every final check`
- `M108 T account budget admission > does not let an account swap reset M82 settled spend or outstanding liability`

### test/unit/SetupBanner.test.tsx

- `SetupBanner > confirms the provider and model, manages providers, and dismisses`

### test/unit/sharingBridge.test.tsx

- `M118 shared host bridge > renders host-owned prompts and sends an insert action without a model submission`
- `M118 shared host bridge > renders an exact chat preview and confirms only from the final button`
- `M118 shared host bridge > ignores malformed envelopes and rejects pending or late actions on close`

### test/unit/SignIn.test.tsx

- `SignIn > shows the sign-in choices without a diagnostic when signed out cleanly`
- `SignIn > shows a timed-out detail as plain text, not an alert`
- `SignIn > shows a backend error as an alert with a retry button`
- `SignIn > shows install guidance when the CLI is missing, with and without a diagnostic`
- `SignIn > shows the waiting text while signing in, falling back to the default copy`
- `SignIn > shows the exact installer command before starting it`
- `SignIn > shows the device code and cancel action in the panel`
- `SignIn > offers only the paths the host lists, and the key path beside the install guidance`
- `SignIn > shows the key path with the install guidance when the CLI is missing but a key would do`
- `SignIn > ranks the own-model choice equally with the other two when no backend is set up`
- `SignIn > keeps the ranking when the own-model choice is missing`
- `SignIn > offers the own-model choice beside the install guidance when the CLI is missing`

### test/unit/spawnInventory.test.mjs

- `complete production process inventory > requires every source process import and launch, including aliases and embedded programs`
- `inventory guard probes > sees each launch construct in a file of its own`
- `inventory guard probes > follows an aliased import of a test-only symbol to its production caller`
- `inventory guard probes > treats class static fields and static blocks as load-time production code`
- `inventory guard probes > treats decorators, IIFEs and callbacks handed to a load-time call as production`

### test/unit/structuredOutput.test.ts

- `M106 structured side answers > selects only supported evidence: %j`
- `M106 structured side answers > keeps the text request byte-identical and does not invoke a codec`
- `M106 structured side answers > encodes %s without changing the prefix`
- `M106 structured side answers > requires the injected captured forced-tool codec`
- `M106 structured side answers > accepts only locally validated data and does not fall back on success`
- `M106 structured side answers > rejects extra granting fields, repairs exactly once, then makes a text request`
- `M106 structured side answers > uses a valid repair without a third request`
- `M106 structured side answers > never repairs a cancelled request`
- `M106 structured side answers > propagates terminal admission failures without repair or fallback`
- `M106 structured side answers > refuses invalid prose at the renderer boundary`
- `M106 structured side answers > renders the six compaction sections byte-identically, preserving prose`
- `M106 structured side answers > still compacts after structured %s`

### test/unit/surfaceRetry.test.ts

- `flushes the existing persisted state before asking the shell to rebuild the document`

### test/unit/TasksApp.test.tsx

- `TasksApp > announces ready, renders live tasks and never offers a composer`
- `TasksApp > offers window movement only when supported`
- `TasksApp > shows ended instead of tasks`
- `TasksApp > rejects malformed host data and all chat commands at its outbound boundary`

### test/unit/TeamCards.test.tsx

- `TeamPlanCard > lists each item delegated or kept, with its reason`
- `TeamSwitchRow > shows the role, from and to, and the translated reason`
- `TeamSwitchRow > shows an unknown reason as it came`
- `TeamWaitingCard > offers the four choices and answers once`
- `TeamWaitingCard > reads only without an answer handler`
- `TeamMergeCard > decides merge or discard, and opens the diff`
- `TeamMergeCard > marks an unreviewed merge and a moved branch`
- `TeamMergeCard > notes a same-model review`
- `TeamMergeCard > reads only without handlers`
- `TeamReportRow > shows the role and the report`
- `F4 merge path layout > gives the merge path lists their own full-width row so paths wrap, never one character per line`
- `worker label > labels a worker’s own approval with role, agent and task`
- `worker label > draws the label from the task, never from worker text`
- `worker label > labels a worker’s own question row`
- `team label fallbacks > shows an unknown entry state as it came`
- `RVM96B card regressions > 13 locks terminal and host-confirmed cards after remount`
- `RVM96B card regressions > 13 unlocks a refused request on the host’s same-id update, retaining locks on ordinary rerenders`
- `RVM96B card regressions > 22 shows bounded affected, protected and conflict paths with review details`
- `RVM96B card regressions > 22 refuses merge when approval details are missing or the branch is conflicted/moved`

### test/unit/teamCleanup.test.ts

- `team copy hygiene > unlinks links/junctions and removes deep copies without touching the outside canary`
- `team copy hygiene > sweeps terminal and owned orphan copies/refs, preserves unmerged and foreign-owned work`
- `team copy hygiene > keeps quarantine until explicit Clean up, warning even when the old owner may be live`
- `team copy hygiene > refuses removal outside storage, storage itself and paths through an ancestor link`
- `team copy hygiene > guards worker starts and command directories against the canonical user checkout`

### test/unit/teamGitIndexLock.test.ts

- `git index ownership and killed landers > gives each acquisition distinct owner bytes even for the same landing and window`
- `git index ownership and killed landers > ignores only the exact owned lock while still observing operations and fresh hints`
- `git index ownership and killed landers > waits the full bound on a foreign lock, never removes it, and retries only after user removal`
- `git index ownership and killed landers > does not release a replaced lock, even when the original owner is done`
- `git index ownership and killed landers > does not release a lock whose contents changed in place`
- `git index ownership and killed landers > does not follow a foreign symlink lock when reading its owner`
- `git index ownership and killed landers > uses the linked worktree own index lock and recognizes every recorded git operation`
- `git index ownership and killed landers > preserves real lander ownership at the barrier: %s`

### test/unit/teamLanding.test.ts

- `snapshot-bound landing and recovery > lands and undoes an indexed executable on a permission-blind checkout`
- `snapshot-bound landing and recovery > defers an operation appearing during lock acquisition: %s`
- `snapshot-bound landing and recovery > stops landing writes when an operation appears after the first file`
- `snapshot-bound landing and recovery > refuses %s when an operation arrives during lock acquisition`
- `snapshot-bound landing and recovery > rechecks holders at the final staged-file guard for %s`
- `snapshot-bound landing and recovery > lands the tested blobs uncommitted, journals first and keeps the user index untouched`
- `snapshot-bound landing and recovery > lands and undoes raw binary additions and deletions with executable modes`
- `snapshot-bound landing and recovery > defers a known holder to a landing branch and Apply rebuilds from a fresh snapshot`
- `snapshot-bound landing and recovery > refuses a per-file byte change immediately before replacement and leaves the user edit`
- `snapshot-bound landing and recovery > rechecks bytes and target admission after the replacement file has been staged`
- `snapshot-bound landing and recovery > reports the visible change from a lock-ignoring writer: %s`
- `snapshot-bound landing and recovery > keeps a partial landing journal and lock, then Recover restores only matching bytes`
- `snapshot-bound landing and recovery > requires owner authorization for recovery and Undo batch for shared files`
- `snapshot-bound landing and recovery > rejects journal path escapes and revalidates targets after staging`
- `snapshot-bound landing and recovery > treats only another window fresh on this same working tree as a known holder`
- `snapshot-bound landing and recovery > with prepared real staging > checks holders immediately before deleting a matching file`
- `snapshot-bound landing and recovery > with prepared real staging > invalidates untouched dependency changes and changed check identities before writing`
- `snapshot-bound landing and recovery > with prepared real staging > excludes overlapping in-process landings and makes real git add meet the lock`
- `snapshot-bound landing and recovery > with prepared real staging > asks separately for Land without checks in every mode`

### test/unit/teamMergeBatchRepository.test.ts

- `cumulative batches on real repositories > checks actual merged files and lands the exact last passing tree: %s`

### test/unit/teamMergeQueue.test.ts

- `merge queue > orders dependencies before finish, inherits priority and applies every tie breaker`
- `merge queue > keeps consecutive small batches closed under dependency and predicted conflicts`
- `merge queue > refuses oversized admissions before any merge or check`
- `merge queue > backs out one culprit and lands only the last cumulative combination checked`
- `merge queue > catches interacting candidates that pass alone and holds failed prerequisites`
- `merge queue > reruns only failing checks and marks the exact passing batch flaky`
- `merge queue > keeps default rework and structured conflicts out of the admitted tree`
- `the shared merge routine > routes structured files even on unchanged sides, without text fallback`
- `the shared merge routine > handles binary, added, deleted, symlink and executable files explicitly`

### test/unit/teamPlanRecord.test.ts

- `M96 approved plan and change record > retains the round-4 safety decisions when lanes 0 and R are merged`
- `M96 approved plan and change record > documents both shipped team lanes in 0.15.0`

### test/unit/teamRoster.test.ts

- `buildRosterStable > names each role with mode, tools, pool order, caps, policy and routing`
- `buildRosterStable > names empty pools in one line as not staffed`
- `buildRosterStable > is byte-identical for the same roles, whatever the live numbers are`
- `rubric and guidance > covers every reason code`
- `rubric and guidance > states integration ownership, the third round and the limits rule`
- `buildRosterLive > shows headroom and states apart from the stable caps`
- `formatStateChangeNote > says nothing when nothing changed state`
- `formatStateChangeNote > encodes each change as structured event data`
- `appendTeamEvents > drains only eligible tool answers and preserves all outcome metadata`

### test/unit/teamRuntimePackage.test.mjs

- `packaged team factories > loads working scheduler and runner capabilities on demand with no constructor dispatch`

### test/unit/teamSchedulerPick.test.ts

- `scheduler pick > puts a critical chain before an older independent task and includes every score factor`
- `scheduler pick > ages ready tasks and breaks ties by ready time then id`
- `scheduler pick > bounds starvation even with aging off and a newer urgent conversation`
- `scheduler pick > inherits through dependencies, lease holders and the merge queue then drops it with the wait`
- `scheduler pick > shares eligible lanes by weighted round robin between conversations`
- `scheduler pick > steals any ready task of the same role, skips leased/ineligible tasks, and never preempts`
- `scheduler pick > stagger starts by agent without delaying another agent or engine`
- `reserved child slots > binds reserved children to their selected entry and retains recovered liabilities above a lowered cap`
- `reserved child slots > refuses a child behind its parent at once and reserves the whole batch or none`
- `reserved child slots > counts uncertain attempts and process caps, prevents duplicate and foreign reservations`
- `reserved child slots > checks role, entry and agent limits across conversations and fully occupied parents`

### test/unit/teamSchedulerReview.test.ts

- `whole-head integration reviews > enqueues clean reviews after a failed check is rerun successfully`
- `whole-head integration reviews > verifies claims only against the latest run, including unfinished reruns`
- `whole-head integration reviews > retries refused rework or failed enqueue without charging for another review`
- `whole-head integration reviews > counts a retired rework that leaves the same head as another bounded review round`
- `whole-head integration reviews > loops back actual failed checks even when the findings are clean`
- `whole-head integration reviews > holds class reservations until all reviews settle and refuses duplicate concurrent review`
- `whole-head integration reviews > automatically reviews three classes on reserved lanes and merges deduplicated findings`
- `whole-head integration reviews > uses one review for all classes with fewer than three lanes and clean changes enter the queue`
- `whole-head integration reviews > preserves Manual and Review automatically flow boundaries`
- `whole-head integration reviews > re-reviews the whole branch for any new head, including whitespace inside a literal`
- `whole-head integration reviews > stops the third failing round as redesign, hands every finding to rework, and never starts a fourth`
- `whole-head integration reviews > selects a different model across every author or marks/refuses a same-model review`
- `whole-head integration reviews > marks nonexistent claimed checks unverified and contradicts false claims with actual outcomes`
- `whole-head integration reviews > rejects invalid reports and stale heads, and never bypasses review admission`

### test/unit/teamSchedulerRoster.test.ts

- `M96c live roster and state-change notes > preserves both C prediction attempts through S admission and T2 answers and notes`
- `M96c live roster and state-change notes > carries the live board, leases, merge positions and events as data`
- `M96c live roster and state-change notes > validates live snapshots and refuses events or leases from another workspace`
- `M96c live roster and state-change notes > delivers all scheduler state changes once as one JSON line at the tail and never emits usage-only notes`
- `M96c live roster and state-change notes > rejects malformed and foreign notes and bounds pending events without silently losing them`

### test/unit/teamSchedulerStalls.test.ts

- `stalls and divergence > detects each stall and excludes a command still inside its timeout`
- `stalls and divergence > detects repeated content in the same lines and size divergence`
- `stalls and divergence > picks another agent for agent faults and another model for model faults in pool order`
- `stalls and divergence > retires then checkpoints actual edited bytes on a branch before a paid handoff with bounded data`
- `stalls and divergence > blocks an unretired attempt without checkpointing or handing it off`
- `stalls and divergence > never reassigns divergence, third stalls, ask or stop, and respects consent refusal`
- `stalls and divergence > refuses concurrent recovery and an attempt made stale during retirement`
- `stalls and divergence > keeps exhaustion and paid refusal explicit and rechecks identity after consent`

### test/unit/teamSchedulerText.test.ts

- `M96c translated scheduler surfaces > has complete real translations and intact slots in %s`
- `M96c translated scheduler surfaces > provides X2 with the same seven manifest titles in English and all 14 languages`
- `M96c translated scheduler surfaces > keeps price and shared daily budget visible in the consent template`
- `M96c translated scheduler surfaces > reads recovery text at use time and pluralises the window and worker counts`

### test/unit/teamSchedulerTools.test.ts

- `M96c scheduler tools > accepts every scheduler field and preserves the base envelope before atomic board submission`
- `M96c scheduler tools > refuses cycles, unknown tasks and foreign edges as a whole before any attempt`
- `M96c scheduler tools > refuses malformed scheduler fields before invoking delegate and keeps dry runs and command ids with base admission`
- `M96c scheduler tools > enqueues merge with a one-based position, defaults to rework and never invokes immediate merge`
- `M96c scheduler tools > refuses invalid merge input and invalid or mismatched queue receipts`
- `M96c scheduler tools > reschedules priority, hold, release and dependencies without starting or spending`
- `M96c scheduler tools > reschedule refuses relink cycles atomically and cannot change running tasks`
- `M96c scheduler tools > $name`
- `M96c scheduler tools > refuses a reschedule cancelled during journal acknowledgement without publishing live data`
- `M96c scheduler tools > waits for the journalled board acknowledgement before publishing a reschedule answer`
- `M96c scheduler tools > keeps declarations byte-identical as live state and base definitions change`
- `M96c scheduler tools > extends the delegate schema while preserving its base constraints and required fields`
- `M96c scheduler tools > preserves report paging and base headroom data with the current live board at the tail`

### test/unit/teamServerToolList.test.ts

- `team server fixed declarations > offers six tools to the orchestrator and only four to a delegating worker`
- `team server fixed declarations > keeps MCP tools/list byte-identical after upstream metadata changes and dispatches only to the bound list`
- `team server fixed declarations > keeps nested roster and collect annotations byte-identical for both callers`

### test/unit/teamStagingCopy.test.ts

- `team staging copies > preserves Git executable modes on a permission-blind checkout and staging clone`
- `team staging copies > uses staged mode changes ahead of the HEAD mode on a permission-blind checkout`
- `team staging copies > cross-checks POSIX filesystem mode after Git mode capture`
- `team staging copies > snapshots all visible files through a temporary index, preserving the real index and raw blobs`
- `team staging copies > refuses escaped tracked parents and submodule directories, cleaning its private index`
- `team staging copies > refuses a HEAD change during capture and still removes its private index`
- `team staging copies > binds resolved commands, platform, setup and cache key into the check identity`
- `team staging copies > imports a staging result into a landing ref without changing the working tree or index`
- `team staging copies > passes only the child allowlist and private index, never inherited Git configuration`
- `team staging copies > uses real git merge-file for both clean text and conflict markers`
- `team staging copies > validates both intents after formatting and captures the formatter output`

### test/unit/TeamTree.test.tsx

- `TeamTree > renders the hierarchy with caps, headroom and the budget`
- `TeamTree > counts every task node`
- `TeamTree > names each item for screen readers with role, model and status`
- `TeamTree > keeps one tab stop across the treeitems`
- `TeamTree > moves with arrows, collapses, expands and types ahead`
- `TeamTree > sends each action with its task, entry or role`
- `TeamTree > reads only without actions`
- `AgentMap team region > shows the team tree with its task count`
- `AgentMap team region > stays today’s map without a team`
- `Header team pill > counts the team tasks and marks them running`
- `Header team pill > stays today’s pill without team tasks`
- `Header team pill > shows no pill with nothing to show`
- `RVM96B tree regressions > 14 has one total Tab stop and exposes every action through F2 and arrows`
- `RVM96B tree regressions > 15 retains a roving stop and recovers focus when the focused task disappears`
- `RVM96B tree regressions > 16 excludes queued, interrupted and unknown tasks from running counts and Stop controls`
- `RVM96B tree regressions > 21 localizes entry names and known worker statuses, preserving unknown statuses`

### test/unit/teamWorkerCertification.test.ts

- `RVM96W2C-N16 certification hashes bind every certified committed worker source`

### test/unit/toggleFocusView.test.ts

- `toggleFocusView > flips %s to %s`

### test/unit/tokens.test.mjs

- `D94 one token source > generates deterministic web, native, TH and TD inputs with one name per token`
- `D94 one token source > keeps high contrast opaque and flat, and honours reduced transparency`
- `D94 one token source > uses the palette selector set for every later standalone accessibility override`
- `D94 one token source > honours reduced transparency with a standalone theme declared on %s`
- `D94 one token source > honours %s at every standalone theme scope`
- `D94 one token source > rejects invalid source types, duplicate names, absent modes and dangling/cyclic references`
- `D94 one token source > resolves aliases to each selected palette, rather than the default palette`
- `D94 one token source > keeps every generated CSS output unchanged through the real commit formatters`
- `D94 one token source > draws F2 focus rings and boundaries from M114 tokens, not direct host colours`
- `D94 one token source > gives traffic and runner buttons the secondary-button role and a token focus ring`
- `D94 one token source > loads generated variables through both surface stylesheets without runtime JavaScript`

### test/unit/toolRows.test.tsx

- `shell previews (M87) > joins tool IN and OUT, clips each at five lines, and expands them independently`
- `shell previews (M87) > gives user commands the same two previews and opens full output in the editor`
- `shell previews (M87) > shows user IN before any output arrives without an empty OUT part`
- `shell previews (M87) > keeps the 2,000-character cap on a shell command`
- `shell previews (M87) > keeps other outputs at twelve lines and toggles accessible expanded state`
- `shell previews (M87) > shows no toggle for exactly five shell lines or 2,000 characters`
- `memory rows (M43) > shows the note saved, where it lives, and the path beside the label`
- `memory rows (M43) > shows what a read brought back, not the JSON around it`
- `memory rows (M43) > shows an edit as the text replaced and its replacement`
- `goal rows (M43) > shows the goal, its status, progress, current and next work, and the tokens`
- `goal rows (M43) > names the objective of a new goal and the status an update sets`
- `goal rows (M43) > falls back to the text when a goal tool answers something else`
- `schedule rows (M43) > shows the prompt, its schedule and that it runs once`
- `schedule rows (M43) > lists the jobs with their next run and how often they ran`
- `schedule rows (M43) > shows a list it cannot read as its text, never as "no scheduled prompts" (the review of PR #29)`
- `schedule rows (M43) > says when there is nothing scheduled`
- `web search rows (M43) > lists the results as links that open in the browser, with their snippets`
- `web search rows (M43) > refuses a result that is not a web page`
- `web search rows (M43) > says a search found nothing, and shows any other result as text`
- `web fetch rows (M69) > shows the URL beside the label, the size under it, and the page the model read`
- `web fetch rows (M69) > shows no size for a refusal, only its reason`
- `background work (M43) > shows what the command printed and that it still runs, not the JSON`
- `background work (M43) > drops the running line once the work ended`
- `labels (M43) > names an MCP Server’s tool by the tool and its server, its JSON indented`
- `labels (M43) > shows text that is not JSON as it came`
- `pictures a tool read or made (M43) > asks the host once for the picture a completed read names, then shows it`
- `pictures a tool read or made (M43) > shows a loaded picture, opens its file on click, and says why one failed`
- `pictures a tool read or made (M43) > asks for nothing while the tool runs or when the path is not a picture`
- `pictures a tool read or made (M43) > shows the pictures a tool reported the model saw`
- `image rows (M44) > show the prompt, the images an edit started from, and the result`

### test/unit/toolVideo.test.tsx

- `lazy tool video > resolves an approved path through the host port, with controls and no autoplay`
- `lazy tool video > refuses an unapproved resource URL`
- `lazy tool video > changing paths aborts the old read and never renders its late resource`

### test/unit/trafficView.test.tsx

- `Traffic accessibility and controls > renders nothing and sends nothing in single-model mode`
- `Traffic accessibility and controls > ranks ready tasks by scheduler order, explains scores and sends current attempts with every board action`
- `Traffic accessibility and controls > withholds board controls when the available actions belong to a stale attempt`
- `Traffic accessibility and controls > has one tab stop and supports arrows, Home and End with focus following selection`
- `Traffic accessibility and controls > announces only new landings or returned candidates once, never turns the Traffic view into a live region`
- `Traffic accessibility and controls > skips announcement history on mount and uses the existing panel announcer for new events`
- `Traffic accessibility and controls > sums only fresh other-window hints and offers only opening a peer window`
- `Traffic accessibility and controls > keeps recovery read-only for possibly live owners and offers no lock removal or locked recovery`
- `Traffic accessibility and controls > shows lanes, leases, conflicts, serial merge reasons, flaky checks and safe disk cleanup`
- `Traffic accessibility and controls > reads the installed table at render time and shows reported and estimated metrics separately`
- `Runners section > preserves an existing multiline setup command when saving untouched fields`
- `Runners section > shows health/fingerprint and input-hang instructions, disables remote tests when untrusted`
- `Runners section > edits a validated user runner and refuses credential variables before posting`

### test/unit/treesLifecycle.test.ts

- `%s recorded ancestry and verified signals > enrolls new sessions, retains reparented descendants and snapshots them before tree kill`
- `%s recorded ancestry and verified signals > never admits an unobserved orphan, recycled member or unrelated reused group`
- `%s recorded ancestry and verified signals > keeps an observed detached descendant after the departed root PID is reused`
- `%s recorded ancestry and verified signals > admits a recycled PID only through a freshly proven ancestry edge`
- `%s recorded ancestry and verified signals > does not re-enroll a departed PID solely because a later birth joins its former group`
- `%s recorded ancestry and verified signals > retains a proven descendant that reuses the original root PID after its parent exits`
- `%s recorded ancestry and verified signals > rechecks exact birth immediately before signalling and distinguishes every outcome`
- `%s recorded ancestry and verified signals > does not signal after retirement while the final birth read is pending`
- `%s recorded ancestry and verified signals > refuses a newcomer when its %s changed after the anchor proof`
- `%s recorded ancestry and verified signals > reports inaccessible final birth reads as refused, never gone or done`

### test/unit/treesLinuxLaunchNative.test.ts

- `native cgroup launch and completion > retires and removes an empty cgroup after normal root exit without Stop`
- `native cgroup launch and completion > retires a direct child in a writable subtree after root exit and reasserts its pinned home`
- `native cgroup launch and completion > retains the managed keeper and exposes a status row after harness retries are exhausted`
- `native cgroup launch and completion > launches a forked grandchild in its own cgroup and Stop (%s) observes populated zero before removal`
- `native cgroup launch and completion > keeps workload instructions behind admission before GO`

### test/unit/treesMacNative.test.ts

- `Darwin native binding boundary > refuses a mismatched native PID at the signal boundary instead of interpreting it as a changed birth`
- `Darwin native binding boundary > refuses a tree snapshot with an inaccessible %s descendant`
- `Darwin native binding boundary > validates exact identities, unavailable results and positional correspondence`
- `native Darwin process identity > reads exact numerical kernel identity without audio setup and refuses invalid input`
- `native Darwin process identity > distinguishes births within one second and observes fast exit without an identity fallback`
- `native Darwin process identity > reports a real unreaped zombie as exited and excludes it from membership`

### test/unit/uiTextRegions.test.mjs

- `selects the canonical English input on POSIX and Windows paths`
- `regional Node English fallback > loads media English only on first media use and installs the caller language`
- `regional Node English fallback > enumerates every key and creates localization state without loading a region`
- `regional Node English fallback > serializes exactly the canonical table, including plurals and nested labels`
- `regional Node English fallback > installs and resets a full translated table with independent language state`
- `round-trips full English inline and its vault installer`
- `round-trips every production Node reference field through the native codec`
- `W startup validates vault translations on first use and loads actual English lazily`

### test/unit/untrustedInput.test.ts

- `M80 untrusted resources > D16 preserves 200KB sentinels, newline/codepoint edges and full envelopes`
- `M80 untrusted resources > A9 checks count, per-file bytes and total bytes independently`
- `M80 untrusted resources > A9 refuses too many chunks including metadata capacity`
- `M80 untrusted resources > A9 unreadable/invalid UTF8 and aborted input refuse without truncated success`
- `M80 untrusted resources > a file name stays one quoted literal in the lead, before the opening marker`
- `M80 untrusted resources > empty files are explicit complete resources and input names are basenames`

### test/unit/usagePackaging.test.mjs

- `usage assets in the ACP package > ships the service, companion, transitive page chunks and every usage table in the actual tarball`
- `usage assets in the ACP package > refuses missing usage asset before packaging: %s`
- `usage assets in the ACP package > refuses a foreign or external browser import: $path`
- `usage assets in the ACP package > keeps the prior package stage intact with invalid %s`

### test/unit/usagePerformance.test.ts

- `usage at the M102 history scale > serves thirty days times two thousand calls and records the warm service timing on this rig`

### test/unit/usageTable.test.ts

- `usage table family > uses English without a file for English and unsupported languages`
- `usage table family > loads the exact or primary locale with a checked table and no Node/editor dependency`
- `usage table family > falls back on read/JSON errors, missing or extra keys, damaged slots and plural shapes`
- `usage table family > installs at runtime, and restores English without changing the frozen source`
- `usage table family > formats range counts and threshold percentages in the installed display language`
- `usage table family > requires translations to keep templates and use their own plural categories`

### test/unit/usageText.test.ts

- `usage text in every editor > compares exact cost %s against %s as %s percent in portable text`
- `usage text in every editor > renders daily, model and limit commands as their requested sections`
- `usage text in every editor > prints the page totals, model/provider breakdown, windows, caps and certainty in plain and Markdown`
- `usage text in every editor > does not turn unknown usage into zero or plan equivalents and liability into charges`
- `usage text in every editor > prints only the latest provider/source/window limits with stale and awaiting status while retaining chart history`
- `usage text in every editor > formats the combined charge once after exact accumulation across certainty lanes`
- `usage text in every editor > escapes hostile model labels in Markdown and keeps real local model zero visible`
- `usage text in every editor > reads the caller table at run time and formats values in its installed locale`

### test/unit/vault/credentialAdapter.test.ts

- `first-party credential adapter > reads per request and erases the broker buffer after conversion`
- `first-party credential adapter > existing entry flow erases transient write bytes even on failure %s`

### test/unit/vault/mcpSecrets.test.ts

- `M109 O command-bound references > refuses cancellation that arrives while resolving paths, before feeder admission`
- `M109 O command-bound references > passes only selected handles and resolved command identity to feeder; no raw secret in host`
- `M109 O command-bound references > refuses handle/reference in unsafe %s field`
- `M109 O command-bound references > takes a snapshot before path resolution; argv substitution fails closed`
- `M109 O command-bound references > accepts Windows absolute command/cwd without conflating argument identity`
- `M109 O command-bound references > cancels before resolution/start and kills a child admitted after cancellation`
- `M109 O origin-bound headers > refuses routing/proxy credentials and ambiguous OAuth plus secret headers`
- `M109 O origin-bound headers > sanitizes failures from trusted header transport`
- `M109 O origin-bound headers > routes each header use by origin; transport receives handles only`
- `M109 O origin-bound headers > refuses %s before credential release`
- `M109 O origin-bound headers > refuses duplicate header aliases, plaintext downgrade and malformed references`
- `M109 O Move to vault review > holds the selected name and key before awaiting live resolution`
- `M109 O Move to vault review > rejects a migration digest that differs from resolved live entry`
- `M109 O Move to vault review > imports and verifies selected %s literal; returns review edit, preserving unrelated config`
- `M109 O Move to vault review > never edits settings when encrypted import fails, and erases imported bytes on failure`
- `M109 O Move to vault review > refuses unsafe migration selection: %s`

### test/unit/vault/mcpVaultPool.test.ts

- `M109 O pool and spawner enforcement > W-O4 credentialed HTTP awaits admission and rechecks current workspace trust`
- `M109 O pool and spawner enforcement > retains host checkpoint admission and current workspace trust for vault stdio`
- `M109 O pool and spawner enforcement > refuses a configured vault port that supplies no transport for secret headers`
- `M109 O pool and spawner enforcement > resolves the actual executable and working folder before granting stdio use`
- `M109 O pool and spawner enforcement > refuses an unbound vault reference before start/HTTP dispatch`
- `M109 O pool and spawner enforcement > passes server identity and cancellation to the vault route, preserving handles`
- `M109 O pool and spawner enforcement > binds remote transport to the exact configured server and endpoint`
- `M109 O pool and spawner enforcement > keeps legacy stdio without references on the existing spawner`
- `M109 O pool and spawner enforcement > direct host spawner refuses unresolved vault references before probing/spawning`

### test/unit/vault/sshAgent.test.ts

- `vault SSH agent destination proofs > bounds bind chains and session ids and validates listed identity metadata`
- `vault SSH agent destination proofs > refuses a valid but unknown host bind and a duplicate forwarding session`
- `vault SSH agent destination proofs > rejects wrong service, method, algorithm and an unsigned authentication probe`
- `vault SSH agent destination proofs > closes at the queued-byte bound and rejects a late identity lookup after close`
- `vault SSH agent destination proofs > lists public identities and signs a verified host/session/remote-user use`
- `vault SSH agent destination proofs > refuses host spoofing and corrupt session-bind before authorization`
- `vault SSH agent destination proofs > refuses unknown/revoked known_hosts and rechecks it at signing`
- `vault SSH agent destination proofs > rejects duplicate binding, authentication rebinding and changed session/key/method`
- `vault SSH agent destination proofs > parses hostbound authentication and rejects a different embedded host key`
- `vault SSH agent destination proofs > marks a forwarding chain and never signs at a forwarding-only hop`
- `vault SSH agent destination proofs > represents a stripped session-bind as unproven, keeping its remote user`
- `vault SSH agent destination proofs > accepts only the separate git SSHSIG namespace and valid hash lengths`
- `vault SSH agent destination proofs > never releases a late signature after revocation or connection close`
- `vault SSH agent destination proofs > hides hidden/first-party/Never keys, rejects invalid signatures and refuses agent mutation commands`
- `SSH session revocation and approval binding (RVM109S) > keeps a reusable connection across signatures when B finishes each admission`
- `SSH session revocation and approval binding (RVM109S) > terminates the pinned client on revocation, exactly once`
- `SSH session revocation and approval binding (RVM109S) > denies a signature approved before a known_hosts rotation`
- `SSH session revocation and approval binding (RVM109S) > answers the extension query with message 29, never message 6`

### test/unit/vault/sshKeys.test.ts

- `vault SSH keys and RFC 9987 boundary > generates unpooled Ed25519 material, exports only public data and verifies signatures`
- `vault SSH keys and RFC 9987 boundary > imports PEM, encrypted PEM and unencrypted OpenSSH; rejects a public/private mismatch`
- `vault SSH keys and RFC 9987 boundary > handles P-256 and RSA SHA2; rejects weak or mismatched methods and unknown flags`
- `vault SSH keys and RFC 9987 boundary > parses fragmented/coalesced frames, bounds lengths, rejects trailing and malformed fields`
- `vault SSH keys and RFC 9987 boundary > bounds selected private-key files and known_hosts before decoding them`
- `vault SSH keys and RFC 9987 boundary > erases borrowed frames and rejects noncanonical booleans and text`
- `vault SSH keys and RFC 9987 boundary > matches literal, hashed and wildcard known_hosts; revocation, negation, aliases and wrong keys fail closed`
- `vault SSH keys and RFC 9987 boundary > treats regex punctuation literally while matching case-insensitive wildcard code points`

### test/unit/verifyLedger.test.ts

- `VerifyLedger > invalidates grants and runs before a workspace write, across a user-message reset`
- `VerifyLedger > keeps unrelated file runs current and a config blocked until every pending write ends`
- `VerifyLedger > shares pending writes with existing and newly live sessions, and releases disposed ones`
- `VerifyLedger > judges a round only by the runs on the latest state of what they covered`
- `VerifyLedger > keeps a run on files an edit did not touch, and drops one on a file it did`
- `VerifyLedger > counts failing verdicts in a row, resets on a passing one, and stops at the limit`
- `VerifyLedger > judges each run once, and leaves the count alone when nothing ran`
- `VerifyLedger > gives no verdict when every run since the last one went stale`
- `VerifyLedger > records nothing for a check that did not run or was stopped`
- `VerifyLedger > forgets everything on the user’s message, and a stopped turn’s round on a new turn`
- `VerifyLedger > starts the fix loop, rejections and runs afresh on a steer, and keeps what was written`
- `VerifyLedger > keeps counting a failure no edit has touched, until a later run of that check passes`
- `VerifyLedger > takes an edit made by someone it answers for as a new state of that file`
- `VerifyLedger > leaves behind a run that an edit overtook while it ran`
- `VerifyLedger > takes what someone it answers for wrote as deciding what runs`
- `VerifyLedger > names the first file written that the editor’s tools run as code`
- `authorizeThenGuard > authorizes again, and guards again, when the rule lapsed during the guard`
- `authorizeThenGuard > refuses when the second authorization refuses, and runs once when nothing lapsed`

### test/unit/verifyRows.test.tsx

- `the verify rows > sum the files and checks up under the row, and open on what the model read`
- `the verify rows > reads a run with no diagnostics or checks to report as nothing, a clean one as clean`
- `the verify rows > counts the files it could not check apart from the clean ones`
- `the verify rows > label the model’s run_checks and the automatic row, with their files`
- `an edit’s then_run > shows the command and its output under the diff: one call, two results`
- `an edit’s then_run > says why a command did not run, or how it was stopped`
- `an edit’s then_run > says a failure without an exit code failed, and gives a hook’s words`
- `the reducer and the export keep both > keeps the then_run and the summary through a start and a later revision`
- `the reducer and the export keep both > exports the then_run command and what it printed`
- `the reducer and the export keep both > exports a skipped then_run and a check row’s summary line`

### test/unit/vsixPackaging.test.mjs

- `VSIX packaging > recompresses real VSCE output with unchanged members and the standard CRC`
- `VSIX packaging > refuses a damaged usage archive member: %s`
- `VSIX packaging > loads archived usage %s byte-exact without a plain table`
- `VSIX packaging > excludes %s from actual VSCE collection`
- `VSIX packaging > ships the helper, shared runtime and deferred chunks`
- `VSIX packaging > P1 refuses a VSIX with the Linux helper %s absent before replacing its stage`
- `VSIX packaging > round-trips %s byte-exact and leaves source unchanged`
- `VSIX packaging > reads legacy key-major archives and refuses truncated leaf rows`
- `VSIX packaging > loads exact archived CommonJS with original relative requires and stack filename`
- `VSIX packaging > refuses an excluded %s page script`
- `VSIX packaging > loads the exact provider catalogue through the verified runtime archive`
- `VSIX packaging > retains direct CommonJS named exports through native import and require, loader hooks: %s`
- `VSIX packaging > keeps the eager fallback smaller and enumerates keys without loading regions`
- `VSIX packaging > refuses packaging a runtime archive over the existing decoded bound`
- `VSIX packaging > retains the synchronous production Brotli bytes: %s`
- `VSIX packaging > produces identical archive bytes with reversed input order`
- `VSIX packaging > discards a cached archive after a failed member so a repair can retry`
- `VSIX packaging > preserves English fallback and refuses damaged executable content: %s`
- `VSIX packaging > keeps a compact guide and recent notes with links to complete documentation`
- `VSIX packaging > resolves or refuses %s repository full-notes links in direct packaging`
- `VSIX packaging > ships the writer’s plan, so the packaged notes agree with What’s New on what is shown`
- `VSIX packaging > keeps both fitting releases in the package with uppercase HTTPS in %s Highlights`
- `VSIX packaging > ships a shortened release without Highlights as its full-notes link, as the page shows it`
- `VSIX packaging > packages a prerelease predecessor through the writer’s own release pattern`
- `VSIX packaging > selects and packages the real beta when a fenced example names it first`
- `VSIX packaging > selects and packages an indented release heading exactly like the writer reads it`
- `VSIX packaging > shortens by parsed heading spans under %j, including indented and fenced headings`
- `VSIX packaging > refuses CR-only and Setext release headings before packaging can diverge from the page`
- `VSIX packaging > packages the retained earlier Highlights, so the packaged notes agree with the page`
- `VSIX packaging > packs the writer’s plan for the real CHANGELOG exactly as the legacy slice`
- `VSIX packaging > generates both static badges from the manifest, with no unresolved token`
- `VSIX packaging > checks exact staged bytes and rejects a staged README or manifest version mismatch`
- `VSIX packaging > keeps the quiet GitHub star link in the README Marketplace and Open VSX render`
- `VSIX packaging > refuses a stage outside its owned build directory`

### test/unit/walkthrough.test.ts

- `walkthrough resources > has a Markdown file that opens with an image for every step`
- `walkthrough resources > names the shortcuts the manifest binds, per platform (M26)`
- `walkthrough resources > is packaged and lives in one folder`
- `walkthrough resources > opens the wizard from the own-model step and its page (M95)`

### test/unit/warmDeferredSurfaces.test.ts

- `warms every module imported by a deferred webview surface or code fence`

### test/unit/webFetch.test.ts

- `fetchWebPage (M69) > imports exact raw prompt text without page markers or HTML conversion`
- `fetchWebPage (M69) > refuses raw HTML even when it is below the ingress byte cap`
- `fetchWebPage (M69) > enforces the smaller raw cap on compressed and decoded bytes independently`
- `fetchWebPage (M69) > reads an HTML page pinned to the checked address, as marked Markdown`
- `fetchWebPage (M69) > reads text a browser would not show as served, all of it inside the untrusted markers`
- `fetchWebPage (M69) > returns text as it came, decoding the declared character set`
- `fetchWebPage (M69) > reads an HTML page's charset from a <meta> tag only, and ignores a label nobody knows`
- `fetchWebPage (M69) > refuses a URL, a reserved name or a private address before any lookup or request`
- `fetchWebPage (M69) > refuses a name when any of its answers is not public, and one with no answer`
- `fetchWebPage (M69) > judges an answer under the network's NAT64 prefix by the IPv4 address it carries`
- `fetchWebPage (M69) > asks whether it is still allowed before each lookup and each request, redirects included`
- `fetchWebPage (M69) > uses no IPv6 answer while NAT64 is unknown, and refuses a name that has only IPv6 ones`
- `fetchWebPage (M69) > tries the next checked address at once when one fails, never a new lookup`
- `fetchWebPage (M69) > starts the next address when one has not connected within the attempt delay (RFC 8305)`
- `fetchWebPage (M69) > starts no fallback after permission withdrawal during the first address (%s)`
- `fetchWebPage (M69) > closes a late answer from an attempt stopped by permission withdrawal`
- `fetchWebPage (M69) > names the host and the addresses tried when none answers, in its own words`
- `fetchWebPage (M69) > reports a proxy's own answer to the tunnel as the proxy's, with its status`
- `fetchWebPage (M69) > never repeats what a server put in an error's message, such as its certificate's names`
- `fetchWebPage (M69) > refuses XHTML, which an HTML parser would misread, before converting anything`
- `fetchWebPage (M69) > refuses a page in an encoding with no decoder, and reads a text page as its encoding says`
- `fetchWebPage (M69) > refuses a page its converter could not convert, naming why, and reads nothing of it`
- `fetchWebPage (M69) > names the fetch's deadline passing during the conversion as the conversion's, not the download's`
- `fetchWebPage (M69) > follows a redirect on the same host, resolving and pinning the new hop again`
- `fetchWebPage (M69) > refuses a redirect whose new lookup answers a private address (rebinding)`
- `fetchWebPage (M69) > refuses a redirect into a refused URL, naming the redirect`
- `fetchWebPage (M69) > hands a redirect to another host back, its URL inside the markers`
- `` fetchWebPage (M69) > `stops after ${String(WEB_FETCH_MAX_REDIRECTS)} redirects, and on one with nowhere to go` ``
- `fetchWebPage (M69) > refuses an error status, a missing type and a type that is not text`
- `fetchWebPage (M69) > never repeats a type or a coding the server wrote that is not a short token`
- `fetchWebPage (M69) > refuses a body past the cap: declared, streamed, or grown by decompression`
- `fetchWebPage (M69) > decodes gzip and Brotli, and refuses an unknown coding or damaged data as the coding`
- `fetchWebPage (M69) > gives up at the deadline, and rethrows a Stop`
- `fetchWebPage (M69) > cuts a long page for the model and says so, and a page cannot close its own markers`
- `fetchWebPage (M69) > says a page that expands past the converter bound has more`

### test/unit/windowsScreenRecorderBuild.test.ts

- `M105 R2 lazy recorder build entry > reads and compiles on first use, caches, and references only inbox assemblies/metadata`
- `M105 R2 lazy recorder build entry > verifies the compiler before spawning it`
- `M105 R2 lazy recorder build entry > verifies the built helper before its identity check`
- `M105 R2 lazy recorder build entry > refuses an incorrect identity reply`
- `M105 R2 lazy recorder build entry > cleans partial compiler output and fails closed`

### test/unit/WorkflowRun.test.tsx

- `a workflow run’s card (M47) > shows the captured run: its name, status, agent, tokens, what started it and its result`
- `a workflow run’s card (M47) > shows running and queued agents without unverified owner controls`
- `a workflow run’s card (M47) > shows a failure when the run has no handle`
- `a workflow run’s card (M47) > keeps an unknown future run and agent status verbatim without falsely marking failure`
- `a workflow run’s card (M47) > shows the Workflow tool’s script and its launch in the row before the card`
- `a workflow run’s card (M47) > does not label an unobserved argument as a resume source`

### test/unit/workLifetime.test.ts

- `a bounded lifetime (M81 A1) > ends at its deadline, rejecting the step waiting then, and records why`
- `a bounded lifetime (M81 A1) > ends when any joined signal aborts, already aborted or later`
- `a bounded lifetime (M81 A1) > passes its own signal to each step and returns what the step answered while it lasts`
- `a bounded lifetime (M81 A1) > closes what a late step returns, so a late download or consent starts nothing`
- `a bounded lifetime (M81 A1) > disposes a late step’s value with its disposer instead of closing it`
- `a bounded lifetime (M81 A1) > passes a step’s own failure through while it lasts`
- `a bounded lifetime (M81 A1) > runs its cleanups once, newest first, at the end, and one added afterwards at once`
- `a bounded lifetime (M81 A1) > stops waiting for cleanups at their own bound`
- `a bounded lifetime (M81 A1) > states a monotonic deadline`

## Tests removed from files that stay

### test/integration/extension.test.ts

- `activation > exposes every setting with its documented default`
- `the Model API bundle > loads from the installed extension and runs a turn`

### test/unit/acpSdkTransport.test.mjs

- `the product ACP stream bound > is the only way production code opens an ACP NDJSON stream`

### test/unit/anthropicCodec.test.ts

- `review regressions (RVM95AO) > uses the captured native model id in every golden`

### test/unit/autoCompact.test.ts

- `automatic compaction economics (D81.4) > documents the actual candidate observation-packing default in D81 and M73`

### test/unit/borderContrast.test.mjs

- `R1 assured boundary contrast > derives --ms-boundary from the theme foreground and background, never a host border`
- `R1 assured boundary contrast > draws the R1 control boundaries from the assured role`

### test/unit/bundleDiet.test.ts

- `train bundle diet > keeps every shared constants initialiser droppable`

### test/unit/bundledSkillsVendor.test.ts

- `bundled workflow release > records exactly the present files, sorted, without the manifest itself`
- `bundled workflow release > pins the SHA-256 of $path`
- `bundled workflow release > ships the complete %s skill entry`
- `bundled workflow release > ships only workflow assets and top-level documentation`

### test/unit/changelogVersion.test.ts

- `` CHANGELOG and the manifest version > `has a dated section for ${manifest.version}` ``

### test/unit/cx1r2Truth.test.ts

- `RVCX1B F1 after C-M106-2: live argument previews are published where they render > README describes the preview, names the one verified model and promises no more`
- `RVCX1B F2: playbook panel claims are removed > catalog and generated Help advertise only ACP journal/settings surfaces`
- `RVCX1B F3: v2 schedule delivery claims are removed on every surface > README retains manual /loop and drops v2 paid-fire instructions`
- `RVCX1B F3: v2 schedule delivery claims are removed on every surface > Help omits v2 command, settings and CLI routes after complete inventory validation`
- `RVCX1B F3: v2 schedule delivery claims are removed on every surface > plan and editor records no longer claim live-session firing or a consent failure point`
- `CX1R3 sibling sweep: dormant features have no published usage > omits %s from Help and clears its capability inventory`
- `CX1R3 sibling sweep: dormant features have no published usage > retains only neutral progress text in the dormant source inventory`
- `CX1R3 sibling sweep: dormant features have no published usage > removes dormant commands, options and paid availability facts`
- `CX1R3 sibling sweep: dormant features have no published usage > keeps only five working report kind instructions`
- `CX1R3 sibling sweep: dormant features have no published usage > roadmap places dormant work in progress with no shipped note or capability claims`
- `CX1R3 sibling sweep: dormant features have no published usage > M95b remains building with its open acceptance checklist`

### test/unit/cx1r4Truth.test.ts

- `CX1R4 F1 after CM108ACC: accounts are published where the code serves them > published Help has the accounts feature, route and --account, not pooling or the settings`
- `CX1R4 F1 after CM108ACC: accounts are published where the code serves them > the capability inventory binds accounts to ACP on the Model API backend`
- `CX1R4 F1 after CM108ACC: accounts are published where the code serves them > README has the product section for what works and no progress-list anchor`
- `CX1R4 F1 after CM108ACC: accounts are published where the code serves them > roadmap leaves accounts in progress with no shipped note`
- `CX1R4 F3: live Help and pickers list only the five working kinds > the working set is exactly the five sourced kinds`
- `CX1R4 F5: corrected English keys ship fresh translations > English holds the corrected wording`
- `CX1R4 F5: corrected English keys ship fresh translations > the %s table carries no stale wording for a corrected key`

### test/unit/estimatorLocalization.test.ts

- `M117 localized estimator consent and manifest handoff > supplies exact five manifest translations for W without registering unfinished commands`

### test/unit/eval/evalTasks.test.ts

- `eval task set > holds seven accept and five held-out tasks, one of each with a long output (M73)`

### test/unit/hookFormatsContracts.test.ts

- `every row is reachable and cited > $name cites saved sources`
- `bounded work > no adapter source constructs a regular expression at run time`

### test/unit/hookFormatsFixtures.test.ts

- `every documented event is a row or refused on purpose > $id`
- `doc stdout: the documented answer > every JSON doc output has an expectation`
- `captured stdin (real CLIs, scrubbed) > every Gemini event that fired has a row`

### test/unit/judgeBench.test.ts

- `committed bench results > holds no keys or bearer tokens (apiKey stays <held-in-env>)`

### test/unit/legalGuards.test.ts

- `legal scanner guards > names no network, process, evaluation or write capability`

### test/unit/legalSpdx.test.ts

- `pinned SPDX data > covers the common identifiers and exceptions`
- `pinned SPDX data > versions the dataset inside the shared bound with provenance`

### test/unit/m106CaptureFixtures.test.ts

- `C-M106-1 counted Muse Code 1.4.4 captures > validates scrubbed fixture hashes and counts every launched probe and request once`
- `C-M106-1 counted Muse Code 1.4.4 captures > names every provider credential or local runtime still waiting without granting capabilities`

### test/unit/m95Strings.test.ts

- `M95 strings > defines every key the providers UI reads, with text`
- `M95 manifest strings > contributes the three provider commands with titles from package.nls.json`
- `M95 manifest strings > lets a workspace suggest one provider preset, and nothing else`
- `M95 manifest strings > adds the walkthrough step that opens the wizard`

### test/unit/mediaLocalization.test.ts

- `M105 frozen media wording > refuses uploads with the missing bindings, not storage billing (D85.6)`

### test/unit/modelapiChatCodec.test.ts

- `chat codec request goldens > identifies the chat format for lane T`

### test/unit/modelApiLoopContracts.test.ts

- `M106 loop contracts > keeps the legacy output cap until the model-record clamp is integrated`
- `M106 loop contracts > fixes the plan’s concurrency, continuation, repair and repetition bounds`
- `M106 loop contracts > provides a bounded search default and a conservative startup pace`

### test/unit/ollamaCodec.test.ts

- `decodeOllamaStream native captures > pins capture version, counted ledger and exact transport byte lengths`

### test/unit/outputSchema.test.ts

- `M106 O2 strict output schema > ships additive v1 schema snapshots preserving every base field and event guard`

### test/unit/planCitation.test.ts

- `the exact-money guard's PLAN.md citations > cites four different clauses`
- `the exact-money guard's PLAN.md citations > resolves in the real PLAN.md: $phrase`
- `the exact-money guard's PLAN.md citations > stay resolved when lines are inserted above the cited passage`
- `the exact-money guard's PLAN.md citations > fails once its clause is gone: $phrase`

### test/unit/providersL10n.test.ts

- `provider localization > keeps provider and release commands in %s help`

### test/unit/resourceDelivery.test.mjs

- `P3 the security guide reflects repaired DK guards and the precise qualifications`

### test/unit/sharingArtifacts.test.ts

- `M118 integration artifacts > requires sync consent on each machine and forbids workspace overrides`
- `M118 integration artifacts > registers all sharing commands and portable context menus`

### test/unit/team/teamTables.test.ts

- `team strings > adds every team key to the English table`

### test/unit/teamConstants.test.ts

- `team caps, intensity and machine values > starts autofill from D75 typical tokens per role`
- `team caps, intensity and machine values > refuses models below 32K and recommends 128K for research and review`
- `team caps, intensity and machine values > sets each role base effort from D75`
- `team caps, intensity and machine values > maps every intensity level to D75 counts, shifts and budgets`
- `team caps, intensity and machine values > estimates a worker at 6 RPM and 250K TPM inside the researched limits`
- `team caps, intensity and machine values > recovers throttled entries one step a minute after a 30-minute usage mark`
- `team caps, intensity and machine values > bounds delegation depth, call size and per-role defaults`
- `team caps, intensity and machine values > bounds queues, requests, briefs, pages and leases from D75`
- `team caps, intensity and machine values > reports summaries by default, reviews for code-review and qa for tests`
- `team caps, intensity and machine values > names the eleven rubric reason codes`
- `team caps, intensity and machine values > holds the machine budget and process-worker formula inputs`
- `team caps, intensity and machine values > holds lane K lifetime, hint and load numbers`
- `team model text > opens every charter with the role and the orchestrator it serves`
- `team model text > tells each workspace mode apart without task-varying bytes`
- `team model text > lists exactly the enforced set and never a merge`
- `team model text > hands each report shape its required fields and statuses`
- `team model text > frames the roster stable part and the live tail note`
- `team model text > gives the rubric every code and the never-delegate line`
- `team model text > describes the five tools without naming a role`
- `team model text > gives every built-in role a stable body that hands work back`
- `team strings > names the panel sections, the slot and the reset`
- `team strings > labels modes, levels, templates and steps for the Roles section`
- `team strings > fills the switch row and the paid popup from slots`
- `team strings > covers the tree states and the waiting-for-you choices`
- `team recovery and landing strings (lane M96-0b) > uses the plan’s exact words for every recovery and landing button`
- `team recovery and landing strings (lane M96-0b) > keeps each recovery and landing string’s slots in English`
- `team roles and tool sets > names the seven built-in roles in D75 order`
- `team roles and tool sets > keeps every role inside the one tool-group definition`
- `team roles and tool sets > gives every worker its report tool, and no worker a merge group`
- `team roles and tool sets > keeps read-only roles off every write-ish group`
- `team roles and tool sets > gives engineering the full harness and marketing no shell`
- `team roles and tool sets > confines writers to D75 write-paths, with engineering on its whole branch`
- `team roles and tool sets > lists the read-only shell and its refused options from D75`

### test/unit/usageL10nTables.test.mjs

- `shipped usage tables (lane L) > keeps a valid usage section in l10n/untranslated.json`
- `shipped usage tables (lane L) > leaves no locale without its table`

## Checks removed from scripts and workflows that stay

- `test/hosts/exec.sh`: the installed agent's `exec --backend modelApi` run against the fake Model API preloaded into the process (one request, `completed`, final message `ok`), with the key from standard input and, under `--store`, from the OS credential store; and the check that the packaged `schemas/exec-*-v2.schema.json` files carry `v: 2` and their required field. The help and trust-refusal checks stay; the key round trip stays in `test/hosts/keystore.sh`.
- `.github/workflows/hosts.yml`: the jobs `code-server`, `theia` and `acp-clients` (JupyterLab, Emacs, Neovim), which drove the fake Muse Code CLI, and the agent job's two stdio suites (`acpStdio.e2e.test.ts`, `execStdio.e2e.test.ts`).
- `package.json`: `test:e2e:live:modelapi`, the Model API live sweep (`test/e2e/modelApi.live.e2e.test.ts`), built on the fake Git window, fake chat surface, fake log channel and fake MCP server.

## Deleted helpers, fixtures and fake suites

These held no test titles of their own: the stand-ins and fixtures the deleted tests used, and the scripts of the deleted suites. The host suites drove code-server, Eclipse Theia, JupyterLab, Emacs and Neovim against the fake Muse Code CLI (hosts.yml); the Action suites ran the composite Action against the fake-only test package (action-check.yml, deleted).

- `test/action/captures.json` (the Action check against the fake-only test package)
- `test/action/certificates.json` (the Action check against the fake-only test package)
- `test/action/exec-test-launcher.ts` (the Action check against the fake-only test package)
- `test/action/execTestTransport.ts` (the Action check against the fake-only test package)
- `test/action/fake-agent.mjs` (the Action check against the fake-only test package)
- `test/action/npm-audit-capture.json` (the Action check against the fake-only test package)
- `test/action/sentinel.mjs` (the Action check against the fake-only test package)
- `test/action/tsconfig.json` (the Action check against the fake-only test package)
- `test/action/w-check.mjs` (the Action check against the fake-only test package)
- `test/action/w-fixture.txt` (the Action check against the fake-only test package)
- `test/e2e/acpFixture.ts`
- `test/e2e/createdHelperFixture.ts`
- `test/e2e/fake-muse/serve.mjs`
- `test/e2e/fake-muse/stub.cs`
- `test/e2e/fakeMuse.ts`
- `test/hosts/code-server.mjs` (the editor host checks against the fake Muse Code CLI)
- `test/hosts/emacs/acp-check.el` (the editor host checks against the fake Muse Code CLI)
- `test/hosts/emacs/agent-shell-check.el` (the editor host checks against the fake Muse Code CLI)
- `test/hosts/fake-muse.sh` (the editor host checks against the fake Muse Code CLI)
- `test/hosts/jupyter.mjs` (the editor host checks against the fake Muse Code CLI)
- `test/hosts/jupyter/personas/muse_spark.svg` (the editor host checks against the fake Muse Code CLI)
- `test/hosts/jupyter/personas/muse_spark_persona.py` (the editor host checks against the fake Muse Code CLI)
- `test/hosts/jupyter/requirements.txt` (the editor host checks against the fake Muse Code CLI)
- `test/hosts/lib/browser.mjs` (the editor host checks against the fake Muse Code CLI)
- `test/hosts/neovim/check.lua` (the editor host checks against the fake Muse Code CLI)
- `test/hosts/neovim/init.lua` (the editor host checks against the fake Muse Code CLI)
- `test/hosts/run-code-server.sh` (the editor host checks against the fake Muse Code CLI)
- `test/hosts/run-emacs.sh` (the editor host checks against the fake Muse Code CLI)
- `test/hosts/run-jupyter.sh` (the editor host checks against the fake Muse Code CLI)
- `test/hosts/run-neovim.sh` (the editor host checks against the fake Muse Code CLI)
- `test/hosts/run-theia.sh` (the editor host checks against the fake Muse Code CLI)
- `test/hosts/runtime-chatgpt-lock-worker.mjs` (the editor host checks against the fake Muse Code CLI)
- `test/hosts/runtime-chatgpt-store.mjs` (the editor host checks against the fake Muse Code CLI)
- `test/hosts/schedule-os-win11.mjs` (the editor host checks against the fake Muse Code CLI)
- `test/hosts/theia.mjs` (the editor host checks against the fake Muse Code CLI)
- `test/hosts/theia/package.json` (the editor host checks against the fake Muse Code CLI)
- `test/unit/helpers/acpPackageSources.ts`
- `test/unit/helpers/acpWaits.ts`
- `test/unit/helpers/actionFixtures.ts`
- `test/unit/helpers/audioLabels.ts`
- `test/unit/helpers/developer.ts`
- `test/unit/helpers/execContract.ts`
- `test/unit/helpers/fakeContextIo.ts`
- `test/unit/helpers/fakeGit.ts`
- `test/unit/helpers/fakeGitHub.ts`
- `test/unit/helpers/fakeMcpBatch.cmd`
- `test/unit/helpers/fakeModelApi.ts`
- `test/unit/helpers/fakePaidFeatures.ts`
- `test/unit/helpers/fakeScheduleWake.mjs`
- `test/unit/helpers/fakeToolIo.ts`
- `test/unit/helpers/fakes.ts`
- `test/unit/helpers/gitFilterNames.ts`
- `test/unit/helpers/githubCapture.ts`
- `test/unit/helpers/isolatedGitConfig.ts`
- `test/unit/helpers/judgeSameRig.ts`
- `test/unit/helpers/judgeUseRig.ts`
- `test/unit/helpers/keyring.ts`
- `test/unit/helpers/legalRequest.ts`
- `test/unit/helpers/logText.ts`
- `test/unit/helpers/mcpFixtures.ts`
- `test/unit/helpers/modelApiBundle.ts`
- `test/unit/helpers/modelApiManager.ts`
- `test/unit/helpers/promptHarness.tsx`
- `test/unit/helpers/proxyExchange.ts`
- `test/unit/helpers/refusedProviders.ts`
- `test/unit/helpers/reviewRoots.ts`
- `test/unit/helpers/teamLanding.ts`
- `test/unit/helpers/teamRepository.ts`
- `test/unit/helpers/teamScheduler.ts`
- `test/unit/helpers/transcriptFixtures.tsx`
- `test/unit/helpers/usageFixture.ts`
- `test/unit/helpers/warmDeferredSurfaces.ts`
- `test/unit/mocks/vscode.ts`
- `test/unit/vault/sshFixture.ts`
- `.github/workflows/action-check.yml` (the Action check against the fake-only test package)
- `scripts/package-acp-test.mjs` (packed the fake-only Action test package)

## Removed when the no-stand-ins lint gate landed (2026-10-17)

These tests drove real code but through stand-ins (`vi.fn` and mock return values) that the deleted-files sweep above did not catch, because they were written across lines. ESLint now refuses every stand-in API in test files.

### test/unit/GoalPanel.test.tsx

- is not there without a goal
- shows the objective, the status in words, the progress and what is now and next
- clamps the bar, not the number, and shows an unknown status as it came
- offers the verbs the status allows, and sends them
- edits the objective in place: save sends it, an unchanged one or Escape sends nothing
- closes the field when the goal can no longer be edited
- keeps an open objective editor through a progress update
- does not reopen an old editor when a cleared goal returns with the same objective
- gives the focus back to Edit when the field closes, never to the page

### test/unit/hostL10n.test.ts

- keeps English for a display language without a table, and says so once
- reads and installs the table the display language maps to
- stays in English, with a warning, when the file cannot be read
- stays in English, with a warning, when the file is not JSON
- stays in English, naming the first problems, when the table does not match English
- names only the first few problems of a badly damaged table
- reads ordinary source/ACP JSON without changing its text
- decodes the staged table and installs its actual translated values
- refuses a compressed table whose decoded bytes exceed the fixed bound
- refuses corrupt compressed bytes instead of using a second file

### test/unit/openInTerminal.test.ts

- runs the CLI with no arguments in the workspace root
- leaves the directory to VS Code without a workspace
- warns with the reason when the CLI is absent

### test/unit/planCommands.test.ts

- lists the plans by title and file, then offers Open and Implement
- answers Implement, and nothing when either pick is dismissed

### test/unit/whatsNewPage.test.ts

- sends a link’s index in place of following it, from a click inside it too
- never follows a link it cannot index, and sends nothing for it
- sends a Try it’s index, and nothing for another button or the page
- sends the toggle’s state

### test/unit/legalFixProduction.test.ts (four tests; the rest of the file stays)

- writes only the exact prepared selection after explicit ownership approval
- denial, changed preview and live admission loss each prevent publication
- rechecks admission between patches and reports per-file failures
- refuses evidence changes during ownership approval

## Withdrawn on lane PR161FIX (2026-10-18)

PR #161's own stand-in tests went the same way as the sweep above: they drove real code through hand-written ports (`connection()`, dispatch `{allowEndpoint, fetch}` literals, the `meta` catalogue double) that the owner's rule refuses. Each behaviour below waits for proof by real use of the packed product. (The merge with current main had already withdrawn `fileSessionStore`, `moneyDisplay`, `sessionBudget` and `companionMediaTransport`; their entries stand above.)

### test/unit/accountReadFailures.test.ts

- `account read failures > reads a host failure as unsigned-in, with the kind in words`
- `account read failures > stays silent when the answer comes in another shape`
- `account read failures > keeps a foreign failure past the boundary`

### test/unit/subscriptionStreamFailures.test.ts

- `subscription stream failures > keeps an unknown failure’s kind past the boundary`
- `subscription stream failures > keeps a foreign failure past the boundary`
- `subscription stream failures > still yields a lapsed sign-in as its words`
- `subscription stream failures > still yields a Copilot failure as its message`

### test/unit/mcpOAuthDenied.test.ts (two tests; the port-free denial test stays)

- `mcp oauth denial > maps a dispatch failure onto the denial with its cause`
- `mcp oauth denial > keeps a foreign dispatch failure past the boundary`

## Withdrawn on lane PR161FIX3 (2026-10-18)

The Codex review of PR #161 found the warn-once case below fed an invented keyring failure through a hand-written port. No real keyring or store exists in unit, so the case is deleted rather than repaired with another fake; its behaviour waits for proof by real use of the packed product (the lead's scenario in `docs/certification/catch-money.md`, PR161FIX3).

### test/unit/credentialReadFailures.test.ts (one test; the rest of the file stays)

- `credential read failures > warns once per owner while the store stays unreadable, re-armed by a healthy read`

## Withdrawn on lane PR161W1 (2026-10-18)

The Codex re-review of PR #161 found the remaining cases in the file below still fed invented keyring failures through a hand-written port. No real keyring or store exists in unit, so the whole file is deleted rather than repaired with another fake; the guarded-scan warn-once-per-kind behaviour waits for proof by real use of the packed product (the lead's scenario in `docs/certification/catch-money.md`, PR161W1: on Linux without a usable keyring, trigger repeated operational key reads and guarded scans and observe one warning per kind in the runtime log; restore the keyring for one healthy scan and observe the warnings re-arm).

### test/unit/credentialReadFailures.test.ts (whole file)

- `credential read failures > reads a store failure as no key, with the kind in words`
- `credential read failures > reads a denied store as unreadable with its kind`
- `credential read failures > stays silent when the store answers`
- `credential read failures > scans past an unreadable provider entry instead of calling it absent`
