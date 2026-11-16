# Change Log

## 0.3.0

- Add a Settings exclusion list for file-link extensions, with case-insensitive matching and optional leading dots. Excluded links retain the original text handler; list changes take effect on subsequent clicks.
- Shorten README file-link guidance to configuration, common commands and recovery entry points.
- Serialize CSS/JavaScript operations across windows and processes, with shared persisted suspension so an in-flight auto-apply cannot undo Remove.
- Check file candidates before standard opening, preserving relative-path fallback for missing candidates and rejecting directories.
- Reject shadowed or reassigned handler dependencies and unexpected enclosing scopes during compatibility checks.
- Safely migrate owned v1 handlers to the corrected v2 handler using the verified original, including interrupted-upgrade recovery and direct restoration.
- Unify CSS and file-link application/restoration under Apply/Remove; choose file-link handling in Settings without command-driven setting writes.
- Persist Remove's suspension across restart, setting changes and extension updates; Apply resumes management while preserving Settings.
- Combine target/status output for both features, retaining independent failure diagnostics and guarded restoration.
- Add a Reload Window button after apply/restore, executed only when explicitly selected.
- Remove file-link-specific enable/restore/status commands and the initial enable notification.
- Localize reload notifications in Japanese and English and test combined control, persistence, event serialization and partial failures.

- Add opt-in standard file-link management without a filename-extension allowlist: coordinate-free links use VS Code's default editor and reveal the file in Explorer.
- Preserve text line/column selection, file-manager actions and CSS customization behavior.
- Verify Codex handlers using a syntax-tree adapter; stop on ambiguous or unknown structures and report when official support cannot be determined.
- Add hash/version backups, verified legacy MP4 migration, guarded restoration, serialized operations and per-target locks.
- Add combined apply, remove and status commands, persistent notice suppression, and open/reveal error reporting. Window reloads remain manual.
- Document compatibility boundaries, recovery and Remote-SSH installation; add regression and simulated-update tests.

## 0.2.2

- Fix CSS target detection for Codex versions that use hash-only stylesheet filenames, including `26.1111.21308`.
- Discover stylesheets from `webview/index.html` references instead of matching `app-initial-*.css` filenames.
- Validate every stylesheet reference before writing and stop with diagnostics if the layout is unsupported or a target is missing or outside the WebView directory.
- Include the Codex version, reference HTML, and stylesheet references in `Show Target` output.
- Add coverage for legacy and hash-only layouts, invalid references, and customization apply/remove behavior.
- Update `@vscode/vsce` to `4.1.1` and refresh its dependencies to address high-severity audit findings.

## 0.2.1

- Update the extension packaging tool and refresh its dependencies to address reported vulnerabilities.

## 0.2.0

- Rename project to **Codex UI Customizer (Unofficial)**.
- Rename extension package to `codex-ui-customizer`.
- Move configuration under the extensible `codexUiCustomizer.*` namespace.
- Keep user-message bubble styling as the first customization module.
- Support future UI customization categories such as code blocks, chat layout, and sidebar styling.
- Back up Codex CSS before patching and restore it with `Remove`.
- Support Remote-SSH extension hosts.
- Automatically detect Codex install location and hashed WebView CSS assets.
- Validate customization values before writing them to Codex CSS.
- Ignore workspace-defined customization settings in Restricted Mode.
- Preserve newer CSS changes when removing a customization from a backed-up file.

## 0.1.1

- Added CSS backup and restore support.
- Documented Remove-before-uninstall workflow.

## 0.1.0

- Initial prototype for user-message bubble styling.
