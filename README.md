# Codex UI Customizer (Unofficial)

Customize the **OpenAI Codex UI in VS Code**.

Codex UI Customizer is a small, unofficial VS Code extension that applies visual customizations to the Codex chat interface. It supports both local VS Code sessions and **Remote-SSH** environments where the Codex extension runs on a remote extension host.

The extension styles **user message bubbles** and optionally manages a reversible patch for **standard file-link opening**, without an extension allowlist.

> [!IMPORTANT]
> **Unofficial extension**
>
> Codex UI Customizer is not affiliated with, endorsed by, or maintained by OpenAI.
>
> This extension modifies internal CSS assets of the installed `openai.chatgpt` VS Code extension. Enabling standard file links also modifies its JavaScript entry point. Enabling plain-text paste appends a handler to its existing WebView module. These are local workarounds using internal implementation details; future Codex updates require continued compatibility review.

---

## Features

- Customize the background color of your own Codex messages
- Customize user-message border color
- Customize border width
- Customize corner radius
- Works with **Remote-SSH**
- Automatically detects the installed `openai.chatgpt` extension
- Does not hard-code Codex version numbers
- Does not hard-code `.vscode-server` paths
- Finds CSS through the WebView HTML's stylesheet references, including hash-only filenames
- Validates every referenced stylesheet before applying changes; stops on unsupported layouts
- Prevents duplicate style injection
- Creates a backup before modifying Codex CSS
- Restores the original CSS with the `Remove` command
- Automatically reapplies customizations after Codex extension updates when possible
- Provides commands for Apply, Remove, and target diagnostics
- Optionally opens coordinate-free file links with VS Code's default editor and selects the file in Explorer
- Preserves the original text handler for links with line or column coordinates
- Detects the previous manual MP4 patch and migrates only with its verified pristine original
- Keeps versioned, hash-checked JavaScript backups and refuses unsafe restoration
- Reports file-link status and failures without automatically reloading the window
- Optionally pastes plain text into the Codex composer with **Ctrl+Shift+V**, while preserving ordinary Ctrl+V
- Does **not** disable WebView CSP
- Plain-text paste uses the existing WebView module without adding script tags

---

## Current Customization

### User Message Bubble

By default, Codex UI Customizer applies:

```css
[data-user-message-bubble="true"] {
  background: #173e76 !important;
  border: 1px solid #3d4654 !important;
  border-radius: 10px !important;
}
```

Only user message bubbles are targeted.

Codex responses are left unchanged.

---

## Configuration

The extension can be configured from VS Code Settings or directly in `settings.json`.

Default configuration:

```json
{
  "codexUiCustomizer.autoApply": true,
  "codexUiCustomizer.fileLinks.enabled": false,
  "codexUiCustomizer.fileLinks.excludedExtensions": [],
  "codexUiCustomizer.plainTextPaste.enabled": true,
  "codexUiCustomizer.userMessage.background": "#173e76",
  "codexUiCustomizer.userMessage.borderColor": "#3d4654",
  "codexUiCustomizer.userMessage.borderWidth": "1px",
  "codexUiCustomizer.userMessage.borderRadius": "10px"
}
```

### Available Settings

| Setting | Default | Description |
|---|---|---|
| `codexUiCustomizer.autoApply` | `true` | Automatically reconciles CSS, selected file-link handling and plain-text paste at startup and on configuration/extension changes, unless suspended by Remove |
| `codexUiCustomizer.fileLinks.enabled` | `false` | Selects file-link handling for Apply; when false, Apply restores its verified managed original |
| `codexUiCustomizer.fileLinks.excludedExtensions` | `[]` | Extensions to keep in the original text handler, e.g. `md` or `.txt`; case-insensitive |
| `codexUiCustomizer.plainTextPaste.enabled` | `true` | Enables Ctrl+Shift+V to paste clipboard text directly into the Codex composer; Apply and reload to activate |
| `codexUiCustomizer.userMessage.background` | `#173e76` | Background color of user message bubbles |
| `codexUiCustomizer.userMessage.borderColor` | `#3d4654` | Border color of user message bubbles |
| `codexUiCustomizer.userMessage.borderWidth` | `1px` | Border width of user message bubbles |
| `codexUiCustomizer.userMessage.borderRadius` | `10px` | Corner radius of user message bubbles |

Colors accept 3, 4, 6, or 8 digit hexadecimal values. Border width and corner
radius accept `0` or non-negative values using `px`, `rem`, or `em`. Invalid
values are ignored and replaced with the corresponding default.

### Plain-text paste (Windows/Linux)

1. Plain-text paste is enabled by default. If previously disabled, set `codexUiCustomizer.plainTextPaste.enabled` to `true`.
2. Run **Codex UI Customizer: Apply**, then use **Reload Window**.
3. Focus the Codex input and press **Ctrl+Shift+V**.

Only `text/plain` is inserted, including Japanese text, newlines and literal
Markdown characters. HTML formatting, clipboard images and file attachments are
excluded from this shortcut; an image-only clipboard does nothing. Ordinary
**Ctrl+V** keeps Codex's existing behavior. The text replaces the current selection
through the browser's native text editing and participates in undo. Clipboard content stays
in the WebView, including over Remote-SSH.

This uses Codex's internal ProseMirror editor and `[data-composer-input]` layout.
The shortcut reads text through the WebView clipboard API and handles the key
before VS Code forwards it to the host. If clipboard access is unavailable, it
attempts a sanitized native paste. Unsupported editors retain their native paste
behavior. Custom keybindings that intercept the key before it reaches the WebView
must be resolved separately.
The WebView module has a verified original backup; unexpected edits stop restoration
instead of overwriting other changes. Disable the setting and run Apply, or run
**Remove**, then reload to restore the original module.

The `codexUiCustomizer.*` namespace is intentionally generic so future releases can add additional categories such as:

```text
codexUiCustomizer.userMessage.*
codexUiCustomizer.codeBlock.*
codexUiCustomizer.chat.*
codexUiCustomizer.sidebar.*
```

---

## Commands

Open the Command Palette with:

```text
Ctrl + Shift + P
```

Available commands:

### Codex UI Customizer: Apply

Applies CSS and reconciles file-link handling and plain-text paste according to Settings. If
`fileLinks.enabled` is false, the managed file-link patch is restored instead.
Apply also resumes automatic management after Remove, and works when `autoApply`
is false. Settings values are preserved.

```text
Codex UI Customizer: Apply
```

### Codex UI Customizer: Remove

Removes CSS, managed file-link customizations and plain-text paste, using verified originals
where available. Settings values are preserved. Remove persists a suspension of
automatic application across restarts and updates. Run Apply to resume. Check
Show Target and Status if either restoration fails.

```text
Codex UI Customizer: Remove
```

### Codex UI Customizer: Show Target and Status

Displays diagnostic information in the Output panel, including:

- current extension host
- detected Codex installation path
- detected Codex version
- Codex WebView assets path
- reference HTML and detection method
- CSS files being patched and their original `href` references, in HTML order
- CSS application state and whether it matches current settings
- file-link state, entry point, hash, backup path and explanation
- automatic-application setting and persistent suspension by Remove

If detection fails, the command opens the Output panel with the failure reason.

```text
Codex UI Customizer: Show Target and Status
```

This command is especially useful when troubleshooting Remote-SSH environments.

---

## Standard File Links (Opt-in)

Select file-link handling in Settings, then run **Codex UI Customizer: Apply**:

```json
{
  "codexUiCustomizer.fileLinks.enabled": true,
  "codexUiCustomizer.fileLinks.excludedExtensions": ["md", ".txt"]
}
```

Links without line/column coordinates open in VS Code's default editor and select
the file in Explorer. Supported viewers and media formats depend on your VS Code
installation.

Excluded extensions use Codex's original text handler, as do links with line or
column coordinates. Matching ignores case and accepts extensions with or without
a leading dot. The last filename extension is used, so `gz` matches `archive.tar.gz`.
The default exclusion list is empty.

Once the updated handler is loaded, changes to the exclusion list affect the next
click without applying or reloading again. After initially applying or restoring
the handler, save your work and use the offered **Reload Window** button.

Use **Remove** to undo CSS, file-link and plain-text paste customization. It preserves Settings
and keeps automatic application suspended until **Apply**, including after restart.

If application or restoration fails, run **Show Target and Status** for the reason.
File-link originals are backed up under `~/.codex/codex-ui-customizer/file-links/`
and checked before restoration. This feature modifies Codex internals, so Codex
updates may require compatibility fixes. Technical checks and recovery details
are recorded in [VALIDATION.md](VALIDATION.md) in the source repository.

---

## Remote-SSH

Codex UI Customizer supports VS Code Remote-SSH.

The important rule is:

> **Install Codex UI Customizer on the same extension host where Codex is running.**

For example, if:

```text
Developer: Show Running Extensions
```

shows the OpenAI Codex extension under:

```text
SSH: dev
```

then Codex UI Customizer must also be installed under:

```text
SSH: dev
```

The extension uses the VS Code API:

```js
vscode.extensions.getExtension("openai.chatgpt")
```

to locate the actual Codex installation.

This means it does not depend on paths such as:

```text
~/.vscode-server/extensions/openai.chatgpt-26.xxxxx/
```

or on any specific Codex version.

A typical Remote-SSH installation may internally look like:

```text
~/.vscode-server/extensions/
└── openai.chatgpt-*/
    └── webview/
        └── assets/
            ├── app-initial-xxxxxxxx.css
            └── app-initial-yyyyyyyy.css
```

but this path is discovered dynamically rather than hard-coded.

---

## How It Works

Codex UI Customizer currently patches internal WebView CSS files belonging to the installed OpenAI Codex extension.

The extension:

1. Locates `openai.chatgpt` through the VS Code Extension API.
2. Resolves its actual `extensionPath`.
3. Looks under:

   ```text
   webview/assets/
   ```

4. Reads `webview/index.html` and resolves explicit stylesheet links, for example:

   ```html
   <link rel="stylesheet" href="./assets/app-initial-aad627bd9dff.css">
   <link rel="stylesheet" href="./assets/c33752c5468c.css">
   ```

   Filenames do not determine eligibility. Comments, module preloads, and CSS
   names in JavaScript dependency tables are not used as targets. References are
   kept in HTML order and duplicate files are patched only once.

5. Validates all references before writing, then creates a backup of each target CSS file before modification.
6. Adds a clearly marked customization block.
7. Avoids adding the same customization more than once.

Referenced files must exist and resolve to regular CSS files within `webview/`,
including after resolving symlinks. External or absolute URLs, escaping paths,
explicit HTML `<base>` tags, conditional or alternate stylesheets, and HTML
without explicit stylesheet links stop detection. There is no fallback that
patches every CSS file. This implementation does not traverse JavaScript
imports or locate dynamically loaded stylesheets.

Injected styles are wrapped with markers similar to:

```css
/* codex-ui-customizer:start */

[data-user-message-bubble="true"] {
  ...
}

/* codex-ui-customizer:end */
```

These markers allow the extension to safely locate and remove its own changes.

---

## Backups and Restoration

Before modifying a Codex CSS file, Codex UI Customizer creates a backup alongside the original file.

The backup is used by:

```text
Codex UI Customizer: Remove
```

to restore the pre-customization CSS when possible.

If a backup is unavailable, the extension falls back to removing only its own marked customization block.

This avoids intentionally replacing unrelated Codex CSS rules.

---

## Uninstalling

> [!WARNING]
> Run **`Codex UI Customizer: Remove` before uninstalling this extension**.

Verify both CSS and file-link restoration succeeded, and reload before uninstalling.

Recommended uninstall sequence:

```text
Ctrl + Shift + P
→ Codex UI Customizer: Remove
→ Uninstall Codex UI Customizer
```

VS Code does not provide a reliable extension uninstall hook that can safely modify another installed extension's files during the uninstall operation.

Because of this, uninstalling Codex UI Customizer without first running `Remove` may leave CSS or JavaScript customizations in the installed Codex extension.

### If You Already Uninstalled Without Running Remove

You can recover by either:

1. reinstalling Codex UI Customizer and running:

   ```text
   Codex UI Customizer: Remove
   ```

or:

2. reinstalling/updating the OpenAI Codex extension so that its WebView assets are replaced.

---

## After Applying a Customization

An already-open Codex WebView may continue using previously loaded CSS.

If a change does not appear immediately:

1. close and reopen the Codex view, or
2. run:

   ```text
   Developer: Reload Window
   ```

A full VS Code restart is normally not required.

---

## Codex Updates

The OpenAI Codex extension may update its internal WebView files at any time.

Codex UI Customizer listens for extension changes and attempts to reconcile both
features automatically when `autoApply` is enabled and Remove has not suspended
application. While suspended, updates only trigger read-only status checks.

You can also run:

```text
Codex UI Customizer: Apply
```

manually after updating Codex.

Because this extension relies on internal implementation details, a Codex update may occasionally change:

- CSS filenames
- DOM attributes
- WebView structure
- style behavior

If that happens, Codex UI Customizer may temporarily stop working until compatibility is updated.

---

## Compatibility

The current implementation expects the OpenAI Codex VS Code extension to expose:

### Extension ID

```text
openai.chatgpt
```

### WebView stylesheet references

```html
<!-- webview/index.html -->
<link rel="stylesheet" href="./assets/example.css">
```

Both legacy `app-initial-*.css` names and hash-only CSS names are supported.
Read-only detection was checked against installed versions `26.1007.21434` and
`26.1111.21308`. This confirms file discovery, not rendering in a live WebView.

### User message attribute

```html
data-user-message-bubble="true"
```

These are internal implementation details and are not guaranteed public APIs.

---

## Privacy and Security

Codex UI Customizer is intentionally small in scope.

It:

- does **not** read Codex conversation contents
- does **not** send telemetry
- does **not** call external services
- does **not** access authentication tokens
- does **not** access OpenAI account credentials
- does **not** access API keys
- does **not** inspect prompts or responses
- does **not** disable Content Security Policy
- does **not** add script tags or weaken WebView CSP

The extension reads the Codex WebView entry HTML to discover its stylesheet
references and updates those CSS assets for visual customization. The separate,
opt-in standard file-link feature reads and patches Codex's JavaScript entry
point using a verified structural adapter. The optional plain-text paste feature
appends a handler to the existing WebView module. It reads clipboard text only
during Ctrl+Shift+V and inserts it locally, without sending it to the extension host.

In VS Code Restricted Mode, workspace-defined Codex UI Customizer settings are
disabled. Settings are also validated before being written to CSS so a workspace
cannot use customization values to inject additional CSS rules.

### Why Does It Modify Another Extension?

At the time of writing, the OpenAI Codex VS Code extension does not expose a public theming API for the user-message bubble.

For example, VS Code's standard:

```json
"workbench.colorCustomizations": {
  "chat.requestBackground": "#173e76"
}
```

does not currently control the Codex user-message bubble.

Because Codex renders its own WebView UI, Codex UI Customizer applies the style directly to Codex's internal CSS assets.

This behavior is documented here intentionally so users can clearly understand what the extension changes.

---

## Limitations

Codex UI Customizer is based on Codex implementation details rather than a stable public UI API.

As a result:

- Codex updates may break individual customizations
- changes to the HTML entry point or stylesheet loading mechanism may require compatibility updates
- DOM selectors may change
- an already-open WebView may require reload after styling
- Codex extension updates may overwrite previous CSS modifications before this extension reapplies them

The extension aims to detect and handle these cases where practical.

---

## Installation From VSIX

To build the VSIX:

```bash
npm run package
```

This produces a file similar to:

```text
codex-ui-customizer-0.3.0.vsix
```

Install or update it with:

```bash
code --install-extension codex-ui-customizer-0.3.0.vsix --force
```

For Remote-SSH, install the VSIX on the remote extension host where Codex is running.

In the connected Remote-SSH window, use **Extensions: Install from VSIX...** and
select the generated package; ensure the extension is installed under **SSH: your
host** alongside Codex. Reload manually to load the new customizer, set
`codexUiCustomizer.fileLinks.enabled` in Settings and run **Apply**, then save work
and click **Reload Window** when offered. Inspect **Show Target and Status**.
Check an image/video link and a code link with
line coordinates. Recheck status after restarting; it should be applied with no
repeat reload notice. The legacy MP4 evidence must be available on that same host.

To update an existing 0.3.0 installation, use `--force` and reload each affected
VS Code window. If applying the updated file-link handler offers another reload,
save your work and use the notification button.

See [VALIDATION.md](VALIDATION.md) in the source repository for automated evidence,
simulated-update results and outstanding live checks. Building a VSIX alone does
not verify installation, live playback, or a real Codex update.

---

## Development

The extension intentionally has a minimal implementation.

The core behavior is:

```text
VS Code Extension API
        ↓
detect openai.chatgpt
        ↓
resolve extensionPath
        ↓
read webview/index.html stylesheet links
        ↓
validate referenced local CSS files
        ↓
backup
        ↓
apply CSS customization
```

No WebView injection framework or additional runtime service is required.

---

## Future Customizations

The project is named **Codex UI Customizer** rather than after the current user-message feature so additional UI options can be added over time.

Possible future customization areas include:

- code block appearance
- chat content width
- message spacing
- sidebar layout
- composer appearance
- typography
- response spacing
- tool-call presentation

Future options should remain opt-in and configurable through the `codexUiCustomizer.*` settings namespace.

---

## Support

Report bugs through the [GitHub issue tracker](https://github.com/mm-lab-dev/codex-ui-customizer/issues).

When reporting a problem, please include:

- VS Code version
- OpenAI Codex extension version
- Codex UI Customizer version
- whether the environment is local or Remote-SSH
- output from:

  ```text
  Codex UI Customizer: Show Target and Status
  ```

Do **not** include:

- conversation contents
- authentication tokens
- API keys
- credentials
- other sensitive information

---

## Disclaimer

Codex UI Customizer is an independent, unofficial project.

OpenAI, Codex, and related names may be trademarks of their respective owners.

This project is not affiliated with or endorsed by OpenAI.

---

## License

MIT
