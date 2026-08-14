"use strict";

const DEFAULTS = Object.freeze({
  background: "#173e76",
  borderColor: "#3d4654",
  borderWidth: "1px",
  borderRadius: "10px",
});

const COLOR_PATTERN = /^#[0-9a-f]{3}(?:[0-9a-f]{1}|[0-9a-f]{3}|[0-9a-f]{5})?$/i;
const LENGTH_PATTERN = /^(?:0|(?:\d+(?:\.\d+)?|\.\d+)(?:px|rem|em))$/i;

function validOrDefault(value, pattern, fallback) {
  return typeof value === "string" && pattern.test(value.trim())
    ? value.trim()
    : fallback;
}

function sanitizeStyleConfig(config) {
  return {
    background: validOrDefault(config.background, COLOR_PATTERN, DEFAULTS.background),
    borderColor: validOrDefault(config.borderColor, COLOR_PATTERN, DEFAULTS.borderColor),
    borderWidth: validOrDefault(config.borderWidth, LENGTH_PATTERN, DEFAULTS.borderWidth),
    borderRadius: validOrDefault(config.borderRadius, LENGTH_PATTERN, DEFAULTS.borderRadius),
  };
}

module.exports = {
  COLOR_PATTERN,
  DEFAULTS,
  LENGTH_PATTERN,
  sanitizeStyleConfig,
};
