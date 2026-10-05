# ACTDIET — 0.14.0 preview startup diet

Preview only on Kubuntu, from `928a9200`. No paid/model/network calls, push, release merge or rebase. Time box: 120 minutes.

## Merge record

| Feature head   | Preview merge | Resolution                                                                                                                                                                                                                                         |
| -------------- | ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M91 `7b366ae1` | `f14ba7b0`    | Clean ort merge.                                                                                                                                                                                                                                   |
| M93 `7a293a16` | `91a0ceb6`    | Union docs, strings and build lists; union runtime imports; retain M93 ACP usage with M91 Setup usage; combine deferred entry maps; regenerate host inventory.                                                                                     |
| M94 `c70facee` | `ce99c0fc`    | Union commands/settings, paid requests/branches and tallies; retain current interactive defaults plus Tab first-use consent; regenerate host inventory. Follow-up moves additions out of released notes and fixes a stale Transcript test fixture. |

## Baseline ownership

Bytes are esbuild production `outputs["dist/extension.js"].inputs[*].bytesInOutput`, ranked without gzip. Existing files are assigned to main; new feature paths to their feature. Shared files name all feature branches that change them, rather than pretending their whole size is incremental feature cost. This is file ownership, not a causal per-feature byte attribution. The build wrapper is the difference between file contributions and the actual artifact.

| Owner                 |       Bytes |
| --------------------- | ----------: |
| main                  |     609,260 |
| dependencies          |      15,031 |
| M94                   |       7,554 |
| M93                   |       2,504 |
| M91                   |         349 |
| Build wrapper         |         633 |
| **Actual activation** | **635,331** |

## Every activation input, ranked

| Rank | Input                                                           |   Bytes | Owner; branches touching shared main files |
| ---: | --------------------------------------------------------------- | ------: | ------------------------------------------ |
|    1 | `src/host/conversation/conversationController.ts`               | 126,103 | main; M91/M93/M94                          |
|    2 | `src/extension.ts`                                              |  49,930 | main; M91/M93/M94                          |
|    3 | `src/shared/constants.ts`                                       |  36,358 | main; M91/M93/M94                          |
|    4 | `src/core/backends/musecode/MuseCodeHost.ts`                    |  22,559 | main; M94                                  |
|    5 | `src/shared/protocol.ts`                                        |  16,840 | main; M91/M93/M94                          |
|    6 | `src/host/auth/authService.ts`                                  |  15,979 | main                                       |
|    7 | `src/host/backend/toolIo.ts`                                    |   9,515 | main; M91                                  |
|    8 | `src/core/memory/memoryStore.ts`                                |   8,152 | main                                       |
|    9 | `src/host/editor/verifyEditor.ts`                               |   7,781 | main; M94                                  |
|   10 | `src/shared/agentEvents.ts`                                     |   7,735 | main; M91/M94                              |
|   11 | `src/host/tab/tabBundle.ts`                                     |   7,554 | M94                                        |
|   12 | `src/host/backend/museCodeBackendManager.ts`                    |   7,545 | main; M94                                  |
|   13 | `src/core/backends/musecode/mapNotification.ts`                 |   7,103 | main; M94                                  |
|   14 | `node_modules/@muse-code/sdk/dist/src/connection/connection.js` |   7,033 | dependencies                               |
|   15 | `src/host/backend/modelApiBackendManager.ts`                    |   6,926 | main; M91/M94                              |
|   16 | `src/core/backends/modelapi/client.ts`                          |   6,901 | main; M94                                  |
|   17 | `src/host/commands/museConfigCommands.ts`                       |   6,871 | main; M91/M94                              |
|   18 | `src/core/paid/paidFeatures.ts`                                 |   6,626 | main; M91/M94                              |
|   19 | `src/host/conversation/conversationCheckpoints.ts`              |   6,227 | main                                       |
|   20 | `src/host/backend/sessionBudgetJournal.ts`                      |   6,144 | main; M94                                  |
|   21 | `src/core/browser/browserTool.ts`                               |   5,681 | main; M94                                  |
|   22 | `src/core/export/sessionTransfer.ts`                            |   5,678 | main                                       |
|   23 | `src/host/settings.ts`                                          |   5,459 | main; M91/M94                              |
|   24 | `src/host/fsAtomic.ts`                                          |   5,233 | main                                       |
|   25 | `src/shared/redact.ts`                                          |   5,167 | main; M94                                  |
|   26 | `src/core/backends/modelapi/sessionStore.ts`                    |   5,127 | main; M91                                  |
|   27 | `node_modules/@muse-code/sdk/dist/src/connection/spawn.js`      |   5,064 | dependencies                               |
|   28 | `src/host/backend/mcpProcess.ts`                                |   4,448 | main; M94                                  |
|   29 | `src/core/paid/paidConsent.ts`                                  |   4,379 | main; M91/M94                              |
|   30 | `src/host/cliFeatures.ts`                                       |   4,241 | main; M91/M94                              |
|   31 | `src/host/checkpoints/checkpointHost.ts`                        |   4,186 | main                                       |
|   32 | `src/host/git.ts`                                               |   4,141 | main                                       |
|   33 | `src/host/processTree.ts`                                       |   4,131 | main                                       |
|   34 | `src/core/attachments.ts`                                       |   3,829 | main                                       |
|   35 | `src/shared/paid.ts`                                            |   3,690 | main; M91/M94                              |
|   36 | `src/core/backends/modelapi/schemas.ts`                         |   3,613 | main; M94                                  |
|   37 | `src/core/export/transcriptMarkdown.ts`                         |   3,611 | main                                       |
|   38 | `src/core/backends/modelapi/imageGeneration.ts`                 |   3,566 | main                                       |
|   39 | `src/core/support/report.ts`                                    |   3,476 | main; M94                                  |
|   40 | `src/host/auth/deviceSignIn.ts`                                 |   3,415 | main                                       |
|   41 | `src/host/codeIntel/languageServices.ts`                        |   3,406 | main                                       |
|   42 | `src/core/codeIntel/definitions.ts`                             |   3,389 | main                                       |
|   43 | `src/host/paid/paidHost.ts`                                     |   3,337 | main; M91/M94                              |
|   44 | `src/host/backend/fileScheduleStore.ts`                         |   3,160 | main                                       |
|   45 | `src/host/commands/worktreeCommands.ts`                         |   3,140 | main; M94                                  |
|   46 | `src/core/backends/musecode/launch.ts`                          |   3,096 | main                                       |
|   47 | `src/host/paid/paidDailyBudget.ts`                              |   3,039 | main; M94                                  |
|   48 | `src/host/commands/skillsCommands.ts`                           |   2,985 | main; M94                                  |
|   49 | `src/host/ide/ideMcpServer.ts`                                  |   2,808 | main; M94                                  |
|   50 | `src/core/plans/planStore.ts`                                   |   2,736 | main                                       |
|   51 | `src/core/pdf.ts`                                               |   2,662 | main                                       |
|   52 | `src/host/skills/bundledSkills.ts`                              |   2,641 | main                                       |
|   53 | `src/host/backend/fileSessionStore.ts`                          |   2,569 | main                                       |
|   54 | `src/host/auth/accountHost.ts`                                  |   2,548 | main                                       |
|   55 | `src/host/web/pageConverter.ts`                                 |   2,543 | main                                       |
|   56 | `src/core/backends/musecode/museConfigView.ts`                  |   2,430 | main; M91                                  |
|   57 | `src/core/backends/musecode/promptLedger.ts`                    |   2,409 | main                                       |
|   58 | `src/host/backend/sandboxSetup.ts`                              |   2,373 | main; M94                                  |
|   59 | `src/core/backends/musecode/skillsCli.ts`                       |   2,340 | main                                       |
|   60 | `src/core/backends/musecode/sessionRecords.ts`                  |   2,292 | main                                       |
|   61 | `node_modules/@muse-code/sdk/dist/src/facade/gap-fill.js`       |   2,273 | dependencies                               |
|   62 | `src/host/browser/browserChecks.ts`                             |   2,257 | main; M94                                  |
|   63 | `src/host/auth/cliAccount.ts`                                   |   2,187 | main                                       |
|   64 | `src/host/commands/memoryCommands.ts`                           |   2,174 | main; M94                                  |
|   65 | `src/host/whatsNew/whatsNew.ts`                                 |   2,166 | main; M94                                  |
|   66 | `src/host/views/tasksPanel.ts`                                  |   2,124 | main                                       |
|   67 | `src/core/diagnostics.ts`                                       |   2,105 | main                                       |
|   68 | `src/core/plans/planDocument.ts`                                |   2,070 | main                                       |
|   69 | `src/core/mcp.ts`                                               |   2,030 | main                                       |
|   70 | `src/shared/l10n/check.ts`                                      |   2,010 | main                                       |
|   71 | `src/core/memory/memoryIndex.ts`                                |   1,942 | main                                       |
|   72 | `src/core/usage/insights.ts`                                    |   1,923 | main                                       |
|   73 | `src/host/planFeatures.ts`                                      |   1,847 | main                                       |
|   74 | `src/core/backends/musecode/sandbox.ts`                         |   1,830 | main; M94                                  |
|   75 | `src/host/conversation/exportConversation.ts`                   |   1,750 | main; M94                                  |
|   76 | `src/core/imageDimensions.ts`                                   |   1,689 | main                                       |
|   77 | `src/shared/l10n/text.ts`                                       |   1,536 | main                                       |
|   78 | `src/host/networkPosture.ts`                                    |   1,503 | main                                       |
|   79 | `src/host/backend/jobBuild.ts`                                  |   1,473 | main; M94                                  |
|   80 | `src/host/ide/webFetchTool.ts`                                  |   1,451 | main; M94                                  |
|   81 | `src/host/views/webviewSetup.ts`                                |   1,352 | main                                       |
|   82 | `src/core/agent/agentBackend.ts`                                |   1,347 | main; M91                                  |
|   83 | `src/core/voice/helperLocation.ts`                              |   1,341 | main                                       |
|   84 | `src/core/networkFailure.ts`                                    |   1,329 | main                                       |
|   85 | `src/core/backends/modelapi/schedules.ts`                       |   1,318 | main                                       |
|   86 | `src/host/ide/imageTools.ts`                                    |   1,302 | main                                       |
|   87 | `src/core/browser/workLifetime.ts`                              |   1,278 | main; M94                                  |
|   88 | `src/core/whatsNew/whatsNewVersions.ts`                         |   1,216 | main; M94                                  |
|   89 | `src/host/backend/shellJob.ts`                                  |   1,210 | main; M94                                  |
|   90 | `src/core/worktrees.ts`                                         |   1,199 | main; M91                                  |
|   91 | `src/host/review/reviewBundle.ts`                               |   1,177 | main                                       |
|   92 | `src/host/backend/memoryIo.ts`                                  |   1,162 | main                                       |
|   93 | `src/host/backend/mcpJobLaunch.ts`                              |   1,157 | main; M91/M94                              |
|   94 | `src/host/ide/browserCheckTool.ts`                              |   1,147 | main; M94                                  |
|   95 | `src/core/workspacePath.ts`                                     |   1,105 | main                                       |
|   96 | `src/host/support/reportFacts.ts`                               |   1,087 | M93                                        |
|   97 | `src/host/html.ts`                                              |   1,058 | main; M94                                  |
|   98 | `src/core/backends/modelapi/imageToolDefinitions.ts`            |   1,034 | main                                       |
|   99 | `src/core/browser/browserPolicy.ts`                             |   1,032 | main; M94                                  |
|  100 | `src/host/worktreeFeatures.ts`                                  |   1,017 | main                                       |
|  101 | `src/core/memory/memoryLocation.ts`                             |     994 | main                                       |
|  102 | `src/host/support/reportRecorder.ts`                            |     971 | M93                                        |
|  103 | `src/host/conversation/turnNotifications.ts`                    |     965 | main                                       |
|  104 | `src/host/backend/mcpJobExecutable.ts`                          |     957 | main; M94                                  |
|  105 | `src/core/mentionIndex.ts`                                      |     954 | main                                       |
|  106 | `src/host/canonicalPath.ts`                                     |     947 | main                                       |
|  107 | `src/core/agent/approvalRules.ts`                               |     944 | main; M94                                  |
|  108 | `src/shared/bestOfN.ts`                                         |     926 | main                                       |
|  109 | `src/core/backends/musecode/credentialFile.ts`                  |     916 | main; M93                                  |
|  110 | `src/host/voice/dictationHost.ts`                               |     906 | main                                       |
|  111 | `src/shared/browserCheckConstants.ts`                           |     900 | main; M94                                  |
|  112 | `src/host/views/chatPanel.ts`                                   |     887 | main                                       |
|  113 | `src/host/views/surfaceRegistry.ts`                             |     885 | main                                       |
|  114 | `src/host/commands/createRulesFile.ts`                          |     874 | main; M94                                  |
|  115 | `src/core/agent/approvalSecrets.ts`                             |     874 | main; M94                                  |
|  116 | `src/host/l10n.ts`                                              |     872 | main                                       |
|  117 | `src/host/memoryFeatures.ts`                                    |     852 | main                                       |
|  118 | `src/host/usage/traceLogs.ts`                                   |     835 | main                                       |
|  119 | `src/core/workspaceRoot.ts`                                     |     817 | main                                       |
|  120 | `src/core/web/webFetchDefinition.ts`                            |     802 | main                                       |
|  121 | `src/core/backends/musecode/logText.ts`                         |     797 | main                                       |
|  122 | `src/core/backendSelection.ts`                                  |     776 | main                                       |
|  123 | `src/core/fuzzy.ts`                                             |     747 | main                                       |
|  124 | `src/host/backend/environment.ts`                               |     743 | main                                       |
|  125 | `src/shared/verifyText.ts`                                      |     742 | main                                       |
|  126 | `src/core/verify/checkCommands.ts`                              |     732 | main                                       |
|  127 | `src/host/editor/revertIo.ts`                                   |     725 | main                                       |
|  128 | `src/host/conversation/transferDialogs.ts`                      |     714 | main                                       |
|  129 | `src/core/toolImages.ts`                                        |     708 | main                                       |
|  130 | `src/host/planMarkdownBundle.ts`                                |     700 | main                                       |
|  131 | `src/core/timeouts.ts`                                          |     692 | main                                       |
|  132 | `src/core/backends/modelapi/sse.ts`                             |     689 | main                                       |
|  133 | `src/host/auth/credentialStore.ts`                              |     688 | main                                       |
|  134 | `src/host/backend/contextIo.ts`                                 |     660 | main                                       |
|  135 | `src/host/checkpoints/checkpointStoreBundle.ts`                 |     658 | main                                       |
|  136 | `src/shared/usage.ts`                                           |     652 | main                                       |
|  137 | `src/shared/sessions.ts`                                        |     646 | main                                       |
|  138 | `src/host/editor/editorContextTracker.ts`                       |     630 | main                                       |
|  139 | `src/host/web/webFetchBundle.ts`                                |     625 | main                                       |
|  140 | `src/core/context/customAgents.ts`                              |     620 | main                                       |
|  141 | `src/core/editorContext.ts`                                     |     615 | main                                       |
|  142 | `src/shared/schedule.ts`                                        |     603 | main                                       |
|  143 | `src/core/bestOfN/bestOfNError.ts`                              |     594 | main                                       |
|  144 | `src/shared/reviewCommand.ts`                                   |     593 | main                                       |
|  145 | `src/host/backend/mcpServers.ts`                                |     588 | main                                       |
|  146 | `src/host/browser/runtimeCommand.ts`                            |     580 | main; M94                                  |
|  147 | `src/host/browser/runtimeConsent.ts`                            |     571 | main; M94                                  |
|  148 | `src/host/backend/museSettings.ts`                              |     559 | main                                       |
|  149 | `src/host/lazyBundle.ts`                                        |     553 | main                                       |
|  150 | `src/core/bestOfN/bestOfNCoordinator.ts`                        |     546 | main                                       |
|  151 | `src/host/views/ChatViewProvider.ts`                            |     540 | main                                       |
|  152 | `src/host/mention/workspaceFiles.ts`                            |     523 | main; M94                                  |
|  153 | `src/host/commands/planCommands.ts`                             |     522 | main                                       |
|  154 | `src/host/backend/checkpointedMemory.ts`                        |     507 | main                                       |
|  155 | `src/host/agentImportBundle.ts`                                 |     502 | main                                       |
|  156 | `src/host/review/museCodeReviewerBundle.ts`                     |     500 | main                                       |
|  157 | `src/host/backend/jobSource.ts`                                 |     478 | main                                       |
|  158 | `src/host/voice/voiceBundle.ts`                                 |     476 | main                                       |
|  159 | `src/core/context/rulesTemplate.ts`                             |     461 | main                                       |
|  160 | `src/core/verify/workspaceEdits.ts`                             |     451 | main                                       |
|  161 | `src/core/executables.ts`                                       |     449 | main                                       |
|  162 | `src/host/support/reportEditorIo.ts`                            |     446 | M93                                        |
|  163 | `src/host/mention/mentionQuickPick.ts`                          |     435 | main                                       |
|  164 | `src/shared/permissionModes.ts`                                 |     433 | main; M94                                  |
|  165 | `src/host/outputDocuments.ts`                                   |     423 | main                                       |
|  166 | `src/shared/mentions.ts`                                        |     415 | main                                       |
|  167 | `src/core/chatReference.ts`                                     |     386 | main                                       |
|  168 | `src/shared/tasksProtocol.ts`                                   |     383 | main                                       |
|  169 | `src/core/backends/modelapi/goalRecord.ts`                      |     375 | main                                       |
|  170 | `src/host/browser/browserCheckConfirm.ts`                       |     363 | main; M94                                  |
|  171 | `src/core/context/skills.ts`                                    |     361 | main; M94                                  |
|  172 | `src/host/checkpoints/checkpointLocation.ts`                    |     359 | main                                       |
|  173 | `src/host/extensionHooksBundle.ts`                              |     349 | M91                                        |
|  174 | `src/shared/textFileDisplay.ts`                                 |     348 | main                                       |
|  175 | `node_modules/@muse-code/sdk/dist/src/fingerprint.js`           |     346 | dependencies                               |
|  176 | `src/core/sessionBoard.ts`                                      |     339 | main                                       |
|  177 | `src/shared/sessionBoard.ts`                                    |     334 | main                                       |
|  178 | `src/core/agent/sessionRows.ts`                                 |     317 | main                                       |
|  179 | `src/core/fifoLimiter.ts`                                       |     314 | main                                       |
|  180 | `src/host/checkpoints/windowPresence.ts`                        |     313 | main                                       |
|  181 | `src/shared/patchDocument.ts`                                   |     312 | main                                       |
|  182 | `src/core/fs/fileIdentity.ts`                                   |     306 | main                                       |
|  183 | `src/host/ide/codeIntelTools.ts`                                |     305 | main                                       |
|  184 | `src/host/views/webviewErrors.ts`                               |     303 | main                                       |
|  185 | `src/core/redact.ts`                                            |     292 | main; M94                                  |
|  186 | `src/core/protectedPaths.ts`                                    |     288 | main; M94                                  |
|  187 | `node_modules/@muse-code/sdk/dist/src/errors.js`                |     288 | dependencies                               |
|  188 | `src/host/backend/selectedHost.ts`                              |     288 | main                                       |
|  189 | `src/host/commands/insertMention.ts`                            |     286 | main                                       |
|  190 | `src/host/agentImportHost.ts`                                   |     278 | main; M91                                  |
|  191 | `src/core/shellResult.ts`                                       |     275 | main                                       |
|  192 | `src/core/verify/textEdits.ts`                                  |     270 | main                                       |
|  193 | `src/host/web/webFetchConfirm.ts`                               |     263 | main                                       |
|  194 | `src/shared/l10n/locales.ts`                                    |     259 | main                                       |
|  195 | `src/core/web/hostName.ts`                                      |     250 | main                                       |
|  196 | `src/host/logger.ts`                                            |     247 | main                                       |
|  197 | `src/host/ide/codeIntelBundle.ts`                               |     225 | main                                       |
|  198 | `src/core/paths.ts`                                             |     221 | main                                       |
|  199 | `src/core/verify/fingerprint.ts`                                |     218 | main                                       |
|  200 | `src/core/shellQuote.ts`                                        |     216 | main                                       |
|  201 | `src/host/popups.ts`                                            |     211 | main                                       |
|  202 | `src/core/verify/codeFiles.ts`                                  |     211 | main                                       |
|  203 | `src/core/logging.ts`                                           |     195 | main                                       |
|  204 | `src/shared/privateFiles.ts`                                    |     193 | main; M94                                  |
|  205 | `src/shared/effort.ts`                                          |     185 | main                                       |
|  206 | `src/shared/l10n/forms.ts`                                      |     185 | main                                       |
|  207 | `src/host/commands/focusInput.ts`                               |     180 | main                                       |
|  208 | `src/host/commands/openInTerminal.ts`                           |     178 | main                                       |
|  209 | `src/host/quickPick.ts`                                         |     164 | main                                       |
|  210 | `src/shared/pdfHeader.ts`                                       |     160 | main                                       |
|  211 | `src/shared/webResults.ts`                                      |     159 | main                                       |
|  212 | `src/host/backend/storeErrors.ts`                               |     149 | main; M94                                  |
|  213 | `src/core/mention.ts`                                           |     129 | main                                       |
|  214 | `src/host/backend/modelApiBundle.ts`                            |     118 | main                                       |
|  215 | `src/host/conversation/sessionImport.ts`                        |     103 | main                                       |
|  216 | `src/core/textAttachment.ts`                                    |      86 | main                                       |
|  217 | `src/core/context/contextFiles.ts`                              |      85 | main                                       |
|  218 | `src/shared/palette.ts`                                         |      80 | main; M91/M93/M94                          |
|  219 | `src/host/commands/toggleFocusView.ts`                          |      74 | main                                       |
|  220 | `src/core/checkpoints/turnKey.ts`                               |      36 | main                                       |
|  221 | `node_modules/@muse-code/sdk/dist/src/facade/session.js`        |      27 | dependencies                               |
|  222 | `node_modules/@muse-code/sdk/dist/src/index.js`                 |       0 | dependencies                               |

## English string regions

The whole baseline fallback is 134,771 bytes. Region estimates below use UTF-8 JSON key/value bytes, excluding inter-property commas and the wrapper; they rank string weight without claiming esbuild attribution within one object. The prototype table records real emitted artifacts separately.

| Region         | Keys | JSON key/value bytes |
| -------------- | ---: | -------------------: |
| Main/other     | 1397 |              110,940 |
| ACP/headless   |   67 |                7,345 |
| Hooks          |   84 |                6,799 |
| Agent import   |   67 |                4,995 |
| Tab            |   34 |                2,571 |
| Support report |   35 |                2,545 |
| What’s New     |   16 |                  807 |

## Every English key-prefix region, ranked

These disjoint regions use the first lower-case word of each camel-case key. All 1700 keys are counted once. This exposes the large main/other group above; a prefix is a measurement region, while the build uses the explicitly declared feature matchers. JSON weight is the same estimate as above.

| Rank | Prefix       | Keys | JSON key/value bytes |
| ---: | ------------ | ---: | -------------------: |
|    1 | paid         |   56 |                7,247 |
|    2 | agent        |   96 |                6,704 |
|    3 | browser      |   44 |                5,451 |
|    4 | usage        |   86 |                4,788 |
|    5 | review       |   68 |                4,744 |
|    6 | acp          |   27 |                4,136 |
|    7 | mcp          |   53 |                3,688 |
|    8 | palette      |    6 |                3,628 |
|    9 | web          |   38 |                3,616 |
|   10 | exec         |   40 |                3,209 |
|   11 | export       |   46 |                3,028 |
|   12 | tool         |   16 |                2,995 |
|   13 | restore      |   26 |                2,925 |
|   14 | muse         |   23 |                2,867 |
|   15 | best         |   47 |                2,849 |
|   16 | plan         |   30 |                2,811 |
|   17 | hooks        |   39 |                2,748 |
|   18 | sandbox      |   17 |                2,599 |
|   19 | report       |   35 |                2,545 |
|   20 | schedule     |   36 |                2,403 |
|   21 | hook         |   27 |                2,369 |
|   22 | session      |   19 |                2,237 |
|   23 | approval     |   22 |                2,228 |
|   24 | goal         |   37 |                1,803 |
|   25 | worktree     |   30 |                1,741 |
|   26 | dictation    |   15 |                1,686 |
|   27 | permission   |   12 |                1,636 |
|   28 | sign         |   19 |                1,565 |
|   29 | memory       |   27 |                1,521 |
|   30 | import       |   21 |                1,505 |
|   31 | model        |   13 |                1,466 |
|   32 | bundled      |   13 |                1,421 |
|   33 | handoff      |   18 |                1,323 |
|   34 | tab          |   24 |                1,314 |
|   35 | command      |    9 |                1,211 |
|   36 | workflow     |   12 |                1,133 |
|   37 | onboarding   |    4 |                1,073 |
|   38 | subagent     |   11 |                1,067 |
|   39 | rewind       |   13 |                  993 |
|   40 | whats        |   16 |                  807 |
|   41 | bypass       |    6 |                  787 |
|   42 | install      |   11 |                  787 |
|   43 | checkpoints  |    6 |                  786 |
|   44 | network      |    4 |                  783 |
|   45 | question     |   15 |                  662 |
|   46 | history      |   17 |                  647 |
|   47 | queued       |    9 |                  614 |
|   48 | edit         |    9 |                  606 |
|   49 | skills       |   10 |                  602 |
|   50 | transfer     |    8 |                  594 |
|   51 | auto         |    7 |                  567 |
|   52 | elicitation  |   10 |                  563 |
|   53 | step         |    1 |                  538 |
|   54 | board        |    9 |                  503 |
|   55 | check        |    2 |                  496 |
|   56 | contributor  |    5 |                  483 |
|   57 | open         |   12 |                  481 |
|   58 | diff         |    7 |                  436 |
|   59 | text         |    6 |                  434 |
|   60 | share        |    7 |                  415 |
|   61 | pack         |    4 |                  398 |
|   62 | announce     |    9 |                  380 |
|   63 | turn         |    5 |                  366 |
|   64 | user         |    6 |                  362 |
|   65 | cli          |    4 |                  361 |
|   66 | policy       |    2 |                  356 |
|   67 | composer     |    5 |                  324 |
|   68 | manual       |    6 |                  313 |
|   69 | notify       |    6 |                  309 |
|   70 | image        |    5 |                  301 |
|   71 | plans        |    6 |                  296 |
|   72 | checks       |    1 |                  291 |
|   73 | prompt       |    3 |                  271 |
|   74 | stop         |    7 |                  271 |
|   75 | background   |    5 |                  263 |
|   76 | code         |    3 |                  257 |
|   77 | rules        |    3 |                  257 |
|   78 | verify       |    4 |                  257 |
|   79 | host         |    5 |                  250 |
|   80 | nothing      |    4 |                  250 |
|   81 | revert       |    2 |                  249 |
|   82 | secret       |    4 |                  248 |
|   83 | redo         |    5 |                  247 |
|   84 | output       |    3 |                  241 |
|   85 | unsupported  |    2 |                  235 |
|   86 | attachment   |    4 |                  234 |
|   87 | rename       |    4 |                  226 |
|   88 | context      |    5 |                  225 |
|   89 | insert       |    3 |                  214 |
|   90 | group        |    8 |                  209 |
|   91 | move         |    3 |                  205 |
|   92 | setup        |    3 |                  203 |
|   93 | backend      |    4 |                  200 |
|   94 | compaction   |    4 |                  200 |
|   95 | view         |    2 |                  200 |
|   96 | no           |    3 |                  199 |
|   97 | side         |    4 |                  199 |
|   98 | effort       |    3 |                  192 |
|   99 | send         |    3 |                  190 |
|  100 | device       |    4 |                  189 |
|  101 | loop         |    3 |                  189 |
|  102 | reference    |    5 |                  189 |
|  103 | link         |    2 |                  187 |
|  104 | todo         |    4 |                  187 |
|  105 | tasks        |    4 |                  182 |
|  106 | remove       |    4 |                  176 |
|  107 | plugin       |    2 |                  168 |
|  108 | agents       |    4 |                  167 |
|  109 | new          |    3 |                  167 |
|  110 | api          |    3 |                  164 |
|  111 | continue     |    3 |                  162 |
|  112 | extension    |    1 |                  158 |
|  113 | then         |    4 |                  154 |
|  114 | unsaved      |    1 |                  154 |
|  115 | imported     |    2 |                  148 |
|  116 | editor       |    3 |                  147 |
|  117 | child        |    1 |                  145 |
|  118 | fork         |    3 |                  141 |
|  119 | crash        |    3 |                  139 |
|  120 | steer        |    1 |                  138 |
|  121 | resume       |    3 |                  134 |
|  122 | older        |    1 |                  131 |
|  123 | snapshot     |    1 |                  129 |
|  124 | shell        |    2 |                  127 |
|  125 | status       |    1 |                  121 |
|  126 | modes        |    4 |                  114 |
|  127 | mention      |    3 |                  113 |
|  128 | row          |    4 |                  109 |
|  129 | trust        |    1 |                  108 |
|  130 | notice       |    2 |                  106 |
|  131 | restarted    |    1 |                  106 |
|  132 | binary       |    1 |                  104 |
|  133 | conversation |    1 |                  103 |
|  134 | message      |    3 |                  100 |
|  135 | decision     |    1 |                   99 |
|  136 | reply        |    2 |                   99 |
|  137 | workflows    |    2 |                   99 |
|  138 | manage       |    2 |                   95 |
|  139 | skill        |    1 |                   94 |
|  140 | terminal     |    1 |                   91 |
|  141 | documents    |    1 |                   85 |
|  142 | media        |    1 |                   85 |
|  143 | compact      |    2 |                   84 |
|  144 | not          |    2 |                   84 |
|  145 | pdf          |    2 |                   83 |
|  146 | cost         |    2 |                   82 |
|  147 | repo         |    1 |                   80 |
|  148 | attach       |    3 |                   77 |
|  149 | jump         |    2 |                   77 |
|  150 | removed      |    1 |                   77 |
|  151 | allow        |    2 |                   76 |
|  152 | thinking     |    3 |                   76 |
|  153 | toggle       |    3 |                   74 |
|  154 | action       |    1 |                   71 |
|  155 | added        |    1 |                   71 |
|  156 | slash        |    1 |                   70 |
|  157 | sessions     |    1 |                   68 |
|  158 | empty        |    1 |                   66 |
|  159 | invalid      |    1 |                   66 |
|  160 | budget       |    1 |                   65 |
|  161 | unread       |    2 |                   62 |
|  162 | clear        |    2 |                   60 |
|  163 | thought      |    2 |                   60 |
|  164 | focus        |    2 |                   57 |
|  165 | clarify      |    1 |                   55 |
|  166 | quote        |    2 |                   53 |
|  167 | task         |    1 |                   52 |
|  168 | document     |    1 |                   51 |
|  169 | implement    |    1 |                   51 |
|  170 | connecting   |    1 |                   50 |
|  171 | answer       |    1 |                   49 |
|  172 | forked       |    1 |                   48 |
|  173 | restart      |    2 |                   48 |
|  174 | copy         |    2 |                   47 |
|  175 | signed       |    1 |                   45 |
|  176 | show         |    2 |                   44 |
|  177 | upload       |    1 |                   43 |
|  178 | checkpoint   |    1 |                   42 |
|  179 | ctrl         |    1 |                   38 |
|  180 | surface      |    1 |                   38 |
|  181 | named        |    1 |                   37 |
|  182 | process      |    1 |                   36 |
|  183 | click        |    1 |                   33 |
|  184 | comment      |    1 |                   33 |
|  185 | untitled     |    1 |                   33 |
|  186 | attachments  |    1 |                   32 |
|  187 | transcript   |    1 |                   32 |
|  188 | ask          |    1 |                   31 |
|  189 | run          |    1 |                   31 |
|  190 | switch       |    1 |                   31 |
|  191 | citations    |    1 |                   28 |
|  192 | loading      |    1 |                   28 |
|  193 | retry        |    1 |                   27 |
|  194 | add          |    1 |                   26 |
|  195 | commands     |    1 |                   26 |
|  196 | banner       |    1 |                   25 |
|  197 | resumed      |    1 |                   25 |
|  198 | menu         |    1 |                   23 |
|  199 | logout       |    1 |                   22 |
|  200 | save         |    1 |                   22 |
|  201 | working      |    1 |                   22 |
|  202 | copied       |    1 |                   21 |
|  203 | modified     |    1 |                   21 |
|  204 | apply        |    1 |                   19 |
|  205 | duration     |    1 |                   19 |
|  206 | reject       |    1 |                   17 |
|  207 | line         |    1 |                   16 |
|  208 | out          |    1 |                   16 |
|  209 | in           |    1 |                   14 |

## Prototype plan and first measurement

1. Move the conversation implementation, attachment/send/replay logic, session
   import and conversation-only rendering behind `conversationLoader`. Thin
   registrations and the synchronous first-surface factory retain ordering.
   Backend restart handling stays eager; a failed factory load refuses and
   retries. The factory installs the caller's language. Move its 20 model-text
   keys into `CONVERSATION_MODEL_TEXT`, guarded for conversation and Model API.
   Activation: **635,331 → 469,825 bytes** (165,506 saved); conversation:
   **234,288 bytes**, new measured-plus-15%-rounded cap 275 KiB. Later safe-error
   recognition changes these measurements slightly; the final table is below.
   User effect: one local parse/load on first chat use. A visible/restored chat
   still needs it immediately; no wall-clock activation speedup is claimed.
2. Generate English fallback regions from the canonical table; preserve the
   complete enumerable table and lazy getters when cloning installed state.
   Never copy or change translations. Browser/integration fallback stays inline.
   Measure core/runtime/hooks/surfaces independently; preserve original 125-KiB
   core cap. Full-table validation/serialization necessarily reads all regions.
3. Share the already-built recorder with the ACP runtime to remove its journal
   duplication, without delaying recording past session initialization. Put
   unshipped changelog additions under Unreleased and retain released bytes.

Alternative command deferrals, ranked after the controller: skills/import/MCP
and hooks pickers (`cliFeatures` 4,241; `museConfigCommands` 6,871 plus their
exclusive command modules), worktree UI (3,140 command bytes plus adapter),
memory/plan pickers, and the diagnostics command's support renderer (3,476).
These are first-invocation imports with local first-use latency and low API
risk, but their overlapping dependencies make sums optimistic. The prototype
already exceeds the requested activation savings, so it avoids these extra
boundaries. Keep Tab's lightweight provider/status registration eager: a default
on feature must answer Invoke and show its paid posture immediately. Its engine
already loads on first request/menu. Do not move auth, policy, recorder admission,
checkpoint fences or IDE tool definitions out of their required startup path.

## Verification in progress

- Kubuntu focused merge tests: paidFeatures/paidHost/protocol, **197 passed**.
- Conversation loader/controller tests: **2 files passed**; initial
  deferred test correctly exposed its old sessionBoard import assertion. It now
  checks the board remains deferred through conversation instead of activation.
- Deferred/exportConversation/sessionTransfer: **49 passed**, including every
  existing split drill and the added conversation drill. The drill plants the
  conversation controller into activation's output inputs, sees split exit 1,
  restores the metafile bytes and verifies SHA-256 equality and green exit 0.
- MSP cross-bundle logging regression: intentionally remove the SDK prototype
  from its real error; old failureForLog returns only MspError, **1 test fails**.
  Correction recognizes the SDK's pinned name/kind/code across bundles; CLI
  message/account/path text stays out of logs. SDK shape read from the pinned
  dependency, no new wire parsing or model capture.
- Full quality is expressly prohibited by the shared lane rules; focused checks
  and static gates do not claim full release/platform certification.

Merge correction: M94 revived three translations deleted by main/M91 (`sandboxOffProfileNotice`, `agentImportDetail`, `agentImportSourceAll`). The localization gate caught 42 extra keys and German loading refused the table in three Model API tests. Remove those stale keys from all 14 tables, retaining every current feature key. The next run verifies localization and German behavior.

Step 1 certified on Kubuntu: full five-project typecheck exit 0; localization
0 problems; host API inventory 0 problems. Final focused runs:
logText/conversationController/deferredBundles **581 passed**;
modelApiHost/chatReference/sessionImport **620 passed**;
exportConversation/sessionTransfer/deferredBundles **49 passed**;
reportProblemRows and conversationBundle passed in the preceding runs.
Existing size failures for core English and ACP remain for steps 2/3; no cap
was raised to certify this preview piece. No whole-repository quality claim.

## English prototype (step 2)

| Artifact                 |  Before |   After |                                    Change |
| ------------------------ | ------: | ------: | ----------------------------------------: |
| `dist/extension.js`      | 469,981 | 470,082 | +101 (descriptor-preserving locale state) |
| `dist/uiText.js`         | 134,771 | 116,791 |                                   −17,980 |
| `dist/uiTextRuntime.js`  |       — |   8,338 |      new; ACP/headless usage and refusals |
| `dist/uiTextHooks.js`    |       — |  12,176 |     new; hooks, paid hook text and import |
| `dist/uiTextSurfaces.js` |       — |   5,893 |           new; Tab, report and What's New |

Core headroom is **11,209 bytes** under the original 128,000-byte cap. Total
English artifacts are **143,198 bytes**, so splitting adds wrapper/accessor/key
metadata overhead while keeping the core under its cap. Full translation
validation and full-table webview serialization load all regions. Regions align
with uses rather than strict one-bundle ownership: Tab status can read its
region immediately. Existing loadUiTable supports whole tables, not regions;
build generation plus descriptor-preserving state adds lazy English access
without changing translation files or the loader's complete-shape validation.
Future `/legal` and judge string keys should be assigned to the corresponding
optional-surface region when their owning lanes define them, under its existing
25-KiB cap, rather than silently spending the core's headroom.

Drills: deliberately restore eager spread, corrupt one generated English value
and disable table installation. All **three new functional tests fail**. Restore
both changed sources byte-exact and verify their SHA-256 hashes. Three direct
regional imports planted into activation metadata each make the split gate exit
1; each metafile is restored byte-exact, hashed and checked green. Metadata
mutations now live in the one existing deferred suite; English behavior tests
build isolated temporary artifacts, preventing their initial shared-dist race.
Kubuntu final regional/l10n/deferred run: **49 passed** (3 files). The preceding
29-test behavior/locale run passed; an intermediate two-suite metadata race was
caught and corrected, not accepted as a product result.

## ACP prototype (step 3)

ACP now loads the existing recorder before serving or reading a report. Its
journal retains the same constructor and policy; no session connects before
startup finishes. Both ACP packages and CI membership checks carry recorder.js,
and its metafile participates in the ACP notices. No new localized/wire text.
ACP **875,453 → 860,293 bytes** (15,160 saved), below unchanged 870,400-byte cap.
Activation **470,105 bytes** (+23: load conversation before allocating a tasks
panel so a missing bundle can retry without allocating a stale panel).
Conversation **221,188 bytes**, tightened new cap **250 KiB**.

Kubuntu: recorder/reportCommand/deferredBundles **54 passed**; the actual staged
production ACP package passes the fake stdio end-to-end file, **9 passed**. Both
new ACP guard drills reject an embedded journal or missing recorder import,
restore original metafile bytes with matching SHA-256, then pass again.

Full production build currently rejects the merged webview startup at
**933,277 bytes / 921,600 cap**; compilation and every other bundle size pass.
The source of this separate merge overage is under investigation; no cap raised.

## Webview recovery (step 4)

Merged startup was **933,277 / 921,600 bytes**. The review pane read one key
from the full review model-text block, carrying all backend instructions. Move
only that unchanged template to REVIEW_COMMENT_MODEL_TEXT; guard its sole
webview reader and reject the full backend block there. Report and ShareView
use ESM first-open chunks with the existing loading/cancellation affordance.
ShareView's exclusive Markdown export renderer also moves. Browser source uses
equivalent UTF-8 rather than ASCII escapes; no English text or key changes.

Report focus needs the original opener before the loading modal takes focus.
The new cold-load/unmount test **fails** without the wrapper's opener snapshot,
then passes with it. ShareView's existing synchronous test first exposes its
new boundary; await its real dialog, retaining all tab-order, Copy, Escape and
focus-return assertions. Kubuntu App/reviewUi/reportProblemDialog: **180 passed**.

The first measured candidate left startup at 902.0 KiB. Moving ShareView and
emitting UTF-8 recovered startup but exceeded the optional 50-KiB cap; retaining
Handoff and SecretPrompt eagerly fits both unchanged caps. This is a prototype
measurement record, not a gate exception. Final bytes are recorded below.

Further drills: change the conversation factory guard to accept strings instead
of functions. All **five new loader tests fail**, including cold loading, cache
reuse, malformed exports and retry. Restore the source byte-exact with matching
SHA-256. The regional plugin's POSIX-only path filter fails the new Windows-path
selection test; accept both separators and all four regional tests pass. This
checks path matching, not a native Windows build. Final region/l10n/VSIX-stage
unit run: **46 passed**. Webview split/model-text drills plus existing deferred
behavior and English tests: **33 passed**; both new surfaces and both directions
of model-text ownership reject deliberate placement, restore bytes and pass.
