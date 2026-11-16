"use strict";

const { CustomizationStore } = require("../../customization-store");
const directory = process.argv[2];
const released = new Promise(resolve => process.once("message", resolve));
new CustomizationStore({ directory }).withLock(async control => {
  await control.write(true);
  process.send("locked");
  await released;
}).then(() => process.disconnect()).catch(error => {
  console.error(error);
  process.exitCode = 1;
  process.disconnect();
});
