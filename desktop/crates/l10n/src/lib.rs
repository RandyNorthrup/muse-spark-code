//! Muse Desktop (M111, D91.20) lane IN: the fifteen UI tables for native
//! Rust, read through [`ui_text!`], with ICU4X locale formatting.
//!
//! The tables come from the same English source and fourteen translated
//! tables the extension reads (`npm run desktop:l10n` generates
//! `tables.rs`; `check:l10n` fails a stale file). Lookup falls back from
//! the current locale to English, then echoes the key itself, so a missing
//! key shows as its own dotted path, never as an empty string.
//!
//! Dates and numbers format through ICU4X from the same locale id, so a
//! date reads the same in the bar and the app. Measurement units stay with
//! the caller (a table pattern around [`format_number`]): ICU4X 2.4 leaves
//! units, currencies and compact notation explicitly unimplemented
//! (icu_decimal's crate docs, "planned", icu4x#275).

mod tables;

use std::error::Error;
use std::fmt::{Display, Formatter};
use std::sync::RwLock;

use fixed_decimal::{Decimal, FloatPrecision};
use icu_calendar::Date;
use icu_datetime::DateTimeFormatter;
use icu_datetime::fieldsets::YMD;
use icu_decimal::DecimalFormatter;
use icu_locale::Locale;
use tables::TABLES;

const ENGLISH_LOCALE: &str = "en";

static LOCALE: RwLock<&'static str> = RwLock::new(ENGLISH_LOCALE);

/// A locale id [`set_locale`] does not know: one of the fifteen tables.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UnknownLocale(pub String);

impl Display for UnknownLocale {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        write!(formatter, "unknown desktop locale: {}", self.0)
    }
}

impl Error for UnknownLocale {}

/// What [`format_date`] and [`format_number`] report: the locale id, the
/// value, and ICU4X's own reason.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FormatError(pub String);

impl Display for FormatError {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        write!(formatter, "{}", self.0)
    }
}

impl Error for FormatError {}

fn entries_for(locale: &str) -> Option<&'static [(&'static str, &'static str)]> {
    TABLES
        .iter()
        .find(|table| table.locale == locale)
        .map(|table| table.entries)
}

fn lookup(entries: &[(&'static str, &'static str)], key: &str) -> Option<&'static str> {
    entries
        .iter()
        .find(|(candidate, _)| *candidate == key)
        .map(|(_, value)| *value)
}

/// The display locale's id (`en`, `de`, `pt-br`, …).
pub fn locale() -> String {
    (*LOCALE.read().expect("desktop locale lock")).to_owned()
}

/// Shows every later [`text`] in `locale`'s table. Refuses an id none of
/// the fifteen tables carries, naming it, and keeps the previous locale.
pub fn set_locale(locale: &str) -> Result<(), UnknownLocale> {
    if entries_for(locale).is_none() {
        return Err(UnknownLocale(locale.to_owned()));
    }
    *LOCALE.write().expect("desktop locale lock") = TABLES
        .iter()
        .find(|table| table.locale == locale)
        .expect("locale checked above")
        .locale;
    Ok(())
}

/// The template for a dotted key (`agents.stopAll`, `agentsCount.one`):
/// the current locale's, else English's, else the key itself.
pub fn text(key: &str) -> &str {
    let current = *LOCALE.read().expect("desktop locale lock");
    entries_for(current)
        .and_then(|entries| lookup(entries, key))
        .or_else(|| entries_for(ENGLISH_LOCALE).and_then(|entries| lookup(entries, key)))
        .unwrap_or(key)
}

/// Reads the fifteen UI tables like the extension's `UI_TEXT` reads them:
/// `ui_text!("agents.stopAll")` is the current locale's template.
#[macro_export]
macro_rules! ui_text {
    ($key:literal) => {
        $crate::text($key)
    };
}

fn icu_locale(locale: &str) -> Result<Locale, FormatError> {
    locale
        .parse()
        .map_err(|error| FormatError(format!("cannot format for locale {locale}: {error}")))
}

/// A Gregorian calendar date in the locale's medium form (`31 Oct 2026`
/// in English, `31.10.2026` in German): the same locale the app formats.
pub fn format_date(locale: &str, year: i32, month: u8, day: u8) -> Result<String, FormatError> {
    let parsed = icu_locale(locale)?;
    let formatter = DateTimeFormatter::try_new(parsed.into(), YMD::medium())
        .map_err(|error| FormatError(format!("cannot format a date for {locale}: {error}")))?;
    let date = Date::try_new_iso(year, month, day)
        .map_err(|error| FormatError(format!("not a date: {year}-{month}-{day}: {error}")))?;
    Ok(formatter.format(&date).to_string())
}

/// A decimal number with the locale's digits, groupings and decimal
/// separator (`12,345.68` in English, `12.345,68` in German).
pub fn format_number(locale: &str, value: f64) -> Result<String, FormatError> {
    let parsed = icu_locale(locale)?;
    let formatter = DecimalFormatter::try_new(parsed.into(), Default::default())
        .map_err(|error| FormatError(format!("cannot format a number for {locale}: {error}")))?;
    let decimal = Decimal::try_from_f64(value, FloatPrecision::RoundTrip)
        .map_err(|error| FormatError(format!("cannot format {value}: {error}")))?;
    Ok(formatter.format(&decimal).to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    // The locale is one global for the process; the tests take it in turns.
    static SERIAL: Mutex<()> = Mutex::new(());

    fn reset() {
        set_locale(ENGLISH_LOCALE).expect("English always exists");
    }

    #[test]
    fn macro_reads_english_by_default() {
        let _guard = SERIAL.lock().expect("test lock");
        reset();
        assert_eq!(ui_text!("desktop.orSignInWith"), "Or sign in with");
        assert_eq!(
            ui_text!("desktop.notificationsCount.one"),
            "{count} notification"
        );
    }

    #[test]
    fn locale_switches_tables_and_refuses_unknown_ids() {
        let _guard = SERIAL.lock().expect("test lock");
        reset();
        set_locale("de").expect("German exists");
        assert_eq!(locale(), "de");
        assert_eq!(ui_text!("desktop.orSignInWith"), "Oder anmelden mit");
        let refused = set_locale("xx").expect_err("xx is not a table");
        assert_eq!(refused, UnknownLocale("xx".to_owned()));
        assert_eq!(locale(), "de", "a refused locale changes nothing");
        reset();
    }

    #[test]
    fn unknown_keys_echo_the_key() {
        let _guard = SERIAL.lock().expect("test lock");
        reset();
        assert_eq!(ui_text!("desktop.noSuchKey"), "desktop.noSuchKey");
    }

    #[test]
    fn dates_use_the_locales_medium_form() {
        assert_eq!(
            format_date("en", 2026, 10, 31).expect("en formats"),
            "Oct 31, 2026"
        );
        assert_eq!(
            format_date("de", 2026, 10, 31).expect("de formats"),
            "31.10.2026"
        );
        assert_eq!(
            format_date("ja", 2026, 10, 31).expect("ja formats"),
            "2026/10/31"
        );
        let bad = format_date("en", 2026, 13, 1).expect_err("month 13 is not a date");
        assert!(bad.to_string().contains("2026-13-1"), "{bad}");
        // A well-formed but unknown locale falls back to the root, as Intl
        // does; only a structurally invalid id is refused.
        assert_eq!(
            format_date("xx", 2026, 10, 31).expect("xx falls back"),
            "2026 M10 31"
        );
        let locale = format_date("9n valid", 2026, 10, 31).expect_err("not an id");
        assert!(locale.to_string().contains("9n valid"), "{locale}");
    }

    #[test]
    fn numbers_use_the_locales_grouping() {
        assert_eq!(
            format_number("en", 12_345.678).expect("en formats"),
            "12,345.678"
        );
        assert_eq!(
            format_number("de", 12_345.678).expect("de formats"),
            "12.345,678"
        );
        assert_eq!(
            format_number("ja", 12_345.678).expect("ja formats"),
            "12,345.678"
        );
    }
}
