# Codex UI Customizer (Unofficial)

Customize the **OpenAI Codex UI in VS Code**.

Codex UI Customizer is a small, unofficial VS Code extension that applies visual customizations to the Codex chat interface. It supports both local VS Code sessions and **Remote-SSH** environments where the Codex extension runs on a remote extension host.

The first available customization is styling for **user message bubbles**. The extension is intentionally structured so additional UI customization options can be added in future releases.

> [!IMPORTANT]
> **Unofficial extension**
>
> Codex UI Customizer is not affiliated with, endorsed by, or maintained by OpenAI.
>
> This extension modifies internal CSS assets of the installed `openai.chatgpt` VS Code extension. It does not use an official Codex theming API, and future Codex updates may require compatibility fixes.

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
- Automatically finds hashed `app-initial-*.css` assets
- Prevents duplicate style injection
- Creates a backup before modifying Codex CSS
- Restores the original CSS with the `Remove` command
- Automatically reapplies customizations after Codex extension updates when possible
- Provides commands for Apply, Remove, and target diagnostics
- Does **not** disable WebView CSP
- Does **not** inject scripts into the Codex WebView

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
  "codexUiCustomizer.userMessage.background": "#173e76",
  "codexUiCustomizer.userMessage.borderColor": "#3d4654",
  "codexUiCustomizer.userMessage.borderWidth": "1px",
  "codexUiCustomizer.userMessage.borderRadius": "10px"
}
```

### Available Settings

| Setting | Default | Description |
|---|---|---|
| `codexUiCustomizer.autoApply` | `true` | Automatically applies UI customizations when the extension activates |
| `codexUiCustomizer.userMessage.background` | `#173e76` | Background color of user message bubbles |
| `codexUiCustomizer.userMessage.borderColor` | `#3d4654` | Border color of user message bubbles |
| `codexUiCustomizer.userMessage.borderWidth` | `1px` | Border width of user message bubbles |
| `codexUiCustomizer.userMessage.borderRadius` | `10px` | Corner radius of user message bubbles |

Colors accept 3, 4, 6, or 8 digit hexadecimal values. Border width and corner
radius accept `0` or non-negative values using `px`, `rem`, or `em`. Invalid
values are ignored and replaced with the corresponding default.

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

Applies the current customization settings to the detected Codex CSS assets.

```text
Codex UI Customizer: Apply
```

### Codex UI Customizer: Remove

Removes the injected customization and restores the original CSS backup when available.

```text
Codex UI Customizer: Remove
```

### Codex UI Customizer: Show Target

Displays diagnostic information in the Output panel, including:

- current extension host
- detected Codex installation path
- Codex WebView assets path
- CSS files being patched

```text
Codex UI Customizer: Show Target
```

This command is especially useful when troubleshooting Remote-SSH environments.

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

4. Finds CSS assets matching:

   ```text
   app-initial-*.css
   ```

5. Creates a backup of each target CSS file before modification.
6. Adds a clearly marked customization block.
7. Avoids adding the same customization more than once.

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

Recommended uninstall sequence:

```text
Ctrl + Shift + P
→ Codex UI Customizer: Remove
→ Uninstall Codex UI Customizer
```

VS Code does not provide a reliable extension uninstall hook that can safely modify another installed extension's files during the uninstall operation.

Because of this, uninstalling Codex UI Customizer without first running `Remove` may leave the injected CSS in the installed Codex extension.

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

Codex UI Customizer listens for extension changes and attempts to reapply the current customization automatically.

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

### WebView CSS assets

```text
app-initial-*.css
```

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
- does **not** modify Codex JavaScript
- does **not** disable Content Security Policy
- does **not** inject JavaScript into the Codex WebView

The extension only reads and updates the Codex WebView CSS assets required to apply the configured visual customization.

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
- WebView assets may be renamed
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
codex-ui-customizer-0.2.0.vsix
```

Install or update it with:

```bash
code --install-extension codex-ui-customizer-0.2.0.vsix --force
```

For Remote-SSH, install the VSIX on the remote extension host where Codex is running.

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
find webview/assets/app-initial-*.css
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
  Codex UI Customizer: Show Target
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
