"use strict";

const acorn = require("acorn");

const CURRENT_REVISION = 3;
const MARKER = "/* codex-ui-customizer:file-links:v3 */";
const CHECKED_MARKER = "/* codex-ui-customizer:file-links:v2 */";
const PREVIOUS_MARKER = "/* codex-ui-customizer:file-links:v1 */";
const LEGACY_MARKER = "/* CODEX-MP4-LINK-01 */";
const REPORT_COMMAND = "codexUiCustomizer.reportFileLinkError";

// Match the complete handler, including the selection calculation and failure
// behavior. Identifiers may be renamed; member/property names and literals may not.
const ORIGINAL = 'async uri=>{try{if(fileManager)return await api.commands.executeCommand("revealFileInOS",uri),!0;let doc=await api.workspace.openTextDocument(uri),position=new api.Position(Math.max(0,(line??1)-1),Math.max(0,column-1)),selection=line==null?void 0:new api.Range(position,position);return await api.window.showTextDocument(doc,{preview:!1,selection:selection}),!0}catch{return!1}}';

function parse(source) {
  return acorn.parse(source, { ecmaVersion: "latest", sourceType: "script", allowHashBang: true });
}

function walk(node, visit, ancestors = []) {
  if (!node || typeof node.type !== "string") return;
  visit(node, ancestors);
  for (const [key, child] of Object.entries(node)) {
    if (key === "start" || key === "end") continue;
    if (Array.isArray(child)) {
      for (const item of child) walk(item, visit, [...ancestors, node]);
    } else if (child && typeof child.type === "string") {
      walk(child, visit, [...ancestors, node]);
    }
  }
}

function same(template, actual, names, identifier = true) {
  if (template == null || typeof template !== "object") return template === actual;
  if (actual == null || typeof actual !== "object") return false;
  if (Array.isArray(template)) {
    return Array.isArray(actual) && template.length === actual.length &&
      template.every((item, i) => same(item, actual[i], names));
  }
  if (template.type !== actual.type) return false;
  if (template.type === "Identifier") {
    if (!identifier || template.name === "Math") return template.name === actual.name;
    if (names.has(template.name)) return names.get(template.name) === actual.name;
    if ([...names.values()].includes(actual.name)) return false;
    names.set(template.name, actual.name);
    return true;
  }
  const keys = Object.keys(template).filter(k => !["start", "end", "raw"].includes(k));
  const actualKeys = Object.keys(actual).filter(k => !["start", "end", "raw"].includes(k));
  if (keys.length !== actualKeys.length) return false;
  return keys.every(key => same(template[key], actual[key], names,
    !((template.type === "MemberExpression" && key === "property" && !template.computed) ||
      (template.type === "Property" && key === "key" && !template.computed))));
}

const originalAst = parse(`(${ORIGINAL})`).body[0].expression;

function command(node, value) {
  return node?.type === "AwaitExpression" && node.argument?.type === "CallExpression" &&
    node.argument.callee?.type === "MemberExpression" &&
    node.argument.callee.property?.name === "executeCommand" &&
    node.argument.arguments[0]?.value === value;
}

function isCandidate(node) {
  if (node.type !== "ArrowFunctionExpression" || !node.async || node.body.type !== "BlockStatement") return false;
  let found = false;
  walk(node.body, (item, ancestors) => {
    if (ancestors.some(parent => /Function/.test(parent.type))) return;
    if (command(item, "revealFileInOS")) found = true;
  });
  return found;
}

function boundNames(pattern) {
  if (!pattern) return [];
  if (pattern.type === "Identifier") return [pattern.name];
  if (pattern.type === "MemberExpression") return boundNames(pattern.object);
  if (pattern.type === "RestElement") return boundNames(pattern.argument);
  if (pattern.type === "AssignmentPattern") return boundNames(pattern.left);
  if (pattern.type === "ArrayPattern") return pattern.elements.flatMap(boundNames);
  if (pattern.type === "ObjectPattern") return pattern.properties.flatMap(property =>
    boundNames(property.type === "RestElement" ? property.argument : property.value));
  return [];
}

function bindingContext(node, ancestors, names) {
  const method = [...ancestors].reverse().find(n => n.type === "MethodDefinition");
  const fn = method?.value;
  if (!method || !fn.async || method.computed || method.key.name !== "open" ||
      fn.params.length !== 1 || fn.params[0].type !== "ObjectPattern") return null;
  // Only the known module-level class and direct callback declaration are
  // supported. A nested catch/function/block could bind the same names to
  // different values even when the callback's text is otherwise identical.
  const classIndex = ancestors.findLastIndex(item => ["ClassDeclaration", "ClassExpression"].includes(item.type));
  const container = ancestors[classIndex];
  const directClass = classIndex === 1 && container.type === "ClassDeclaration";
  const assignedClass = classIndex === 3 && ancestors[1].type === "VariableDeclaration" &&
    ancestors[2].type === "VariableDeclarator" && ancestors[2].init === container;
  if (!directClass && !assignedClass) return null;
  if ([names.get("api"), "Math", "Array"].includes(container.id?.name)) return null;
  const params = new Map(fn.params[0].properties.map(p => [p.key?.name, p.value?.name]));
  if (["path", "line", "column", "cwd", "target"].some(key => !params.get(key))) return null;
  if ([...params.values()].some(name => [names.get("api"), "Math", "Array"].includes(name))) return null;
  const declarations = fn.body.body.filter(n => n.type === "VariableDeclaration")
    .flatMap(n => n.declarations);
  if (!declarations.some(declaration => declaration.init === node)) return null;
  const declaration = name => declarations.find(n => n.id.type === "Identifier" && n.id.name === name);
  const expected = new Map(names);
  expected.set("rawLine", params.get("line"));
  expected.set("rawColumn", params.get("column"));
  expected.set("target", params.get("target"));
  for (const [key, expression] of [
    ["fileManager", 'target==="fileManager"'],
    ["line", 'typeof rawLine=="number"?rawLine:void 0'],
    ["column", 'typeof rawColumn=="number"?rawColumn:1'],
  ]) {
    if (!same(parse(`(${expression})`).body[0].expression, declaration(names.get(key))?.init, expected)) return null;
  }
  // Require a module-scope VS Code import (direct or bundler interop wrapper),
  // and reject local shadows of that namespace or Math in the enclosing method.
  const program = ancestors[0];
  if (program.body.some(statement =>
    statement.type === "VariableDeclaration" ? statement.declarations.some(declaration => boundNames(declaration.id).some(name => ["Math", "Array"].includes(name))) :
      ["FunctionDeclaration", "ClassDeclaration"].includes(statement.type) && ["Math", "Array"].includes(statement.id?.name))) return null;
  const imports = program.body.filter(n => n.type === "VariableDeclaration").flatMap(n => n.declarations)
    .filter(n => n.id.name === names.get("api"));
  if (imports.length !== 1) return null;
  let init = imports[0].init;
  if (init?.type === "CallExpression" && init.arguments.length === 1 &&
      init.arguments[0]?.type === "CallExpression") init = init.arguments[0];
  if (init?.type !== "CallExpression" || init.callee?.name !== "require" ||
      init.arguments.length !== 1 || init.arguments[0]?.value !== "vscode") return null;
  const protectedNames = new Set([names.get("api"), "Math", "Array", names.get("fileManager"),
    names.get("line"), names.get("column"), params.get("line"), params.get("column")]);
  const knownDeclarations = new Set([names.get("fileManager"), names.get("line"), names.get("column")]
    .map(name => declaration(name)));
  let shadow = false;
  walk(fn.body, item => {
    if (item.type === "VariableDeclarator" && !knownDeclarations.has(item) && boundNames(item.id).some(name => protectedNames.has(name))) shadow = true;
    if (["AssignmentExpression", "UpdateExpression"].includes(item.type) && boundNames(item.left ?? item.argument).some(name => protectedNames.has(name))) shadow = true;
    if (item.type === "CatchClause" && boundNames(item.param).some(name => protectedNames.has(name))) shadow = true;
    if (["FunctionDeclaration", "ClassDeclaration"].includes(item.type) && protectedNames.has(item.id?.name)) shadow = true;
    if (/Function/.test(item.type) && item.params?.flatMap(boundNames).some(name => protectedNames.has(name))) shadow = true;
  });
  if (shadow) return null;
  return { ...Object.fromEntries(names), rawLine: params.get("line"), rawColumn: params.get("column") };
}

function branch(context) {
  const { api, uri, rawLine, rawColumn } = context;
  const used = new Set(Object.values(context));
  function local(label) {
    let name = `codexUiLink${label}`;
    while (used.has(name)) name += "_";
    used.add(name);
    return name;
  }
  const excluded = local("Excluded");
  const filename = local("Filename");
  const dot = local("Dot");
  const extension = local("Extension");
  const entry = local("Entry");
  const skip = local("Skip");
  const error = local("Error");
  return `if(${rawLine}==null&&${rawColumn}==null){
    const ${excluded} = ${api}.workspace.getConfiguration("codexUiCustomizer").get("fileLinks.excludedExtensions", []);
    const ${filename} = (${uri}.path ?? ${uri}.fsPath ?? "").split(/[\\\\/]/).pop() ?? "";
    const ${dot} = ${filename}.lastIndexOf(".");
    const ${extension} = ${dot} > 0 ? ${filename}.slice(${dot} + 1).toLowerCase() : "";
    const ${skip} = ${extension} !== "" && Array.isArray(${excluded}) && ${excluded}.some(${entry} =>
      typeof ${entry} === "string" && ${entry}.trim().replace(/^\\./, "").toLowerCase() === ${extension});
    if (!${skip}) {
      try {
        if ((await ${api}.workspace.fs.stat(${uri})).type & ${api}.FileType.Directory) return false;
        await ${api}.commands.executeCommand("vscode.open",${uri},{preview:false});
        await ${api}.commands.executeCommand("revealInExplorer",${uri});
        return true;
      } catch (${error}) {
        if (${error}?.code === "FileNotFound" || ${error}?.code === "ENOENT") return false;
        try {
          await ${api}.commands.executeCommand("${REPORT_COMMAND}", "" + ${error});
        } catch {}
        return false;
      }
    }
  }`;
}

function checkedBranch({ api, uri, rawLine, rawColumn }) {
  const error = api === "codexUiLinkError" ? "codexUiLinkError2" : "codexUiLinkError";
  return `if(${rawLine}==null&&${rawColumn}==null){
    try {
      if ((await ${api}.workspace.fs.stat(${uri})).type & ${api}.FileType.Directory) return false;
      await ${api}.commands.executeCommand("vscode.open",${uri},{preview:false});
      await ${api}.commands.executeCommand("revealInExplorer",${uri});
      return true;
    } catch (${error}) {
      if (${error}?.code === "FileNotFound" || ${error}?.code === "ENOENT") return false;
      try {
        await ${api}.commands.executeCommand("${REPORT_COMMAND}", "" + ${error});
      } catch {}
      return false;
    }
  }`;
}

function previousBranch({ api, uri, rawLine, rawColumn }) {
  return `if(${rawLine}==null&&${rawColumn}==null){try{await ${api}.commands.executeCommand("vscode.open",${uri},{preview:false});await ${api}.commands.executeCommand("revealInExplorer",${uri});return!0}catch(codexUiLinkError){await ${api}.commands.executeCommand("${REPORT_COMMAND}",String(codexUiLinkError)).catch(()=>{});return!1}}`;
}

function legacyBranch({ api, uri }) {
  return `if(/\\.mp4$/i.test(${uri}.path??${uri}.fsPath??"")){await ${api}.commands.executeCommand("vscode.open",${uri});await ${api}.commands.executeCommand("revealInExplorer",${uri});return!0}`;
}

function exactStatement(source, actual) {
  const expected = parse(`(async()=>{${source}})`).body[0].expression.body.body[0];
  const identifiers = new Map();
  walk(expected, node => { if (node.type === "Identifier") identifiers.set(node.name, node.name); });
  return same(expected, actual, identifiers);
}

function officialBranches({ api, uri, rawLine, rawColumn }) {
  // Only claim official support for explicitly verified equivalent structures.
  // Other implementations remain unsupported, with an indeterminate message.
  return [",{preview:false}", ""].map(options =>
    `if(${rawLine}==null&&${rawColumn}==null){await ${api}.commands.executeCommand("vscode.open",${uri}${options});await ${api}.commands.executeCommand("revealInExplorer",${uri});return!0}`);
}

function analyze(source) {
  let ast;
  try { ast = parse(source); } catch (error) {
    return { kind: "unsupported", reason: `JavaScript cannot be parsed: ${error.message}` };
  }
  const candidates = [];
  walk(ast, (node, ancestors) => { if (isCandidate(node)) candidates.push({ node, ancestors }); });
  if (candidates.length !== 1) return { kind: "unsupported", reason: `Expected one file-link handler; found ${candidates.length}. Official support cannot be determined.` };
  const { node, ancestors } = candidates[0];
  const statements = node.body.body[0]?.type === "TryStatement" ? node.body.body[0].block.body : null;
  if (!statements) return { kind: "unsupported", reason: "File-link handler structure differs from the supported adapter. Official support cannot be determined; no changes made." };
  for (const kind of ["unpatched", "legacy", "managed", "checked", "previous", "official"]) {
    const stripped = structuredClone(node);
    if (kind !== "unpatched") stripped.body.body[0].block.body.splice(1, 1);
    const names = new Map();
    if (!same(originalAst, stripped, names)) continue;
    const context = bindingContext(node, ancestors, names);
    if (!context) continue;
    const insertion = statements[0].end;
    if (kind !== "unpatched") {
      const expected = kind === "legacy" ? [legacyBranch(context)] :
        kind === "official" ? officialBranches(context) : kind === "previous" ? [previousBranch(context)] :
          kind === "checked" ? [checkedBranch(context)] : [branch(context)];
      if (!expected.some(source => exactStatement(source, statements[1]))) continue;
    }
    const handlerSource = source.slice(node.start, node.end);
    const hasManaged = handlerSource.includes(MARKER);
    const hasChecked = handlerSource.includes(CHECKED_MARKER);
    const hasPrevious = handlerSource.includes(PREVIOUS_MARKER);
    const hasLegacy = handlerSource.includes(LEGACY_MARKER);
    if (kind === "managed" && (!hasManaged || hasChecked || hasPrevious || hasLegacy)) continue;
    if (kind === "checked" && (!hasChecked || hasManaged || hasPrevious || hasLegacy)) continue;
    if (kind === "previous" && (!hasPrevious || hasManaged || hasChecked || hasLegacy)) continue;
    if (kind === "official" && (hasManaged || hasChecked || hasPrevious || hasLegacy)) continue;
    if (kind === "legacy" && (!hasLegacy || hasManaged || hasChecked || hasPrevious)) continue;
    if (kind === "unpatched" && [MARKER, CHECKED_MARKER, PREVIOUS_MARKER, LEGACY_MARKER].some(marker => source.includes(marker))) continue;
    // Refuse stray/duplicate markers anywhere in the bundle.
    if (kind === "managed" && source.split(MARKER).length !== 2) continue;
    if (kind === "checked" && source.split(CHECKED_MARKER).length !== 2) continue;
    if (kind === "previous" && source.split(PREVIOUS_MARKER).length !== 2) continue;
    if (kind === "legacy" && source.split(LEGACY_MARKER).length !== 2) continue;
    return { kind: ["previous", "checked"].includes(kind) ? "managed" : kind,
      revision: kind === "previous" ? 1 : kind === "checked" ? 2 : kind === "managed" ? CURRENT_REVISION : undefined,
      insertion, context, nodeStart: node.start, nodeEnd: node.end,
      reason: kind === "official" ? "Equivalent standard-open handler found without our marker (structurally verified)." : `Verified ${kind} handler.` };
  }
  return { kind: "unsupported", reason: "File-link handler structure differs from the supported adapter. Official support cannot be determined; no changes made." };
}

function transform(source, legacy = false) {
  const result = analyze(source);
  if (result.kind !== "unpatched") throw new Error(`Cannot transform ${result.kind}: ${result.reason}`);
  const addition = legacy ? LEGACY_MARKER + legacyBranch(result.context) : MARKER + branch(result.context);
  const patched = source.slice(0, result.insertion) + addition + source.slice(result.insertion);
  const checked = analyze(patched);
  if (checked.kind !== (legacy ? "legacy" : "managed")) throw new Error("Generated patch failed structural verification");
  return patched;
}

module.exports = { analyze, transform, MARKER, LEGACY_MARKER, REPORT_COMMAND, CURRENT_REVISION };
