// The Jira adapter for the Mailbox's Jira page. Reads ONLY, with the API
// token Maksym pasted once into the town's settings (next to the Telegram
// token; never in a project, never in git). Three calls per look, measured
// 2026-11-05 on empat.atlassian.net: his open tickets with their change
// history (one search, ~2 s), the tickets with comments mentioning him (one
// search), and those tickets' comments (one call each, in parallel). Writes —
// moving a ticket, commenting — stay with the characters and their own Jira
// connection; nothing here ever calls a write endpoint.

import type { JiraRawComment, JiraRawIssue } from "../domain/jira";
import { log } from "../log";

const FIELDS = ["summary", "status", "assignee", "updated", "issuetype", "parent"];

export class JiraClient {
  private readonly auth: string;
  constructor(readonly site: string, email: string, token: string) {
    this.auth = "Basic " + Buffer.from(`${email}:${token}`).toString("base64");
  }

  private async call(method: "GET" | "POST", path: string, body?: unknown, timeoutMs = 30_000): Promise<any> {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const r = await fetch(this.site + path, {
        method, signal: ctl.signal,
        headers: { Authorization: this.auth, Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!r.ok) throw new Error(httpReason(r.status));
      // A move answers "done" with NO body (204). Reading that as JSON threw,
      // and the throw was reported as "Jira could not be reached" — so every
      // move since 2026-11-09 said it failed while Jira had moved the ticket,
      // and the comment after it was never written (measured 2026-11-10:
      // HIGHCAP-367 moved at the very second of the "not moved" toast).
      const raw = await r.text();
      if (!raw.trim()) return null;
      try { return JSON.parse(raw); } catch { throw new Error("Jira answered with something unreadable"); }
    } catch (e: any) {
      if (e?.name === "AbortError") throw new Error("Jira took too long to answer");
      throw new Error(e?.message?.startsWith("Jira") || e?.message?.startsWith("the token") ? e.message : "Jira could not be reached");
    } finally { clearTimeout(t); }
  }

  /** Who the token belongs to. */
  async myself(): Promise<{ accountId: string; displayName: string }> {
    const j = await this.call("GET", "/rest/api/3/myself", undefined, 20_000);
    if (!j?.accountId) throw new Error("Jira did not say who the token belongs to");
    return { accountId: String(j.accountId), displayName: String(j.displayName || "") };
  }

  /** One look at a project's board for Maksym. */
  async board(project: string, me: string): Promise<{ issues: JiraRawIssue[]; comments: Record<string, JiraRawComment[]> }> {
    const mine = await this.call("POST", "/rest/api/3/search/jql", {
      jql: `project = ${project} AND assignee = currentUser() AND statusCategory != Done ORDER BY updated DESC`,
      fields: FIELDS, maxResults: 100, expand: "changelog",
    });
    const tagged = await this.call("POST", "/rest/api/3/search/jql", {
      jql: `project = ${project} AND comment ~ "${me}" AND updated >= -7d ORDER BY updated DESC`,
      fields: FIELDS, maxResults: 30,
    });
    const issues: JiraRawIssue[] = []; const seen = new Set<string>();
    for (const i of [...(mine?.issues || []), ...(tagged?.issues || [])] as JiraRawIssue[]) { if (!seen.has(i.key)) { seen.add(i.key); issues.push(i); } }
    const comments: Record<string, JiraRawComment[]> = {};
    const keys: string[] = (tagged?.issues || []).map((i: JiraRawIssue) => i.key);
    // Comments for the tagged tickets, a few at a time.
    for (let n = 0; n < keys.length; n += 6) {
      await Promise.all(keys.slice(n, n + 6).map(async (k) => {
        try {
          const j = await this.call("GET", `/rest/api/3/issue/${k}/comment?orderBy=-created&maxResults=12`, undefined, 20_000);
          comments[k] = (j?.comments || []) as JiraRawComment[];
        } catch (e: any) { log("jira", "comments not read", { key: k, error: String(e?.message || e) }); comments[k] = []; }
      }));
    }
    return { issues, comments };
  }

  /** The Notebook's catch-up: Maksym's tickets whose status changed inside
   *  the window (local-time JQL dates), with their changelogs — the domain
   *  picks the forward moves. */
  async moved(project: string, fromJql: string, toJql: string): Promise<JiraRawIssue[]> {
    const j = await this.call("POST", "/rest/api/3/search/jql", {
      jql: `project = ${project} AND (assignee = currentUser() OR assignee WAS currentUser()) AND status CHANGED DURING ("${fromJql}", "${toJql}") ORDER BY updated DESC`,
      fields: FIELDS, maxResults: 60, expand: "changelog",
    });
    return (j?.issues || []) as JiraRawIssue[];
  }

  /** The current column of a ticket. */
  async status(key: string): Promise<string | null> {
    const j = await this.call("GET", `/rest/api/3/issue/${key}?fields=status`, undefined, 20_000);
    return j?.fields?.status?.name ? String(j.fields.status.name) : null;
  }

  /** THE one write the town makes with the token: after Maksym's own merge,
   *  the ticket moves by the named transition, with a one-line comment. Any
   *  other move stays with the characters. */
  async move(key: string, transitionName: string, comment: string): Promise<{ ok: boolean; message: string }> {
    const j = await this.call("GET", `/rest/api/3/issue/${key}/transitions`, undefined, 20_000);
    const t = (j?.transitions || []).find((x: any) => String(x?.name || "").toLowerCase() === transitionName.toLowerCase());
    if (!t) return { ok: false, message: `Jira does not offer "${transitionName}" on ${key} right now` };
    await this.call("POST", `/rest/api/3/issue/${key}/transitions`, { transition: { id: String(t.id) } }, 20_000).catch((e: any) => { throw new Error(`the move failed — ${e?.message || e}`); });
    try {
      await this.call("POST", `/rest/api/3/issue/${key}/comment`, { body: { type: "doc", version: 1, content: [{ type: "paragraph", content: [{ type: "text", text: comment }] }] } }, 20_000);
    } catch (e: any) { log("jira", "moved, but the comment failed", { key, error: String(e?.message || e) }); }
    return { ok: true, message: `${key} → ${t.to?.name || transitionName}` };
  }
}

function httpReason(status: number): string {
  if (status === 401) return "the token was not accepted — expired? paste a new one";
  if (status === 403) return "Jira said this token may not read the project";
  if (status === 404) return "Jira says the project does not exist";
  if (status === 429) return "Jira's rate limit — back in a bit";
  return `Jira answered ${status}`;
}
