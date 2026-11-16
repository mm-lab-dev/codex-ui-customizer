# Standard file-link management validation

Date: 2026-11-16 (Asia/Tokyo). Version: 0.3.0.

Approved behavior: links without line/column coordinates use VS Code's default
editor and reveal the file in Explorer, with no filename-extension allowlist.
Links with either coordinate retain the original text handler. Existing CSS and
file-manager behavior remain independent.

## Automated checks

Environment: Windows, Node.js v22.23.4, npm 10.9.9.

`npm test`: **71 tests passed**, no failures or skips, including extension exclusions and migration of earlier handlers.

Coverage includes:

- Application, no-write repeated application, and state after a new manager activation.
- Exclusive original backups, exact restoration, disable/re-enable, and retained backups.
- Legacy MP4 detection and migration; absent/mismatched originals refuse migration.
- Missing, duplicate, malformed and changed handlers; namespace/binding changes; modified markers.
- A structurally recognized equivalent upstream handler remains unchanged. This is a synthetic fixture, not evidence of an actual official release.
- Extensionless files, unusual extensions, MP4/uppercase extensions and Japanese/space-containing paths.
- Text selection with line and/or column coordinates; unchanged file-manager command.
- Viewer/reveal failure reporting and notification suppression.
- Unknown builds and external edits remain unchanged; corruption, locks and update races refuse writes.
- Startup/update event coalescing, concurrent requests, configuration changes and notification suppression across restarts.
- Real customizer activation with both file-link management and CSS Apply/Remove.
- Shared Apply/Remove reconcile both features without writing configuration; dedicated file-link commands and the opt-in notification are absent.
- Remove persists suspension across restart, settings and extension changes; only Apply resumes management.
- Disabled file-link settings restore JavaScript while CSS stays applied; autoApply=false makes both features read-only until Apply.
- Both features are attempted on partial failure, including a refused JavaScript restore or missing CSS entry point.
- Combined read-only diagnostics show both features and suspension; pending events cannot reapply after Remove.
- One combined reload notification; dismissal, unchanged removal and responses after disposal do not reload.
- Cross-window in-flight apply/Remove serialization with separate, stale mementos and shared filesystem state.
- Cross-process locking with a separate Node process, plus busy-lock timeout and invalid-state rejection.
- Full open() candidate search when the first workspace-prefixed relative path is missing, even if vscode.open would resolve without opening it.
- Directory rejection and unchanged coordinate-based text search.
- Rejection of catch bindings, destructured locals, enclosing classes/functions, function declarations and assignments that change dependency bindings.
- Owned v1 upgrade without rewriting its original backup, direct v1 restoration/reapplication, interrupted-upgrade retry/restoration, and refusal over edits/corruption.
- Owned v2 upgrade/restoration and interrupted-upgrade recovery.
- Extension exclusions with optional dots, case folding, Unicode/Windows paths, final-suffix matching, invalid values, and preserved coordinate/file-manager behavior.
- Exclusion changes read by the same loaded callback on subsequent clicks and no rewriting of the installed handler on configuration changes.
- Injected exclusion variables remain distinct from renamed handler dependencies.

## Read-only evidence from the existing installation

The legacy evidence was read from the Ubuntu VM's
`~/.codex/fixes/CODEX-MP4-LINK-01/`. Its manifest identifies Linux x64 Codex
26.1111.21308. The installed entry point's SHA-256 matches the saved manual patch.

| File | SHA-256 |
|---|---|
| Original entry point | `aa93a1b5aaa79746f3b583133355c659a0f059ff98d1956adf9da0e4afbcf817` |
| Legacy MP4-only entry point / installed entry point | `0229c556ae365ad0a83f708c53a308bb03cc756dfd7d434e89125eebbe9e7011` |
| Previous standard file-link entry point (v1) | `883f16053f2f9e2b71494728c07ac5777cb8055eb7f2694147c03d144a0d5f18` |
| Previous checked file-link entry point (v2) | `8767410eec5ec1f56c189225583f0ca3b5eff8d582492f99c4ee49c22fe04975` |
| Configurable-exclusion file-link entry point (v3) | `7bb4353010b77ce5ca8a7bb9958b260c39c36dc13447f149567b2341db1fd6cd` |

Both full bundles were copied into the repository's ignored `.tmp/` directory.
The committed test fixture retains only the real `open()` method and identifies
its source hash; the complete Codex bundles are not distributed in the VSIX.

Reproduce the full-bundle copy check with read-only input copies:

```sh
node scripts/verify-file-links-copy.cjs --original .tmp/codex-26.1111.21308.original.js --legacy .tmp/codex-26.1111.21308.patched.js --version 26.1111.21308
```

This script mutates only temporary copies under this repository. It verifies
application, syntax of the complete patched bundle, no-write repeat application,
new-manager state, byte-exact restoration, full-bundle v1/v2 upgrade and restoration,
verified legacy migration, and refusal
to restore over an external edit. The supplied input files remain unchanged.

## Update testing

The current handler reads `codexUiCustomizer.fileLinks.excludedExtensions` on each
coordinate-free click. It normalizes the optional leading dot and case, matches
the final filename suffix, and falls through to the existing text handler on a
match. Invalid list values are ignored. The machine-scoped setting defaults to
an empty array. Changing the list does not embed settings in the target bundle
or rewrite an already current handler.

V1 and v2 managed markers are recognized for verified migration to v3 using the
same original backup. `previousPatchedHash` recovery covers both previous
revisions when an upgrade is interrupted. The saved full-bundle v1/v2 hashes
above were reproduced before upgrading and restoring the copies.

**Simulated updates passed:** a test replaces the extension descriptor with a new
path/version and renamed namespace; the compatible copy is patched with a separate
backup. A subsequent unknown structure remains untouched. A separate test injects
an update during an operation and verifies that the final hash guard refuses it.

**Actual Codex update: not performed.** No claim is made that a real update has
been installed and followed successfully. Other Codex versions/platform builds
are not yet validated. Future compatibility requires continued review of Codex
internals; this remains a local workaround until official support.

## Packaging and dependencies

The release uses the existing `npm run package` / VSCE workflow. The package must
contain `customization-controller.js`, `customization-store.js`,
`file-link-controller.js`, `file-link-transform.js`, `file-links.js` and
the runtime Acorn dependency. Tests, scripts, caches and copied Codex bundles are
excluded. See the final packaging result below.

`npm audit --audit-level=high` completed successfully with **two moderate findings**
in the development packaging dependency chain (`@vscode/vsce` / `minimatch`),
and no high/critical findings. npm proposed a breaking packaging-tool downgrade;
it was not applied as part of this feature. Acorn is pinned to 8.15.0.

`npm audit --omit=dev`: **0 vulnerabilities** in runtime dependencies.

The version remains 0.3.0, including the unified Apply/Remove/Settings workflow.
The 0.3.0 VSIX is rebuilt from this source; its final archive details are recorded
below. This replaces the earlier generated package with the same version number.

The archive is rebuilt after this workflow change; package verification details
are recorded at the end of this document.

## Live verification and outstanding checks

File-link recovery records live under
`~/.codex/codex-ui-customizer/file-links/<version>-<target-path-hash>/`.
`manifest.json` identifies the target, pristine original hash, current patched
hash and any previous hash accepted during an interrupted upgrade. Originals are
stored in `<original-sha256>.original.js` and verified before restoration.

Cross-window control uses
`~/.codex/codex-ui-customizer/control/<extensions-directory-hash>/state.json`
and an exclusive `operation.lock`. The lock covers CSS and JavaScript together,
including the shared suspension read/write. Status inspection uses the lock and
may initialize control metadata. A busy lock is retried for up to 30 seconds.
If a crash leaves a stale lock, confirm no customization operation is running
before removing that lock and retrying. Invalid shared state or recovery evidence
is reported as an error.

The original MP4-only patch was reported as click-tested by the user before this
task. That does not verify the broader standard file-link implementation.

On 2026-11-16 the user reported that standard file-link opening worked in the
**Windows local VS Code** environment after fully restarting VS Code. The preceding
enable attempt had failed with an unregistered-setting error. Read-only inspection
confirmed the installed 0.3.0 manifest and VSIX both contained the setting, and the
failure log identified the extension host as `local`. The exact registration/cache
cause was not established; the successful restart does not prove a specific cause.
Individual media formats, Explorer selection and coordinate selection were not
separately reported as verified, so they remain outstanding live checks.

The corrected combined workflow and notification buttons are tested through real customizer
activation with a mocked VS Code host, but have not yet been click-tested in the
real Windows UI. The full-bundle copy check was rerun after the review fixes and
verified both the corrected handler and migration of the exact previously
generated v1 and v2 bundles. The exclusion setting is tested through mocked VS Code
configuration and command APIs. A real Codex update and Remote-SSH deployment remain unverified.

The agent has not changed installed extensions, VS Code settings or the running
window. The supplied repository-only write rule still prohibits those writes
without an explicit exception. The user's installation/enablement of 0.3.0 was
performed outside the agent's tool actions.

After installation on the same Remote-SSH extension host as Codex:

1. Reload every affected window to load the updated customizer 0.3.0; select fileLinks.enabled in Settings and run Apply. An owned v1/v2 handler is upgraded when enabled.
2. Confirm migration and reload-pending status; save work and select Reload Window in the notification. Dismissing it must not reload.
3. Click a chat MP4 link: verify playback and Explorer selection.
4. Click an image link: verify the viewer and Explorer selection. Check any additional formats supported by the installed viewers.
5. Click an ordinary code link with a line/column: verify the original selection.
6. Restart/reload and confirm applied status with no repeated notification or rewrite.
7. Run Remove and reload manually; confirm both customizations are removed while Settings values remain unchanged. Restart and verify suspension prevents reapplication.
8. Run Apply to resume; verify both selected features are restored. To keep CSS alone, turn fileLinks.enabled off in Settings and run Apply.
9. With the updated customizer loaded in two windows on the same extension host, verify that Remove leaves both target customizations restored after other queued automatic checks finish.
10. Set fileLinks.excludedExtensions to ["md", ".txt"], verify those links use the text handler, then edit the list and verify the next click follows the new setting without reloading.

Full operational acceptance remains pending the remaining checks and an actual Codex
update test. No automatic reload, remote install, or Marketplace publication was
performed.

## Final unified-workflow package

`npm run package` succeeded for `codex-ui-customizer-0.3.0.vsix`, with 26 entries
and a size of approximately 244.95 KB. Direct archive inspection verified matching
runtime sources and the array setting's empty default, machine scope and accepted
extension syntax. Tests, scripts and caches are excluded from the VSIX.

VSIX SHA-256:
`5af1d7be050c9aa0d119b2ebd66cc81b83fad2b2838e300c70e91aebc685142f`.
