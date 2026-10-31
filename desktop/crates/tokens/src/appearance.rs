//! Appearance resolution: the portal's appearance with the override
//! (D91.19). A concrete `desktop.json` appearance value wins; otherwise the
//! portal's colour scheme picks light or dark and its contrast flag picks
//! the high-contrast variant. Mirrors `resolveAppearance` in
//! `scripts/build-tokens-desktop.mjs` and the QML theme's `resolveMode`.

/// The four desktop theme modes.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ThemeMode {
    /// The light Muse palette.
    Light,
    /// The dark Muse palette.
    Dark,
    /// High-contrast light.
    HcLight,
    /// High-contrast dark.
    HcDark,
}

/// The portal's `org.freedesktop.appearance` colour-scheme values
/// (xdg-desktop-portal): no preference.
pub const PORTAL_NO_PREFERENCE: u32 = 0;
/// The portal's `org.freedesktop.appearance` colour-scheme values: prefer dark.
pub const PORTAL_PREFER_DARK: u32 = 1;
/// The portal's colour-scheme values: prefer light.
pub const PORTAL_PREFER_LIGHT: u32 = 2;
/// Our contrast extension's values: normal contrast.
pub const PORTAL_CONTRAST_NORMAL: u32 = 0;
/// Our contrast extension's values: high contrast (served by PT's portal).
pub const PORTAL_CONTRAST_HIGH: u32 = 1;
/// The `desktop.json` appearance value that follows the portal.
pub const OVERRIDE_SYSTEM: &str = "system";

impl ThemeMode {
    /// Parses a `desktop.json` appearance value. `None` means system (or an
    /// unknown string, which also falls back to the portal, never a crash).
    #[must_use]
    pub fn parse(value: &str) -> Option<ThemeMode> {
        match value {
            "light" => Some(ThemeMode::Light),
            "dark" => Some(ThemeMode::Dark),
            "hc-light" => Some(ThemeMode::HcLight),
            "hc-dark" => Some(ThemeMode::HcDark),
            _ => None,
        }
    }

    /// The mode's name, as used in file names and `desktop.json`.
    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            ThemeMode::Light => "light",
            ThemeMode::Dark => "dark",
            ThemeMode::HcLight => "hc-light",
            ThemeMode::HcDark => "hc-dark",
        }
    }
}

/// Resolves the effective mode. `scheme` and `contrast` are the portal's
/// values (`None` when unreadable); `appearance_override` is the
/// `desktop.json` value. Unreadable and unknown inputs fall back to dark,
/// as M114's unthemed root does.
#[must_use]
pub fn resolve(scheme: Option<u32>, contrast: Option<u32>, appearance_override: &str) -> ThemeMode {
    if appearance_override != OVERRIDE_SYSTEM {
        if let Some(mode) = ThemeMode::parse(appearance_override) {
            return mode;
        }
    }
    let light = scheme == Some(PORTAL_PREFER_LIGHT);
    let high = contrast == Some(PORTAL_CONTRAST_HIGH);
    match (light, high) {
        (true, true) => ThemeMode::HcLight,
        (true, false) => ThemeMode::Light,
        (false, true) => ThemeMode::HcDark,
        (false, false) => ThemeMode::Dark,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn concrete_override_wins_over_the_portal() {
        for (override_value, expected) in [
            ("light", ThemeMode::Light),
            ("dark", ThemeMode::Dark),
            ("hc-light", ThemeMode::HcLight),
            ("hc-dark", ThemeMode::HcDark),
        ] {
            assert_eq!(
                resolve(
                    Some(PORTAL_PREFER_LIGHT),
                    Some(PORTAL_CONTRAST_HIGH),
                    override_value
                ),
                expected
            );
            assert_eq!(resolve(None, None, override_value), expected);
        }
    }

    #[test]
    fn portal_scheme_and_contrast_pick_the_mode() {
        let cases = [
            (
                Some(PORTAL_PREFER_LIGHT),
                Some(PORTAL_CONTRAST_NORMAL),
                ThemeMode::Light,
            ),
            (
                Some(PORTAL_PREFER_LIGHT),
                Some(PORTAL_CONTRAST_HIGH),
                ThemeMode::HcLight,
            ),
            (
                Some(PORTAL_PREFER_DARK),
                Some(PORTAL_CONTRAST_HIGH),
                ThemeMode::HcDark,
            ),
            (
                Some(PORTAL_PREFER_DARK),
                Some(PORTAL_CONTRAST_NORMAL),
                ThemeMode::Dark,
            ),
            (
                Some(PORTAL_NO_PREFERENCE),
                Some(PORTAL_CONTRAST_NORMAL),
                ThemeMode::Dark,
            ),
            (
                Some(PORTAL_NO_PREFERENCE),
                Some(PORTAL_CONTRAST_HIGH),
                ThemeMode::HcDark,
            ),
            (None, None, ThemeMode::Dark),
            (None, Some(PORTAL_CONTRAST_HIGH), ThemeMode::HcDark),
            (Some(99), Some(99), ThemeMode::Dark),
        ];
        for (scheme, contrast, expected) in cases {
            assert_eq!(resolve(scheme, contrast, OVERRIDE_SYSTEM), expected);
        }
    }

    #[test]
    fn unknown_override_falls_back_to_the_portal() {
        assert_eq!(
            resolve(
                Some(PORTAL_PREFER_LIGHT),
                Some(PORTAL_CONTRAST_NORMAL),
                "bogus"
            ),
            ThemeMode::Light
        );
        assert_eq!(resolve(None, None, ""), ThemeMode::Dark);
    }

    #[test]
    fn mode_names_round_trip() {
        for mode in [
            ThemeMode::Light,
            ThemeMode::Dark,
            ThemeMode::HcLight,
            ThemeMode::HcDark,
        ] {
            assert_eq!(ThemeMode::parse(mode.as_str()), Some(mode));
        }
        assert_eq!(ThemeMode::parse(OVERRIDE_SYSTEM), None);
    }
}
