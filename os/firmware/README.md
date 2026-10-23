# Base firmware (M110os OS5)

AMD, Intel and Wi-Fi firmware ship in the base image, not as an
add-on. `firmware.json` names the Debian packages OS1's recipe must
carry; `check-firmware.mjs` resolves each one against
snapshot.debian.org so a rename or a typo breaks CI instead of the
base build:

```sh
node os/firmware/check-firmware.mjs --firmware os/firmware/firmware.json
node os/firmware/check-firmware.mjs --firmware os/firmware/firmware.json --transcript-dir test/fixtures/nodeos-firmware
```

Package versions follow OS1's snapshot date (the recipe pins the whole
archive to one snapshot); this file pins names only, deliberately.
Recorded responses live in `test/fixtures/nodeos-firmware/` with
their capture record.
