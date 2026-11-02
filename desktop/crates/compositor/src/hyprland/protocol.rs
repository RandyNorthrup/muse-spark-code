//! Hyprland's wire: request bytes, Lua fragments, and the socket2 event
//! parser (`wiki.hypr.land/ipc`). Request builders and the Lua escaper are
//! ours to define (tested here); every response and event shape they parse
//! is locked to a recorded capture under `tests/fixtures/`.

use crate::port::{CompositorEvent, FullscreenMode, WindowSelector};

/// A socket2 line that is not `EVENT>>DATA`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum EventParseError {
    /// The line has no `>>` separator.
    Malformed {
        /// The offending line.
        line: String,
    },
    /// A numeric field does not parse.
    BadNumber {
        /// Which field failed.
        field: &'static str,
        /// The offending value.
        value: String,
    },
}

impl std::fmt::Display for EventParseError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            EventParseError::Malformed { .. } => write!(f, "malformed compositor event line"),
            EventParseError::BadNumber { field, .. } => {
                write!(f, "bad {field} in compositor event")
            }
        }
    }
}

impl std::error::Error for EventParseError {}

/// Quotes a Lua string, escaping what would break out of it. Labels,
/// commands and titles pass through here; a quote in the value stays data.
#[must_use]
pub fn lua_string(value: &str) -> String {
    let mut out = String::with_capacity(value.len() + 2);
    out.push('"');
    for ch in value.chars() {
        match ch {
            '\\' => out.push_str("\\\\"),
            '"' => out.push_str("\\\""),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\0' => out.push_str("\\0"),
            _ => out.push(ch),
        }
    }
    out.push('"');
    out
}

/// Renders a port window selector to Hyprland's selector syntax.
#[must_use]
pub fn window_ref(window: &WindowSelector) -> String {
    match window {
        WindowSelector::Active => "activewindow".to_string(),
        WindowSelector::Address(address) => format!("address:{address}"),
        WindowSelector::Class(class) => format!("class:{class}"),
        WindowSelector::Title(title) => format!("title:{title}"),
    }
}

/// A JSON info request: `j/<command>`.
#[must_use]
pub fn info_request(command: &str) -> String {
    format!("j/{command}")
}

/// A dispatcher call: `dispatch <lua expression>`.
#[must_use]
pub fn dispatch_request(lua: &str) -> String {
    format!("dispatch {lua}")
}

/// A Lua evaluation: `eval <lua>`.
#[must_use]
pub fn eval_request(lua: &str) -> String {
    format!("eval {lua}")
}

/// Focuses a desktop: `hl.dsp.focus({ workspace = … })`.
#[must_use]
pub fn dsp_focus_workspace(desktop: &str) -> String {
    format!("hl.dsp.focus({{ workspace = {} }})", lua_string(desktop))
}

/// Moves a window to a desktop, with or without following it.
#[must_use]
pub fn dsp_move_window(window: Option<&WindowSelector>, desktop: &str, follow: bool) -> String {
    let target = window.map_or_else(|| "activewindow".to_string(), window_ref);
    format!(
        "hl.dsp.window.move({{ window = {}, workspace = {}, follow = {follow} }})",
        lua_string(&target),
        lua_string(desktop),
    )
}

/// Moves a window to a monitor, with or without following it.
#[must_use]
pub fn dsp_move_window_to_monitor(
    window: Option<&WindowSelector>,
    monitor: &str,
    follow: bool,
) -> String {
    let target = window.map_or_else(|| "activewindow".to_string(), window_ref);
    format!(
        "hl.dsp.window.move({{ window = {}, monitor = {}, follow = {follow} }})",
        lua_string(&target),
        lua_string(monitor),
    )
}

/// Moves a desktop to a monitor.
#[must_use]
pub fn dsp_move_desktop_to_monitor(desktop: &str, monitor: &str) -> String {
    format!(
        "hl.dsp.workspace.move({{ workspace = {}, monitor = {} }})",
        lua_string(desktop),
        lua_string(monitor),
    )
}

/// Renames a desktop (a label lands or clears).
#[must_use]
pub fn dsp_rename_desktop(desktop: &str, name: &str) -> String {
    format!(
        "hl.dsp.workspace.rename({{ workspace = {}, name = {} }})",
        lua_string(desktop),
        lua_string(name),
    )
}

/// Focuses a window.
#[must_use]
pub fn dsp_focus_window(window: &WindowSelector) -> String {
    format!(
        "hl.dsp.focus({{ window = {} }})",
        lua_string(&window_ref(window))
    )
}

/// Asks a window to close.
#[must_use]
pub fn dsp_close_window(window: &WindowSelector) -> String {
    format!(
        "hl.dsp.window.close({{ window = {} }})",
        lua_string(&window_ref(window))
    )
}

/// Floats a window, or tiles it again.
#[must_use]
pub fn dsp_float_window(window: &WindowSelector, float: bool) -> String {
    let action = if float { "\"set\"" } else { "\"unset\"" };
    format!(
        "hl.dsp.window.float({{ window = {}, action = {action} }})",
        lua_string(&window_ref(window)),
    )
}

/// Fullscreens a window maximized or covering, or returns it to the layout.
#[must_use]
pub fn dsp_fullscreen_window(window: &WindowSelector, mode: Option<FullscreenMode>) -> String {
    let (action, mode) = match mode {
        None => ("\"unset\"", String::new()),
        Some(FullscreenMode::Maximize) => ("\"set\"", ", mode = \"maximized\"".to_string()),
        Some(FullscreenMode::Fullscreen) => ("\"set\"", ", mode = \"fullscreen\"".to_string()),
    };
    format!(
        "hl.dsp.window.fullscreen({{ window = {}, action = {action}{mode} }})",
        lua_string(&window_ref(window)),
    )
}

/// Pins a window to every desktop, or unpins it.
#[must_use]
pub fn dsp_pin_window(window: &WindowSelector, pin: bool) -> String {
    let action = if pin { "\"set\"" } else { "\"unset\"" };
    format!(
        "hl.dsp.window.pin({{ window = {}, action = {action} }})",
        lua_string(&window_ref(window)),
    )
}

/// Centres a floating window on its monitor.
#[must_use]
pub fn dsp_center_window(window: &WindowSelector) -> String {
    format!(
        "hl.dsp.window.center({{ window = {} }})",
        lua_string(&window_ref(window))
    )
}

/// Groups the window with its neighbour, or dissolves its group.
#[must_use]
pub fn dsp_toggle_group(window: &WindowSelector) -> String {
    format!(
        "hl.dsp.group.toggle({{ window = {} }})",
        lua_string(&window_ref(window))
    )
}

/// Runs a command with window rules: on a desktop, silently when it must
/// not take focus.
#[must_use]
pub fn dsp_exec(command: &str, desktop: &str, focus: bool) -> String {
    let rule = if focus {
        desktop.to_string()
    } else {
        format!("{desktop} silent")
    };
    format!(
        "hl.dsp.exec_cmd({}, {{ workspace = {} }})",
        lua_string(command),
        lua_string(&rule),
    )
}

/// Applies configuration values live: `hl.config({ … })` with one fragment.
#[must_use]
pub fn config_eval(fragment: &str) -> String {
    format!("hl.config({{ {fragment} }})")
}

/// A monitor arrangement applied live: `hl.monitor({ … })`.
#[must_use]
pub fn monitor_eval(output: &str, mode: &str, position: &str, scale: f32) -> String {
    format!(
        "hl.monitor({{ output = {}, mode = {}, position = {}, scale = {scale} }})",
        lua_string(output),
        lua_string(mode),
        lua_string(position),
    )
}

/// A workspace rule applied live: `hl.workspace_rule({ … })` with one effect.
#[must_use]
pub fn workspace_rule_eval(desktop: &str, effect: &str) -> String {
    format!(
        "hl.workspace_rule({{ workspace = {}, {effect} }})",
        lua_string(desktop),
    )
}

fn number(field: &'static str, value: &str) -> Result<i32, EventParseError> {
    value
        .parse::<i32>()
        .map_err(|_| EventParseError::BadNumber {
            field,
            value: value.to_string(),
        })
}

fn flag(field: &'static str, value: &str) -> Result<bool, EventParseError> {
    match value {
        "1" => Ok(true),
        "0" => Ok(false),
        _ => Err(EventParseError::BadNumber {
            field,
            value: value.to_string(),
        }),
    }
}

/// Splits `head,MIDDLE,tail` where the middle may itself hold commas
/// (a renamed desktop): the first and last fields win.
fn split_triple(data: &str) -> Option<(&str, &str, &str)> {
    let (head, rest) = data.split_once(',')?;
    let (middle, tail) = rest.rsplit_once(',')?;
    Some((head, middle, tail))
}

/// Parses one socket2 line. Returns `None` for the legacy v1 lines whose v2
/// twin carries the same change with ids; anything unknown arrives as
/// [`CompositorEvent::Unknown`], never dropped.
pub fn parse_event_line(line: &str) -> Result<Option<CompositorEvent>, EventParseError> {
    let (name, data) = line
        .split_once(">>")
        .ok_or_else(|| EventParseError::Malformed {
            line: line.to_string(),
        })?;
    let event = match name {
        "workspace" | "focusedmon" | "activewindow" | "monitorremoved" | "monitoradded"
        | "createworkspace" | "destroyworkspace" | "moveworkspace" | "activespecial"
        | "movewindow" | "windowtitle" | "screencast" => return Ok(None),
        "workspacev2" => {
            let (id, workspace) =
                data.split_once(',')
                    .ok_or_else(|| EventParseError::Malformed {
                        line: line.to_string(),
                    })?;
            CompositorEvent::DesktopChanged {
                id: number("workspace id", id)?,
                name: workspace.to_string(),
            }
        }
        "focusedmonv2" => {
            let (monitor, id) = data
                .split_once(',')
                .ok_or_else(|| EventParseError::Malformed {
                    line: line.to_string(),
                })?;
            let _id = number("workspace id", id)?;
            CompositorEvent::MonitorFocused {
                monitor: monitor.to_string(),
                desktop: id.to_string(),
            }
        }
        "activewindowv2" => CompositorEvent::WindowFocused {
            address: data.to_string(),
        },
        "fullscreen" => CompositorEvent::FullscreenChanged {
            fullscreen: flag("fullscreen", data)?,
        },
        "monitoraddedv2" => {
            let mut parts = data.splitn(3, ',');
            let id = parts.next().unwrap_or_default();
            let monitor = parts.next().unwrap_or_default();
            CompositorEvent::MonitorAdded {
                id: number("monitor id", id)?,
                name: monitor.to_string(),
            }
        }
        "monitorremovedv2" => {
            let mut parts = data.splitn(3, ',');
            let id = parts.next().unwrap_or_default();
            let monitor = parts.next().unwrap_or_default();
            CompositorEvent::MonitorRemoved {
                id: number("monitor id", id)?,
                name: monitor.to_string(),
            }
        }
        "createworkspacev2" => {
            let (id, workspace) =
                data.split_once(',')
                    .ok_or_else(|| EventParseError::Malformed {
                        line: line.to_string(),
                    })?;
            CompositorEvent::DesktopCreated {
                id: number("workspace id", id)?,
                name: workspace.to_string(),
            }
        }
        "destroyworkspacev2" => {
            let (id, workspace) =
                data.split_once(',')
                    .ok_or_else(|| EventParseError::Malformed {
                        line: line.to_string(),
                    })?;
            CompositorEvent::DesktopDestroyed {
                id: number("workspace id", id)?,
                name: workspace.to_string(),
            }
        }
        "moveworkspacev2" => {
            let (id, workspace, monitor) =
                split_triple(data).ok_or_else(|| EventParseError::Malformed {
                    line: line.to_string(),
                })?;
            CompositorEvent::DesktopMonitorChanged {
                id: number("workspace id", id)?,
                name: workspace.to_string(),
                monitor: monitor.to_string(),
            }
        }
        "renameworkspace" => {
            let (id, name) = data
                .split_once(',')
                .ok_or_else(|| EventParseError::Malformed {
                    line: line.to_string(),
                })?;
            CompositorEvent::DesktopRenamed {
                id: number("workspace id", id)?,
                name: name.to_string(),
            }
        }
        "activespecialv2" => {
            let (id, name, monitor) =
                split_triple(data).ok_or_else(|| EventParseError::Malformed {
                    line: line.to_string(),
                })?;
            let _id = if id.is_empty() {
                -1
            } else {
                number("workspace id", id)?
            };
            CompositorEvent::SpecialChanged {
                name: name.to_string(),
                monitor: monitor.to_string(),
            }
        }
        "activelayout" => {
            let (keyboard, layout) = data.split_once(',').unwrap_or((data, ""));
            CompositorEvent::InputLayoutChanged {
                keyboard: keyboard.to_string(),
                layout: layout.to_string(),
            }
        }
        "openwindow" => {
            let mut parts = data.splitn(4, ',');
            let address = parts.next().unwrap_or_default();
            let desktop = parts.next().unwrap_or_default();
            let class = parts.next().unwrap_or_default();
            let title = parts.next().unwrap_or_default();
            if address.is_empty() || desktop.is_empty() {
                return Err(EventParseError::Malformed {
                    line: line.to_string(),
                });
            }
            CompositorEvent::WindowOpened {
                address: address.to_string(),
                desktop: desktop.to_string(),
                class: class.to_string(),
                title: title.to_string(),
            }
        }
        "closewindow" | "kill" => CompositorEvent::WindowClosed {
            address: data.to_string(),
        },
        "movewindowv2" => {
            let mut parts = data.splitn(3, ',');
            let address = parts.next().unwrap_or_default();
            let id = parts.next().unwrap_or_default();
            let name = parts.next().unwrap_or_default();
            CompositorEvent::WindowMoved {
                address: address.to_string(),
                desktop_id: number("workspace id", id)?,
                desktop_name: name.to_string(),
            }
        }
        "openlayer" => CompositorEvent::LayerOpened {
            namespace: data.to_string(),
        },
        "closelayer" => CompositorEvent::LayerClosed {
            namespace: data.to_string(),
        },
        "submap" => CompositorEvent::SubmapChanged {
            name: data.to_string(),
        },
        "changefloatingmode" => {
            let (address, floating) =
                data.split_once(',')
                    .ok_or_else(|| EventParseError::Malformed {
                        line: line.to_string(),
                    })?;
            CompositorEvent::WindowFloating {
                address: address.to_string(),
                floating: flag("floating", floating)?,
            }
        }
        "urgent" => CompositorEvent::WindowUrgent {
            address: data.to_string(),
        },
        "screencastv2" => {
            let mut parts = data.splitn(3, ',');
            let state = parts.next().unwrap_or_default();
            let owner = parts.next().unwrap_or_default();
            let target = parts.next().unwrap_or_default();
            CompositorEvent::ScreencastChanged {
                active: flag("screencast state", state)?,
                owner: owner.to_string(),
                target: target.to_string(),
            }
        }
        "windowtitlev2" => {
            let (address, title) = data.split_once(',').unwrap_or((data, ""));
            CompositorEvent::WindowTitle {
                address: address.to_string(),
                title: title.to_string(),
            }
        }
        "togglegroup" => {
            let (state, members) = data.split_once(',').unwrap_or((data, ""));
            CompositorEvent::GroupChanged {
                active: flag("group state", state)?,
                members: members.to_string(),
            }
        }
        "moveintogroup" => CompositorEvent::WindowGrouped {
            address: data.to_string(),
        },
        "moveoutofgroup" => CompositorEvent::WindowUngrouped {
            address: data.to_string(),
        },
        "ignoregrouplock" | "lockgroups" => CompositorEvent::GroupLockChanged {
            locked: flag("group lock", data)?,
        },
        "configreloaded" => CompositorEvent::ConfigReloaded,
        "pin" => {
            let (address, state) =
                data.split_once(',')
                    .ok_or_else(|| EventParseError::Malformed {
                        line: line.to_string(),
                    })?;
            CompositorEvent::WindowPinned {
                address: address.to_string(),
                pinned: flag("pin state", state)?,
            }
        }
        "minimized" => {
            let (address, state) =
                data.split_once(',')
                    .ok_or_else(|| EventParseError::Malformed {
                        line: line.to_string(),
                    })?;
            CompositorEvent::Minimized {
                address: address.to_string(),
                minimized: flag("minimized", state)?,
            }
        }
        "bell" => CompositorEvent::Bell {
            address: data.to_string(),
        },
        _ => CompositorEvent::Unknown {
            name: name.to_string(),
            data: data.to_string(),
        },
    };
    Ok(Some(event))
}

#[cfg(test)]
mod tests {
    use super::{
        config_eval, dispatch_request, dsp_exec, dsp_float_window, dsp_focus_window,
        dsp_focus_workspace, dsp_fullscreen_window, dsp_move_window, dsp_rename_desktop,
        eval_request, info_request, lua_string, monitor_eval, window_ref, workspace_rule_eval,
    };
    use crate::port::{FullscreenMode, WindowSelector};

    #[test]
    fn lua_strings_keep_quotes_and_newlines_data() {
        assert_eq!(lua_string("plain"), "\"plain\"");
        assert_eq!(lua_string("a\"b\\c"), "\"a\\\"b\\\\c\"");
        assert_eq!(lua_string("a\nb\rc\0d"), "\"a\\nb\\rc\\0d\"");
        // A label that tries to break out of the call stays one string.
        assert_eq!(
            lua_string("x\"}), hl.dsp.exit(), ({\""),
            "\"x\\\"}), hl.dsp.exit(), ({\\\"\"",
        );
    }

    #[test]
    fn window_selectors_render_hyprland_syntax() {
        assert_eq!(window_ref(&WindowSelector::Active), "activewindow");
        assert_eq!(
            window_ref(&WindowSelector::Address("0x1a2b".to_string())),
            "address:0x1a2b"
        );
        assert_eq!(
            window_ref(&WindowSelector::Class("foot".to_string())),
            "class:foot"
        );
        assert_eq!(
            window_ref(&WindowSelector::Title("t".to_string())),
            "title:t"
        );
    }

    #[test]
    fn requests_take_the_socket_forms() {
        assert_eq!(info_request("clients"), "j/clients");
        assert_eq!(dispatch_request("hl.dsp.exit()"), "dispatch hl.dsp.exit()");
        assert_eq!(eval_request("1 + 1"), "eval 1 + 1");
    }

    #[test]
    fn dispatchers_take_the_lua_forms() {
        assert_eq!(
            dsp_focus_workspace("3"),
            "hl.dsp.focus({ workspace = \"3\" })",
        );
        assert_eq!(
            dsp_move_window(Some(&WindowSelector::Active), "2", true),
            "hl.dsp.window.move({ window = \"activewindow\", workspace = \"2\", follow = true })",
        );
        assert_eq!(
            dsp_move_window(None, "1", false),
            "hl.dsp.window.move({ window = \"activewindow\", workspace = \"1\", follow = false })",
        );
        assert_eq!(
            dsp_rename_desktop("3", "agent:fix"),
            "hl.dsp.workspace.rename({ workspace = \"3\", name = \"agent:fix\" })",
        );
        assert_eq!(
            dsp_float_window(&WindowSelector::Class("foot".to_string()), true),
            "hl.dsp.window.float({ window = \"class:foot\", action = \"set\" })",
        );
        assert_eq!(
            dsp_focus_window(&WindowSelector::Address("0x1".to_string())),
            "hl.dsp.focus({ window = \"address:0x1\" })",
        );
        assert_eq!(
            dsp_fullscreen_window(&WindowSelector::Active, Some(FullscreenMode::Maximize)),
            "hl.dsp.window.fullscreen({ window = \"activewindow\", action = \"set\", mode = \"maximized\" })",
        );
        assert_eq!(
            dsp_fullscreen_window(&WindowSelector::Active, Some(FullscreenMode::Fullscreen)),
            "hl.dsp.window.fullscreen({ window = \"activewindow\", action = \"set\", mode = \"fullscreen\" })",
        );
        assert_eq!(
            dsp_fullscreen_window(&WindowSelector::Active, None),
            "hl.dsp.window.fullscreen({ window = \"activewindow\", action = \"unset\" })",
        );
    }

    #[test]
    fn exec_rules_hold_the_desktop_and_the_silence() {
        assert_eq!(
            dsp_exec("foot", "3", true),
            "hl.dsp.exec_cmd(\"foot\", { workspace = \"3\" })",
        );
        assert_eq!(
            dsp_exec("foot --project /tmp/p", "4", false),
            "hl.dsp.exec_cmd(\"foot --project /tmp/p\", { workspace = \"4 silent\" })",
        );
    }

    #[test]
    fn live_application_calls_take_the_lua_forms() {
        assert_eq!(
            config_eval("general = { gaps_in = 6 }"),
            "hl.config({ general = { gaps_in = 6 } })"
        );
        assert_eq!(
            monitor_eval("HEADLESS-1", "1920x1080@60", "auto", 1.0),
            "hl.monitor({ output = \"HEADLESS-1\", mode = \"1920x1080@60\", position = \"auto\", scale = 1 })",
        );
        assert_eq!(
            workspace_rule_eval("2", "layout = \"master\""),
            "hl.workspace_rule({ workspace = \"2\", layout = \"master\" })",
        );
    }
}
