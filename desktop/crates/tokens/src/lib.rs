//! Muse Desktop theme constants and appearance resolution (M111 lane TH).
//!
//! [`palette`] holds the generated constants: every design token resolved
//! per mode from M114's single source by `scripts/build-tokens-desktop.mjs`.
//! Colours are `0xAARRGGBB`. [`appearance`] resolves the effective
//! [`appearance::ThemeMode`] from the portal's appearance values and the
//! `desktop.json` override.

pub mod appearance;
pub mod palette;
