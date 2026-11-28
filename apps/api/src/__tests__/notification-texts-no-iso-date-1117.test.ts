/**
 * Issue #1117 (AC-2) - guard: no notification text names a calendar day in computer format
 * ("2026-12-01"). A bell row and the notification e-mail print the title and the message verbatim,
 * so a day in them must read the German way ("1.12.2026", "1.12.–2.12.2026") through
 * `dayLabelDe` / `dayRangeLabelDe` in `apps/api/src/utils/day-label-de.ts` (glossary row "Datum (Ich
 * und Team)"), or through one of the existing German formatters registered below.
 *
 * Pure static analysis with the `typescript` package (no Program, no database).
 *
 * What counts as a site: a call `notify({ ... })` / `<x>.notify({ ... })` with an object literal, and
 * a `<x>.notification.create({ data: { ... } })` / `createMany` whose `data` is an object literal or an
 * array of them. A site whose `data` is anything else is itself a finding (E) - it cannot be read.
 * The texts read per site are `title`, `message` and `emailSubject`; `link` is NOT a text (deep links
 * carry ISO days on purpose).
 *
 * How a text is read: the expression is resolved into leaves - literal text, an ISO producer, or an
 * opaque value named by its property / identifier / callee. Identifiers follow their declaration
 * (const initializer, `let` assignments, object-binding selection, loop variables are opaque),
 * calls follow a same-file function or an exported function of a relative import (one `export ... from`
 * hop), `map` callbacks follow what they return (a callback parameter stands for the receiver), other
 * methods follow their receiver, and a call of a registered German formatter is safe without reading
 * its arguments.
 *
 * Findings: (A) a text leaf holding an ISO day; (B) an ISO producer (`toISOString`, `toJSON`,
 * `dateStrInTz`, `formatInTimeZone` with yyyy-MM-dd); (C) an opaque leaf whose name reads as a calendar
 * day (`startDay`, `targetDate`, `gapDates`, `entryDateStr`) unless NOT_A_CALENDAR_DAY names it; (D) a
 * text that is a parameter of the function that contains the site (a forwarder whose callers write the
 * text) unless SINKS names the file; (E) an unreadable `data` argument.
 *
 * Stated blind spots: a `let` assigned through a destructuring or inside a callback; arguments of
 * `concat` / `replace`; a text built by a callee that is not a plain identifier (`obj.method()` is read
 * as its receiver); a forwarder that is called with a day text, one hop away from the site (D covers
 * only the function around the site); more than eight identifier / call hops (reported as a leaf).
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname, posix } from "node:path";
import ts from "typescript";
import { describe, it, expect } from "vitest";
import { dayLabelDe, dayRangeLabelDe } from "../utils/day-label-de";
import { decisionPeriodDe } from "../contexts/absence/leave-decision";
import { monthLabelDe } from "../contexts/working-time-account/month-close-notification";

const SRC = join(__dirname, "..");
/** Measured on the green tree (Issue #1117): notify() and notification.create() emit sites. */
const MIN_EMIT_SITES = 50;
const MAX_HOPS = 8;
const ISO_DAY = /\b\d{4}-\d{2}-\d{2}\b/;
const TEXT_PROPS = new Set(["title", "message", "emailSubject"]);

/** Callee names whose result is a German day text; their arguments are not read. */
const GERMAN_FORMATTERS: Record<string, string> = {
  dayLabelDe: "the one German day label (Issue #1117): 1.12.2026",
  dayRangeLabelDe: "the German range label (Issue #1117): 1.12.–2.12.2026",
  decisionPeriodDe: "'vom 1.12.2026 [bis 2.12.2026]' of leave-decision.ts, built from dayLabelDe",
  monthLabelDe: "'Juni 2026', a month label that names no day",
};

/**
 * Issue #1149: the one formatter is `dayLabelDe` / `dayRangeLabelDe`, so a day with a leading zero
 * ("01.12.2026", "vom 01.12.") is a finding of its own kind (F), just like an ISO day is (A-D).
 * Literal text is read for it; so are the calls that can print one: `toLocaleDateString` /
 * `toLocaleString` whose options name a `day` (or that carry no options at all, which prints the
 * day and reads the host time zone), and `formatInTimeZone` with a `dd` pattern.
 */
const LEADING_ZERO_DAY = /(^|[^\d.])(0\d\.\d{1,2}\.|\d{1,2}\.0\d\.)/;
const LOCALE_DAY_CALLS = new Set(["toLocaleDateString", "toLocaleString"]);

/** "file::leaf" -> reason: an opaque leaf whose name reads as a day but is not a calendar day. */
const NOT_A_CALENDAR_DAY: Record<string, string> = {
  "contexts/time-tracking/plugins/attendance-checker.ts::carryOverDeadlineDay":
    "VACATION_EXPIRY: a day-of-month number the text builds D.M.YYYY from",
};

/** file -> reason: the text of a site is a parameter on purpose (the sink writes what it is given). */
const SINKS: Record<string, string> = {
  "contexts/platform/plugins/notify.ts": "notify() itself writes its `message` parameter",
};

// ── scanner ─────────────────────────────────────────────────────────────────────────────────

type FnNode =
  ts.FunctionDeclaration | ts.FunctionExpression | ts.ArrowFunction | ts.MethodDeclaration;
const isFn = (n: ts.Node): n is FnNode =>
  ts.isFunctionDeclaration(n) ||
  ts.isFunctionExpression(n) ||
  ts.isArrowFunction(n) ||
  ts.isMethodDeclaration(n);

type Leaf =
  | { k: "text"; text: string }
  | { k: "iso"; why: string }
  | { k: "zero"; why: string }
  | { k: "opaque"; name: string; rel: string; forwarder: boolean };

interface BindingHit {
  kind: "plain" | "object" | "opaque";
  prop: string;
}

type Decl =
  | { k: "param"; fn: FnNode; param: ts.ParameterDeclaration }
  | { k: "var"; decl: ts.VariableDeclaration; hit: BindingHit }
  | { k: "fn"; node: ts.FunctionDeclaration }
  | { k: "import"; spec: ts.ImportSpecifier; from: string }
  | { k: "opaque" };

interface Reached {
  formatters: Set<string>;
  notDay: Set<string>;
  sinks: Set<string>;
}

interface SiteInfo {
  rel: string;
  line: number;
  steps: number;
  files: Set<string>;
}

interface ScanResult {
  walked: number;
  sites: SiteInfo[];
  findings: string[];
  reached: Reached;
}

interface Cx {
  files: Map<string, ts.SourceFile>;
  site: ts.Node;
  leaves: Leaf[];
  safe: number;
  calls: number;
  entered: Set<string>;
  seen: Set<string>;
  mapParams: Map<ts.Node, ts.Expression>;
  reached: Reached;
}

function bindingHit(name: ts.BindingName, target: string): BindingHit | null {
  if (ts.isIdentifier(name)) return name.text === target ? { kind: "plain", prop: target } : null;
  for (const el of name.elements) {
    if (ts.isOmittedExpression(el)) continue;
    if (ts.isIdentifier(el.name)) {
      if (el.name.text !== target) continue;
      if (!ts.isObjectBindingPattern(name)) return { kind: "opaque", prop: target };
      const prop =
        el.propertyName && ts.isIdentifier(el.propertyName) ? el.propertyName.text : target;
      return { kind: "object", prop };
    }
    if (bindingHit(el.name, target)) return { kind: "opaque", prop: target };
  }
  return null;
}

function lookup(id: ts.Identifier): Decl | null {
  const name = id.text;
  for (let p: ts.Node | undefined = id.parent; p; p = p.parent) {
    if (isFn(p)) {
      for (const param of p.parameters) {
        if (bindingHit(param.name, name)) return { k: "param", fn: p, param };
      }
    }
    if (
      ts.isBlock(p) ||
      ts.isSourceFile(p) ||
      ts.isModuleBlock(p) ||
      ts.isCaseClause(p) ||
      ts.isDefaultClause(p)
    ) {
      for (const st of p.statements) {
        if (ts.isVariableStatement(st)) {
          for (const d of st.declarationList.declarations) {
            const hit = bindingHit(d.name, name);
            if (hit && (ts.isSourceFile(p) || d.getStart() < id.getStart())) {
              return { k: "var", decl: d, hit };
            }
          }
        } else if (ts.isFunctionDeclaration(st) && st.name?.text === name) {
          return { k: "fn", node: st };
        } else if (ts.isImportDeclaration(st) && st.importClause?.namedBindings) {
          const nb = st.importClause.namedBindings;
          if (ts.isNamedImports(nb) && ts.isStringLiteral(st.moduleSpecifier)) {
            for (const spec of nb.elements) {
              if (spec.name.text === name) {
                return { k: "import", spec, from: st.moduleSpecifier.text };
              }
            }
          }
        }
      }
    }
    if (
      (ts.isForOfStatement(p) || ts.isForInStatement(p) || ts.isForStatement(p)) &&
      p.initializer &&
      ts.isVariableDeclarationList(p.initializer)
    ) {
      for (const d of p.initializer.declarations)
        if (bindingHit(d.name, name)) return { k: "opaque" };
    }
    if (
      ts.isCatchClause(p) &&
      p.variableDeclaration &&
      bindingHit(p.variableDeclaration.name, name)
    ) {
      return { k: "opaque" };
    }
  }
  return null;
}

function resolveModule(files: Map<string, ts.SourceFile>, from: string, spec: string) {
  if (!spec.startsWith(".")) return null;
  const base = posix.normalize(posix.join(posix.dirname(from), spec));
  for (const cand of [`${base}.ts`, `${base}/index.ts`]) if (files.has(cand)) return cand;
  return null;
}

function localFn(sf: ts.SourceFile, name: string): FnNode | null {
  for (const st of sf.statements) {
    if (ts.isFunctionDeclaration(st) && st.name?.text === name) return st;
    if (ts.isVariableStatement(st)) {
      for (const d of st.declarationList.declarations) {
        if (
          ts.isIdentifier(d.name) &&
          d.name.text === name &&
          d.initializer &&
          (ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer))
        ) {
          return d.initializer;
        }
      }
    }
  }
  return null;
}

function exportedFn(
  files: Map<string, ts.SourceFile>,
  rel: string,
  name: string,
  hopsLeft: number,
): FnNode | null {
  const sf = files.get(rel);
  if (!sf) return null;
  const direct = localFn(sf, name);
  if (direct) {
    const exported = sf.statements.some(
      (st) =>
        (ts.isFunctionDeclaration(st) || ts.isVariableStatement(st)) &&
        ts.getModifiers(st)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword),
    );
    if (exported) return direct;
  }
  for (const st of sf.statements) {
    if (!ts.isExportDeclaration(st) || !st.exportClause || !ts.isNamedExports(st.exportClause))
      continue;
    for (const el of st.exportClause.elements) {
      if (el.name.text !== name) continue;
      const inner = el.propertyName?.text ?? name;
      if (!st.moduleSpecifier) return localFn(sf, inner);
      if (hopsLeft > 0 && ts.isStringLiteral(st.moduleSpecifier)) {
        const next = resolveModule(files, rel, st.moduleSpecifier.text);
        if (next) return exportedFn(files, next, inner, hopsLeft - 1);
      }
    }
  }
  return null;
}

function functionOf(callee: ts.Identifier, cx: Cx): FnNode | null {
  const decl = lookup(callee);
  if (!decl) return null;
  if (decl.k === "fn") return decl.node;
  if (decl.k === "var" && decl.hit.kind === "plain") {
    const init = decl.decl.initializer;
    if (init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init))) return init;
    return null;
  }
  if (decl.k === "import") {
    const target = resolveModule(cx.files, callee.getSourceFile().fileName, decl.from);
    if (!target) return null;
    return exportedFn(cx.files, target, decl.spec.propertyName?.text ?? decl.spec.name.text, 1);
  }
  return null;
}

function returnedExprs(fn: FnNode): ts.Expression[] {
  if (ts.isArrowFunction(fn) && !ts.isBlock(fn.body)) return [fn.body];
  const out: ts.Expression[] = [];
  const body = fn.body;
  if (!body) return out;
  const collect = (n: ts.Node) => {
    if (ts.isReturnStatement(n)) {
      if (n.expression) out.push(n.expression);
      return;
    }
    if (n !== body && isFn(n)) return;
    n.forEachChild(collect);
  };
  collect(body);
  return out;
}

function isAncestor(anc: ts.Node, node: ts.Node): boolean {
  for (let p: ts.Node | undefined = node; p; p = p.parent) if (p === anc) return true;
  return false;
}

/** `word: "genehmigt" | "abgelehnt"`: a plain parameter whose type is string literals only. */
function isLiteralUnion(param: ts.ParameterDeclaration): boolean {
  const t = param.type;
  if (!t || !ts.isIdentifier(param.name)) return false;
  const lit = (x: ts.TypeNode) => ts.isLiteralTypeNode(x) && ts.isStringLiteral(x.literal);
  return lit(t) || (ts.isUnionTypeNode(t) && t.types.every(lit));
}

function opaque(cx: Cx, name: string, node: ts.Node, forwarder = false) {
  cx.leaves.push({ k: "opaque", name, rel: node.getSourceFile().fileName, forwarder });
}

const ISO_FORMAT = /yyyy-MM-dd/;

function resolve(n: ts.Node | undefined, cx: Cx, hops: number, select?: string): void {
  if (!n) return;
  if (ts.isStringLiteralLike(n)) {
    cx.leaves.push({ k: "text", text: n.text });
    return;
  }
  if (ts.isTemplateExpression(n)) {
    cx.leaves.push({ k: "text", text: n.head.text });
    for (const span of n.templateSpans) {
      resolve(span.expression, cx, hops);
      cx.leaves.push({ k: "text", text: span.literal.text });
    }
    return;
  }
  if (
    ts.isParenthesizedExpression(n) ||
    ts.isAsExpression(n) ||
    ts.isNonNullExpression(n) ||
    ts.isAwaitExpression(n) ||
    ts.isTypeAssertionExpression(n) ||
    ts.isSatisfiesExpression(n) ||
    ts.isSpreadElement(n)
  ) {
    resolve(n.expression, cx, hops, select);
    return;
  }
  if (ts.isBinaryExpression(n)) {
    const op = n.operatorToken.kind;
    if (
      op === ts.SyntaxKind.PlusToken ||
      op === ts.SyntaxKind.QuestionQuestionToken ||
      op === ts.SyntaxKind.BarBarToken ||
      op === ts.SyntaxKind.AmpersandAmpersandToken
    ) {
      resolve(n.left, cx, hops, select);
      resolve(n.right, cx, hops, select);
    }
    return;
  }
  if (ts.isConditionalExpression(n)) {
    resolve(n.whenTrue, cx, hops, select);
    resolve(n.whenFalse, cx, hops, select);
    return;
  }
  if (ts.isArrayLiteralExpression(n)) {
    for (const el of n.elements) resolve(el, cx, hops);
    return;
  }
  if (ts.isObjectLiteralExpression(n)) {
    const keyOf = (p: ts.ObjectLiteralElementLike) =>
      p.name && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) ? p.name.text : "";
    const textual = n.properties.filter((p) => keyOf(p) === "title" || keyOf(p) === "message");
    const picked = select
      ? n.properties.filter((p) => keyOf(p) === select)
      : textual.length > 0
        ? textual
        : [...n.properties];
    for (const p of picked) {
      if (ts.isPropertyAssignment(p)) resolve(p.initializer, cx, hops);
      else if (ts.isShorthandPropertyAssignment(p)) resolve(p.name, cx, hops);
    }
    return;
  }
  if (ts.isIdentifier(n)) {
    resolveIdentifier(n, cx, hops, select);
    return;
  }
  if (ts.isPropertyAccessExpression(n)) {
    opaque(cx, n.name.text, n);
    return;
  }
  if (ts.isElementAccessExpression(n)) {
    resolve(n.expression, cx, hops);
    return;
  }
  if (ts.isCallExpression(n)) resolveCall(n, cx, hops, select);
}

function resolveIdentifier(id: ts.Identifier, cx: Cx, hops: number, select?: string): void {
  if (id.text === "undefined") return;
  const decl = lookup(id);
  if (!decl) {
    opaque(cx, id.text, id);
    return;
  }
  if (decl.k === "opaque" || decl.k === "fn" || decl.k === "import") {
    if (decl.k === "opaque") opaque(cx, id.text, id);
    return;
  }
  if (decl.k === "param") {
    const receiver = cx.mapParams.get(decl.fn);
    if (receiver) {
      resolve(receiver, cx, hops + 1);
      return;
    }
    // A parameter typed as a union of string literals is a fixed vocabulary, it cannot carry a day.
    if (isLiteralUnion(decl.param)) return;
    opaque(cx, id.text, id, cx.calls === 0 && isAncestor(decl.fn, cx.site));
    return;
  }
  if (hops >= MAX_HOPS) {
    opaque(cx, "<depth-limit>", id);
    return;
  }
  const key = `${decl.decl.getSourceFile().fileName}:${decl.decl.pos}:${select ?? ""}`;
  if (cx.seen.has(key)) return;
  cx.seen.add(key);
  if (decl.hit.kind === "opaque") {
    opaque(cx, id.text, id);
    return;
  }
  const list = decl.decl.parent;
  const isLet = ts.isVariableDeclarationList(list) && (list.flags & ts.NodeFlags.Let) !== 0;
  const wanted = decl.hit.kind === "object" ? decl.hit.prop : select;
  resolve(decl.decl.initializer, cx, hops + 1, wanted);
  if (isLet && decl.hit.kind === "plain") {
    const scope = list.parent.parent;
    const visit = (x: ts.Node) => {
      if (
        ts.isBinaryExpression(x) &&
        (x.operatorToken.kind === ts.SyntaxKind.EqualsToken ||
          x.operatorToken.kind === ts.SyntaxKind.PlusEqualsToken) &&
        ts.isIdentifier(x.left) &&
        x.left.text === id.text
      ) {
        resolve(x.right, cx, hops + 1);
      }
      x.forEachChild(visit);
    };
    visit(scope);
  }
}

function resolveCall(call: ts.CallExpression, cx: Cx, hops: number, select?: string): void {
  const callee = call.expression;
  const name = ts.isIdentifier(callee)
    ? callee.text
    : ts.isPropertyAccessExpression(callee)
      ? callee.name.text
      : null;
  if (name && Object.prototype.hasOwnProperty.call(GERMAN_FORMATTERS, name)) {
    cx.reached.formatters.add(name);
    cx.safe++;
    return;
  }
  if (name === "toISOString" || name === "toJSON" || name === "dateStrInTz") {
    cx.leaves.push({ k: "iso", why: name });
    return;
  }
  if (name === "formatInTimeZone") {
    const format = call.arguments[2];
    if (format && ts.isStringLiteralLike(format) && ISO_FORMAT.test(format.text)) {
      cx.leaves.push({ k: "iso", why: `formatInTimeZone(${format.text})` });
    } else if (format && ts.isStringLiteralLike(format) && /dd/.test(format.text)) {
      cx.leaves.push({ k: "zero", why: `formatInTimeZone(${format.text})` });
    } else cx.safe++;
    return;
  }
  if (name && LOCALE_DAY_CALLS.has(name) && ts.isPropertyAccessExpression(callee)) {
    const options = call.arguments[1];
    const printsDay =
      !options || (ts.isObjectLiteralExpression(options) && /\bday\s*:/.test(options.getText()));
    if (printsDay)
      cx.leaves.push({ k: "zero", why: `${name}(${options ? "{ day }" : "no options"})` });
    else cx.safe++;
    return;
  }
  if ((name === "map" || name === "flatMap") && ts.isPropertyAccessExpression(callee)) {
    const cb = call.arguments[0];
    if (
      cb &&
      ts.isIdentifier(cb) &&
      Object.prototype.hasOwnProperty.call(GERMAN_FORMATTERS, cb.text)
    ) {
      cx.reached.formatters.add(cb.text);
      cx.safe++;
      return;
    }
    if (cb && isFn(cb)) {
      cx.mapParams.set(cb, callee.expression);
      for (const r of returnedExprs(cb)) resolve(r, cx, hops);
      return;
    }
    opaque(cx, name, call);
    return;
  }
  if (ts.isPropertyAccessExpression(callee)) {
    resolve(callee.expression, cx, hops);
    return;
  }
  if (!ts.isIdentifier(callee)) return;
  if (name === "String" || name === "Number") {
    resolve(call.arguments[0], cx, hops);
    return;
  }
  const fn = functionOf(callee, cx);
  if (!fn) {
    opaque(cx, callee.text, call);
    return;
  }
  if (hops >= MAX_HOPS) {
    opaque(cx, "<depth-limit>", call);
    return;
  }
  const key = `fn:${fn.getSourceFile().fileName}:${fn.pos}:${select ?? ""}`;
  if (cx.seen.has(key)) return;
  cx.seen.add(key);
  cx.entered.add(fn.getSourceFile().fileName);
  cx.calls++;
  for (const r of returnedExprs(fn)) resolve(r, cx, hops + 1, select);
  cx.calls--;
}

const DAY_LIKE = [/^(date|day|dates|iso)$/i, /[a-z0-9](Date|Day|Dates|Iso)(Str)?$/];
const dayLike = (name: string) => DAY_LIKE.some((r) => r.test(name));

function siteTexts(
  obj: ts.ObjectLiteralExpression,
): { prop: string; expr: ts.Node; select?: string }[] {
  const out: { prop: string; expr: ts.Node; select?: string }[] = [];
  for (const p of obj.properties) {
    if (ts.isSpreadAssignment(p)) {
      // `{ userId, ...notificationData }`: the spread object carries the texts.
      for (const prop of TEXT_PROPS) out.push({ prop, expr: p.expression, select: prop });
      continue;
    }
    if (ts.isPropertyAssignment(p) && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name))) {
      if (TEXT_PROPS.has(p.name.text)) out.push({ prop: p.name.text, expr: p.initializer });
    } else if (ts.isShorthandPropertyAssignment(p) && TEXT_PROPS.has(p.name.text)) {
      out.push({ prop: p.name.text, expr: p.name });
    }
  }
  return out;
}

function typeOf(obj: ts.ObjectLiteralExpression): string {
  for (const p of obj.properties) {
    if (ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && p.name.text === "type") {
      return p.initializer.getText().replace(/\s+/g, " ").slice(0, 60);
    }
  }
  return "?";
}

function newReached(): Reached {
  return { formatters: new Set(), notDay: new Set(), sinks: new Set() };
}

function scanProject(sources: Record<string, string>): ScanResult {
  const files = new Map<string, ts.SourceFile>();
  for (const [rel, text] of Object.entries(sources)) {
    files.set(rel, ts.createSourceFile(rel, text, ts.ScriptTarget.ES2022, true));
  }
  const reached = newReached();
  const sites: SiteInfo[] = [];
  const findings = new Set<string>();

  const analyse = (obj: ts.ObjectLiteralExpression, site: ts.Node, rel: string) => {
    const line = obj.getSourceFile().getLineAndCharacterOfPosition(site.getStart()).line + 1;
    const info: SiteInfo = { rel, line, steps: 0, files: new Set() };
    sites.push(info);
    const where = `${rel}:${line}`;
    const type = typeOf(obj);
    for (const { prop, expr, select } of siteTexts(obj)) {
      const cx: Cx = {
        files,
        site,
        leaves: [],
        safe: 0,
        calls: 0,
        entered: new Set(),
        seen: new Set(),
        mapParams: new Map(),
        reached,
      };
      resolve(expr, cx, 0, select);
      info.steps += cx.leaves.length + cx.safe;
      for (const f of cx.entered) info.files.add(f);
      const report = (kind: string, what: string) =>
        findings.add(`${where} [${kind}] ${type} ${prop}: ${what}`);
      for (const leaf of cx.leaves) {
        if (leaf.k === "text") {
          const hit = ISO_DAY.exec(leaf.text);
          if (hit) report("A", `literal text names the day ${hit[0]}`);
          const zero = LEADING_ZERO_DAY.exec(leaf.text);
          if (zero) report("F", `literal text names a day with a leading zero ${zero[0].trim()}`);
        } else if (leaf.k === "zero") {
          report("F", `a day printed with a leading zero or in the host zone: ${leaf.why}`);
        } else if (leaf.k === "iso") {
          report("B", `ISO producer ${leaf.why}`);
        } else if (leaf.forwarder) {
          if (Object.prototype.hasOwnProperty.call(SINKS, rel)) reached.sinks.add(rel);
          else report("D", `text is the parameter \`${leaf.name}\` of the enclosing function`);
        } else if (dayLike(leaf.name)) {
          const key = `${leaf.rel}::${leaf.name}`;
          if (Object.prototype.hasOwnProperty.call(NOT_A_CALENDAR_DAY, key))
            reached.notDay.add(key);
          else report("C", `\`${leaf.name}\` reads as a calendar day`);
        }
      }
    }
  };

  for (const [rel, sf] of files) {
    const visit = (n: ts.Node) => {
      if (ts.isCallExpression(n)) {
        const callee = n.expression;
        const arg = n.arguments[0];
        const isNotify =
          (ts.isIdentifier(callee) && callee.text === "notify") ||
          (ts.isPropertyAccessExpression(callee) && callee.name.text === "notify");
        const isCreate =
          ts.isPropertyAccessExpression(callee) &&
          (callee.name.text === "create" || callee.name.text === "createMany") &&
          ts.isPropertyAccessExpression(callee.expression) &&
          callee.expression.name.text === "notification";
        if (isNotify && arg && ts.isObjectLiteralExpression(arg)) analyse(arg, n, rel);
        else if (isCreate && arg && ts.isObjectLiteralExpression(arg)) {
          const data = arg.properties.find(
            (p): p is ts.PropertyAssignment =>
              ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && p.name.text === "data",
          );
          const rows = data?.initializer;
          const objs =
            rows && ts.isObjectLiteralExpression(rows)
              ? [rows]
              : rows &&
                  ts.isArrayLiteralExpression(rows) &&
                  rows.elements.every(ts.isObjectLiteralExpression)
                ? (rows.elements as unknown as ts.ObjectLiteralExpression[])
                : null;
          if (objs) for (const o of objs) analyse(o, n, rel);
          else {
            const line = sf.getLineAndCharacterOfPosition(n.getStart()).line + 1;
            findings.add(`${rel}:${line} [E] notification.create data is not an object literal`);
          }
        }
      }
      n.forEachChild(visit);
    };
    visit(sf);
  }
  return { walked: files.size, sites, findings: [...findings].sort(), reached };
}

/** One synthetic file through the scanner (the controls). */
function scanSource(text: string, label = "synthetic.ts"): ScanResult {
  return scanProject({ [label]: text });
}

// ── the real tree ───────────────────────────────────────────────────────────────────────────

function walk(dir: string, rel = "", out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const next = rel ? `${rel}/${name}` : name;
    if (statSync(join(dir, name)).isDirectory()) {
      if (name === "__tests__" || name === "node_modules") continue;
      walk(join(dir, name), next, out);
    } else if (name.endsWith(".ts") && !name.endsWith(".test.ts") && !name.endsWith(".d.ts")) {
      out.push(next);
    }
  }
  return out;
}

const FILES = walk(SRC).map((rel) => ({ rel, text: readFileSync(join(SRC, rel), "utf8") }));
const SOURCES: Record<string, string> = Object.fromEntries(FILES.map((f) => [f.rel, f.text]));
const REAL = scanProject(SOURCES);

// ── tests ───────────────────────────────────────────────────────────────────────────────────

const HEAD = `export async function f(app, input, row, body, tx, state, e) {\n`;

/** [name, source, expected finding kind] - the eight pre-#1117 shapes plus the reader's other paths. */
const POSITIVE_CONTROLS: [string, string, string][] = [
  [
    "(a) leave range from input days",
    HEAD +
      "await app.notify({ type: 'X', title: 't', message: `Max (${input.startDay} – ${input.endDay})` });\n}",
    "C",
  ],
  [
    "(b) a Zod day in the text",
    HEAD +
      "await app.notify({ type: 'X', title: 't', message: `für den ${body.targetDate}.` });\n}",
    "C",
  ],
  [
    "(c) a local toISOString().slice(0, 10) helper",
    "const day = (d: Date) => d.toISOString().slice(0, 10);\n" +
      HEAD +
      "await app.notify({ type: 'X', title: 't', message: `für den ${day(row.targetDate)} wurde` });\n}",
    "B",
  ],
  [
    "(d) a builder whose rows map over days",
    "function buildMessage(s) {\n" +
      "  const rows = s.employees.map((e) => `${e.name}: ${e.gapDates.join(', ')}`).join('\\n');\n" +
      "  return `Head\\n${rows}`;\n}\n" +
      HEAD +
      "const message = buildMessage(state);\nawait app.notify({ type: 'X', title: 't', message });\n}",
    "C",
  ],
  [
    "(e) dateStrInTz in a variable",
    HEAD +
      "const entryDateStr = dateStrInTz(row.start, 'Europe/Berlin');\n" +
      "await app.notify({ type: 'X', title: 't', message: `Zeitnachtrag für den ${entryDateStr}` });\n}",
    "B",
  ],
  [
    "(f) toISOString().split('T')[0] in a variable",
    HEAD +
      "const targetDateStr = row.targetDate.toISOString().split('T')[0];\n" +
      "await app.notify({ type: 'X', title: 't', message: `für den ${targetDateStr} wurde` });\n}",
    "B",
  ],
  [
    "(g) a literal ISO day",
    HEAD + "await app.notify({ type: 'X', title: 't', message: 'am 2026-12-01 ist frei' });\n}",
    "A",
  ],
  [
    "(h) notification.create with a joined day list",
    HEAD +
      "await tx.notification.create({ data: { title: 't', message: `${row.gapDates.join(', ')}` } });\n}",
    "C",
  ],
  [
    "(i) a forwarder that writes the text it is given",
    "function send(app, text) { return app.notify({ type: 'X', title: 't', message: text }); }",
    "D",
  ],
  [
    "(j) an object binding selected from a conditional builder",
    "function buildA(x) { return { title: 't', message: `(${x.startDay})` }; }\n" +
      "function buildB(x) { return { title: 't', message: 'ok' }; }\n" +
      HEAD +
      "const { title, message } = input.a ? buildA(input) : buildB(input);\n" +
      "await app.notify({ type: 'X', title, message });\n}",
    "C",
  ],
  [
    "(k) a map callback that returns its day parameter",
    HEAD +
      "const days = row.gapDates.map((d) => d);\n" +
      "await app.notify({ type: 'X', title: 't', message: `Tage: ${days.join(', ')}` });\n}",
    "C",
  ],
  [
    "(l) a let that is appended to",
    HEAD +
      "let message = 'Tage:';\nmessage += ` ${row.startDay}`;\n" +
      "await app.notify({ type: 'X', title: 't', message });\n}",
    "C",
  ],
  [
    "(m) an unreadable notification.create data",
    HEAD + "await tx.notification.create({ data: rows });\n}",
    "E",
  ],
  [
    "(o) toLocaleDateString with a 2-digit day",
    HEAD +
      "const startStr = row.startDate.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });\n" +
      "await app.notify({ type: 'X', title: 't', message: `beginnt am ${startStr}` });\n}",
    "F",
  ],
  [
    "(p) toLocaleDateString without options",
    HEAD +
      "await app.notify({ type: 'X', title: 't', message: `ab ${row.weekStart.toLocaleDateString('de-DE')}` });\n}",
    "F",
  ],
  [
    "(q) a dd.MM. pattern",
    HEAD +
      "const label = formatInTimeZone(row.start, 'UTC', 'dd.MM.');\n" +
      "await app.notify({ type: 'X', title: 't', message: `am ${label}` });\n}",
    "F",
  ],
  [
    "(r) a literal day with a leading zero",
    HEAD +
      "await app.notify({ type: 'X', title: 't', message: 'Urlaub vom 01.12.2026 bis 02.12.2026' });\n}",
    "F",
  ],
  [
    "(s) a literal day and month with a leading zero and no year",
    HEAD + "await app.notify({ type: 'X', title: 't', message: 'am 01.12. beginnt' });\n}",
    "F",
  ],
  [
    "(t) a literal day with a leading zero in the month only",
    HEAD + "await app.notify({ type: 'X', title: 't', message: 'am 1.01.2027 endet' });\n}",
    "F",
  ],
  [
    "(n) the title carries the day",
    HEAD + "await app.notify({ type: 'X', title: `Tag ${input.startDay}`, message: 'm' });\n}",
    "C",
  ],
];

const NEGATIVE_CONTROLS: [string, string][] = [
  [
    "the range label",
    "import { dayRangeLabelDe } from '../utils/day-label-de';\n" +
      HEAD +
      "await app.notify({ type: 'X', title: 't', message: `(${dayRangeLabelDe(input.startDay, input.endDay)})` });\n}",
  ],
  [
    "a mapped day label",
    HEAD +
      "await app.notify({ type: 'X', title: 't', message: `${e.gapDates.map((d) => dayLabelDe(d)).join(', ')}` });\n}",
  ],
  [
    "a mapped formatter by name",
    HEAD +
      "await app.notify({ type: 'X', title: 't', message: `${row.gapDates.map(dayLabelDe).join(', ')}` });\n}",
  ],
  [
    "an ISO producer wrapped in a German formatter",
    HEAD +
      "await app.notify({ type: 'X', title: 't', message: `für den ${dayLabelDe(row.startDate.toISOString().slice(0, 10))}` });\n}",
  ],
  [
    "a month label from toLocaleDateString",
    HEAD +
      "const monthLabel = new Date(2026, 11, 1).toLocaleDateString('de-DE', { month: 'long', year: 'numeric' });\n" +
      "await app.notify({ type: 'X', title: 't', message: `Monat ${monthLabel}` });\n}",
  ],
  [
    "a day label without a leading zero and a decimal comma",
    HEAD +
      "await app.notify({ type: 'X', title: 't', message: 'ab 1.12.2026 noch 0,5 Tage, 10.12. und 5.10.2026' });\n}",
  ],
  [
    "split parts rebuilt as D.M.Y",
    HEAD +
      "const [y, m, d] = row.start.toISOString().slice(0, 10).split('-');\n" +
      "await app.notify({ type: 'X', title: 't', message: `am ${d}.${m}.${y}` });\n}",
  ],
  [
    "a day in the link only",
    HEAD +
      "await app.notify({ type: 'X', title: 't', message: 'm', link: `/inbox?day=${row.startDay}` });\n}",
  ],
  [
    "a builder that formats its days",
    "function build(s) { return `Tage: ${s.days.map((d) => dayLabelDe(d)).join(', ')}`; }\n" +
      HEAD +
      "await app.notify({ type: 'X', title: 't', message: build(state) });\n}",
  ],
];

describe("notification text scanner: synthetic controls (Issue #1117)", () => {
  it.each(POSITIVE_CONTROLS)("finds the ISO day of %s", (_name, source, kind) => {
    const scan = scanSource(source);
    expect(scan.sites.length).toBe(kind === "E" ? 0 : 1);
    expect(scan.findings.length).toBeGreaterThan(0);
    expect(scan.findings.some((f) => f.includes(`[${kind}]`))).toBe(true);
  });

  it.each(NEGATIVE_CONTROLS)("reports nothing for %s", (_name, source) => {
    const scan = scanSource(source);
    expect(scan.sites.length).toBe(1);
    expect(scan.findings).toEqual([]);
  });

  it("follows a relative import to the function that builds the text", () => {
    const scan = scanProject({
      "contexts/a/send.ts":
        "import { build as makeText } from './text';\n" +
        "export async function f(app, input) { await app.notify({ type: 'X', title: 't', message: makeText(input) }); }",
      "contexts/a/text.ts": "export function build(x) { return `(${x.startDay})`; }",
    });
    expect(scan.findings.some((f) => f.includes("[C]"))).toBe(true);
    expect(scan.sites[0].files.has("contexts/a/text.ts")).toBe(true);
  });

  it("follows an `export { x } from` hop of an index file", () => {
    const scan = scanProject({
      "contexts/a/send.ts":
        "import { build } from './lib';\n" +
        "export async function f(app, input) { await app.notify({ type: 'X', title: 't', message: build(input) }); }",
      "contexts/a/lib/index.ts": "export { build } from './text';",
      "contexts/a/lib/text.ts": "export function build(x) { return `(${x.endDay})`; }",
    });
    expect(scan.findings.some((f) => f.includes("[C]"))).toBe(true);
  });

  it("accepts a forwarder in a registered sink file and nowhere else", () => {
    const source =
      "export async function send(app, text) { return app.notify({ type: 'X', title: 't', message: text }); }";
    expect(scanSource(source, "contexts/platform/plugins/notify.ts").findings).toEqual([]);
    expect(scanSource(source, "contexts/other/send.ts").findings.length).toBeGreaterThan(0);
  });

  it("registers a day-like name only for the named file", () => {
    const source =
      HEAD +
      "await app.notify({ type: 'X', title: 't', message: `${row.carryOverDeadlineDay}` });\n}";
    const key = Object.keys(NOT_A_CALENDAR_DAY)[0];
    const [file] = key.split("::");
    expect(scanSource(source, file).findings).toEqual([]);
    expect(scanSource(source, "contexts/other/x.ts").findings.length).toBeGreaterThan(0);
  });
});

describe("no notification text names an ISO calendar day (Issue #1117, AC-2)", () => {
  it("walks a non-trivial tree and finds the emit sites (anti-vacuity)", () => {
    expect(FILES.length).toBeGreaterThan(300); // the walked source tree is not empty
    expect(REAL.walked).toBe(FILES.length);
    expect(REAL.sites.length).toBeGreaterThanOrEqual(MIN_EMIT_SITES);
    const blind = REAL.sites.filter((s) => s.steps === 0).map((s) => `${s.rel}:${s.line}`);
    expect(blind, "emit sites whose texts resolved to nothing").toEqual([]);
  });

  it("resolves the break notices through break-finding-notice.ts (relative-import resolution works)", () => {
    const hit = REAL.sites.some((s) =>
      [...s.files].some((f) => f.endsWith("break-finding-notice.ts")),
    );
    expect(hit).toBe(true);
  });

  it("never gave up on the hop limit", () => {
    expect(REAL.findings.filter((f) => f.includes("<depth-limit>"))).toEqual([]);
  });

  it("every notify() / notification.create() title and message names its days the German way", () => {
    expect(
      REAL.findings,
      "A notification text carries an ISO day. Format it with dayLabelDe / dayRangeLabelDe from " +
        "apps/api/src/utils/day-label-de.ts (Issue #1117).",
    ).toEqual([]);
  });
});

describe("the registers are alive (a stale entry fails)", () => {
  it("every registered German formatter is reached by the scan and declared under src", () => {
    for (const name of Object.keys(GERMAN_FORMATTERS)) {
      expect(REAL.reached.formatters.has(name), `${name} is never reached`).toBe(true);
      const declared = new RegExp(`(function\\s+|const\\s+|let\\s+)${name}\\b`);
      expect(
        FILES.some((f) => declared.test(f.text)),
        `${name} is not declared under src`,
      ).toBe(true);
    }
  });

  it("the exported formatters print no ISO day and no leading zero (Issue #1149)", () => {
    const day = new Date("2026-12-01T00:00:00.000Z");
    const samples = [
      dayLabelDe("2026-12-01"),
      dayLabelDe("2026-12-01", { year: false }),
      dayRangeLabelDe("2026-12-01", "2026-12-02"),
      dayRangeLabelDe("2026-12-01", "2026-12-02", { year: false }),
      decisionPeriodDe(day, new Date("2026-12-02T00:00:00.000Z")),
      decisionPeriodDe(day, day),
      monthLabelDe({ year: 2026, month: 12 }),
    ];
    for (const s of samples) {
      expect(s).not.toMatch(ISO_DAY);
      expect(s).not.toMatch(LEADING_ZERO_DAY);
    }
  });

  it("every NOT_A_CALENDAR_DAY and SINKS entry is consulted", () => {
    for (const key of Object.keys(NOT_A_CALENDAR_DAY))
      expect(REAL.reached.notDay.has(key)).toBe(true);
    for (const file of Object.keys(SINKS)) expect(REAL.reached.sinks.has(file)).toBe(true);
    expect(Object.keys(NOT_A_CALENDAR_DAY)).toEqual([
      "contexts/time-tracking/plugins/attendance-checker.ts::carryOverDeadlineDay",
    ]);
    expect(Object.keys(SINKS)).toEqual(["contexts/platform/plugins/notify.ts"]);
    expect(dirname(Object.keys(SINKS)[0])).toBe("contexts/platform/plugins");
  });
});
