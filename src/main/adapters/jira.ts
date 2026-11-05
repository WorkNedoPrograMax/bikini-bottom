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
      return await r.json();
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
}

function httpReason(status: number): string {
  if (status === 401) return "the token was not accepted — expired? paste a new one";
  if (status === 403) return "Jira said this token may not read the project";
  if (status === 404) return "Jira says the project does not exist";
  if (status === 429) return "Jira's rate limit — back in a bit";
  return `Jira answered ${status}`;
}
