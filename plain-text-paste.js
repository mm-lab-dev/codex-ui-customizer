"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { createHash, randomUUID } = require("node:crypto");

// Runs inside the existing WebView module; never reads the clipboard in the
// extension host (which could be a different machine in Remote-SSH).
function installPlainTextPaste(document, clock = Date.now) {
  let pending;
  const editorFor = target => target?.closest?.('[data-composer-input] .ProseMirror[contenteditable="true"]');
  const insert = text => {
    try { return !text || document.execCommand("insertText", false, text.replace(/\r\n?/g, "\n")); }
    catch { return false; }
  };
  const fallback = armed => {
    if (pending !== armed || document.activeElement !== armed.editor || clock() - armed.time > 1500) return;
    // Electron can supply a native paste when clipboard.readText is unavailable.
    // The capture handler below strips everything except text/plain.
    let pasted = false;
    try { pasted = document.execCommand("paste"); } catch { /* Report without clipboard contents below. */ }
    if (!pasted) {
      pending = undefined;
      document.defaultView?.console?.warn("Codex UI Customizer: unable to read clipboard text for Ctrl+Shift+V.");
    }
  };
  document.addEventListener("keydown", event => {
    pending = undefined;
    if (event.defaultPrevented || event.isComposing || !event.ctrlKey || !event.shiftKey || event.altKey || event.metaKey ||
        event.key.toLowerCase() !== "v") return;
    const editor = editorFor(event.target);
    if (!editor || typeof document.execCommand !== "function") return;
    // VS Code forwards native paste keys to its host, where Ctrl+Shift+V has no
    // general WebView paste implementation. Handle this shortcut before that.
    event.preventDefault();
    event.stopImmediatePropagation();
    if (event.repeat) return;
    const armed = pending = { editor, time: clock() };
    const clipboard = document.defaultView?.navigator?.clipboard;
    if (!clipboard?.readText) { fallback(armed); return; }
    let reading;
    try { reading = clipboard.readText(); } catch { fallback(armed); return; }
    Promise.resolve(reading).then(text => {
      if (pending !== armed || document.activeElement !== editor || clock() - armed.time > 1500) return;
      pending = undefined;
      if (!insert(text)) document.defaultView?.console?.warn("Codex UI Customizer: unable to insert clipboard text.");
    }, () => fallback(armed));
  }, true);
  document.addEventListener("focusout", () => { pending = undefined; }, true);
  document.addEventListener("paste", event => {
    const armed = pending;
    pending = undefined;
    const editor = editorFor(event.target);
    if (!armed || armed.editor !== editor || clock() - armed.time > 1500 || event.defaultPrevented) return;
    if (!editor || !event.clipboardData || typeof document.execCommand !== "function") return;
    // An image-only clipboard is a no-op for this shortcut, never an upload.
    const text = event.clipboardData.getData("text/plain");
    if (text) {
      // Chromium's native text editing preserves the selection and undo stack.
      // ProseMirror observes this DOM edit and updates its document normally.
      // Unlike innerHTML/textContent assignment, this also retains caret state.
      if (!insert(text)) return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);
}

const START = "/* codex-ui-customizer:plain-text-paste:start:v2 */";
const END = "/* codex-ui-customizer:plain-text-paste:end */";
const PATCH = `\n;${START}\n(${installPlainTextPaste.toString()})(document);\n${END}\n`;
const hash = value => createHash("sha256").update(value).digest("hex");
const within = (root, file) => {
  const relative = path.relative(root, file);
  return relative && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
};

class PlainTextPasteManager {
  constructor({ getExtension, storageRoot = path.join(os.homedir(), ".codex", "codex-ui-customizer", "plain-text-paste") }) {
    Object.assign(this, { getExtension, storageRoot });
  }

  async target() {
    const extension = this.getExtension();
    if (!extension) throw new Error('Codex "openai.chatgpt" is not installed on this extension host.');
    const root = await fs.realpath(path.join(extension.extensionPath, "webview"));
    const html = (await fs.readFile(path.join(root, "index.html"), "utf8")).replace(/<!--[\s\S]*?-->/g, "");
    const scripts = [...html.matchAll(/<script\b[^>]*\btype=["']module["'][^>]*\bsrc=["']([^"']+)["'][^>]*>/gi)];
    if (scripts.length !== 1) throw new Error("Unsupported WebView: expected one module entry script.");
    const reference = scripts[0][1];
    if (!/^\.\/assets\/[\w.-]+\.js$/.test(reference)) throw new Error("Unsupported WebView module path.");
    const file = await fs.realpath(path.resolve(root, reference));
    if (!within(root, file) || !(await fs.stat(file)).isFile()) throw new Error("WebView module escapes its directory.");
    const directory = path.join(this.storageRoot, hash(file));
    return { file, directory, recordFile: path.join(directory, "original.json") };
  }

  async snapshot() {
    const target = await this.target();
    const source = await fs.readFile(target.file, "utf8");
    let record;
    try { record = JSON.parse(await fs.readFile(target.recordFile, "utf8")); } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    if (record && (record.file !== target.file || typeof record.source !== "string" || hash(record.source) !== record.hash)) {
      throw new Error("Invalid plain-text paste backup; refusing to modify the module.");
    }
    const patched = record && source === record.source + PATCH;
    if ((source.includes("/* codex-ui-customizer:plain-text-paste:start:") || source.includes(END)) && !patched) {
      throw new Error("Unrecognized plain-text paste patch; refusing to overwrite it.");
    }
    if (record && !patched && source !== record.source) {
      throw new Error("WebView module changed since backup; refusing to overwrite it.");
    }
    return { ...target, source, record, patched };
  }

  async inspect(enabled) {
    if (!enabled) {
      // Disabled installations may have no supported WebView module at all.
      // Still detect our markers when an entry can be resolved.
      try { return await this.status(enabled); } catch (error) {
        if (/Unsupported WebView|not installed|ENOENT/.test(error.message)) return { state: "unapplied", changed: false, reason: "Plain-text paste is disabled." };
        throw error;
      }
    }
    return this.status(enabled);
  }

  async status(enabled) {
    const target = await this.snapshot();
    return { state: target.patched ? "applied" : "unapplied", changed: false,
      reason: `Ctrl+Shift+V: ${target.patched ? "installed" : "not installed"}; selected=${enabled}; ${target.file}` };
  }

  async reconcile(enabled) {
    let target;
    try { target = await this.snapshot(); } catch (error) {
      if (!enabled && /Unsupported WebView|not installed|ENOENT/.test(error.message)) return this.inspect(false);
      throw error;
    }
    if (Boolean(target.patched) === enabled) return this.status(enabled);
    if (enabled && !target.record) {
      await fs.mkdir(target.directory, { recursive: true });
      await fs.writeFile(target.recordFile, JSON.stringify({ file: target.file, hash: hash(target.source), source: target.source }), { flag: "wx", mode: 0o600 });
    }
    // Recheck immediately before replacement; never restore over other edits.
    if (await fs.readFile(target.file, "utf8") !== target.source) throw new Error("WebView module changed during plain-text paste operation.");
    const temporary = `${target.file}.codex-ui-${randomUUID()}.tmp`;
    try {
      await fs.writeFile(temporary, enabled ? (target.record?.source ?? target.source) + PATCH : target.record.source, { flag: "wx", mode: (await fs.stat(target.file)).mode });
      if (await fs.readFile(target.file, "utf8") !== target.source) throw new Error("WebView module changed before replacement.");
      await fs.rename(temporary, target.file);
    } finally {
      await fs.rm(temporary, { force: true });
    }
    return { state: "reload-pending", changed: true, reason: `Plain-text paste ${enabled ? "installed" : "restored"}; reload the window.` };
  }
}

module.exports = { installPlainTextPaste, PlainTextPasteManager };
