// Checks the one write the town makes in Jira (adapters/jira.ts move()).
// 2026-11-10: Jira answers a successful move with an EMPTY body (204); the
// adapter read it as JSON, threw, and told Maksym "the move failed — Jira could
// not be reached" while the ticket had moved — and skipped the comment.
// Run after `npm run build`:  node scripts/check-jira-move.mjs
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { JiraClient } = require("../dist/main/adapters/jira.js");

let fails = 0;
const ok = (cond, msg) => { if (!cond) { fails++; console.log("  ✗", msg); } else console.log("  ✓", msg); };
const res = (status, body) => ({ ok: status >= 200 && status < 300, status, text: async () => body, json: async () => JSON.parse(body) });
const calls = [];
const serve = (handler) => { calls.length = 0; globalThis.fetch = async (url, init) => { calls.push(`${init.method} ${String(url).replace("https://x.test", "")}`); return handler(String(url), init); }; };
const jira = new JiraClient("https://x.test", "a@b.c", "tok");
const offered = JSON.stringify({ transitions: [{ id: "31", name: "Review approved", to: { name: "Review Completed" } }] });

console.log("a move Jira accepts (empty 204 answer, as the real one):");
{
  serve((url, init) => init.method === "GET" ? res(200, offered) : url.endsWith("/transitions") ? res(204, "") : res(201, "{\"id\":\"1\"}"));
  let r, err; try { r = await jira.move("HIGHCAP-367", "Review approved", "why"); } catch (e) { err = e; }
  ok(!err, `no error is raised${err ? ` (got: ${err.message})` : ""}`);
  ok(r?.ok === true && r.message === "HIGHCAP-367 → Review Completed", "it reports the ticket moved");
  ok(calls.some((c) => c === "POST /rest/api/3/issue/HIGHCAP-367/comment"), "the comment is written after the move");
}
console.log("real failures still say what they are:");
{
  serve((url, init) => init.method === "GET" ? res(200, offered) : res(400, "{}"));
  let err; try { await jira.move("HIGHCAP-1", "Review approved", "why"); } catch (e) { err = e; }
  ok(err && err.message.startsWith("the move failed — ") && !err.message.includes("could not be reached"), `Jira refusing the move is not called unreachable (${err?.message})`);
  ok(!calls.some((c) => c.endsWith("/comment")), "no comment on a ticket that did not move");
  serve(() => { throw new TypeError("fetch failed"); });
  err = null; try { await jira.move("HIGHCAP-1", "Review approved", "why"); } catch (e) { err = e; }
  ok(err?.message === "Jira could not be reached", "no network → could not be reached");
  serve(() => res(200, JSON.stringify({ transitions: [] })));
  const r = await jira.move("HIGHCAP-1", "Review approved", "why");
  ok(r.ok === false && r.message.includes("does not offer"), "a move Jira does not offer is said so");
}
console.log(fails ? `\n${fails} check(s) failed` : "\nall Jira-move checks passed");
process.exit(fails ? 1 : 0);
