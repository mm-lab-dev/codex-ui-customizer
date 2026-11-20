"use strict";

const { CustomizationStore } = require("./customization-store");

const SUSPENDED_KEY = "customizations.suspended";

function installCustomizations(vscode, context, { fileLinks, plainTextPaste, applyCss, removeCss, inspectCss, log, getOutput, delay = 1200, stateStoreOptions = {} }) {
  const memory = new Map();
  const state = context.globalState ?? { get: key => memory.get(key), update: async (key, value) => memory.set(key, value) };
  let timer, disposed = false, tail = Promise.resolve(), reloadPending = false;
  let sharedSuspended = state.get(SUSPENDED_KEY) === true;
  const store = new CustomizationStore({ getExtension: () => vscode.extensions.getExtension("openai.chatgpt"), ...stateStoreOptions });
  const config = () => vscode.workspace.getConfiguration("codexUiCustomizer");
  const selected = () => config().get("fileLinks.enabled", false) === true;
  const pasteSelected = () => config().get("plainTextPaste.enabled", true) === true;
  plainTextPaste ??= { inspect: async () => ({ state: "unapplied" }), reconcile: async () => ({ state: "unapplied" }) };
  const automatic = () => config().get("autoApply", true) === true;
  const suspended = () => sharedSuspended;
  const japanese = vscode.env.language?.startsWith("ja");
  const ui = japanese ? {
    reload: "ウィンドウを再読み込み", output: "出力を表示",
    apply: "設定に従ってカスタマイズを適用しました。",
    remove: "カスタマイズを解除しました。設定値は保持し、Applyまで自動適用を停止します。",
    failure: "一部の処理に失敗しました。出力で各機能の状態を確認してください。",
    save: "作業を保存してから、ボタンでウィンドウを再読み込みしてください。",
  } : {
    reload: "Reload Window", output: "Show Output",
    apply: "Customizations applied according to Settings.",
    remove: "Customizations removed. Settings are preserved; automatic application is suspended until Apply.",
    failure: "Some operations failed. See Output for each feature's state.",
    save: "Save your work, then use the button to reload this window.",
  };

  function queue(operation) {
    const next = tail.then(() => {
      if (disposed) return;
      return store.withLock(async control => {
        if (disposed) return;
        const saved = await control.read();
        // Migrate the previous per-extension-host suspension once. Thereafter
        // disk state is authoritative, including when another window resumes.
        sharedSuspended = saved ?? (state.get(SUSPENDED_KEY) === true);
        if (saved === null) await control.write(sharedSuspended);
        return operation(control);
      });
    });
    tail = next.catch(() => {});
    return next;
  }
  async function safe(feature, operation) {
    try { return await operation(); } catch (error) {
      log(`${feature} failed: ${error?.stack ?? error}`);
      return { state: "failed", changed: error?.changed === true, reason: String(error) };
    }
  }
  async function notify(result, explicit) {
    if (disposed) return;
    const problem = result.css.state === "failed" || ["failed", "unsupported"].includes(result.fileLinks.state) || result.plainTextPaste.state === "failed";
    if (!explicit && !result.changed && !problem) return;
    const fingerprint = JSON.stringify([result.action, result.css.state, result.css.state === "failed" ? result.css.reason : null,
      result.fileLinks.state, result.fileLinks.hash, result.fileLinks.reason, result.plainTextPaste.state, result.plainTextPaste.reason]);
    if (!explicit && fingerprint === state.get("customizations.lastNotice")) return;
    await state.update("customizations.lastNotice", fingerprint);
    if (disposed) return;
    const detail = problem ? ui.failure : result.action === "remove" ? ui.remove : ui.apply;
    const actions = [];
    if (result.reloadPending) actions.push(ui.reload);
    if (problem) actions.push(ui.output);
    const message = `Codex UI Customizer: ${detail}${result.reloadPending ? ` ${ui.save}` : ""}`;
    const response = problem ? vscode.window.showWarningMessage(message, ...actions) :
      vscode.window.showInformationMessage(message, ...actions);
    // Never keep the operation queue waiting for a user's notification response.
    void Promise.resolve(response).then(choice => {
      if (disposed) return;
      if (choice === ui.reload) return vscode.commands.executeCommand("workbench.action.reloadWindow");
      if (choice === ui.output) getOutput().show(true);
    }).catch(error => log(`Customization notification action failed: ${error.stack ?? error}`));
  }
  function printMode() {
    const channel = getOutput();
    channel.appendLine(`Extension host: ${vscode.env.remoteName ?? "local"}`);
    channel.appendLine(`Automatic application: ${automatic()}; suspended by Remove: ${suspended()}`);
    channel.appendLine(`Settings fileLinks.enabled: ${selected()} (Apply/Remove do not change settings)`);
    channel.appendLine(`Excluded extensions: ${JSON.stringify(config().get("fileLinks.excludedExtensions", []))}`);
    channel.appendLine(`Settings plainTextPaste.enabled: ${pasteSelected()}`);
  }
  async function inspect() {
    printMode();
    const css = await safe("CSS target detection", inspectCss);
    const links = await safe("File-link inspection", () => fileLinks.inspect(selected()));
    const paste = await safe("Plain-text paste inspection", () => plainTextPaste.inspect(pasteSelected()));
    getOutput().appendLine(`Plain-text paste: ${paste.state}; ${paste.reason ?? ""}`);
    if (css.state === "failed") getOutput().appendLine(`CSS: failed; ${css.reason}`);
    const pending = reloadPending || links.state === "reload-pending";
    getOutput().appendLine(`Reload pending in this extension host: ${pending}`);
    return { action: "inspect", suspended: suspended(), reloadPending: pending, css, fileLinks: links, plainTextPaste: paste };
  }
  async function reconcile(action, explicit) {
    printMode();
    // All features are attempted, even when an earlier one fails.
    const css = await safe("CSS", action === "remove" ? removeCss : applyCss);
    const links = await safe("File links", () => fileLinks.reconcile(action !== "remove" && selected()));
    const paste = await safe("Plain-text paste", () => plainTextPaste.reconcile(action !== "remove" && pasteSelected()));
    getOutput().appendLine(`Plain-text paste: ${paste.state}; ${paste.reason ?? ""}`);
    const changed = css.changed === true || links.changed === true || paste.changed === true;
    reloadPending ||= changed || links.state === "reload-pending";
    const result = { action, suspended: suspended(), css, fileLinks: links, plainTextPaste: paste, changed, reloadPending };
    log(`Combined ${action}: CSS=${css.state}, file links=${links.state}, plain-text paste=${paste.state}, changed=${changed}, suspended=${result.suspended}`);
    await notify(result, explicit);
    return result;
  }
  function apply() {
    clearTimeout(timer);
    return queue(async control => {
      await control.write(false);
      sharedSuspended = false;
      await state.update(SUSPENDED_KEY, false);
      return reconcile("apply", true);
    });
  }
  function remove() {
    clearTimeout(timer);
    return queue(async control => {
      // Persist before restoring, including when a restore fails. Later events
      // can inspect but cannot reapply either feature until explicit Apply.
      await control.write(true);
      sharedSuspended = true;
      await state.update(SUSPENDED_KEY, true);
      return reconcile("remove", true);
    });
  }
  function autoCheck() {
    return queue(() => automatic() && !suspended() ? reconcile("apply", false) : inspect());
  }
  function schedule() {
    if (disposed) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      void autoCheck().catch(error => {
        log(`Automatic customization check failed: ${error.stack ?? error}`);
        if (!disposed) void vscode.window.showErrorMessage(`Codex UI Customizer: ${String(error)}`);
      });
    }, delay);
    timer.unref?.();
  }
  const register = (name, operation) => vscode.commands.registerCommand(name, async () => {
    try { return await operation(); } catch (error) {
      log(`Customization command ${name} failed: ${error.stack ?? error}`);
      void vscode.window.showErrorMessage(`Codex UI Customizer: ${String(error)}`);
    }
  });
  function dispose() { disposed = true; clearTimeout(timer); }
  context.subscriptions.push(
    register("codexUiCustomizer.apply", apply),
    register("codexUiCustomizer.remove", remove),
    register("codexUiCustomizer.showTarget", () => queue(async () => {
      getOutput().clear();
      const result = await inspect();
      getOutput().show(true);
      return result;
    })),
    vscode.workspace.onDidChangeConfiguration(event => {
      if (event.affectsConfiguration("codexUiCustomizer")) schedule();
    }),
    vscode.extensions.onDidChange(schedule),
    { dispose }
  );
  schedule();
  return { apply, remove, autoCheck, inspect: () => queue(inspect), schedule, dispose };
}

module.exports = { installCustomizations, SUSPENDED_KEY };
