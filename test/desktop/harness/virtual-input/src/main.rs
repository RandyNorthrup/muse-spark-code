//! muse-virtual-input — the M111 desktop harness's input driver.
//!
//! A Wayland client speaking zwp_virtual_keyboard_v1 and
//! zwlr_virtual_pointer_v1 (both implemented by Hyprland), so scenes can
//! be driven in a headless session where aquamarine has no physical
//! input devices. Commands arrive as lines on stdin (see commands.rs);
//! `ok <n>` is printed after each executed line and flushed.

mod commands;
mod keys;

use std::collections::HashSet;
use std::fs::File;
use std::io::{self, BufRead, Write};
use std::os::fd::AsFd;
use std::os::unix::net::UnixStream;
use std::path::PathBuf;
use std::time::{Duration, Instant};

use wayland_client::protocol::wl_pointer::{Axis, ButtonState};
use wayland_client::protocol::wl_registry::WlRegistry;
use wayland_client::protocol::wl_seat::WlSeat;
use wayland_client::{delegate_noop, Connection, Dispatch, EventQueue, Proxy, QueueHandle};
use wayland_protocols_misc::zwp_virtual_keyboard_v1::client::zwp_virtual_keyboard_manager_v1::ZwpVirtualKeyboardManagerV1;
use wayland_protocols_misc::zwp_virtual_keyboard_v1::client::zwp_virtual_keyboard_v1::ZwpVirtualKeyboardV1;
use wayland_protocols_wlr::virtual_pointer::v1::client::zwlr_virtual_pointer_manager_v1::ZwlrVirtualPointerManagerV1;
use wayland_protocols_wlr::virtual_pointer::v1::client::zwlr_virtual_pointer_v1::ZwlrVirtualPointerV1;

use commands::{parse_line, Command, Press};

const KEYMAP: &str = include_str!("../us.keymap");

// The misc protocol carries these as plain u32; the values are
// wl_keyboard's (keymap_format.xkb_v1 = 1, key_state released = 0,
// pressed = 1), which the protocol text names as its enumerations.
const KEYMAP_FORMAT_XKB_V1: u32 = 1;
const KEY_RELEASED: u32 = 0;
const KEY_PRESSED: u32 = 1;

#[derive(Default)]
struct State {
    globals: Vec<(u32, String, u32)>,
}

impl Dispatch<WlRegistry, ()> for State {
    fn event(
        state: &mut Self,
        _registry: &WlRegistry,
        event: wayland_client::protocol::wl_registry::Event,
        _data: &(),
        _connection: &Connection,
        _qh: &QueueHandle<Self>,
    ) {
        if let wayland_client::protocol::wl_registry::Event::Global {
            name,
            interface,
            version,
        } = event
        {
            state.globals.push((name, interface, version));
        }
    }
}

delegate_noop!(State: ignore WlSeat);
delegate_noop!(State: ignore ZwpVirtualKeyboardManagerV1);
delegate_noop!(State: ignore ZwpVirtualKeyboardV1);
delegate_noop!(State: ignore ZwlrVirtualPointerManagerV1);
delegate_noop!(State: ignore ZwlrVirtualPointerV1);

struct Driver {
    queue: EventQueue<State>,
    state: State,
    keyboard: ZwpVirtualKeyboardV1,
    pointer: Option<ZwlrVirtualPointerV1>,
    started: Instant,
    pressed: HashSet<u32>,
}

fn modifier_mask(pressed: &HashSet<u32>) -> u32 {
    // xkb modifier indices in the uploaded keymap: Shift 0, Lock 1,
    // Control 2, Mod1 (Alt) 3, Mod4 (Super) 6.
    let mut mask = 0;
    if pressed.contains(&42) || pressed.contains(&54) {
        mask |= 1 << 0;
    }
    if pressed.contains(&58) {
        mask |= 1 << 1;
    }
    if pressed.contains(&29) || pressed.contains(&97) {
        mask |= 1 << 2;
    }
    if pressed.contains(&56) || pressed.contains(&100) {
        mask |= 1 << 3;
    }
    if pressed.contains(&125) || pressed.contains(&126) {
        mask |= 1 << 6;
    }
    mask
}

impl Driver {
    fn now_ms(&self) -> u32 {
        self.started.elapsed().as_millis() as u32
    }

    fn key(&mut self, name: &str, action: Press) -> Result<(), String> {
        let code = keys::key_code(name).ok_or_else(|| format!("unknown key {name}"))?;
        match action {
            Press::Down => self.key_event(code, true),
            Press::Up => self.key_event(code, false),
            Press::Tap => {
                self.key_event(code, true);
                self.key_event(code, false);
            }
        }
        Ok(())
    }

    fn key_event(&mut self, code: u32, down: bool) {
        if down {
            self.pressed.insert(code);
        } else {
            self.pressed.remove(&code);
        }
        self.keyboard.key(
            self.now_ms(),
            code,
            if down { KEY_PRESSED } else { KEY_RELEASED },
        );
        self.keyboard
            .modifiers(modifier_mask(&self.pressed), 0, 0, 0);
    }

    fn pointer(&self) -> Result<&ZwlrVirtualPointerV1, String> {
        self.pointer
            .as_ref()
            .ok_or_else(|| "the compositor offers no zwlr_virtual_pointer_manager_v1".to_owned())
    }

    fn execute(&mut self, command: &Command) -> Result<(), String> {
        match command {
            Command::Key { name, action } => self.key(name, *action),
            Command::Combo { keys: combo } => {
                for name in combo {
                    self.key(name, Press::Down)?;
                }
                for name in combo.iter().rev() {
                    self.key(name, Press::Up)?;
                }
                Ok(())
            }
            Command::Text { text } => {
                let strokes = keys::strokes_for_text(text)
                    .map_err(|ch| format!("cannot type character {ch:?} on the US keymap"))?;
                let shift_code = keys::key_code("leftshift").expect("shift is in the table");
                for stroke in strokes {
                    if stroke.shift {
                        self.key_event(shift_code, true);
                    }
                    self.key(stroke.key, Press::Tap)?;
                    if stroke.shift {
                        self.key_event(shift_code, false);
                    }
                }
                Ok(())
            }
            Command::Move { dx, dy } => {
                let pointer = self.pointer()?;
                pointer.motion(self.now_ms(), *dx as f64, *dy as f64);
                pointer.frame();
                Ok(())
            }
            Command::MoveTo {
                x,
                y,
                width,
                height,
            } => {
                let pointer = self.pointer()?;
                pointer.motion_absolute(self.now_ms(), *x, *y, *width, *height);
                pointer.frame();
                Ok(())
            }
            Command::Button { name, action } => {
                let code =
                    keys::button_code(name).ok_or_else(|| format!("unknown button {name}"))?;
                let pointer = self.pointer()?;
                let press = |down: bool| {
                    pointer.button(
                        self.now_ms(),
                        code,
                        if down {
                            ButtonState::Pressed
                        } else {
                            ButtonState::Released
                        },
                    );
                };
                match action {
                    Press::Down => press(true),
                    Press::Up => press(false),
                    Press::Tap => {
                        press(true);
                        press(false);
                    }
                }
                pointer.frame();
                Ok(())
            }
            Command::Scroll { dx, dy } => {
                let pointer = self.pointer()?;
                if *dx != 0.0 {
                    pointer.axis(self.now_ms(), Axis::HorizontalScroll, *dx);
                }
                if *dy != 0.0 {
                    pointer.axis(self.now_ms(), Axis::VerticalScroll, *dy);
                }
                pointer.frame();
                Ok(())
            }
            Command::Sleep { ms } => {
                std::thread::sleep(Duration::from_millis(*ms));
                Ok(())
            }
        }
    }

    fn sync(&mut self) -> Result<(), String> {
        self.queue
            .roundtrip(&mut self.state)
            .map_err(|error| format!("the compositor roundtrip failed: {error}"))?;
        Ok(())
    }
}

fn keymap_file() -> io::Result<File> {
    let name = format!("muse-virtual-input-{}", std::process::id());
    let path = PathBuf::from("/dev/shm").join(name);
    let mut file = File::create(&path)?;
    file.write_all(KEYMAP.as_bytes())?;
    file.sync_all()?;
    std::fs::remove_file(&path)?;
    Ok(file)
}

fn connect(socket: Option<&str>) -> Result<Connection, String> {
    match socket {
        None => Connection::connect_to_env()
            .map_err(|error| format!("cannot connect to the Wayland session: {error}")),
        Some(name) => {
            let path = if name.starts_with('/') {
                PathBuf::from(name)
            } else {
                let runtime = std::env::var_os("XDG_RUNTIME_DIR")
                    .ok_or("XDG_RUNTIME_DIR is not set and the socket name is relative")?;
                PathBuf::from(runtime).join(name)
            };
            let stream = UnixStream::connect(&path).map_err(|error| {
                format!(
                    "cannot connect to the Wayland socket {}: {error}",
                    path.display()
                )
            })?;
            Connection::from_socket(stream)
                .map_err(|error| format!("cannot use the Wayland socket: {error}"))
        }
    }
}

fn bind<T: Proxy + 'static>(
    state: &State,
    registry: &WlRegistry,
    qh: &QueueHandle<State>,
) -> Result<T, String>
where
    State: Dispatch<T, ()>,
{
    let interface = T::interface().name;
    let (name, _, version) = state
        .globals
        .iter()
        .find(|(_, found, _)| found == interface)
        .ok_or_else(|| format!("the compositor offers no {interface}"))?;
    Ok(registry.bind(*name, (*version).min(T::interface().version), qh, ()))
}

fn run(socket: Option<&str>) -> Result<(), String> {
    let connection = connect(socket)?;
    let mut queue: EventQueue<State> = connection.new_event_queue();
    let qh: QueueHandle<State> = queue.handle();
    let registry = connection.display().get_registry(&qh, ());
    let mut state = State::default();
    queue
        .roundtrip(&mut state)
        .map_err(|error| format!("cannot read the compositor's globals: {error}"))?;
    let seat: WlSeat = bind(&state, &registry, &qh)?;
    let keyboard_manager: ZwpVirtualKeyboardManagerV1 = bind(&state, &registry, &qh)?;
    let pointer_manager: Option<ZwlrVirtualPointerManagerV1> = bind(&state, &registry, &qh).ok();

    let keyboard = keyboard_manager.create_virtual_keyboard(&seat, &qh, ());
    let file = keymap_file().map_err(|error| format!("cannot stage the keymap: {error}"))?;
    keyboard.keymap(KEYMAP_FORMAT_XKB_V1, file.as_fd(), KEYMAP.len() as u32);
    let pointer =
        pointer_manager.map(|manager| manager.create_virtual_pointer(Some(&seat), &qh, ()));

    let mut driver = Driver {
        queue,
        state,
        keyboard,
        pointer,
        started: Instant::now(),
        pressed: HashSet::new(),
    };
    driver.sync()?;
    println!("ready");
    io::stdout().flush().ok();

    let stdin = io::stdin();
    let mut lines = stdin.lock().lines();
    let mut executed: u64 = 0;
    for line in lines.by_ref() {
        let line = line.map_err(|error| format!("cannot read commands: {error}"))?;
        let command = parse_line(&line)?;
        let Some(command) = command else { continue };
        driver.execute(&command)?;
        driver.sync()?;
        executed += 1;
        println!("ok {executed}");
        io::stdout().flush().ok();
    }
    Ok(())
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let socket = match args.as_slice() {
        [] => None,
        [flag, value] if flag == "--socket" => Some(value.as_str()),
        [flag] if flag == "--help" || flag == "-h" => {
            println!(
                "muse-virtual-input [--socket <wayland socket>]\n\nReads one command per stdin line:\n  key <name> down|up|tap · combo <key>+<key> · text <words>\n  move <dx> <dy> · move-to <x> <y> <w> <h> · button <name> down|up|click\n  scroll <dx> <dy> · sleep <ms>\nPrints `ready`, then `ok <n>` per executed line."
            );
            return;
        }
        _ => {
            eprintln!("usage: muse-virtual-input [--socket <wayland socket>]");
            std::process::exit(2);
        }
    };
    if let Err(error) = run(socket) {
        eprintln!("muse-virtual-input: {error}");
        std::process::exit(1);
    }
}
