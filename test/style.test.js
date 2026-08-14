"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { DEFAULTS, sanitizeStyleConfig } = require("../style");

test("accepts supported hexadecimal colors and CSS lengths", () => {
  assert.deepEqual(
    sanitizeStyleConfig({
      background: " #abc8 ",
      borderColor: "#AABBCCDD",
      borderWidth: ".5rem",
      borderRadius: "0",
    }),
    {
      background: "#abc8",
      borderColor: "#AABBCCDD",
      borderWidth: ".5rem",
      borderRadius: "0",
    }
  );
});

test("rejects values that can escape a CSS declaration", () => {
  assert.deepEqual(
    sanitizeStyleConfig({
      background: "red; } body { display: none",
      borderColor: "url(https://example.invalid/track)",
      borderWidth: "1px; color: red",
      borderRadius: "calc(10px)",
    }),
    DEFAULTS
  );
});

test("rejects negative, unitless, and non-string lengths", () => {
  const result = sanitizeStyleConfig({
    background: null,
    borderColor: 123,
    borderWidth: "-1px",
    borderRadius: "10",
  });

  assert.deepEqual(result, DEFAULTS);
});
