"use strict";

const vscode = require("vscode");
const fs = require("node:fs/promises");
const path = require("node:path");
const { DEFAULTS, sanitizeStyleConfig } = require("./style");

const CODEX_EXTENSION_ID = "openai.chatgpt";
const START_MARKER = "/* codex-ui-customizer:start */";
const END_MARKER = "/* codex-ui-customizer:end */";
const BACKUP_SUFFIX = ".codex-ui-customizer.bak";
const OUTPUT_NAME = "Codex UI Customizer";

let output;
let applyTimer;

function getOutput() {
  if (!output) {
    output = vscode.window.createOutputChannel(OUTPUT_NAME);
  }
  return output;
}

function log(message) {
  getOutput().appendLine(`[${new Date().toISOString()}] ${message}`);
}

function getConfig() {
  const config = vscode.workspace.getConfiguration("codexUiCustomizer");
  return {
    autoApply: config.get("autoApply", true),
    ...sanitizeStyleConfig({
      background: config.get("userMessage.background", DEFAULTS.background),
      borderColor: config.get("userMessage.borderColor", DEFAULTS.borderColor),
      borderWidth: config.get("userMessage.borderWidth", DEFAULTS.borderWidth),
      borderRadius: config.get("userMessage.borderRadius", DEFAULTS.borderRadius),
    }),
  };
}

function getStyleBlock() {
  const c = getConfig();

  return [
    START_MARKER,
    '[data-user-message-bubble="true"] {',
    `  background: ${c.background} !important;`,
    `  border: ${c.borderWidth} solid ${c.borderColor} !important;`,
    `  border-radius: ${c.borderRadius} !important;`,
    "}",
    END_MARKER,
  ].join("\n");
}

function stripExistingPatch(content) {
  let result = content;

  while (true) {
    const start = result.indexOf(START_MARKER);
    if (start === -1) break;

    const end = result.indexOf(END_MARKER, start);
    if (end === -1) break;

    result =
      result.slice(0, start).trimEnd() +
      result.slice(end + END_MARKER.length);
  }

  return result;
}

async function atomicWrite(file, content) {
  const temp = `${file}.codex-ui-customizer.tmp`;
  await fs.writeFile(temp, content, "utf8");
  await fs.rename(temp, file);
}

async function ensureBackup(file, original) {
  const backup = `${file}${BACKUP_SUFFIX}`;

  try {
    await fs.access(backup);
  } catch {
    await fs.writeFile(backup, original, "utf8");
    log(`Backup created: ${backup}`);
  }
}

async function restoreBackupIfPresent(file) {
  const backup = `${file}${BACKUP_SUFFIX}`;

  try {
    const [backupContent, currentContent] = await Promise.all([
      fs.readFile(backup, "utf8"),
      fs.readFile(file, "utf8"),
    ]);
    const withoutPatch = stripExistingPatch(currentContent);

    if (withoutPatch.trimEnd() === backupContent.trimEnd()) {
      await atomicWrite(file, backupContent);
      log(`Restored backup: ${file}`);
      await fs.unlink(backup);
      return true;
    }

    if (withoutPatch !== currentContent) {
      const cleaned = withoutPatch.trimEnd() + "\n";
      await atomicWrite(file, cleaned);
      log(`Preserved newer CSS changes while removing customization: ${file}`);
      await fs.unlink(backup);
      return true;
    }

    await fs.unlink(backup);
    log(`Discarded stale backup without changing current CSS: ${backup}`);
    return false;
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

async function getCodexCssFiles() {
  const codex = vscode.extensions.getExtension(CODEX_EXTENSION_ID);

  if (!codex) {
    throw new Error(
      `OpenAI Codex extension "${CODEX_EXTENSION_ID}" was not found in this extension host. ` +
      "On Remote-SSH, install this extension on the same SSH host as Codex."
    );
  }

  const assetsDir = path.join(codex.extensionPath, "webview", "assets");
  const entries = await fs.readdir(assetsDir);

  const cssFiles = entries
    .filter((name) => /^app-initial-.*\.css$/i.test(name))
    .map((name) => path.join(assetsDir, name))
    .sort();

  if (cssFiles.length === 0) {
    throw new Error(`No app-initial-*.css files found under ${assetsDir}`);
  }

  return { codex, assetsDir, cssFiles };
}

async function applyPatch({ notify = true, quietMissing = false } = {}) {
  let target;

  try {
    target = await getCodexCssFiles();
  } catch (error) {
    if (quietMissing) {
      log(`Auto-apply skipped: ${String(error)}`);
      return;
    }
    throw error;
  }

  const style = getStyleBlock();
  let changed = 0;

  for (const file of target.cssFiles) {
    const original = await fs.readFile(file, "utf8");
    const withoutPatch = stripExistingPatch(original).trimEnd();
    const patched = `${withoutPatch}\n\n${style}\n`;

    if (patched !== original) {
      await ensureBackup(file, original);
      await atomicWrite(file, patched);
      changed++;
      log(`Patched: ${file}`);
    }
  }

  const host = vscode.env.remoteName ?? "local";
  log(
    `Apply complete on ${host}: ${changed}/${target.cssFiles.length} file(s) changed.`
  );

  if (notify) {
    void vscode.window.showInformationMessage(
      changed > 0
        ? `Codex UI Customizer: applied on ${host}. Reopen the Codex view if needed.`
        : `Codex UI Customizer: style is already current on ${host}.`
    );
  }
}

async function removePatch() {
  const target = await getCodexCssFiles();
  let changed = 0;
  let restored = 0;

  for (const file of target.cssFiles) {
    if (await restoreBackupIfPresent(file)) {
      changed++;
      restored++;
      continue;
    }

    const original = await fs.readFile(file, "utf8");
    const cleaned = stripExistingPatch(original).trimEnd() + "\n";

    if (cleaned !== original) {
      await atomicWrite(file, cleaned);
      changed++;
      log(`Removed patch markers: ${file}`);
    }
  }

  void vscode.window.showInformationMessage(
    `Codex UI Customizer: removed from ${changed} CSS file(s)` +
      (restored > 0 ? `, restored ${restored} backup(s)` : "") +
      ". Reopen the Codex view if needed."
  );
}

async function showTarget() {
  const target = await getCodexCssFiles();
  const host = vscode.env.remoteName ?? "local";
  const channel = getOutput();

  channel.clear();
  channel.appendLine(`Extension host: ${host}`);
  channel.appendLine(`Codex extension: ${target.codex.id}`);
  channel.appendLine(`Codex path: ${target.codex.extensionPath}`);
  channel.appendLine(`Assets path: ${target.assetsDir}`);
  channel.appendLine("CSS targets:");
  for (const file of target.cssFiles) {
    channel.appendLine(`- ${file}`);
  }
  channel.show(true);
}

function scheduleAutoApply() {
  if (!getConfig().autoApply) return;

  if (applyTimer) {
    clearTimeout(applyTimer);
  }

  applyTimer = setTimeout(() => {
    applyPatch({ notify: false, quietMissing: true }).catch((error) => {
      log(`Auto-apply failed: ${String(error)}`);
    });
  }, 1200);
}

function activate(context) {
  log(`Activated on extension host: ${vscode.env.remoteName ?? "local"}`);

  context.subscriptions.push(
    getOutput(),

    vscode.commands.registerCommand("codexUiCustomizer.apply", async () => {
      try {
        await applyPatch({ notify: true });
      } catch (error) {
        void vscode.window.showErrorMessage(`Codex UI Customizer: ${String(error)}`);
      }
    }),

    vscode.commands.registerCommand("codexUiCustomizer.remove", async () => {
      try {
        await removePatch();
      } catch (error) {
        void vscode.window.showErrorMessage(`Codex UI Customizer: ${String(error)}`);
      }
    }),

    vscode.commands.registerCommand("codexUiCustomizer.showTarget", async () => {
      try {
        await showTarget();
      } catch (error) {
        void vscode.window.showErrorMessage(`Codex UI Customizer: ${String(error)}`);
      }
    }),

    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("codexUiCustomizer")) {
        scheduleAutoApply();
      }
    }),

    vscode.extensions.onDidChange(() => {
      // Re-apply after Codex install/update because its asset filenames may change.
      scheduleAutoApply();
    })
  );

  scheduleAutoApply();
}

function deactivate() {
  if (applyTimer) {
    clearTimeout(applyTimer);
  }
}

module.exports = { activate, deactivate };
