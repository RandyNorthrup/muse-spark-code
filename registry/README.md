# ACP Registry submission (M63c)

`muse-spark-code/` is this product's entry for the ACP Registry
(`github.com/agentclientprotocol/registry`), laid out exactly as that
repository takes it: `agent.json` plus the required 16x16 monochrome
`icon.svg`. It refreshes the owner's open submission, PR #661
(`RandyNorthrup/registry` branch `add-muse-spark-code`), to 0.19.0; the
name, description, website and icon are that pull request's own. The
agent is distributed through npm (`muse-spark-code-acp@0.19.0`, no
arguments: the command serves ACP on stdio by default), and its
`initialize` answers the registry checker's terminal-auth announcement
with `type: "terminal"` methods, which is what the registry's
authentication check requires.

To submit the refresh: push these two files to PR #661's branch. Their
CI validates `agent.json` against their schema, checks the npm package
exists, verifies the icon, and runs the authentication check against the
published package.

When the product version moves, this entry's `version` and the `npx`
package pin move with it in the same release; the registry entry is
re-submitted (a version-bump push to the submission branch) after the
npm package publishes.
