"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");

function decodeAttribute(value) {
  const entities = { amp: "&", quot: '"', apos: "'", lt: "<", gt: ">" };
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, name) => {
    if (name[0] === "#") {
      const hex = name[1].toLowerCase() === "x";
      const code = Number.parseInt(name.slice(hex ? 2 : 1), hex ? 16 : 10);
      if (code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff)) {
        return String.fromCodePoint(code);
      }
    } else if (Object.hasOwn(entities, name.toLowerCase())) {
      return entities[name.toLowerCase()];
    }
    throw new Error(`Unsupported HTML entity in stylesheet reference: ${entity}`);
  });
}

// Read only explicit stylesheet links. Ignore comments and raw script/style text,
// including Vite dependency tables, which also contain CSS filenames.
function getStylesheetReferences(html) {
  const tags = html.matchAll(/<!--[\s\S]*?-->|<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>|<([a-z][\w:-]*)\b(?:[^"'<>]|"[^"]*"|'[^']*')*>/gi);
  const references = [];
  for (const match of tags) {
    const tag = match[2]?.toLowerCase();
    if (tag === "base") {
      throw new Error("Unsupported <base> in webview/index.html; stylesheet resolution stopped.");
    }
    if (tag !== "link") continue;
    const attributes = Object.create(null);
    const source = match[0].slice(5, -1).replace(/\/\s*$/, "");
    const attribute = /\s+([^\s=<>/"']+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/gy;
    let offset = 0;
    while (offset < source.length) {
      if (!source.slice(offset).trim()) break;
      attribute.lastIndex = offset;
      const item = attribute.exec(source);
      if (!item) throw new Error(`Cannot parse HTML link: ${match[0]}`);
      const name = item[1].toLowerCase();
      if (Object.hasOwn(attributes, name)) throw new Error(`Duplicate link attribute: ${name}`);
      attributes[name] = decodeAttribute(item[2] ?? item[3] ?? item[4] ?? "");
      offset = attribute.lastIndex;
    }
    const rel = (attributes.rel ?? "").toLowerCase().split(/\s+/);
    if (!rel.includes("stylesheet")) continue;
    if (!attributes.href || rel.includes("alternate") || Object.hasOwn(attributes, "disabled") ||
        (attributes.media && attributes.media.toLowerCase() !== "all")) {
      throw new Error(`Unsupported or conditional stylesheet link: ${match[0]}`);
    }
    references.push(attributes.href);
  }
  if (references.length === 0) {
    throw new Error("No explicit stylesheet links found in webview/index.html; no CSS files will be changed.");
  }
  return references;
}

function isWithin(root, file) {
  const relative = path.relative(root, file);
  return relative !== "" && relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

async function discoverCssTargets(extensionPath) {
  const webviewDir = path.join(extensionPath, "webview");
  const htmlFile = path.join(webviewDir, "index.html");
  const references = getStylesheetReferences(await fs.readFile(htmlFile, "utf8"));
  const realRoot = await fs.realpath(webviewDir);
  const targets = [];
  const seen = new Set();

  // Validate every reference before the caller starts writing any CSS.
  for (const href of references) {
    if (/^(?:[a-z][a-z\d+.-]*:|[\/\\])|\\/i.test(href)) {
      throw new Error(`Stylesheet must use a local relative path: ${href}`);
    }
    let relative;
    try {
      relative = decodeURIComponent(href.split(/[?#]/, 1)[0]);
    } catch {
      throw new Error(`Invalid URL encoding in stylesheet reference: ${href}`);
    }
    if (/[\\\x00-\x1f:?#]/.test(relative) || !/\.css$/i.test(relative)) {
      throw new Error(`Unsupported stylesheet path: ${href}`);
    }
    const file = path.resolve(webviewDir, relative);
    if (!isWithin(webviewDir, file)) throw new Error(`Stylesheet escapes webview directory: ${href}`);
    let realFile;
    try {
      realFile = await fs.realpath(file);
      if (!(await fs.stat(realFile)).isFile()) throw new Error("not a regular file");
    } catch (error) {
      throw new Error(`Cannot access stylesheet ${href} referenced by ${htmlFile}: ${error.message}`);
    }
    if (!isWithin(realRoot, realFile)) throw new Error(`Stylesheet resolves outside webview directory: ${href}`);
    if (!seen.has(realFile)) {
      seen.add(realFile);
      targets.push({ file, href });
    }
  }
  return { htmlFile, targets, cssFiles: targets.map(({ file }) => file) };
}

module.exports = { discoverCssTargets, getStylesheetReferences };
