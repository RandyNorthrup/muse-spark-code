# Muse Desktop: the Settings app's system pages (M111 lane ST1)

The Settings app's system pages are Muse Desktop's system settings:
Appearance, Displays, Sound, Network, Bluetooth, Cellular, Power and
sleep, Printers, Storage, Date and time, and Language and region. One
page per area, a list on the left, the page on the right; every page
reads its values from the system service (`muse-sysd`) and every
system change asks you first — nothing applies without your
confirmation. Bluetooth pairing checks its passkey before it pairs.

## Build it (development)

```sh
npm run build:desktop
```

That produces `dist/desktop/settings.js`,
`dist/desktop/settings.css` and the `settings.html` page beside
the workbench build. Until lane SY's transport lands, the app says
plainly that the system service is unavailable; the pages mount
once SY hands the shell a client. The pages follow the approved
mockups (`docs/design/m111-mockups/`) and speak the same fifteen
languages as the panel, from the desktop string chunk.

## Keys

| Keys          | Does                          |
| ------------- | ----------------------------- |
| Up / Down     | Move through the page list    |
| Home / End    | First / last page             |
| Enter / Space | Open the focused page         |
| Escape        | Close the confirmation dialog |

## What is not here yet

The desktop's main process does not open the settings app yet —
that wiring is lane ST2's with the app's chrome and the remaining
pages. The system service and its transport are lane SY's; the
installable desktop arrives with M111i.
