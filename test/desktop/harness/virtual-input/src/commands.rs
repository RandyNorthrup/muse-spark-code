//! The driver's line protocol: one command per stdin line, `ok <n>` back
//! per executed line. Pure parsing lives here so it is unit-tested
//! without a compositor.

/// One parsed harness command.
#[derive(Debug, Clone, PartialEq)]
pub enum Command {
    /// `key <name> down|up|tap`
    Key { name: String, action: Press },
    /// `combo <key>+<key>[+<key>...]` (pressed together, released in reverse)
    Combo { keys: Vec<String> },
    /// `text <the rest of the line>`
    Text { text: String },
    /// `move <dx> <dy>` (relative, in pixels)
    Move { dx: i32, dy: i32 },
    /// `move-to <x> <y> <output-width> <output-height>`
    MoveTo {
        x: u32,
        y: u32,
        width: u32,
        height: u32,
    },
    /// `button <left|right|middle> down|up|click`
    Button { name: String, action: Press },
    /// `scroll <dx> <dy>` (axis values, 15.0 is one wheel step by convention)
    Scroll { dx: f64, dy: f64 },
    /// `sleep <milliseconds>`
    Sleep { ms: u64 },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Press {
    Down,
    Up,
    Tap,
}

fn press(word: Option<&str>, allow_tap_word: &str) -> Result<Press, String> {
    match word {
        Some("down") => Ok(Press::Down),
        Some("up") => Ok(Press::Up),
        Some(word) if word == allow_tap_word => Ok(Press::Tap),
        other => Err(format!(
            "expected down, up or {allow_tap_word}, got {}",
            other.unwrap_or("(nothing)")
        )),
    }
}

fn number<T: std::str::FromStr>(words: &[&str], index: usize, what: &str) -> Result<T, String> {
    let word = words.get(index).ok_or_else(|| format!("missing {what}"))?;
    word.parse::<T>()
        .map_err(|_| format!("{what} is not a number: {word}"))
}

/// Parses one protocol line. Blank lines and `#` comments parse to None.
pub fn parse_line(line: &str) -> Result<Option<Command>, String> {
    let trimmed = line.trim_end_matches(['\n', '\r']);
    if trimmed.trim().is_empty() || trimmed.trim_start().starts_with('#') {
        return Ok(None);
    }
    if let Some(text) = trimmed.strip_prefix("text ") {
        return Ok(Some(Command::Text {
            text: text.to_owned(),
        }));
    }
    let words: Vec<&str> = trimmed.split_whitespace().collect();
    let command = match words[0] {
        "key" => Command::Key {
            name: words.get(1).ok_or("key needs a key name")?.to_string(),
            action: press(words.get(2).copied(), "tap")?,
        },
        "combo" => {
            let spec = words.get(1).ok_or("combo needs keys joined with +")?;
            let keys: Vec<String> = spec.split('+').map(str::to_owned).collect();
            if keys.iter().any(|k| k.is_empty()) || keys.len() < 2 {
                return Err("combo needs at least two keys joined with +".into());
            }
            Command::Combo { keys }
        }
        "text" => Command::Text {
            text: String::new(),
        },
        "move" => Command::Move {
            dx: number(&words, 1, "move dx")?,
            dy: number(&words, 2, "move dy")?,
        },
        "move-to" => Command::MoveTo {
            x: number(&words, 1, "move-to x")?,
            y: number(&words, 2, "move-to y")?,
            width: number(&words, 3, "move-to output width")?,
            height: number(&words, 4, "move-to output height")?,
        },
        "button" => Command::Button {
            name: words
                .get(1)
                .ok_or("button needs a button name")?
                .to_string(),
            action: press(words.get(2).copied(), "click")?,
        },
        "scroll" => Command::Scroll {
            dx: number(&words, 1, "scroll dx")?,
            dy: number(&words, 2, "scroll dy")?,
        },
        "sleep" => Command::Sleep {
            ms: number(&words, 1, "sleep milliseconds")?,
        },
        other => return Err(format!("unknown command {other}")),
    };
    Ok(Some(command))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_every_command() {
        assert_eq!(
            parse_line("key super tap").unwrap(),
            Some(Command::Key {
                name: "super".into(),
                action: Press::Tap
            })
        );
        assert_eq!(
            parse_line("combo ctrl+alt+t").unwrap(),
            Some(Command::Combo {
                keys: vec!["ctrl".into(), "alt".into(), "t".into()]
            })
        );
        assert_eq!(
            parse_line("text hello world").unwrap(),
            Some(Command::Text {
                text: "hello world".into()
            })
        );
        assert_eq!(
            parse_line("move -5 10").unwrap(),
            Some(Command::Move { dx: -5, dy: 10 })
        );
        assert_eq!(
            parse_line("move-to 100 50 1920 1080").unwrap(),
            Some(Command::MoveTo {
                x: 100,
                y: 50,
                width: 1920,
                height: 1080
            })
        );
        assert_eq!(
            parse_line("button left click").unwrap(),
            Some(Command::Button {
                name: "left".into(),
                action: Press::Tap
            })
        );
        assert_eq!(
            parse_line("scroll 0 -15.5").unwrap(),
            Some(Command::Scroll { dx: 0.0, dy: -15.5 })
        );
        assert_eq!(parse_line("  # a comment").unwrap(), None);
        assert_eq!(parse_line("").unwrap(), None);
    }

    #[test]
    fn refuses_malformed_lines() {
        assert!(parse_line("key a sideways").is_err());
        assert!(parse_line("combo ctrl").is_err());
        assert!(parse_line("move one 2").is_err());
        assert!(parse_line("dance now").is_err());
        assert!(parse_line("button left").is_err());
    }
}
