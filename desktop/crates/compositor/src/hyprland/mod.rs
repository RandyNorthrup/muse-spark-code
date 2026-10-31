//! The Hyprland adapter: [`HyprlandAdapter`] speaks both sockets, mapping
//! the port's calls to hyprctl-style requests and the `EVENT>>DATA` stream
//! to [`CompositorEvent`](crate::port::CompositorEvent). Verified against
//! Hyprland 0.55.2 and 0.57.0; every response shape it parses is locked to
//! a recorded capture under `tests/fixtures/`.

pub mod protocol;

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::os::unix::net::UnixStream;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::Deserialize;

use crate::port::{
    CompositorEvent, CompositorPort, DesktopBinding, DesktopInfo, EventSubscription,
    FullscreenMode, Health, InputDevice, KeyboardLayoutCommand, Layout, MonitorInfo, MonitorSpec,
    ThemeMode, WindowInfo, WindowSelector,
};
use protocol::{
    config_eval, dispatch_request, dsp_center_window, dsp_close_window, dsp_exec, dsp_float_window,
    dsp_focus_window, dsp_focus_workspace, dsp_fullscreen_window, dsp_move_desktop_to_monitor,
    dsp_move_window, dsp_move_window_to_monitor, dsp_pin_window, dsp_rename_desktop,
    dsp_toggle_group, eval_request, info_request, lua_string, monitor_eval, parse_event_line,
    workspace_rule_eval,
};

/// How long a socket1 round trip may take. Hyprland itself freezes an
/// unclosed connection for five seconds (`wiki.hypr.land/ipc`); we match
/// that rather than invent our own.
const REQUEST_TIMEOUT: Duration = Duration::from_secs(5);

/// dwindle's default split ratio range, from the layout docs: 1.0 splits
/// even, the ends bias.
const SPLIT_RATIO_MIN: f32 = 0.1;
const SPLIT_RATIO_MAX: f32 = 1.9;

/// Everything the Hyprland adapter reports. Displays name the kind, never
/// the data: paths, titles and replies stay in fields, out of logs.
#[derive(Debug)]
pub enum HyprlandError {
    /// The environment does not name a compositor to talk to.
    NoCompositor {
        /// The missing variable.
        var: &'static str,
    },
    /// The socket would not connect.
    Connect {
        /// What the adapter tried.
        path: PathBuf,
        /// The operating system error.
        source: std::io::Error,
    },
    /// A connected socket failed mid-request.
    Io {
        /// What the adapter tried.
        path: PathBuf,
        /// The operating system error.
        source: std::io::Error,
    },
    /// The compositor took longer than [`REQUEST_TIMEOUT`].
    Timeout,
    /// The compositor answered JSON the adapter does not understand.
    InvalidJson {
        /// The request sent.
        request: String,
        /// The reply received.
        reply: String,
    },
    /// The compositor refused a control request.
    Refused {
        /// The request sent.
        request: String,
        /// The reply received.
        reply: String,
    },
    /// A socket2 line is not `EVENT>>DATA`.
    BadEvent {
        /// The offending line.
        line: String,
    },
    /// No desktop matches.
    UnknownDesktop {
        /// The desktop sought.
        desktop: String,
    },
    /// A value is outside the compositor's documented range.
    OutOfRange {
        /// What was set.
        what: &'static str,
    },
}

impl std::fmt::Display for HyprlandError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            HyprlandError::NoCompositor { .. } => {
                write!(f, "no compositor socket in the environment")
            }
            HyprlandError::Connect { .. } => write!(f, "compositor socket would not connect"),
            HyprlandError::Io { .. } => write!(f, "compositor socket failed mid-request"),
            HyprlandError::Timeout => write!(f, "compositor took too long to answer"),
            HyprlandError::InvalidJson { .. } => {
                write!(f, "compositor answered invalid JSON")
            }
            HyprlandError::Refused { .. } => write!(f, "compositor refused the request"),
            HyprlandError::BadEvent { .. } => write!(f, "malformed compositor event line"),
            HyprlandError::UnknownDesktop { .. } => write!(f, "no such desktop"),
            HyprlandError::OutOfRange { what } => write!(f, "{what} is outside its range"),
        }
    }
}

impl std::error::Error for HyprlandError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            HyprlandError::Connect { source, .. } | HyprlandError::Io { source, .. } => {
                Some(source)
            }
            _ => None,
        }
    }
}

impl From<protocol::EventParseError> for HyprlandError {
    fn from(error: protocol::EventParseError) -> Self {
        match error {
            protocol::EventParseError::Malformed { line } => HyprlandError::BadEvent { line },
            protocol::EventParseError::BadNumber { value, .. } => {
                HyprlandError::BadEvent { line: value }
            }
        }
    }
}

/// A workspace reference inside another answer: the id is present only for
/// numbered workspaces.
#[derive(Debug, Default, Deserialize)]
struct HyprWorkspaceRef {
    #[serde(default)]
    id: Option<i32>,
    #[serde(default)]
    name: String,
}

/// One `workspaces -j` row.
#[derive(Debug, Deserialize)]
struct HyprWorkspace {
    #[serde(default)]
    id: Option<i32>,
    #[serde(default)]
    name: String,
    #[serde(default)]
    monitor: String,
    #[serde(rename = "monitorID", default)]
    monitor_id: Option<i32>,
    #[serde(default)]
    windows: u32,
    #[serde(default)]
    hasfullscreen: bool,
    #[serde(default)]
    lastwindow: String,
}

/// One `clients -j` row. `monitor` is the monitor's numeric id; the
/// adapter resolves names through `monitors -j`.
#[derive(Debug, Deserialize)]
struct HyprClient {
    #[serde(default)]
    address: String,
    #[serde(default)]
    class: String,
    #[serde(default)]
    title: String,
    #[serde(default)]
    pid: i32,
    #[serde(default)]
    workspace: HyprWorkspaceRef,
    #[serde(default)]
    floating: bool,
    #[serde(default)]
    fullscreen: u8,
    #[serde(default)]
    pinned: bool,
    #[serde(default)]
    monitor: i32,
}

/// One `monitors -j` row.
#[derive(Debug, Deserialize)]
struct HyprMonitor {
    #[serde(default)]
    id: i32,
    #[serde(default)]
    name: String,
    #[serde(default)]
    description: String,
    #[serde(default)]
    width: i32,
    #[serde(default)]
    height: i32,
    #[serde(rename = "refreshRate", default)]
    refresh_rate: f32,
    #[serde(default)]
    x: i32,
    #[serde(default)]
    y: i32,
    #[serde(default)]
    scale: f32,
    #[serde(rename = "activeWorkspace", default)]
    active_workspace: HyprWorkspaceRef,
}

/// The `devices -j` answer.
#[derive(Debug, Deserialize)]
struct HyprDevices {
    #[serde(default)]
    mice: Vec<HyprMouse>,
    #[serde(default)]
    keyboards: Vec<HyprKeyboard>,
}

#[derive(Debug, Deserialize)]
struct HyprMouse {
    #[serde(default)]
    name: String,
}

#[derive(Debug, Deserialize)]
struct HyprKeyboard {
    #[serde(default)]
    name: String,
    #[serde(default)]
    layout: String,
    #[serde(default)]
    active_keymap: String,
}

/// The adapter: the port over Hyprland's two sockets. Holds the runtime
/// project bindings; the settings app persists them in `desktop.json`.
pub struct HyprlandAdapter {
    socket1: PathBuf,
    socket2: PathBuf,
    bindings: Mutex<HashMap<String, PathBuf>>,
}

impl HyprlandAdapter {
    /// Opens the adapter on an instance's socket directory (the folder
    /// holding `.socket.sock` and `.socket2.sock`).
    #[must_use]
    pub fn new(socket_dir: &Path) -> Self {
        HyprlandAdapter {
            socket1: socket_dir.join(".socket.sock"),
            socket2: socket_dir.join(".socket2.sock"),
            bindings: Mutex::new(HashMap::new()),
        }
    }

    /// Opens the adapter on the compositor this process runs under, from
    /// `XDG_RUNTIME_DIR` and `HYPRLAND_INSTANCE_SIGNATURE`.
    pub fn from_env() -> Result<Self, HyprlandError> {
        let runtime =
            std::env::var("XDG_RUNTIME_DIR").map_err(|_| HyprlandError::NoCompositor {
                var: "XDG_RUNTIME_DIR",
            })?;
        let signature = std::env::var("HYPRLAND_INSTANCE_SIGNATURE").map_err(|_| {
            HyprlandError::NoCompositor {
                var: "HYPRLAND_INSTANCE_SIGNATURE",
            }
        })?;
        Ok(HyprlandAdapter::new(
            &Path::new(&runtime).join("hypr").join(signature),
        ))
    }

    /// One socket1 round trip: connect, write, read to end, close. The
    /// connection always closes: Hyprland freezes an unclosed one.
    fn round_trip(&self, request: &str) -> Result<String, HyprlandError> {
        let stream =
            UnixStream::connect(&self.socket1).map_err(|source| HyprlandError::Connect {
                path: self.socket1.clone(),
                source,
            })?;
        stream
            .set_read_timeout(Some(REQUEST_TIMEOUT))
            .and_then(|()| stream.set_write_timeout(Some(REQUEST_TIMEOUT)))
            .map_err(|source| HyprlandError::Io {
                path: self.socket1.clone(),
                source,
            })?;
        let mut stream = stream;
        stream
            .write_all(request.as_bytes())
            .map_err(|source| self.io_error(source))?;
        let mut reply = String::new();
        stream
            .read_to_string(&mut reply)
            .map_err(|source| self.io_error(source))?;
        Ok(reply)
    }

    fn io_error(&self, source: std::io::Error) -> HyprlandError {
        if source.kind() == std::io::ErrorKind::TimedOut {
            return HyprlandError::Timeout;
        }
        HyprlandError::Io {
            path: self.socket1.clone(),
            source,
        }
    }

    /// A JSON info request, parsed.
    fn info<T>(&self, command: &str) -> Result<T, HyprlandError>
    where
        T: serde::de::DeserializeOwned,
    {
        let request = info_request(command);
        let reply = self.round_trip(&request)?;
        serde_json::from_str(&reply).map_err(|_| HyprlandError::InvalidJson { request, reply })
    }

    /// A control request: dispatch, eval, or a hyprctl verb. Anything but
    /// `ok` is the compositor refusing.
    fn control(&self, request: &str) -> Result<(), HyprlandError> {
        let reply = self.round_trip(request)?;
        if reply.trim() == "ok" {
            Ok(())
        } else {
            Err(HyprlandError::Refused {
                request: request.to_string(),
                reply,
            })
        }
    }

    fn dispatch(&self, lua: &str) -> Result<(), HyprlandError> {
        self.control(&dispatch_request(lua))
    }

    fn eval(&self, lua: &str) -> Result<(), HyprlandError> {
        self.control(&eval_request(lua))
    }

    /// The monitor names by id, for resolving the clients' numeric monitor.
    fn monitor_names(&self) -> Result<HashMap<i32, String>, HyprlandError> {
        let monitors: Vec<HyprMonitor> = self.info("monitors")?;
        Ok(monitors.into_iter().map(|m| (m.id, m.name)).collect())
    }

    /// Resolves a desktop id or name to its numeric id.
    fn desktop_id(&self, desktop: &str) -> Result<i32, HyprlandError> {
        let desktops = self.desktops()?;
        if let Ok(id) = desktop.parse::<i32>() {
            if desktops.iter().any(|d| d.id == id) {
                return Ok(id);
            }
        }
        desktops
            .iter()
            .find(|d| d.name == desktop)
            .map(|d| d.id)
            .ok_or_else(|| HyprlandError::UnknownDesktop {
                desktop: desktop.to_string(),
            })
    }
}

impl CompositorPort for HyprlandAdapter {
    type Error = HyprlandError;

    fn desktops(&self) -> Result<Vec<DesktopInfo>, HyprlandError> {
        let workspaces: Vec<HyprWorkspace> = self.info("workspaces")?;
        Ok(workspaces
            .into_iter()
            .map(|w| DesktopInfo {
                id: w.id.unwrap_or(-1),
                name: w.name,
                monitor: w.monitor,
                monitor_id: w.monitor_id.unwrap_or(-1),
                windows: w.windows,
                fullscreen: w.hasfullscreen,
                last_window: w.lastwindow,
            })
            .collect())
    }

    fn active_desktop(&self) -> Result<DesktopInfo, HyprlandError> {
        let w: HyprWorkspace = self.info("activeworkspace")?;
        Ok(DesktopInfo {
            id: w.id.unwrap_or(-1),
            name: w.name,
            monitor: w.monitor,
            monitor_id: w.monitor_id.unwrap_or(-1),
            windows: w.windows,
            fullscreen: w.hasfullscreen,
            last_window: w.lastwindow,
        })
    }

    fn switch_desktop(&self, desktop: &str) -> Result<(), HyprlandError> {
        self.dispatch(&dsp_focus_workspace(desktop))
    }

    fn move_window(
        &self,
        window: &WindowSelector,
        desktop: &str,
        follow: bool,
    ) -> Result<(), HyprlandError> {
        self.dispatch(&dsp_move_window(Some(window), desktop, follow))
    }

    fn bind_desktop(&self, desktop: &str, project: PathBuf) -> Result<(), HyprlandError> {
        self.bindings
            .lock()
            .map(|mut bindings| {
                bindings.insert(desktop.to_string(), project);
            })
            .map_err(|_| HyprlandError::Refused {
                request: "bind_desktop".to_string(),
                reply: "bindings lock poisoned".to_string(),
            })
    }

    fn unbind_desktop(&self, desktop: &str) -> Result<(), HyprlandError> {
        self.bindings
            .lock()
            .map(|mut bindings| {
                bindings.remove(desktop);
            })
            .map_err(|_| HyprlandError::Refused {
                request: "unbind_desktop".to_string(),
                reply: "bindings lock poisoned".to_string(),
            })
    }

    fn desktop_bindings(&self) -> Result<Vec<DesktopBinding>, HyprlandError> {
        self.bindings
            .lock()
            .map(|bindings| {
                bindings
                    .iter()
                    .map(|(desktop, project)| DesktopBinding {
                        desktop: desktop.clone(),
                        project: project.clone(),
                    })
                    .collect()
            })
            .map_err(|_| HyprlandError::Refused {
                request: "desktop_bindings".to_string(),
                reply: "bindings lock poisoned".to_string(),
            })
    }

    fn windows(&self) -> Result<Vec<WindowInfo>, HyprlandError> {
        // `ja/clients`: JSON with every window, mapped or not, so a merge
        // never loses one.
        let request = "ja/clients".to_string();
        let reply = self.round_trip(&request)?;
        let clients: Vec<HyprClient> = serde_json::from_str(&reply)
            .map_err(|_| HyprlandError::InvalidJson { request, reply })?;
        let monitors = self.monitor_names()?;
        Ok(clients
            .into_iter()
            .map(|c| {
                let monitor = monitors.get(&c.monitor).cloned().unwrap_or_default();
                WindowInfo {
                    address: c.address,
                    class: c.class,
                    title: c.title,
                    pid: c.pid,
                    desktop_id: c.workspace.id.unwrap_or(-1),
                    desktop_name: c.workspace.name,
                    floating: c.floating,
                    fullscreen: c.fullscreen != 0,
                    pinned: c.pinned,
                    monitor,
                }
            })
            .collect())
    }

    fn active_window(&self) -> Result<Option<WindowInfo>, HyprlandError> {
        let request = info_request("activewindow");
        let reply = self.round_trip(&request)?;
        let value: serde_json::Value =
            serde_json::from_str(&reply).map_err(|_| HyprlandError::InvalidJson {
                request: request.clone(),
                reply: reply.clone(),
            })?;
        if value.as_object().is_none_or(serde_json::Map::is_empty) {
            return Ok(None);
        }
        let client: HyprClient = serde_json::from_value(value)
            .map_err(|_| HyprlandError::InvalidJson { request, reply })?;
        let monitors = self.monitor_names()?;
        let monitor = monitors.get(&client.monitor).cloned().unwrap_or_default();
        Ok(Some(WindowInfo {
            address: client.address,
            class: client.class,
            title: client.title,
            pid: client.pid,
            desktop_id: client.workspace.id.unwrap_or(-1),
            desktop_name: client.workspace.name,
            floating: client.floating,
            fullscreen: client.fullscreen != 0,
            pinned: client.pinned,
            monitor,
        }))
    }

    fn focus_window(&self, window: &WindowSelector) -> Result<(), HyprlandError> {
        self.dispatch(&dsp_focus_window(window))
    }

    fn close_window(&self, window: &WindowSelector) -> Result<(), HyprlandError> {
        self.dispatch(&dsp_close_window(window))
    }

    fn float_window(&self, window: &WindowSelector, float: bool) -> Result<(), HyprlandError> {
        self.dispatch(&dsp_float_window(window, float))
    }

    fn set_fullscreen(
        &self,
        window: &WindowSelector,
        mode: Option<FullscreenMode>,
    ) -> Result<(), HyprlandError> {
        self.dispatch(&dsp_fullscreen_window(window, mode))
    }

    fn pin_window(&self, window: &WindowSelector, pin: bool) -> Result<(), HyprlandError> {
        self.dispatch(&dsp_pin_window(window, pin))
    }

    fn center_window(&self, window: &WindowSelector) -> Result<(), HyprlandError> {
        self.dispatch(&dsp_center_window(window))
    }

    fn toggle_group(&self, window: &WindowSelector) -> Result<(), HyprlandError> {
        self.dispatch(&dsp_toggle_group(window))
    }

    fn open_on_desktop(
        &self,
        command: &str,
        desktop: &str,
        focus: bool,
    ) -> Result<(), HyprlandError> {
        self.dispatch(&dsp_exec(command, desktop, focus))
    }

    fn label_desktop(&self, desktop: &str, label: &str) -> Result<(), HyprlandError> {
        if label.is_empty() {
            let id = self.desktop_id(desktop)?;
            return self.dispatch(&dsp_rename_desktop(&id.to_string(), &id.to_string()));
        }
        self.dispatch(&dsp_rename_desktop(desktop, label))
    }

    fn send_to_new_desktop(
        &self,
        window: &WindowSelector,
        follow: bool,
    ) -> Result<String, HyprlandError> {
        let desktops = self.desktops()?;
        let next = desktops.iter().map(|d| d.id).max().unwrap_or(0) + 1;
        let target = next.to_string();
        self.dispatch(&dsp_move_window(Some(window), &target, follow))?;
        Ok(target)
    }

    fn merge_desktops(&self, source: &str, target: &str) -> Result<usize, HyprlandError> {
        if source == target {
            return Ok(0);
        }
        let windows = self.windows()?;
        let mut moved = 0;
        for window in windows {
            let on_source = window.desktop_name == source
                || source
                    .parse::<i32>()
                    .is_ok_and(|id| id == window.desktop_id);
            if !on_source {
                continue;
            }
            let selector = WindowSelector::Address(window.address);
            self.dispatch(&dsp_move_window(Some(&selector), target, false))?;
            moved += 1;
        }
        Ok(moved)
    }

    fn set_layout(&self, desktop: Option<&str>, layout: Layout) -> Result<(), HyprlandError> {
        let name = match &layout {
            Layout::Dwindle => "dwindle".to_string(),
            Layout::Master => "master".to_string(),
            Layout::Scrolling => "scrolling".to_string(),
            Layout::Custom(name) => name.clone(),
        };
        match desktop {
            None => self.eval(&config_eval(&format!(
                "general = {{ layout = {} }}",
                lua_string(&name)
            ))),
            Some(desktop) => self.eval(&workspace_rule_eval(
                desktop,
                &format!("layout = {}", lua_string(&name)),
            )),
        }
    }

    fn set_split_ratio(&self, ratio: f32) -> Result<(), HyprlandError> {
        if !(SPLIT_RATIO_MIN..=SPLIT_RATIO_MAX).contains(&ratio) {
            return Err(HyprlandError::OutOfRange {
                what: "split ratio",
            });
        }
        self.eval(&config_eval(&format!(
            "dwindle = {{ default_split_ratio = {ratio} }}"
        )))
    }

    fn set_master_factor(&self, mfact: f32) -> Result<(), HyprlandError> {
        self.eval(&config_eval(&format!("master = {{ mfact = {mfact} }}")))
    }

    fn set_gaps(&self, inner_px: u32, outer_px: u32) -> Result<(), HyprlandError> {
        self.eval(&config_eval(&format!(
            "general = {{ gaps_in = {inner_px}, gaps_out = {outer_px} }}"
        )))
    }

    fn monitors(&self) -> Result<Vec<MonitorInfo>, HyprlandError> {
        let monitors: Vec<HyprMonitor> = self.info("monitors")?;
        Ok(monitors
            .into_iter()
            .map(|m| MonitorInfo {
                id: m.id,
                name: m.name,
                description: m.description,
                width: m.width,
                height: m.height,
                refresh_rate: m.refresh_rate,
                x: m.x,
                y: m.y,
                scale: m.scale,
                active_desktop: m.active_workspace.id.unwrap_or(-1),
            })
            .collect())
    }

    fn arrange_monitor(&self, spec: &MonitorSpec) -> Result<(), HyprlandError> {
        self.eval(&monitor_eval(
            &spec.output,
            &spec.mode,
            &spec.position,
            spec.scale,
        ))
    }

    fn move_desktop_to_monitor(&self, desktop: &str, monitor: &str) -> Result<(), HyprlandError> {
        self.dispatch(&dsp_move_desktop_to_monitor(desktop, monitor))
    }

    fn move_window_to_monitor(
        &self,
        window: &WindowSelector,
        monitor: &str,
        follow: bool,
    ) -> Result<(), HyprlandError> {
        self.dispatch(&dsp_move_window_to_monitor(Some(window), monitor, follow))
    }

    fn input_devices(&self) -> Result<Vec<InputDevice>, HyprlandError> {
        let devices: HyprDevices = self.info("devices")?;
        let mut out: Vec<InputDevice> = devices
            .mice
            .into_iter()
            .map(|m| InputDevice {
                name: m.name,
                kind: "mouse".to_string(),
                layout: String::new(),
            })
            .collect();
        out.extend(devices.keyboards.into_iter().map(|k| {
            let layout = if k.active_keymap.is_empty() {
                k.layout
            } else {
                k.active_keymap
            };
            InputDevice {
                name: k.name,
                kind: "keyboard".to_string(),
                layout,
            }
        }));
        Ok(out)
    }

    fn switch_keyboard_layout(
        &self,
        device: &str,
        command: KeyboardLayoutCommand,
    ) -> Result<(), HyprlandError> {
        // The request splits on spaces, so device names travel dashed
        // (`at-translated-set-2-keyboard`); the selectors pass through.
        let target = match device {
            "main" | "active" | "current" | "all" => device.to_string(),
            _ => device.replace(' ', "-"),
        };
        let action = match command {
            KeyboardLayoutCommand::Next => "next".to_string(),
            KeyboardLayoutCommand::Previous => "prev".to_string(),
            KeyboardLayoutCommand::Index(index) => index.to_string(),
        };
        self.control(&format!("switchxkblayout {target} {action}"))
    }

    fn set_repeat(&self, rate: u32, delay_ms: u32) -> Result<(), HyprlandError> {
        self.eval(&config_eval(&format!(
            "input = {{ repeat_rate = {rate}, repeat_delay = {delay_ms} }}"
        )))
    }

    fn apply_appearance(&self, mode: ThemeMode) -> Result<(), HyprlandError> {
        use muse_tokens::palette;
        let (active, inactive) = match mode {
            ThemeMode::Light => (palette::FOCUS_LIGHT, palette::BORDER_LIGHT),
            ThemeMode::Dark => (palette::FOCUS_DARK, palette::BORDER_DARK),
            ThemeMode::HcLight => (palette::FOCUS_HC_LIGHT, palette::BORDER_HC_LIGHT),
            ThemeMode::HcDark => (palette::FOCUS_HC_DARK, palette::BORDER_HC_DARK),
        };
        let effects = match mode {
            ThemeMode::Light | ThemeMode::Dark => true,
            ThemeMode::HcLight | ThemeMode::HcDark => false,
        };
        let rgb = |argb: u32| format!("rgb({argb:06x})", argb = argb & 0x00FF_FFFF);
        self.eval(&config_eval(&format!(
            "general = {{ col = {{ active_border = {}, inactive_border = {} }} }}, decoration = {{ blur = {{ enabled = {effects} }}, shadow = {{ enabled = {effects} }} }}",
            lua_string(&rgb(active)),
            lua_string(&rgb(inactive)),
        )))
    }

    fn set_reduced_motion(&self, reduced: bool) -> Result<(), HyprlandError> {
        let enabled = !reduced;
        self.eval(&config_eval(&format!(
            "animations = {{ enabled = {enabled} }}"
        )))
    }

    fn subscribe(&self) -> Result<EventSubscription<HyprlandError>, HyprlandError> {
        let stream =
            UnixStream::connect(&self.socket2).map_err(|source| HyprlandError::Connect {
                path: self.socket2.clone(),
                source,
            })?;
        Ok(Box::new(EventStream {
            lines: BufReader::new(stream).lines(),
        }))
    }

    fn ping(&self) -> Result<Health, HyprlandError> {
        let started = Instant::now();
        let reply = self.round_trip("version")?;
        let version = reply.lines().next().unwrap_or_default().trim().to_string();
        Ok(Health {
            version,
            ping_ms: u64::try_from(started.elapsed().as_millis()).unwrap_or(u64::MAX),
        })
    }
}

/// The socket2 stream: lines parsed to events, legacy v1 twins skipped,
/// malformed lines reported without killing the stream.
struct EventStream {
    lines: std::io::Lines<BufReader<UnixStream>>,
}

impl Iterator for EventStream {
    type Item = Result<CompositorEvent, HyprlandError>;

    fn next(&mut self) -> Option<Self::Item> {
        loop {
            let line = match self.lines.next()? {
                Ok(line) => line,
                Err(source) => {
                    if source.kind() == std::io::ErrorKind::TimedOut {
                        return Some(Err(HyprlandError::Timeout));
                    }
                    return Some(Err(HyprlandError::Io {
                        path: PathBuf::from(".socket2.sock"),
                        source,
                    }));
                }
            };
            match parse_event_line(&line) {
                Ok(None) => continue,
                Ok(Some(event)) => return Some(Ok(event)),
                Err(error) => return Some(Err(HyprlandError::from(error))),
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::HyprlandAdapter;
    use crate::port::CompositorPort;
    use std::path::PathBuf;

    #[test]
    fn bind_and_unbind_hold_the_runtime_copy() {
        let adapter = HyprlandAdapter::new(&PathBuf::from("/nonexistent"));
        adapter
            .bind_desktop("2", PathBuf::from("/tmp/proj"))
            .expect("bind");
        adapter
            .bind_desktop("3", PathBuf::from("/tmp/other"))
            .expect("bind");
        let mut bindings = adapter.desktop_bindings().expect("bindings");
        bindings.sort_by(|a, b| a.desktop.cmp(&b.desktop));
        assert_eq!(bindings.len(), 2);
        assert_eq!(bindings[0].project, PathBuf::from("/tmp/proj"));
        adapter.unbind_desktop("2").expect("unbind");
        adapter
            .unbind_desktop("missing")
            .expect("unknown unbind is a no-op");
        let bindings = adapter.desktop_bindings().expect("bindings");
        assert_eq!(bindings.len(), 1);
        assert_eq!(bindings[0].desktop, "3");
    }

    #[test]
    fn missing_sockets_fail_with_their_kind() {
        let adapter = HyprlandAdapter::new(&PathBuf::from("/nonexistent-dir-xyz"));
        let error = adapter
            .desktops()
            .expect_err("desktops succeeds without a socket");
        assert!(
            matches!(error, super::HyprlandError::Connect { .. }),
            "{error:?}"
        );
        let error = adapter.ping().expect_err("ping succeeds without a socket");
        assert!(
            matches!(error, super::HyprlandError::Connect { .. }),
            "{error:?}"
        );
        let subscribed = adapter.subscribe();
        assert!(matches!(
            subscribed,
            Err(super::HyprlandError::Connect { .. })
        ));
    }

    #[test]
    fn error_text_names_the_kind_not_the_data() {
        let error = super::HyprlandError::Refused {
            request: "dispatch secret".to_string(),
            reply: "no".to_string(),
        };
        assert_eq!(error.to_string(), "compositor refused the request");
        let error = super::HyprlandError::Connect {
            path: PathBuf::from("/home/person/x"),
            source: std::io::Error::new(std::io::ErrorKind::NotFound, "gone"),
        };
        assert_eq!(error.to_string(), "compositor socket would not connect");
    }
}
