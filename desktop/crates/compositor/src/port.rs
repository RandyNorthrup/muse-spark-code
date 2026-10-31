//! The `CompositorPort`: every caller above the compositor speaks here, and
//! nothing above it names Hyprland (M111, D91.3). Desktops are workspaces
//! seen through this port (D91.15); a later compositor replaces the one
//! adapter in [`crate::hyprland`]. Mirrored in TypeScript by
//! `src/shared/desktop/compositor.ts`.

use std::path::PathBuf;

/// Live desktop thumbnails per second. The Qt shell captures at most this
/// often and pauses unless the M107 governor reports normal pressure.
/// Mirrors `DESKTOP_THUMBNAIL_FPS` in `src/shared/constants.ts`; the vitest
/// suite fails if the two drift apart.
pub const THUMBNAIL_FPS: u32 = 10;

/// A desktop: one workspace with its windows, on one monitor (D91.15).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DesktopInfo {
    /// The workspace id. Negative when the compositor did not send one.
    pub id: i32,
    /// The display name: the id, or the agent/session label (see
    /// [`CompositorPort::label_desktop`]).
    pub name: String,
    /// The monitor showing this desktop.
    pub monitor: String,
    /// The monitor's id. Negative when the compositor did not send one.
    pub monitor_id: i32,
    /// How many windows live here.
    pub windows: u32,
    /// Whether a window covers the desktop fullscreen.
    pub fullscreen: bool,
    /// The last active window's address, empty when there is none.
    pub last_window: String,
}

/// One window on a desktop.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WindowInfo {
    /// The compositor's window address (an opaque handle).
    pub address: String,
    /// The application class.
    pub class: String,
    /// The current title.
    pub title: String,
    /// The owning process id. Negative when the compositor did not send one.
    pub pid: i32,
    /// The desktop id. Negative when the compositor did not send one.
    pub desktop_id: i32,
    /// The desktop's display name.
    pub desktop_name: String,
    /// Whether the window floats instead of tiling.
    pub floating: bool,
    /// Whether the window is fullscreen.
    pub fullscreen: bool,
    /// Whether the window shows on every desktop.
    pub pinned: bool,
    /// The monitor showing the window.
    pub monitor: String,
}

/// One output with its mode and position.
#[derive(Debug, Clone, PartialEq)]
pub struct MonitorInfo {
    /// The monitor's id. Negative when the compositor did not send one.
    pub id: i32,
    /// The output name (e.g. `HEADLESS-1`).
    pub name: String,
    /// The human description, empty when the compositor did not send one.
    pub description: String,
    /// The mode width in pixels.
    pub width: i32,
    /// The mode height in pixels.
    pub height: i32,
    /// The refresh rate in hertz.
    pub refresh_rate: f32,
    /// The layout position's x.
    pub x: i32,
    /// The layout position's y.
    pub y: i32,
    /// The scale factor.
    pub scale: f32,
    /// The active desktop's id.
    pub active_desktop: i32,
}

/// A tiling layout the port can pick per desktop (D91.15).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Layout {
    /// Dwindle, the default: windows split and fill as they open.
    Dwindle,
    /// Master: one master window with the rest stacked beside it.
    Master,
    /// Scrolling: columns on a strip.
    Scrolling,
    /// A layout the config registered under this name.
    Custom(String),
}

/// An input device: a keyboard, pointer, tablet or switch.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InputDevice {
    /// The device name.
    pub name: String,
    /// The device kind (`keyboard`, `mouse`, `tablet`, …).
    pub kind: String,
    /// The active keyboard layout, for keyboards.
    pub layout: String,
}

/// Where a headed app opens (D91.15's amendment; `desktop.placement`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Placement {
    /// A new desktop of its own (the default).
    NewDesktop,
    /// The current desktop.
    CurrentDesktop,
    /// Ask where it should go, every time.
    Ask,
}

/// Who owns a desktop: the person, an agent, or a session (D91.15).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DesktopOwner {
    /// The person's own desktop (desktop 1 holds the workbench).
    User,
    /// An agent's desktop, labelled with the agent.
    Agent {
        /// The agent's name.
        name: String,
    },
    /// A session's desktop, labelled with the session.
    Session {
        /// The session's name.
        name: String,
    },
}

impl DesktopOwner {
    /// The pill label: the agent or session name, or `None` for the user.
    #[must_use]
    pub fn label(&self) -> Option<&str> {
        match self {
            DesktopOwner::User => None,
            DesktopOwner::Agent { name } | DesktopOwner::Session { name } => Some(name),
        }
    }
}

/// A workspace bound to a project folder: the app's window on it opens that
/// folder (D91.15). Persisted in `desktop.json` by the settings app; the
/// adapter holds the runtime copy.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DesktopBinding {
    /// The desktop id.
    pub desktop: String,
    /// The project folder.
    pub project: PathBuf,
}

/// A monitor arrangement applied live through the port (D91.15).
#[derive(Debug, Clone, PartialEq)]
pub struct MonitorSpec {
    /// The output name the rule targets.
    pub output: String,
    /// The mode (`1920x1080@60`, `preferred`, …).
    pub mode: String,
    /// The position (`auto`, `0x0`, …).
    pub position: String,
    /// The scale factor.
    pub scale: f32,
}

/// Which window a call targets. The adapter renders these to the
/// compositor's selectors; callers never write selector syntax.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum WindowSelector {
    /// Whatever window is active.
    Active,
    /// The window at this address.
    Address(String),
    /// A window of this class.
    Class(String),
    /// A window with this title.
    Title(String),
}

/// Fullscreen modes for [`CompositorPort::set_fullscreen`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FullscreenMode {
    /// Fill the desktop inside the layout.
    Maximize,
    /// Cover the desktop.
    Fullscreen,
}

/// Keyboard-layout switch commands for [`CompositorPort::switch_keyboard_layout`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum KeyboardLayoutCommand {
    /// The next layout.
    Next,
    /// The previous layout.
    Previous,
    /// A layout by index.
    Index(u32),
}

/// Compositor health: reachable, its version, and the round-trip time of
/// the probe. Frame pacing has no compositor IPC; the observability lane
/// measures it another way.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Health {
    /// The compositor's self-reported version.
    pub version: String,
    /// The probe's round trip in milliseconds.
    pub ping_ms: u64,
}

/// The resource governor's pressure level (M107): thumbnails capture only
/// while it is [`GovernorLevel::Normal`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GovernorLevel {
    /// No pressure: thumbnails run at [`THUMBNAIL_FPS`].
    Normal,
    /// Pressure: thumbnails pause until it clears.
    Throttle,
    /// Work is moving elsewhere: thumbnails pause until it clears.
    Relocate,
    /// Everything stops: thumbnails pause until it clears.
    Pause,
}

/// Whether a live thumbnail may capture now: only under no pressure, and at
/// most [`THUMBNAIL_FPS`] frames per second (D91.15). `last_ms` is the
/// previous capture's monotonic time, or `None` when nothing captured yet.
#[must_use]
pub fn thumbnails_live(level: GovernorLevel, last_ms: Option<u64>, now_ms: u64) -> bool {
    if level != GovernorLevel::Normal {
        return false;
    }
    match last_ms {
        None => true,
        Some(last) => now_ms.saturating_sub(last) * u64::from(THUMBNAIL_FPS) >= 1000,
    }
}

/// Every event the port reports. Carries what the compositor sent; anything
/// the wire adds later arrives as [`CompositorEvent::Unknown`], never
/// dropped (D36).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CompositorEvent {
    /// The active desktop changed.
    DesktopChanged {
        /// The desktop id.
        id: i32,
        /// The desktop's display name.
        name: String,
    },
    /// A desktop was created.
    DesktopCreated {
        /// The desktop id.
        id: i32,
        /// The desktop's display name.
        name: String,
    },
    /// A desktop was destroyed.
    DesktopDestroyed {
        /// The desktop id.
        id: i32,
        /// The desktop's display name.
        name: String,
    },
    /// A desktop was renamed (a label landed or cleared).
    DesktopRenamed {
        /// The desktop id.
        id: i32,
        /// The new display name.
        name: String,
    },
    /// A desktop moved to another monitor.
    DesktopMonitorChanged {
        /// The desktop id.
        id: i32,
        /// The desktop's display name.
        name: String,
        /// The monitor it moved to.
        monitor: String,
    },
    /// The active monitor changed.
    MonitorFocused {
        /// The monitor's name.
        monitor: String,
        /// The desktop it shows.
        desktop: String,
    },
    /// A monitor was connected.
    MonitorAdded {
        /// The monitor's id.
        id: i32,
        /// The monitor's name.
        name: String,
    },
    /// A monitor was disconnected.
    MonitorRemoved {
        /// The monitor's id.
        id: i32,
        /// The monitor's name.
        name: String,
    },
    /// A window opened.
    WindowOpened {
        /// The window's address.
        address: String,
        /// The desktop's display name.
        desktop: String,
        /// The application class.
        class: String,
        /// The window title.
        title: String,
    },
    /// A window closed.
    WindowClosed {
        /// The window's address.
        address: String,
    },
    /// The active window changed.
    WindowFocused {
        /// The window's address.
        address: String,
    },
    /// A window's title changed.
    WindowTitle {
        /// The window's address.
        address: String,
        /// The new title.
        title: String,
    },
    /// A window moved to another desktop.
    WindowMoved {
        /// The window's address.
        address: String,
        /// The desktop id.
        desktop_id: i32,
        /// The desktop's display name.
        desktop_name: String,
    },
    /// A window's floating state changed.
    WindowFloating {
        /// The window's address.
        address: String,
        /// Whether it floats now.
        floating: bool,
    },
    /// A window asked for attention.
    WindowUrgent {
        /// The window's address.
        address: String,
    },
    /// A window's pinned state changed.
    WindowPinned {
        /// The window's address.
        address: String,
        /// Whether it shows on every desktop now.
        pinned: bool,
    },
    /// A window entered or left fullscreen.
    FullscreenChanged {
        /// Whether a window covers the desktop now.
        fullscreen: bool,
    },
    /// A screencopy session started or stopped.
    ScreencastChanged {
        /// Whether capture runs now.
        active: bool,
        /// What is captured (`monitor`, `window`, `region`).
        owner: String,
        /// The shared target's name (a monitor name or window title).
        target: String,
    },
    /// A keyboard's layout changed.
    InputLayoutChanged {
        /// The keyboard's name.
        keyboard: String,
        /// The new layout's name.
        layout: String,
    },
    /// A group formed or dissolved.
    GroupChanged {
        /// Whether a group formed (`false` dissolved).
        active: bool,
        /// The member window addresses, comma separated.
        members: String,
    },
    /// A window joined a group.
    WindowGrouped {
        /// The window's address.
        address: String,
    },
    /// A window left a group.
    WindowUngrouped {
        /// The window's address.
        address: String,
    },
    /// Group locking was toggled.
    GroupLockChanged {
        /// Whether groups lock now.
        locked: bool,
    },
    /// The keybind submap changed (empty means the default map).
    SubmapChanged {
        /// The submap's name.
        name: String,
    },
    /// A layer surface mapped.
    LayerOpened {
        /// The layer namespace.
        namespace: String,
    },
    /// A layer surface unmapped.
    LayerClosed {
        /// The layer namespace.
        namespace: String,
    },
    /// The special workspace a monitor shows changed.
    SpecialChanged {
        /// The desktop's display name, empty when closed.
        name: String,
        /// The monitor it shows on.
        monitor: String,
    },
    /// An app rang the system bell.
    Bell {
        /// The window's address, empty when the bell names none.
        address: String,
    },
    /// A taskbar-like app asked to minimize a window.
    Minimized {
        /// The window's address.
        address: String,
        /// Whether it minimizes (`false` restores).
        minimized: bool,
    },
    /// The configuration finished reloading.
    ConfigReloaded,
    /// An event this port version does not know yet, carried as it came.
    Unknown {
        /// The event name.
        name: String,
        /// The event data.
        data: String,
    },
}

/// A live event subscription: the compositor's stream, parsed. Ends when the
/// caller drops it.
pub type EventSubscription<E> = Box<dyn Iterator<Item = Result<CompositorEvent, E>> + Send>;

/// The port every desktop caller programs against (D91.3, D91.15).
/// Desktops are workspaces; a merge moves every client; an agent's new
/// desktop never takes focus.
pub trait CompositorPort {
    /// The adapter's failure type.
    type Error: std::error::Error;

    /// Every desktop with its windows.
    fn desktops(&self) -> Result<Vec<DesktopInfo>, Self::Error>;
    /// The desktop the person looks at.
    fn active_desktop(&self) -> Result<DesktopInfo, Self::Error>;
    /// Switches to a desktop by id or name.
    fn switch_desktop(&self, desktop: &str) -> Result<(), Self::Error>;
    /// Sends a window to a desktop; `follow` moves focus with it.
    fn move_window(
        &self,
        window: &WindowSelector,
        desktop: &str,
        follow: bool,
    ) -> Result<(), Self::Error>;
    /// Binds a desktop to a project folder, so the app's window on it opens
    /// that folder.
    fn bind_desktop(&self, desktop: &str, project: PathBuf) -> Result<(), Self::Error>;
    /// Drops a desktop's project binding. Unknown desktops are a no-op.
    fn unbind_desktop(&self, desktop: &str) -> Result<(), Self::Error>;
    /// Every project binding the adapter holds.
    fn desktop_bindings(&self) -> Result<Vec<DesktopBinding>, Self::Error>;

    /// Every window on every desktop.
    fn windows(&self) -> Result<Vec<WindowInfo>, Self::Error>;
    /// The focused window, or `None` when nothing has focus.
    fn active_window(&self) -> Result<Option<WindowInfo>, Self::Error>;
    /// Focuses a window.
    fn focus_window(&self, window: &WindowSelector) -> Result<(), Self::Error>;
    /// Asks a window to close.
    fn close_window(&self, window: &WindowSelector) -> Result<(), Self::Error>;
    /// Floats a window, or tiles it again.
    fn float_window(&self, window: &WindowSelector, float: bool) -> Result<(), Self::Error>;
    /// Fullscreens a window, or returns it to the layout.
    fn set_fullscreen(
        &self,
        window: &WindowSelector,
        mode: Option<FullscreenMode>,
    ) -> Result<(), Self::Error>;
    /// Pins a window to every desktop, or unpins it.
    fn pin_window(&self, window: &WindowSelector, pin: bool) -> Result<(), Self::Error>;
    /// Centres a floating window on its monitor.
    fn center_window(&self, window: &WindowSelector) -> Result<(), Self::Error>;
    /// Groups the window with its neighbour, or dissolves its group.
    fn toggle_group(&self, window: &WindowSelector) -> Result<(), Self::Error>;

    /// Opens a headed app on a desktop. `focus = false` leaves focus where
    /// it is: an agent's new desktop never takes focus (D91.15).
    fn open_on_desktop(&self, command: &str, desktop: &str, focus: bool)
        -> Result<(), Self::Error>;
    /// Labels a desktop with its agent or session; an empty label clears it.
    fn label_desktop(&self, desktop: &str, label: &str) -> Result<(), Self::Error>;
    /// Sends a window to a new desktop past the highest id, and returns it.
    /// `follow` moves focus with it; agent calls pass `false` so the
    /// person's view never jumps.
    fn send_to_new_desktop(
        &self,
        window: &WindowSelector,
        follow: bool,
    ) -> Result<String, Self::Error>;
    /// Merges one desktop into another: moves every client, and returns how
    /// many moved. Merging a desktop into itself moves nothing.
    fn merge_desktops(&self, source: &str, target: &str) -> Result<usize, Self::Error>;

    /// Picks a desktop's layout (`None` means the active desktop).
    fn set_layout(&self, desktop: Option<&str>, layout: Layout) -> Result<(), Self::Error>;
    /// Sets dwindle's default split ratio (0.1–1.9, 1.0 splits even).
    fn set_split_ratio(&self, ratio: f32) -> Result<(), Self::Error>;
    /// Sets master's master-area factor (0.0–1.0).
    fn set_master_factor(&self, mfact: f32) -> Result<(), Self::Error>;
    /// Sets the inner and outer gaps in pixels.
    fn set_gaps(&self, inner_px: u32, outer_px: u32) -> Result<(), Self::Error>;

    /// Every output with its mode and position.
    fn monitors(&self) -> Result<Vec<MonitorInfo>, Self::Error>;
    /// Arranges a monitor live; the settings app persists it.
    fn arrange_monitor(&self, spec: &MonitorSpec) -> Result<(), Self::Error>;
    /// Moves a desktop to another monitor.
    fn move_desktop_to_monitor(&self, desktop: &str, monitor: &str) -> Result<(), Self::Error>;
    /// Moves a window to another monitor; `follow` moves focus with it.
    fn move_window_to_monitor(
        &self,
        window: &WindowSelector,
        monitor: &str,
        follow: bool,
    ) -> Result<(), Self::Error>;

    /// Every input device with its kind and layout.
    fn input_devices(&self) -> Result<Vec<InputDevice>, Self::Error>;
    /// Switches a keyboard's layout.
    fn switch_keyboard_layout(
        &self,
        device: &str,
        command: KeyboardLayoutCommand,
    ) -> Result<(), Self::Error>;
    /// Sets key repeat: repeats per second and the delay in milliseconds.
    fn set_repeat(&self, rate: u32, delay_ms: u32) -> Result<(), Self::Error>;

    /// Applies a theme mode's borders and effects live.
    fn apply_appearance(&self, mode: ThemeMode) -> Result<(), Self::Error>;
    /// Turns animations off for reduced motion, or back on.
    fn set_reduced_motion(&self, reduced: bool) -> Result<(), Self::Error>;

    /// Subscribes to the compositor's live events.
    fn subscribe(&self) -> Result<EventSubscription<Self::Error>, Self::Error>;
    /// Probes the compositor: reachable, its version, the round trip.
    fn ping(&self) -> Result<Health, Self::Error>;
}

// Re-exported so callers name one crate for the port and its modes.
pub use muse_tokens::appearance::ThemeMode;

#[cfg(test)]
mod tests {
    use super::{thumbnails_live, GovernorLevel, THUMBNAIL_FPS};

    #[test]
    fn thumbnails_pause_above_normal_pressure() {
        for level in [
            GovernorLevel::Throttle,
            GovernorLevel::Relocate,
            GovernorLevel::Pause,
        ] {
            assert!(!thumbnails_live(level, None, 0), "{level:?} captures");
            assert!(
                !thumbnails_live(level, Some(0), 10_000),
                "{level:?} captures"
            );
        }
        assert!(thumbnails_live(GovernorLevel::Normal, None, 0));
    }

    #[test]
    fn thumbnails_hold_the_frame_rate() {
        let frame_ms = 1000 / u64::from(THUMBNAIL_FPS);
        assert!(thumbnails_live(GovernorLevel::Normal, Some(0), frame_ms));
        assert!(!thumbnails_live(
            GovernorLevel::Normal,
            Some(0),
            frame_ms - 1
        ));
        // A clock that jumps backwards never divides or panics; it waits.
        assert!(!thumbnails_live(GovernorLevel::Normal, Some(500), 100));
    }
}
