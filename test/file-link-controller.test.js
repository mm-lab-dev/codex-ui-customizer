"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const { installFileLinks } = require("../file-link-controller");
const { REPORT_COMMAND, transform } = require("../file-link-transform");
const { fixture, sourcePromise } = require("./helpers/file-links");

function host(f) {
  const commands = new Map(), lines = [], errors = [];
  const api = {
    commands: { registerCommand: (id, fn) => commands.set(id, fn) },
    window: { showErrorMessage: message => errors.push(message) },
  };
  const controller = installFileLinks(api, { subscriptions: [] }, {
    log: message => lines.push(message), getOutput: () => ({ appendLine: message => lines.push(message) }), managerOptions: f.options,
  });
  return { controller, commands, lines, errors };
}

test("adapter registers only runtime reporting and inspection never applies", async t => {
  const f = await fixture(t);
  const h = host(f);
  assert.deepEqual([...h.commands.keys()], [REPORT_COMMAND]);
  assert.equal((await h.controller.inspect(true)).state, "unapplied");
  assert.equal(await fs.readFile(f.file, "utf8"), f.source);
  assert.ok(h.lines.some(line => line.startsWith("File links:")));
});

test("runtime errors are logged each time and identical error popups are suppressed", async t => {
  const h = host(await fixture(t));
  h.commands.get(REPORT_COMMAND)("Viewer failure");
  h.commands.get(REPORT_COMMAND)("Viewer failure");
  assert.equal(h.errors.length, 1);
  assert.equal(h.lines.filter(line => line.includes("Viewer failure")).length, 2);
});

test("unmanaged legacy patch cannot be reported as a successful removal", async t => {
  const source = transform(await sourcePromise, true);
  const f = await fixture(t, source);
  const h = host(f);
  assert.equal((await h.controller.reconcile(false)).state, "failed");
  assert.equal(await fs.readFile(f.file, "utf8"), source);
});
