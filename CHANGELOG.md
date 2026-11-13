# Change Log

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
