use zed_extension_api::{self as zed, LanguageServerId, Result, Worktree};

struct MuseSpark;

fn credential(name: &str) -> bool {
    let name = name.to_ascii_uppercase();
    name.ends_with("_API_KEY")
        || [
            "AWS_ACCESS_KEY_ID",
            "AWS_SECRET_ACCESS_KEY",
            "AWS_SESSION_TOKEN",
            "OPENAI_KEY",
            "ANTHROPIC_KEY",
            "META_KEY",
        ]
        .contains(&name.as_str())
}

impl zed::Extension for MuseSpark {
    fn new() -> Self {
        Self
    }

    fn language_server_command(
        &mut self,
        _language_server_id: &LanguageServerId,
        worktree: &Worktree,
    ) -> Result<zed::Command> {
        let settings = zed::settings::LspSettings::for_worktree("muse_spark", worktree)?;
        let command = settings
            .binary
            .as_ref()
            .and_then(|binary| binary.path.clone())
            .or_else(|| worktree.which("muse-spark-code-acp"))
            .ok_or_else(|| "ELSP_RUNTIME_REQUIRED".to_owned())?;
        let mut args = settings
            .binary
            .and_then(|binary| binary.arguments)
            .unwrap_or_default();
        let verb_index = usize::from(args.first().is_some_and(|arg| !arg.starts_with('-')));
        args.insert(verb_index, "lsp".to_owned());
        args.extend(["--workspace".to_owned(), worktree.root_path()]);
        // Zed merges command.env with its shell environment: override every
        // credential with an empty value so no secret reaches the child.
        let env = worktree
            .shell_env()
            .into_iter()
            .filter(|(name, _)| credential(name))
            .map(|(name, _)| (name, String::new()))
            .collect();
        Ok(zed::Command { command, args, env })
    }
}

zed::register_extension!(MuseSpark);
