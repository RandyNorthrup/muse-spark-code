//! The wire, locked to recordings: socket2 parsing and socket1 reply
//! mapping over the captures in `fixtures/` (see its README for the
//! capture dates and commands). No compositor runs here; the guest
//! sessions in `docs/certification/rlf-m111cp.md` ran it.

use muse_compositor_port::hyprland::protocol::{parse_event_line, EventParseError};
use muse_compositor_port::hyprland::{
    parse_active_desktop, parse_active_window, parse_desktops, parse_devices, parse_monitors,
    parse_windows,
};
use muse_compositor_port::port::CompositorEvent;
use std::collections::HashMap;

fn fixture(name: &str) -> String {
    let path = format!("{}/tests/fixtures/{name}", env!("CARGO_MANIFEST_DIR"));
    std::fs::read_to_string(&path).unwrap_or_else(|_| panic!("missing fixture {name}"))
}

fn monitor_names() -> HashMap<i32, String> {
    parse_monitors(&fixture("monitors.json"))
        .expect("monitors parse")
        .into_iter()
        .map(|m| (m.id, m.name))
        .collect()
}

#[test]
fn s1_stream_parses_in_order_with_v1_twins_skipped() {
    let stream = fixture("events-s1.log");
    let lines: Vec<&str> = stream.lines().collect();
    assert_eq!(lines.len(), 24, "the recording grew or shrank");
    let parsed: Vec<Option<CompositorEvent>> = lines
        .iter()
        .map(|line| parse_event_line(line).expect("a recorded line parses"))
        .collect();
    let renamed = |id: i32, name: &str| {
        Some(CompositorEvent::DesktopRenamed {
            id,
            name: name.to_string(),
        })
    };
    let layout = |keyboard: &str, layout: &str| {
        Some(CompositorEvent::InputLayoutChanged {
            keyboard: keyboard.to_string(),
            layout: layout.to_string(),
        })
    };
    let expected = vec![
        None,
        Some(CompositorEvent::DesktopCreated {
            id: 2,
            name: "2".to_string(),
        }),
        None,
        Some(CompositorEvent::DesktopChanged {
            id: 2,
            name: "2".to_string(),
        }),
        None,
        Some(CompositorEvent::DesktopDestroyed {
            id: 1,
            name: "1".to_string(),
        }),
        renamed(2, "agent:fix"),
        renamed(2, "2"),
        layout("hl-virtual-keyboard-wtype", "English (US)"),
        layout("hl-virtual-keyboard-wtype", "error"),
        None,
        Some(CompositorEvent::DesktopCreated {
            id: 1,
            name: "1".to_string(),
        }),
        None,
        Some(CompositorEvent::DesktopChanged {
            id: 1,
            name: "1".to_string(),
        }),
        None,
        Some(CompositorEvent::DesktopDestroyed {
            id: 2,
            name: "2".to_string(),
        }),
        layout("hl-virtual-keyboard-cp1", "English (US)"),
        None,
        Some(CompositorEvent::DesktopCreated {
            id: 2,
            name: "2".to_string(),
        }),
        None,
        // The C1 keypress, still in order: back to 2 after the focus to 1.
        Some(CompositorEvent::DesktopChanged {
            id: 2,
            name: "2".to_string(),
        }),
        None,
        Some(CompositorEvent::DesktopDestroyed {
            id: 1,
            name: "1".to_string(),
        }),
        layout("cp-proof-pending", "English (US)"),
    ];
    assert_eq!(parsed, expected);
}

#[test]
fn s3_stream_moves_opens_and_titles_carry_their_fields() {
    let mut moved = 0;
    let mut opened = 0;
    let mut titles = 0;
    let mut focused = 0;
    for line in fixture("events-s3.log").lines() {
        let parsed = parse_event_line(line).expect("a recorded line parses");
        if line.starts_with("movewindow>>") || line.starts_with("activewindow>>") {
            assert_eq!(parsed, None, "v1 twin skipped: {line}");
        } else if let Some(rest) = line.strip_prefix("movewindowv2>>") {
            let mut parts = rest.splitn(3, ',');
            let address = parts.next().unwrap_or_default();
            let id: i32 = parts.next().unwrap_or_default().parse().expect("id");
            let name = parts.next().unwrap_or_default();
            assert_eq!(
                parsed,
                Some(CompositorEvent::WindowMoved {
                    address: address.to_string(),
                    desktop_id: id,
                    desktop_name: name.to_string(),
                })
            );
            moved += 1;
        } else if let Some(rest) = line.strip_prefix("openwindow>>") {
            let mut parts = rest.splitn(4, ',');
            assert_eq!(
                parsed,
                Some(CompositorEvent::WindowOpened {
                    address: parts.next().unwrap_or_default().to_string(),
                    desktop: parts.next().unwrap_or_default().to_string(),
                    class: parts.next().unwrap_or_default().to_string(),
                    title: parts.next().unwrap_or_default().to_string(),
                })
            );
            opened += 1;
        } else if let Some(rest) = line.strip_prefix("windowtitlev2>>") {
            let (address, title) = rest.split_once(',').unwrap_or((rest, ""));
            assert_eq!(
                parsed,
                Some(CompositorEvent::WindowTitle {
                    address: address.to_string(),
                    title: title.to_string(),
                })
            );
            titles += 1;
        } else if line.starts_with("activewindowv2>>") {
            assert!(
                matches!(parsed, Some(CompositorEvent::WindowFocused { .. })),
                "{line}"
            );
            focused += 1;
        }
    }
    // The recording's own shape: three feet opened, five moves (the
    // fallback, the merge, the send to a new desktop), three titles, eight
    // focus changes. Zero of any is a changed capture, not a pass.
    assert_eq!((opened, moved, titles, focused), (3, 5, 3, 8));
}

#[test]
fn malformed_lines_report_without_a_shape() {
    assert!(matches!(
        parse_event_line("workspacev2"),
        Err(EventParseError::Malformed { .. })
    ));
    assert!(matches!(
        parse_event_line("workspacev2>>x,2"),
        Err(EventParseError::BadNumber { .. })
    ));
}

#[test]
fn workspaces_map_with_windows_and_monitors() {
    let desktops = parse_desktops(&fixture("workspaces.json")).expect("workspaces parse");
    assert_eq!(desktops.len(), 2);
    assert_eq!(desktops[0].id, 1);
    assert_eq!(desktops[0].name, "1");
    assert_eq!(desktops[0].windows, 0);
    assert_eq!(desktops[1].id, 2);
    assert_eq!(desktops[1].name, "2");
    assert_eq!(desktops[1].windows, 3);
    for desktop in &desktops {
        assert_eq!(desktop.monitor, "Virtual-1");
        assert_eq!(desktop.monitor_id, 0);
        assert!(!desktop.fullscreen);
    }
    assert_eq!(desktops[1].last_window, "0x55ffacf95430");
}

#[test]
fn monitors_carry_mode_position_and_the_active_desktop() {
    let monitors = parse_monitors(&fixture("monitors.json")).expect("monitors parse");
    assert_eq!(monitors.len(), 1);
    let monitor = &monitors[0];
    assert_eq!(monitor.id, 0);
    assert_eq!(monitor.name, "Virtual-1");
    assert_eq!(monitor.description, "Red Hat Inc. QEMU Monitor");
    assert_eq!((monitor.width, monitor.height), (800, 600));
    assert!((monitor.refresh_rate - 60.317).abs() < 0.001);
    assert_eq!((monitor.x, monitor.y), (0, 0));
    assert_eq!(monitor.scale, 1.0);
    assert_eq!(monitor.active_desktop, 1);
}

#[test]
fn clients_map_with_desktops_and_resolved_monitors() {
    let windows = parse_windows(&fixture("clients.json"), &monitor_names()).expect("clients parse");
    assert_eq!(windows.len(), 3);
    let titles: Vec<&str> = windows.iter().map(|w| w.title.as_str()).collect();
    assert_eq!(titles, vec!["cp-direct", "cp-exec", "cp-fb"]);
    for window in &windows {
        assert_eq!(window.class, "foot");
        assert_eq!(window.desktop_id, 2);
        assert_eq!(window.desktop_name, "2");
        assert_eq!(window.monitor, "Virtual-1");
        assert!(!window.floating);
        assert!(!window.fullscreen);
        assert!(!window.pinned);
        assert!(window.pid > 0);
        assert!(window.address.starts_with("0x"));
    }
    let active = parse_active_desktop(&fixture("activeworkspace.json")).expect("active parses");
    assert_eq!(active.id, 1);
    assert_eq!(active.name, "1");
}

#[test]
fn empty_active_window_is_no_focus() {
    let monitors = monitor_names();
    assert_eq!(
        parse_active_window(&fixture("activewindow.json"), &monitors).expect("parses"),
        None
    );
}

#[test]
fn devices_split_mice_and_keyboards_with_live_keymaps() {
    let devices = parse_devices(&fixture("devices.json")).expect("devices parse");
    let mice: Vec<&str> = devices
        .iter()
        .filter(|d| d.kind == "mouse")
        .map(|d| d.name.as_str())
        .collect();
    assert_eq!(
        mice,
        vec!["qemu-virtio-tablet", "imexps/2-generic-explorer-mouse"]
    );
    let keyboards: Vec<(&str, &str)> = devices
        .iter()
        .filter(|d| d.kind == "keyboard")
        .map(|d| (d.name.as_str(), d.layout.as_str()))
        .collect();
    // The active keymap wins over the layout code (`us` on the wire).
    assert_eq!(
        keyboards,
        vec![
            ("qemu-virtio-keyboard", "English (US)"),
            ("power-button", "English (US)"),
            ("at-translated-set-2-keyboard", "English (US)"),
        ]
    );
}

#[test]
fn garbage_replies_are_invalid_json_not_panics() {
    assert!(matches!(
        parse_desktops("nope"),
        Err(muse_compositor_port::hyprland::HyprlandError::InvalidJson { .. })
    ));
    assert!(matches!(
        parse_windows("nope", &HashMap::new()),
        Err(muse_compositor_port::hyprland::HyprlandError::InvalidJson { .. })
    ));
}
