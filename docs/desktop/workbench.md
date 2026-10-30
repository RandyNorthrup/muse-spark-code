# Muse Desktop: the workbench (M111 lane WB)

The workbench is Muse Desktop's Electron app: one window per folder you
work in. Chat sits on the left, the editor group in the centre with the
terminal panel below it and the tabbed footer (Terminal, Problems,
Output) at the same width, and the icon rail and sidebar on the right.
The status bar spans the whole desktop and belongs to the shell; the
workbench publishes its items (workspace, terminals) to it.

## Run it (development)

```sh
npm run build:desktop
npx electron dist/desktop/main.mjs --workspace /path/to/folder
```

Without `--workspace`, the first-boot setup asks you to pick a folder.
`npm run package:desktop` assembles a runnable app folder under
`dist/desktop-app/` with the Electron fuses flipped; signing and the
installer arrive with M111i.

## Keys

| Keys            | Does                                  |
| --------------- | ------------------------------------- |
| Ctrl+P          | Quick open                            |
| Ctrl+B          | Toggle the sidebar                    |
| Ctrl+Shift+B    | Toggle the rail                       |
| Ctrl+`          | Toggle the terminal panel             |
| Ctrl+Shift+`    | New terminal                          |
| Ctrl+S          | Save the open file                    |
| Ctrl+W          | Close the open file                   |
| Ctrl+PageDown   | Next file                             |
| Ctrl+PageUp     | Previous file                         |
| Ctrl+1 … Ctrl+4 | Focus chat, editor, terminal, sidebar |

Your layout — pane widths, what is open, where the terminal sits — is
remembered per folder (and per desktop workspace on Muse Desktop) and
comes back when you return. The terminal panel docks under the editors,
collapses into the footer, floats when detached, or hides while its
sessions keep running.

## What is not here yet

The editor group (ED), the sidebar's sections (SB1), the full terminal
surface (BP), settings (ST1/ST2) and onboarding (ON) are their own M111
lanes and mount inside this shell. The shell's bar, launcher and lock
screen are lanes SH1/SH2/SS.
