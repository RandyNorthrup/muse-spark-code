# TRUSTROOT — Windows trusted paths against a trusted root (2026-10-09)

Lane: Windows-native fix lane, branch `rel017/ciwin`, Windows 11 host.
Decision: PLAN.md D104. Owner rule: 2026-10-08, "Windows paths: any drive".

## Change

`src/runtime/windowsTrustedPath.ts` verified every component up to the drive
root (OpenSSH `safe_path`) and refused any reparse point anywhere in the
path. A Windows profile that is a junction, or redirected to another drive,
was therefore refused by native schedules and helpers.

`TrustedPathVerifier.verify(path, { leafKind, root })` now verifies against
the caller's trusted root (omitted: the file's own folder, or the folder
itself):

| Where          | Links and junctions                                | Owner and ACL check |
| -------------- | -------------------------------------------------- | ------------------- |
| Above the root | Accepted                                           | None (OS only)      |
| The root       | Accepted; trusted by resolved identity (dev + ino) | Resolved root       |
| Below the root | Refused at the first such component, even inside   | Every component     |

The resolved leaf must be the resolved root's own descendant by identity, so
a link that slips past the component check is still refused ("outside its
trusted root"). Paths are compared by `path.win32.relative`, so drive-letter
case does not matter; nothing compares string prefixes.

## Tests (`test/unit/windowsTrustedPath.test.ts`, real NTFS junctions)

| Case                                                         | Result                                         |
| ------------------------------------------------------------ | ---------------------------------------------- |
| Profile folder a junction above the root                     | Accepted; resolved path returned               |
| The root itself a junction to an owner-only folder elsewhere | Accepted, with and without an explicit root    |
| Junction below the root escaping the tree                    | Refused at that junction                       |
| Junction below the root staying inside the tree              | Refused at that junction (policy kept)         |
| Leaf outside the named root                                  | Refused, "outside its trusted root"            |
| Lower-case drive letter on the leaf, upper-case on the root  | Accepted                                       |
| ACL refused at the root / below it                           | Refused there; root first, one query per level |
| Faked reparse metadata on the leaf                           | Refused at the leaf                            |

Another volume is not created in the suite; the root junction case covers
identity across a redirection, and identity is the volume serial plus file
id, so a junction to another drive takes the same path.

## Red drills (each restored byte-for-byte; `git diff` clean after)

| Drill                                               | Result                                                                                      |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Refuse a link at or above the root (the old policy) | "accepts junctions at and above the trusted root …" fails                                   |
| Drop the below-root link refusal                    | Both trusted-root cases fail; the escaping junction is still refused, by the identity check |

## Runs (Windows host)

windowsTrustedPath 24/24; nativeScheduleBackground, spawnBoundaries,
scheduleFs, windowsVaultNative, spawnProfiles, scheduleRuntime,
mediaConvert and spawnGovernance pass; host and unit typechecks pass.
