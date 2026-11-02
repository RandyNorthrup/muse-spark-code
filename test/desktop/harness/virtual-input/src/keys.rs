//! Key and button names to Linux evdev codes (input-event-codes.h), and
//! text typing over the US keymap this driver uploads. The virtual
//! keyboard protocol takes evdev keycodes; the compositor adds the xkb
//! offset itself.

/// Looks up an evdev key code by its harness name (case-insensitive).
pub fn key_code(name: &str) -> Option<u32> {
    let code = match name.to_ascii_lowercase().as_str() {
        "esc" | "escape" => 1,
        "1" => 2,
        "2" => 3,
        "3" => 4,
        "4" => 5,
        "5" => 6,
        "6" => 7,
        "7" => 8,
        "8" => 9,
        "9" => 10,
        "0" => 11,
        "minus" => 12,
        "equal" => 13,
        "backspace" => 14,
        "tab" => 15,
        "q" => 16,
        "w" => 17,
        "e" => 18,
        "r" => 19,
        "t" => 20,
        "y" => 21,
        "u" => 22,
        "i" => 23,
        "o" => 24,
        "p" => 25,
        "leftbrace" => 26,
        "rightbrace" => 27,
        "enter" | "return" => 28,
        "leftctrl" | "ctrl" => 29,
        "a" => 30,
        "s" => 31,
        "d" => 32,
        "f" => 33,
        "g" => 34,
        "h" => 35,
        "j" => 36,
        "k" => 37,
        "l" => 38,
        "semicolon" => 39,
        "apostrophe" => 40,
        "grave" => 41,
        "leftshift" | "shift" => 42,
        "backslash" => 43,
        "z" => 44,
        "x" => 45,
        "c" => 46,
        "v" => 47,
        "b" => 48,
        "n" => 49,
        "m" => 50,
        "comma" => 51,
        "dot" | "period" => 52,
        "slash" => 53,
        "rightshift" => 54,
        "leftalt" | "alt" => 56,
        "space" => 57,
        "capslock" => 58,
        "f1" => 59,
        "f2" => 60,
        "f3" => 61,
        "f4" => 62,
        "f5" => 63,
        "f6" => 64,
        "f7" => 65,
        "f8" => 66,
        "f9" => 67,
        "f10" => 68,
        "f11" => 87,
        "f12" => 88,
        "rightctrl" => 97,
        "rightalt" => 100,
        "home" => 102,
        "up" => 103,
        "pageup" => 104,
        "left" => 105,
        "right" => 106,
        "end" => 107,
        "down" => 108,
        "pagedown" => 109,
        "insert" => 110,
        "delete" => 111,
        "leftmeta" | "super" | "meta" => 125,
        "rightmeta" => 126,
        _ => return None,
    };
    Some(code)
}

/// An evdev pointer button code by name.
pub fn button_code(name: &str) -> Option<u32> {
    match name.to_ascii_lowercase().as_str() {
        "left" => Some(0x110),
        "right" => Some(0x111),
        "middle" => Some(0x112),
        _ => None,
    }
}

/// One key stroke while typing text: a key name plus whether Shift is held.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Stroke {
    pub key: &'static str,
    pub shift: bool,
}

/// Maps one character of `text` input to a stroke on the US keymap.
/// Returns None for a character the layout cannot type, so the caller
/// refuses the whole string instead of typing half of it.
pub fn stroke_for(ch: char) -> Option<Stroke> {
    let plain = |key| Some(Stroke { key, shift: false });
    let shifted = |key| Some(Stroke { key, shift: true });
    match ch {
        'a'..='z' => plain(match ch {
            'a' => "a",
            'b' => "b",
            'c' => "c",
            'd' => "d",
            'e' => "e",
            'f' => "f",
            'g' => "g",
            'h' => "h",
            'i' => "i",
            'j' => "j",
            'k' => "k",
            'l' => "l",
            'm' => "m",
            'n' => "n",
            'o' => "o",
            'p' => "p",
            'q' => "q",
            'r' => "r",
            's' => "s",
            't' => "t",
            'u' => "u",
            'v' => "v",
            'w' => "w",
            'x' => "x",
            'y' => "y",
            _ => "z",
        }),
        'A'..='Z' => shifted(match ch.to_ascii_lowercase() {
            'a' => "a",
            'b' => "b",
            'c' => "c",
            'd' => "d",
            'e' => "e",
            'f' => "f",
            'g' => "g",
            'h' => "h",
            'i' => "i",
            'j' => "j",
            'k' => "k",
            'l' => "l",
            'm' => "m",
            'n' => "n",
            'o' => "o",
            'p' => "p",
            'q' => "q",
            'r' => "r",
            's' => "s",
            't' => "t",
            'u' => "u",
            'v' => "v",
            'w' => "w",
            'x' => "x",
            'y' => "y",
            _ => "z",
        }),
        '0'..='9' => plain(match ch {
            '0' => "0",
            '1' => "1",
            '2' => "2",
            '3' => "3",
            '4' => "4",
            '5' => "5",
            '6' => "6",
            '7' => "7",
            '8' => "8",
            _ => "9",
        }),
        ' ' => plain("space"),
        '\n' => plain("enter"),
        '\t' => plain("tab"),
        '-' => plain("minus"),
        '_' => shifted("minus"),
        '=' => plain("equal"),
        '+' => shifted("equal"),
        '[' => plain("leftbrace"),
        '{' => shifted("leftbrace"),
        ']' => plain("rightbrace"),
        '}' => shifted("rightbrace"),
        ';' => plain("semicolon"),
        ':' => shifted("semicolon"),
        '\'' => plain("apostrophe"),
        '"' => shifted("apostrophe"),
        '`' => plain("grave"),
        '~' => shifted("grave"),
        '\\' => plain("backslash"),
        '|' => shifted("backslash"),
        ',' => plain("comma"),
        '<' => shifted("comma"),
        '.' => plain("dot"),
        '>' => shifted("dot"),
        '/' => plain("slash"),
        '?' => shifted("slash"),
        '!' => shifted("1"),
        '@' => shifted("2"),
        '#' => shifted("3"),
        '$' => shifted("4"),
        '%' => shifted("5"),
        '^' => shifted("6"),
        '&' => shifted("7"),
        '*' => shifted("8"),
        '(' => shifted("9"),
        ')' => shifted("0"),
        _ => None,
    }
}

/// The strokes for a whole string, or the first untypeable character.
pub fn strokes_for_text(text: &str) -> Result<Vec<Stroke>, char> {
    let mut strokes = Vec::with_capacity(text.len());
    for ch in text.chars() {
        match stroke_for(ch) {
            Some(stroke) => strokes.push(stroke),
            None => return Err(ch),
        }
    }
    Ok(strokes)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn known_evdev_codes() {
        assert_eq!(key_code("a"), Some(30));
        assert_eq!(key_code("A"), Some(30));
        assert_eq!(key_code("enter"), Some(28));
        assert_eq!(key_code("Return"), Some(28));
        assert_eq!(key_code("esc"), Some(1));
        assert_eq!(key_code("super"), Some(125));
        assert_eq!(key_code("f12"), Some(88));
        assert_eq!(key_code("banana"), None);
        assert_eq!(button_code("left"), Some(272));
        assert_eq!(button_code("middle"), Some(274));
        assert_eq!(button_code("side"), None);
    }

    #[test]
    fn text_strokes_carry_shift() {
        let strokes = strokes_for_text("Hi!").unwrap();
        assert_eq!(
            strokes,
            vec![
                Stroke {
                    key: "h",
                    shift: true
                },
                Stroke {
                    key: "i",
                    shift: false
                },
                Stroke {
                    key: "1",
                    shift: true
                },
            ]
        );
        assert_eq!(strokes_for_text("a\u{20ac}b"), Err('\u{20ac}'));
        assert_eq!(strokes_for_text(""), Ok(vec![]));
    }
}
