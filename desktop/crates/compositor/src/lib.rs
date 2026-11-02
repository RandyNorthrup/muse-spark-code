//! The `CompositorPort` and its Hyprland adapter (M111 lane CP, D91.3).
//!
//! [`port::CompositorPort`] is the trait every desktop caller programs
//! against; [`hyprland::HyprlandAdapter`] speaks Hyprland's two sockets
//! (`wiki.hypr.land/ipc`, verified against 0.55.2 and 0.57.0): hyprctl-like
//! requests on `.socket.sock`, `EVENT>>DATA` lines on `.socket2.sock`.
//! Nothing above this crate names Hyprland.

pub mod hyprland;
pub mod port;
