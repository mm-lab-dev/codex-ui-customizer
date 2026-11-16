"use strict";

const { FileLinkManager } = require("./file-links");
const { REPORT_COMMAND } = require("./file-link-transform");

const LABELS = {
  applied: "Applied / 適用済み", unapplied: "Not applied / 未適用",
  "reload-pending": "Reload pending / 再読み込み待ち",
  unsupported: "Unsupported version or structure / 未対応バージョン・構造不一致",
  official: "Official support detected / 公式対応済み",
  failed: "Apply or restore failed / 適用・復元失敗",
};

// Settings, events and notifications belong to the shared controller.
function installFileLinks(vscode, context, { log, getOutput, managerOptions = {} }) {
  const manager = new FileLinkManager({
    getExtension: () => vscode.extensions.getExtension("openai.chatgpt"), log, ...managerOptions,
  });
  let lastRuntimeError;
  function print(status) {
    const channel = getOutput();
    channel.appendLine(`File links: ${LABELS[status.state] ?? status.state}`);
    channel.appendLine(`Effective enabled: ${status.enabled}; Codex: ${status.version ?? "unknown"}`);
    if (status.file) channel.appendLine(`Entry point: ${status.file}`);
    if (status.hash) channel.appendLine(`SHA-256: ${status.hash}`);
    if (status.backup) channel.appendLine(`Backup directory: ${status.backup}`);
    channel.appendLine(status.reason);
  }
  context.subscriptions.push(vscode.commands.registerCommand(REPORT_COMMAND, message => {
    const detail = String(message).slice(0, 4000);
    log(`File-link open/reveal failed: ${detail}`);
    if (lastRuntimeError !== detail) {
      lastRuntimeError = detail;
      void vscode.window.showErrorMessage("Codex UI Customizer: could not open or reveal the linked file. See the Codex UI Customizer Output channel.");
    }
  }));
  return {
    manager,
    async inspect(enabled) {
      const status = await manager.inspect(enabled);
      print(status);
      return status;
    },
    async reconcile(enabled) {
      let status = await manager.reconcile(enabled);
      if (!enabled && status.kind === "legacy" && status.state === "applied") {
        status = { ...status, state: "failed", reason: "Legacy manual MP4 patch has no managed original backup; it was left untouched. Inspect the legacy recovery evidence before restoring it." };
        log(status.reason);
      }
      print(status);
      return status;
    },
  };
}

module.exports = { installFileLinks, LABELS };
