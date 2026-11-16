"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { fork } = require("node:child_process");
const { once } = require("node:events");
const { CustomizationStore } = require("../customization-store");
const { fixture } = require("./helpers/file-links");

test("the customization lock and suspension are shared with a separate Node process", async t => {
  const f = await fixture(t);
  const directory = path.join(f.root, "control");
  const child = fork(path.join(__dirname, "helpers", "customization-store-child.cjs"), [directory], {
    stdio: ["ignore", "ignore", "pipe", "ipc"], windowsHide: true,
  });
  const exited = once(child, "exit");
  try {
    const [message] = await once(child, "message");
    assert.equal(message, "locked");
    let acquired = false;
    const operation = new CustomizationStore({ directory }).withLock(async control => {
      acquired = true;
      return control.read();
    });
    await new Promise(resolve => setTimeout(resolve, 40));
    assert.equal(acquired, false);
    child.send("release");
    assert.equal(await operation, true);
    const [code] = await exited;
    assert.equal(code, 0);
  } finally {
    if (child.exitCode === null) child.kill();
    await exited;
  }
});

test("a busy lock times out without stealing the lock or changing shared state", async t => {
  const f = await fixture(t);
  const directory = path.join(f.root, "control");
  await fs.mkdir(directory);
  const lockFile = path.join(directory, "operation.lock");
  await fs.writeFile(lockFile, "busy");
  const store = new CustomizationStore({ directory, lockTimeoutMs: 30, retryMs: 5 });
  await assert.rejects(store.withLock(async control => control.write(false)), /still holding/);
  assert.equal(await fs.readFile(lockFile, "utf8"), "busy");
  await assert.rejects(fs.access(path.join(directory, "state.json")), { code: "ENOENT" });
});

test("invalid shared state fails closed and the operation lock is released", async t => {
  const f = await fixture(t);
  const directory = path.join(f.root, "control");
  await fs.mkdir(directory);
  await fs.writeFile(path.join(directory, "state.json"), '{"schema":1,"suspended":"invalid"}');
  const store = new CustomizationStore({ directory });
  await assert.rejects(store.withLock(async control => control.read()), /Invalid customization state/);
  await assert.rejects(fs.access(path.join(directory, "operation.lock")), { code: "ENOENT" });
});
