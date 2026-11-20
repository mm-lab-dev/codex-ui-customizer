"use strict";

// Optional Chromium check. All generated files, browser profile and temp data
// stay beneath this repository; never launch the installed Codex extension.
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { pathToFileURL } = require("node:url");
const { installPlainTextPaste } = require("../plain-text-paste");

const root = path.resolve(__dirname, "..");
const browser = process.argv[2];
if (!browser) throw new Error("Usage: node scripts/verify-plain-text-paste-browser.cjs <chromium-executable>");
const directory = fs.mkdtempSync(path.join(root, ".tmp-plain-paste-browser-"));
const htmlFile = path.join(directory, "check.html");
const packageNames = ["prosemirror-model", "prosemirror-state", "prosemirror-view", "prosemirror-history", "prosemirror-schema-basic", "prosemirror-transform", "orderedmap", "rope-sequence"];
const imports = Object.fromEntries(packageNames.map(name => {
  const packageRoot = path.join(root, ".tmp", "pm-browser", "node_modules", name);
  const manifest = JSON.parse(fs.readFileSync(path.join(packageRoot, "package.json"), "utf8"));
  return [name, pathToFileURL(path.join(packageRoot, manifest.module)).href];
}));
fs.writeFileSync(htmlFile, `<!doctype html><meta charset="utf-8">
<style>.ProseMirror { white-space: pre-wrap; }</style>
<div data-composer-input><div id="mount"></div></div>
<pre id="result">pending</pre><script type="importmap">${JSON.stringify({ imports })}</script><script type="module">
import { EditorState, TextSelection } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { schema } from "prosemirror-schema-basic";
import { history, undo } from "prosemirror-history";
(${installPlainTextPaste.toString()})(document);
const result = document.getElementById("result");
try {
  const state = EditorState.create({ schema, plugins: [history()], doc: schema.node("doc", null,
    [schema.node("paragraph", null, schema.text("before REPLACE after"))]) });
  const view = new EditorView(document.getElementById("mount"), { state });
  const editor = view.dom;
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 8, 15)));
  view.focus();
  let inputs = 0; editor.addEventListener("input", () => inputs++);
  const data = new DataTransfer();
  data.setData("text/plain", "日本語\\r\\n**literal**\\n\\nlast");
  data.setData("text/html", "<b>UNWANTED HTML</b>");
  // Model VS Code's host forwarding and clipboard API, without changing the
  // user's OS clipboard. Crucially, deliver no native paste for Ctrl+Shift+V.
  let hostKeys = 0, clipboardReads = 0;
  window.addEventListener("keydown", event => { if (event.ctrlKey && event.key.toLowerCase() === "v") { hostKeys++; event.preventDefault(); } });
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { readText: async () => { clipboardReads++; return data.getData("text/plain"); } } });
  const paste = () => new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: data });
  editor.dispatchEvent(new KeyboardEvent("keydown", { key: "V", ctrlKey: true, shiftKey: true, bubbles: true }));
  await new Promise(resolve => setTimeout(resolve, 50));
  const text = view.state.doc.textBetween(0, view.state.doc.content.size, "\\n");
  if (text !== "before 日本語\\n**literal**\\n\\nlast after") throw new Error("Selection/newlines: " + JSON.stringify(text));
  if (editor.querySelector("b,strong") || !inputs || hostKeys !== 0 || clipboardReads !== 1) throw new Error("Native insertion/HTML filtering/host interception failed");
  const selection = window.getSelection();
  if (!selection.isCollapsed || !editor.contains(selection.anchorNode)) throw new Error("Caret lost after paste");
  if (!undo(view.state, view.dispatch) || view.state.doc.textContent !== "before REPLACE after") throw new Error("Undo failed");
  editor.dispatchEvent(new KeyboardEvent("keydown", { key: "v", ctrlKey: true, bubbles: true }));
  let forwarded = false;
  editor.addEventListener("paste", event => { forwarded = event.clipboardData.getData("text/html") === "<b>UNWANTED HTML</b>"; }, { capture: true, once: true });
  const ordinary = paste(); editor.dispatchEvent(ordinary);
  let hasStrong = false; view.state.doc.descendants(node => { if (node.marks.some(mark => mark.type.name === "strong")) hasStrong = true; });
  if (!forwarded || !hasStrong) throw new Error("Ordinary rich paste was changed");
  result.textContent = "PASS: direct clipboard text without native paste, host forwarding blocked, ProseMirror selection, Unicode, multiline, blank lines, literal Markdown, HTML filtering, caret, native input events, history undo, ordinary paste";
} catch (error) { result.textContent = "FAIL: " + error.stack; }
</script>`);
const run = spawnSync(browser, ["--headless", "--disable-gpu", "--no-first-run", "--no-default-browser-check", "--disable-breakpad",
  "--disable-crash-reporter", "--allow-file-access-from-files", "--virtual-time-budget=2000", `--user-data-dir=${path.join(directory, "profile")}`, "--dump-dom", pathToFileURL(htmlFile).href],
{ encoding: "utf8", timeout: 45000, maxBuffer: 4 * 1024 * 1024, env: { ...process.env, TEMP: directory, TMP: directory } });
fs.writeFileSync(path.join(directory, "result.html"), run.stdout ?? "");
fs.writeFileSync(path.join(directory, "browser.log"), run.stderr ?? "");
const outcome = run.stdout?.match(/<pre id="result">([\s\S]*?)<\/pre>/)?.[1];
process.stdout.write(`${outcome ?? run.error ?? "No browser result"}\nArtifacts: ${directory}\n`);
if (run.error || run.status !== 0 || !outcome?.startsWith("PASS:")) process.exitCode = 1;
