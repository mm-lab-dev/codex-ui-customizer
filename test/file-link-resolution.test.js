"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const vm = require("node:vm");
const { sourcePromise } = require("./helpers/file-links");
const { transform } = require("../file-link-transform");

async function openLink({ file = "repo/app.js", cwd = "/repo", exists = ["/repo/app.js"], type = 1, line } = {}) {
  const opened = [], calls = [], stats = [];
  const api = {
    Uri: { file: value => ({ path: value }), joinPath: (base, ...parts) => ({ path: path.posix.join(base.path, ...parts) }) },
    FileType: { Directory: 2 },
    workspace: {
      getConfiguration: () => ({ get: () => [] }),
      workspaceFolders: [], findFiles: async () => [],
      fs: { stat: async uri => {
        stats.push(uri.path);
        if (!exists.includes(uri.path)) throw Object.assign(new Error("Missing candidate"), { code: "FileNotFound" });
        return { type };
      } },
      openTextDocument: async uri => {
        if (!exists.includes(uri.path)) throw new Error("Missing text document");
        return uri;
      },
    },
    window: { showTextDocument: async uri => opened.push(uri.path) },
    commands: { executeCommand: async (command, uri) => {
      calls.push([command, uri.path]);
      // vscode.open can resolve without an exception even when it failed to open.
      if (command === "vscode.open" && exists.includes(uri.path)) opened.push(uri.path);
    } },
    Position: class {}, Range: class {},
  };
  const source = transform(await sourcePromise);
  const Target = vm.runInNewContext(source + "\nCodexFileTarget", {
    require: () => api, process: { platform: "linux" }, rHe: path.posix, NGe: path.posix.isAbsolute, m9: () => [],
  });
  const target = new Target();
  target.logger = { error() {} };
  return { result: await target.open({ path: file, cwd, line }), opened, calls, stats };
}

test("a missing first relative candidate falls through to the existing file", async () => {
  const result = await openLink();
  assert.equal(result.result.success, true);
  assert.deepEqual(result.opened, ["/repo/app.js"]);
  assert.deepEqual(result.stats, ["/repo/repo/app.js", "/repo/app.js"]);
  assert.deepEqual(result.calls, [["vscode.open", "/repo/app.js"], ["revealInExplorer", "/repo/app.js"]]);
});

test("missing files and directories cannot be reported as opened", async () => {
  for (const options of [{ exists: [] }, { file: "/repo", exists: ["/repo"], type: 2 }]) {
    const result = await openLink(options);
    assert.equal(result.result.success, false);
    assert.deepEqual(result.opened, []);
    assert.deepEqual(result.calls, []);
  }
});

test("coordinate links retain the original text candidate search", async () => {
  const result = await openLink({ line: 3 });
  assert.equal(result.result.success, true);
  assert.deepEqual(result.opened, ["/repo/app.js"]);
  assert.deepEqual(result.stats, []);
});
