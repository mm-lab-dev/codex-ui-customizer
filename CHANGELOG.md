# Change Log

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
