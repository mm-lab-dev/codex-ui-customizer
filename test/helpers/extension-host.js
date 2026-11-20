"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const vm = require("node:vm");
const { sourcePromise } = require("./file-links");

async function loadExtension(root, fileLinksEnabled = false, options = {}) {
  const main = path.join(root, "out", "extension.js");
  await fs.mkdir(path.dirname(main), { recursive: true });
  try { await fs.access(main); } catch { await fs.writeFile(main, await sourcePromise); }
  const commands = new Map(), state = options.state ?? new Map();
  const lines = [], errors = [], notices = [], executed = [], settingWrites = [];
  const extensionEvents = [], configEvents = [];
  let fileLinks, customizations;
  // Older CSS/file-link fixtures omit the WebView module; disable paste there.
  const settings = { autoApply: false, "fileLinks.enabled": fileLinksEnabled, "plainTextPaste.enabled": false, ...options.settings };
  const channel = { appendLine: s => lines.push(s), clear: () => { lines.length = 0; }, show() {} };
  const information = (message, ...actions) => new Promise(resolve => notices.push({ message, actions, respond: resolve }));
  const disposable = { dispose() {} };
  const vscode = {
    window: {
      createOutputChannel: () => channel, showInformationMessage: information,
      showWarningMessage: (message, ...actions) => { errors.push(message); return information(message, ...actions); },
      showErrorMessage: message => errors.push(message),
    },
    env: { language: options.language ?? "en" },
    workspace: {
      getConfiguration: () => ({ get: (key, fallback) => settings[key] ?? fallback,
        update: (...args) => { settingWrites.push(args); throw new Error("Commands must not write configuration"); } }),
      onDidChangeConfiguration: fn => { configEvents.push(fn); return disposable; },
    },
    extensions: {
      getExtension: () => ({ id: "openai.chatgpt", extensionPath: root, packageJSON: { version: "fixture", main: "./out/extension.js" } }),
      onDidChange: fn => { extensionEvents.push(fn); return disposable; },
    },
    commands: {
      registerCommand: (name, fn) => { commands.set(name, fn); return disposable; },
      executeCommand: async name => { executed.push(name); },
    },
  };
  const sandbox = {
    require: name => {
      if (name === "vscode") return vscode;
      if (name === "./plain-text-paste") return { PlainTextPasteManager: class extends require("../../plain-text-paste").PlainTextPasteManager {
        constructor(config) { super({ ...config, storageRoot: path.join(root, "paste-backups") }); }
      } };
      if (name === "./file-link-controller") return { installFileLinks: (api, context, config) => {
        fileLinks = require("../../file-link-controller").installFileLinks(api, context, {
          ...config, managerOptions: { storageRoot: path.join(root, "backups"), legacyRoot: path.join(root, "legacy") },
        });
        return fileLinks;
      } };
      if (name === "./customization-controller") return { installCustomizations: (api, context, config) => {
        customizations = require("../../customization-controller").installCustomizations(api, context, {
          ...config, delay: options.delay ?? 10000,
          stateStoreOptions: { directory: path.join(root, "control"), ...options.stateStoreOptions },
        });
        return customizations;
      } };
      return name.startsWith("./") ? require(`../../${name.slice(2)}`) : require(name);
    },
    module: { exports: {} },
  };
  const source = await fs.readFile(path.join(__dirname, "..", "..", "extension.js"), "utf8");
  vm.runInNewContext(source, sandbox);
  const context = { subscriptions: [], globalState: {
    get: key => state.get(key), update: async (key, value) => state.set(key, value),
  } };
  sandbox.module.exports.activate(context);
  return { commands, lines, errors, fileLinks, customizations, settings, state, notices, executed, settingWrites,
    dispose: () => context.subscriptions.forEach(d => d?.dispose?.()),
    updateEvent: () => extensionEvents.forEach(fn => fn()),
    setSetting: (key, value) => { settings[key] = value; configEvents.forEach(fn => fn({ affectsConfiguration: () => true })); },
  };
}

module.exports = { loadExtension };
