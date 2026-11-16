"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { analyze, transform, MARKER, REPORT_COMMAND } = require("../file-link-transform");
const { invoke, sourcePromise } = require("./helpers/file-links");

test("adapter recognizes the extracted real handler and changes only one insertion", async () => {
  const original = await sourcePromise;
  const patched = transform(original);
  assert.equal(analyze(original).kind, "unpatched");
  assert.equal(analyze(patched).kind, "managed");
  const start = patched.indexOf(MARKER);
  const end = patched.indexOf("let y=", start);
  assert.equal(patched.slice(0, start) + patched.slice(end), original);
  assert.throws(() => transform(patched), /Cannot transform managed/);
  assert.equal(analyze(transform(original, true)).kind, "legacy");
});

test("all coordinate-free files use the default editor, independent of extension or path", async () => {
  const patched = transform(await sourcePromise);
  for (const file of ["/tmp/video.mp4", "/tmp/Video.MP4", "/tmp/日本語の動画.mp4", "/tmp/日本語 画像.PNG", "/tmp/file.pdf", "/tmp/sound.flac", "/tmp/README", "/tmp/custom.weird", "/tmp/app.js"]) {
    const result = await invoke(patched, { file });
    assert.equal(result.success, true);
    assert.deepEqual(result.calls, ["vscode.open", "revealInExplorer"]);
  }
});

test("line and column coordinates preserve the original text handler and selection", async () => {
  const original = await sourcePromise;
  const patched = transform(original);
  for (const coords of [{ line: 12, column: 3 }, { line: 1 }, { column: 4 }, { line: 0, column: 0 }]) {
    const before = await invoke(original, coords);
    const after = await invoke(patched, coords);
    assert.equal(after.success, before.success);
    assert.deepEqual(after.calls, before.calls);
    assert.equal(JSON.stringify(after.selection), JSON.stringify(before.selection));
  }
  const selected = await invoke(patched, { line: 12, column: 3 });
  assert.equal(selected.selection.start.line, 11);
  assert.equal(selected.selection.start.character, 2);
});

test("file-manager operations remain unchanged even on binary files", async () => {
  const result = await invoke(transform(await sourcePromise), { fileManager: true });
  assert.equal(result.success, true);
  assert.deepEqual(result.calls, ["revealFileInOS"]);
});

test("open and reveal failures are reported rather than silently swallowed", async () => {
  const patched = transform(await sourcePromise);
  for (const failCommand of ["vscode.open", "revealInExplorer"]) {
    const result = await invoke(patched, { failCommand });
    assert.equal(result.success, false);
    assert.equal(result.calls.at(-1), REPORT_COMMAND);
    if (failCommand === "vscode.open") assert.ok(!result.calls.includes("revealInExplorer"));
  }
});

test("renamed identifiers and whitespace changes remain compatible", async () => {
  const original = (await sourcePromise).replace(/\boo\b/g, "vscodeNamespace").replace(/\bl\b/g, "lineNumber").replace(/\bc\b/g, "columnNumber").replace(/\bv\b/g, "uriValue");
  const formatted = original.replace(/^\/\/.*$/gm, "").replaceAll(";", ";\n");
  assert.equal(analyze(formatted).kind, "unpatched");
  assert.deepEqual((await invoke(transform(formatted))).calls, ["vscode.open", "revealInExplorer"]);
});

test("missing, ambiguous, malformed, and changed structures are refused", async () => {
  const original = await sourcePromise;
  for (const source of ["const anything=1;", original + original, "function {", original.replace("preview:!1", "preview:!0"), original.replace('require("vscode")', 'require("other")'), original.replace('i==="fileManager"', 'i==="other"'), original.replace("async v=>{try", "async v=>{void 0;try"), original.replace("f=async v=>", "f=(r=1,async v=>").replace(";if(NGe(p))", ");if(NGe(p))")]) {
    assert.equal(analyze(source).kind, "unsupported");
    assert.throws(() => transform(source), /Cannot transform unsupported/);
  }
});

test("managed branch edits or duplicate markers cannot masquerade as the verified patch", async () => {
  const patched = transform(await sourcePromise);
  for (const source of [patched.replace("if(r==null&&n==null)", "if(r==null&&other==null)"), patched.replace('"vscode.open",v', '"vscode.open",other'), patched + MARKER]) {
    assert.equal(analyze(source).kind, "unsupported");
  }
});

test("known equivalent upstream structure is official; unknown upstream changes stay indeterminate", async () => {
  const original = await sourcePromise;
  const index = analyze(original).insertion;
  const equivalent = 'if(r==null&&n==null){await oo.commands.executeCommand("vscode.open",v,{preview:false});await oo.commands.executeCommand("revealInExplorer",v);return!0}';
  assert.equal(analyze(original.slice(0, index) + equivalent + original.slice(index)).kind, "official");
  const unknown = original.replace('openTextDocument(v)', 'openTextDocumentOrMedia(v)');
  assert.equal(analyze(unknown).kind, "unsupported");
  assert.match(analyze(unknown).reason, /cannot be determined/);
});

test("catch bindings, destructured locals and enclosing scopes cannot shadow handler dependencies", async () => {
  const original = await sourcePromise;
  const variants = [
    original.replace('f=async v=>{try', 'f=(()=>{try{throw Error("scope")}catch(r){return async v=>{try').replace(';if(NGe(p))', '}})();if(NGe(p))'),
    original.replace('let s=i===', 'let {oo}=other;let s=i==='),
    original.replace('class CodexFileTarget', 'function outer(oo){return class CodexFileTarget') + '}',
    original.replace('f=async v=>', 'f=({r}=other,async v=>').replace(';if(NGe(p))', ');if(NGe(p))'),
    original.replace('class CodexFileTarget', 'class Outer { create(oo) { return class CodexFileTarget') + '}}',
    original.replace('let s=i===', 'function oo(){}let s=i==='),
    original.replace('f=async v=>', 'f=(oo.commands=other,async v=>').replace(';if(NGe(p))', ');if(NGe(p))'),
    original.replace('let s=i===', 'const Array=other;let s=i==='),
  ];
  for (const source of variants) {
    assert.equal(analyze(source).kind, "unsupported");
    assert.throws(() => transform(source), /Cannot transform unsupported/);
  }
});

test("excluded extensions use the original text handler with optional dot and case folding", async () => {
  const patched = transform(await sourcePromise);
  for (const [file, excludedExtensions] of [
    ["/tmp/README.MD", ["md"]], ["/tmp/a.txt", [".TXT"]],
    ["/tmp/日本語の画像.PNG", [".png"]], ["C:\\素材\\写真.画像", ["画像"]],
  ]) {
    const result = await invoke(patched, { file, excludedExtensions });
    assert.equal(result.success, true);
    assert.deepEqual(result.calls, ["text", "showText"]);
  }
});

test("exclusion matching uses only the last extension in the final filename", async () => {
  const patched = transform(await sourcePromise);
  for (const file of ["/tmp/a.txt.mp4", "/tmp/folder.txt/README", "/tmp/.txt", "/tmp/file.txt."]) {
    assert.deepEqual((await invoke(patched, { file, excludedExtensions: ["txt"] })).calls, ["vscode.open", "revealInExplorer"]);
  }
  assert.deepEqual((await invoke(patched, { file: "/tmp/archive.tar.gz", excludedExtensions: ["gz"] })).calls, ["text", "showText"]);
});

test("invalid exclusion values are ignored and coordinates and file-manager actions keep their behavior", async () => {
  const patched = transform(await sourcePromise);
  for (const excludedExtensions of [null, "mp4", {}, [null, 1, true, {}, "png"]]) {
    assert.deepEqual((await invoke(patched, { excludedExtensions })).calls, ["vscode.open", "revealInExplorer"]);
  }
  assert.deepEqual((await invoke(patched, { excludedExtensions: ["mp4"], fileManager: true })).calls, ["revealFileInOS"]);
  const selected = await invoke(patched, { excludedExtensions: ["mp4"], line: 12, column: 3 });
  assert.deepEqual(selected.calls, ["text", "showText"]);
  assert.equal(selected.selection.start.line, 11);
  assert.equal(selected.selection.start.character, 2);
});

test("settings changes affect subsequent clicks without regenerating the handler", async () => {
  const patched = transform(await sourcePromise);
  const result = await invoke(patched, { repeatWithExclusions: [[".mp4"], []] });
  assert.deepEqual(result.calls, ["vscode.open", "revealInExplorer", "text", "showText", "vscode.open", "revealInExplorer"]);
});

test("injected exclusion variables cannot shadow a renamed VS Code namespace", async () => {
  const original = (await sourcePromise).replace(/\boo\b/g, "codexUiLinkExcluded");
  assert.deepEqual((await invoke(transform(original), { excludedExtensions: ["mp4"] })).calls, ["text", "showText"]);
});
