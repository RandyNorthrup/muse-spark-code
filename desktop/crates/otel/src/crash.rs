//! Rust panic records for the crash ring (M111 lane OB, D91.22).
//!
//! [`install_panic_hook`] chains the process panic hook: a panic still
//! prints as before, and one structured record lands in the ring's own
//! day file (`crashes-YYYY-MM-DD.jsonl`), in the exact line shape
//! `parseCrashLine` (`src/core/o11y/crash.ts`) reads back.
//!
//! The record carries shape only: the component, the `panic` kind and
//! code, the time, and the panic's file, line and column. The panic
//! payload is deliberately never read: it may hold secrets, and a
//! sentence is not a code. The file path passes the same rule the
//! store's writer enforces (relative, no escapes, bounded); a path
//! outside it writes a record with no frames rather than a dropped
//! record. A failed write says so on standard error and never panics.

use std::error::Error;
use std::fmt;
use std::fs::OpenOptions;
use std::io::Write;
use std::panic::{take_hook, PanicHookInfo};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;

use super::COMPONENTS;

/// The crash kind for a Rust panic, one of `O11Y_CRASH_KINDS`.
pub const CRASH_KIND_PANIC: &str = "panic";

/// The crash code for a Rust panic: the error class, never the payload.
pub const CRASH_CODE_PANIC: &str = "panic";

/// A frame path's bound, mirroring `REPORT_FRAME_PATH_MAX_CHARS`.
const FRAME_PATH_MAX_CHARS: usize = 260;

/// Milliseconds in a day, for the day-file stamp.
const MILLIS_PER_DAY: u64 = 86_400_000;

/// Why [`install_panic_hook`] refused, in fixed words.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CrashError {
    /// The component is outside [`COMPONENTS`][super::COMPONENTS].
    UnknownComponent,
    /// The ring directory does not exist or is not a directory.
    BadRingDir,
}

impl fmt::Display for CrashError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::UnknownComponent => write!(f, "crash component is unknown"),
            Self::BadRingDir => write!(f, "crash ring directory is missing"),
        }
    }
}

impl Error for CrashError {}

#[derive(Debug, Serialize)]
struct CrashFrame {
    path: String,
    line: u32,
    column: u32,
}

#[derive(Debug, Serialize)]
struct CrashRecord {
    v: u8,
    at: u64,
    component: &'static str,
    kind: &'static str,
    code: &'static str,
    frames: Vec<CrashFrame>,
}

/// A frame path the store may hold, mirroring `scrubFramePath`
/// (`src/core/o11y/crash.ts`): relative, bounded, with no empty, dot or
/// dot-dot segments, no backslashes, no drive root and no URI scheme.
fn frame_path_ok(path: &str) -> bool {
    if path.is_empty() || path.chars().count() > FRAME_PATH_MAX_CHARS {
        return false;
    }
    if path.contains('\\') || path.starts_with('/') {
        return false;
    }
    if has_drive_root(path) || has_uri_scheme(path) {
        return false;
    }
    !path
        .split('/')
        .any(|segment| segment.is_empty() || segment == "." || segment == "..")
}

fn has_drive_root(path: &str) -> bool {
    let bytes = path.as_bytes();
    bytes.len() >= 3 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':' && bytes[2] == b'/'
}

fn has_uri_scheme(path: &str) -> bool {
    let Some(colon) = path.find(':') else {
        return false;
    };
    let (scheme, _) = path.split_at(colon);
    let mut chars = scheme.chars();
    chars
        .next()
        .is_some_and(|first| first.is_ascii_alphabetic())
        && chars.all(|char| char.is_ascii_alphanumeric() || "+.-".contains(char))
}

/// The UTC `YYYY-MM-DD` stamp for whole days since the epoch (Howard
/// Hinnant's days-to-civil conversion).
fn day_stamp(at_ms: u64) -> String {
    let days = i64::try_from(at_ms / MILLIS_PER_DAY).unwrap_or(i64::MAX);
    let shifted = days + 719_468;
    let era = shifted.div_euclid(146_097);
    let day_of_era = shifted.rem_euclid(146_097);
    let year_of_era =
        (day_of_era - day_of_era / 1460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let year = year_of_era + era * 400;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let month_part = (5 * day_of_year + 2) / 153;
    let day = u32::try_from(day_of_year - (153 * month_part + 2) / 5 + 1).unwrap_or_default();
    let month = u32::try_from(if month_part < 10 {
        month_part + 3
    } else {
        month_part - 9
    })
    .unwrap_or_default();
    let year = if month <= 2 { year + 1 } else { year };
    format!("{year:04}-{month:02}-{day:02}")
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|span| span.as_millis().try_into().unwrap_or(u64::MAX))
        .unwrap_or_default()
}

fn record_for(component: &'static str, info: &PanicHookInfo<'_>) -> (String, u64) {
    let at = now_ms();
    let frames = info
        .location()
        .filter(|location| frame_path_ok(location.file()))
        .map(|location| {
            vec![CrashFrame {
                path: location.file().to_owned(),
                line: location.line(),
                column: location.column(),
            }]
        })
        .unwrap_or_default();
    let record = CrashRecord {
        v: 1,
        at,
        component,
        kind: CRASH_KIND_PANIC,
        code: CRASH_CODE_PANIC,
        frames,
    };
    let mut line = serde_json::to_string(&record).unwrap_or_else(|_| String::new());
    line.push('\n');
    (line, at)
}

fn append_line(ring_dir: &Path, at: u64, line: &str) -> std::io::Result<()> {
    let name = format!("crashes-{}.jsonl", day_stamp(at));
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(ring_dir.join(name))?;
    // One write call: short appends land atomically, and a torn line reads
    // absent on the store's side rather than corrupting its neighbours.
    file.write_all(line.as_bytes())
}

/// Chain the process panic hook so a panic writes one structured crash
/// record to the ring directory's day file, then prints as before.
///
/// The write is best effort and never panics: a failure says so on
/// standard error. Replaces any hook set before; the replaced hook
/// still runs, after the record lands.
///
/// # Errors
///
/// [`CrashError::UnknownComponent`] when the component is outside the
/// telemetry vocabulary, [`CrashError::BadRingDir`] when the ring
/// directory does not exist.
pub fn install_panic_hook(ring_dir: &Path, component: &'static str) -> Result<(), CrashError> {
    if !COMPONENTS.contains(&component) {
        return Err(CrashError::UnknownComponent);
    }
    if !ring_dir.is_dir() {
        return Err(CrashError::BadRingDir);
    }
    let dir: PathBuf = ring_dir.to_owned();
    let previous = take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let (line, at) = record_for(component, info);
        if let Err(error) = append_line(&dir, at, &line) {
            eprintln!("muse-spark-otel: crash record unwritten: {error}");
        }
        previous(info);
    }));
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{day_stamp, frame_path_ok, install_panic_hook, CrashError};
    use std::panic::{catch_unwind, take_hook};
    use std::sync::{Mutex, MutexGuard};

    // The panic hook is process-global: hook tests hold this from install
    // to restore, so parallel threads never interleave take and set.
    static HOOK_LOCK: Mutex<()> = Mutex::new(());

    fn hook_guard() -> MutexGuard<'static, ()> {
        HOOK_LOCK.lock().expect("the hook lock")
    }

    #[test]
    fn day_stamps_match_the_civil_calendar() {
        // Oracles from `date -u -d @<s> +%F` on the rig.
        assert_eq!(day_stamp(0), "1970-01-01");
        assert_eq!(day_stamp(1_793_475_296_000), "2026-10-31");
        assert_eq!(day_stamp(1_709_190_000_000), "2024-02-29");
        assert_eq!(day_stamp(1_735_689_599_999), "2024-12-31");
        assert_eq!(day_stamp(1_735_689_600_000), "2025-01-01");
    }

    #[test]
    fn frame_paths_follow_the_store_rule() {
        assert!(frame_path_ok("src/main.rs"));
        assert!(frame_path_ok("crates/shell/src/main.rs"));
        assert!(!frame_path_ok(""));
        assert!(!frame_path_ok("/home/shell/src/main.rs"));
        assert!(!frame_path_ok("C:/src/main.rs"));
        assert!(!frame_path_ok("file:///src/main.rs"));
        assert!(!frame_path_ok("src\\main.rs"));
        assert!(!frame_path_ok("src/../main.rs"));
        assert!(!frame_path_ok("src/./main.rs"));
        assert!(!frame_path_ok("src//main.rs"));
        assert!(!frame_path_ok(&"a".repeat(261)));
    }

    #[test]
    fn install_names_its_refusals() {
        let missing = std::path::Path::new("definitely-not-a-ring-dir");
        assert_eq!(
            install_panic_hook(missing, "toaster").expect_err("unknown component is refused"),
            CrashError::UnknownComponent
        );
        assert_eq!(
            install_panic_hook(missing, "shell").expect_err("a missing ring dir is refused"),
            CrashError::BadRingDir
        );
        // A scratch dir, never the repo: a later failure's panic must not
        // leave a record beside the source.
        let dir = tempfile::tempdir().expect("a scratch ring dir");
        let _held = hook_guard();
        let previous = take_hook();
        assert!(install_panic_hook(dir.path(), "shell").is_ok());
        std::panic::set_hook(previous);
    }

    #[test]
    fn a_caught_panic_writes_one_record() {
        let dir = tempfile::tempdir().expect("a scratch ring dir");
        let _held = hook_guard();
        let previous = take_hook();
        install_panic_hook(dir.path(), "shell").expect("the hook installs");
        let outcome = catch_unwind(|| panic!("boom"));
        assert!(outcome.is_err());
        std::panic::set_hook(previous);
        // The day file's name comes from the same stamp the hook used; read
        // the directory so a midnight run cannot flake.
        let mut files: Vec<_> = std::fs::read_dir(dir.path())
            .expect("the ring dir reads")
            .map(|entry| entry.expect("an entry").file_name())
            .collect();
        assert_eq!(files.len(), 1);
        let name = files.pop().expect("one day file");
        assert!(name.to_string_lossy().starts_with("crashes-"));
        let text = std::fs::read_to_string(dir.path().join(name)).expect("the day file reads");
        let lines: Vec<&str> = text.lines().collect();
        assert_eq!(lines.len(), 1);
        let record: serde_json::Value =
            serde_json::from_str(lines[0]).expect("the line is one JSON record");
        assert_eq!(record["v"], 1);
        assert_eq!(record["component"], "shell");
        assert_eq!(record["kind"], "panic");
        // The payload is never read: a sentence is not a code.
        assert_eq!(record["code"], "panic");
        let path = record["frames"][0]["path"]
            .as_str()
            .expect("the frame names its file");
        assert!(path.ends_with("crash.rs"), "unexpected frame path {path}");
        assert!(record["frames"][0]["line"].as_u64().unwrap_or_default() >= 1);
    }
}
