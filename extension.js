"use strict";

const vscode = require("vscode");
const fs = require("node:fs/promises");
const path = require("node:path");
const { DEFAULTS, sanitizeStyleConfig } = require("./style");
const { discoverCssTargets } = require("./css-targets");
const { installFileLinks } = require("./file-link-controller");
const { installCustomizations } = require("./customization-controller");
const { PlainTextPasteManager } = require("./plain-text-paste");

const CODEX_EXTENSION_ID = "openai.chatgpt";
const START_MARKER = "/* codex-ui-customizer:start */";
const END_MARKER = "/* codex-ui-customizer:end */";
const BACKUP_SUFFIX = ".codex-ui-customizer.bak";
const OUTPUT_NAME = "Codex UI Customizer";

let output;
let customizations;

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
      await fs.unlink(backup).catch(error => { error.changed = true; throw error; });
      return true;
    }

    if (withoutPatch !== currentContent) {
      const cleaned = withoutPatch.trimEnd() + "\n";
      await atomicWrite(file, cleaned);
      log(`Preserved newer CSS changes while removing customization: ${file}`);
      await fs.unlink(backup).catch(error => { error.changed = true; throw error; });
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
  const detected = await discoverCssTargets(codex.extensionPath);
  log(`Detected Codex ${codex.packageJSON?.version ?? "unknown"}: ${detected.cssFiles.length} stylesheet(s) linked by ${detected.htmlFile}`);
  return { codex, assetsDir, ...detected };
}

async function applyPatch() {
  const target = await getCodexCssFiles();

  const style = getStyleBlock();
  let changed = 0;

  for (const file of target.cssFiles) {
    try {
      const original = await fs.readFile(file, "utf8");
      const withoutPatch = stripExistingPatch(original).trimEnd();
      const patched = `${withoutPatch}\n\n${style}\n`;

      if (patched !== original) {
        await ensureBackup(file, original);
        await atomicWrite(file, patched);
        changed++;
        log(`Patched: ${file}`);
      }
    } catch (error) {
      error.changed = changed > 0;
      throw error;
    }
  }

  const host = vscode.env.remoteName ?? "local";
  log(
    `Apply complete on ${host}: ${changed}/${target.cssFiles.length} file(s) changed.`
  );

  return { state: "applied", changed: changed > 0, reason: `${changed}/${target.cssFiles.length} CSS file(s) changed.` };
}

async function removePatch() {
  const target = await getCodexCssFiles();
  let changed = 0;
  let restored = 0;

  for (const file of target.cssFiles) {
    try {
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
    } catch (error) {
      error.changed = error.changed === true || changed > 0;
      throw error;
    }
  }

  log(`CSS removed from ${changed} file(s); restored ${restored} backup(s).`);
  return { state: "unapplied", changed: changed > 0, reason: `${changed} CSS file(s) cleaned; ${restored} backup(s) restored.` };
}

async function showTarget() {
  const target = await getCodexCssFiles();
  const host = vscode.env.remoteName ?? "local";
  const channel = getOutput();

  channel.appendLine(`Extension host: ${host}`);
  channel.appendLine(`Codex extension: ${target.codex.id}`);
  channel.appendLine(`Codex version: ${target.codex.packageJSON?.version ?? "unknown"}`);
  channel.appendLine(`Codex path: ${target.codex.extensionPath}`);
  channel.appendLine(`Assets path: ${target.assetsDir}`);
  channel.appendLine(`Reference HTML: ${target.htmlFile}`);
  channel.appendLine('Detection: explicit <link rel="stylesheet"> references (HTML order)');
  channel.appendLine("CSS targets:");
  for (const { file, href } of target.targets) {
    channel.appendLine(`- ${href} -> ${file}`);
  }
  let patched = 0, current = 0;
  for (const file of target.cssFiles) {
    const content = await fs.readFile(file, "utf8");
    if (content.includes(START_MARKER)) patched++;
    if (content === `${stripExistingPatch(content).trimEnd()}\n\n${getStyleBlock()}\n`) current++;
  }
  const state = current === target.cssFiles.length ? "applied" : patched === 0 ? "unapplied" : "outdated";
  const reason = `${current}/${target.cssFiles.length} CSS files match current settings; ${patched} contain customization markers.`;
  channel.appendLine(`CSS: ${state}; ${reason}`);
  return { state, reason };
}

function activate(context) {
  log(`Activated on extension host: ${vscode.env.remoteName ?? "local"}`);
  const fileLinks = installFileLinks(vscode, context, { log, getOutput });
  context.subscriptions.push(getOutput());
  customizations = installCustomizations(vscode, context, {
    fileLinks, plainTextPaste: new PlainTextPasteManager({ getExtension: () => vscode.extensions.getExtension(CODEX_EXTENSION_ID) }),
    applyCss: applyPatch, removeCss: removePatch, inspectCss: showTarget, log, getOutput,
  });
}

function deactivate() {
  customizations?.dispose();
}

module.exports = { activate, deactivate };
