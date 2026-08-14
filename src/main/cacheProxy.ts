// Local caching proxy — works around a known Agent SDK bug where SUB-AGENTS run
// with prompt caching hardcoded off (github.com/anthropics/claude-code/issues/29966),
// so every helper re-sends the full system prompt + tools + repo setup as UNCACHED,
// full-price tokens on every step. That made Bikini cost many times a terminal.
//
// The fix (same approach the bug-reporter uses): route every character's Claude
// traffic through this tiny local proxy. When a Messages request arrives WITHOUT
// any cache_control breakpoint (the sub-agent case), we add one so the big stable
// prefix (system + tools) gets cached like it does in the terminal. Requests that
// already have cache_control (the main session) pass through untouched.

import http from "node:http";
import https from "node:https";
import { log } from "./log";

/** Insert cache_control on the big stable prefix if the body has none. */
function injectCacheControl(bodyStr: string): string {
  if (bodyStr.includes('"cache_control"')) return bodyStr; // already cached (main path) — leave it
  let body: any;
  try { body = JSON.parse(bodyStr); } catch { return bodyStr; }
  if (!body || typeof body !== "object" || !body.model) return bodyStr;
  const mark = { type: "ephemeral" };
  let added = 0;
  // Cache the system prompt (+ tools, which render before it) — the ~tens-of-kб
  // stable prefix that was being re-billed every sub-agent step.
  if (typeof body.system === "string" && body.system.length) {
    body.system = [{ type: "text", text: body.system, cache_control: mark }]; added++;
  } else if (Array.isArray(body.system) && body.system.length) {
    const last = body.system[body.system.length - 1];
    if (last && typeof last === "object") { last.cache_control = mark; added++; }
  }
  // Cache the conversation prefix too (last message's last block).
  if (Array.isArray(body.messages) && body.messages.length) {
    const m = body.messages[body.messages.length - 1];
    if (m) {
      if (typeof m.content === "string" && m.content.length) {
        m.content = [{ type: "text", text: m.content, cache_control: mark }]; added++;
      } else if (Array.isArray(m.content) && m.content.length) {
        const lb = m.content[m.content.length - 1];
        if (lb && typeof lb === "object") { lb.cache_control = mark; added++; }
      }
    }
  }
  return added ? JSON.stringify(body) : bodyStr;
}

/** Start the proxy and return its base URL (http://127.0.0.1:PORT). Forwards to
 *  the real Anthropic endpoint (or an existing ANTHROPIC_BASE_URL if set). */
export function startCacheProxy(): Promise<string> {
  // Where to actually send traffic — honor a pre-existing base URL, else default.
  const upstreamRaw = process.env.ANTHROPIC_BASE_URL && !process.env.ANTHROPIC_BASE_URL.includes("127.0.0.1")
    ? process.env.ANTHROPIC_BASE_URL
    : "https://api.anthropic.com";
  const upstream = new URL(upstreamRaw);
  const useHttps = upstream.protocol === "https:";
  const agent = useHttps ? https : http;
  const upPort = upstream.port ? Number(upstream.port) : (useHttps ? 443 : 80);

  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c) => chunks.push(c as Buffer));
      req.on("end", () => {
        let body = Buffer.concat(chunks);
        const url = req.url || "";
        const isMessages = req.method === "POST" && url.startsWith("/v1/messages") && !url.includes("count_tokens");
        if (isMessages && body.length) {
          try {
            const before = body.toString("utf8");
            const after = injectCacheControl(before);
            if (after !== before) { body = Buffer.from(after, "utf8"); log("proxy", "added cache markers to a sub-agent request"); }
          } catch { /* forward original untouched */ }
        }
        const headers: Record<string, any> = { ...req.headers };
        headers.host = upstream.host;
        if (body.length) headers["content-length"] = String(body.length); else delete headers["content-length"];
        const up = agent.request({ host: upstream.hostname, port: upPort, method: req.method, path: url, headers }, (upRes) => {
          res.writeHead(upRes.statusCode || 502, upRes.headers);
          upRes.pipe(res);
        });
        up.on("error", (e) => { log("proxy", "upstream error", { error: String(e) }); if (!res.headersSent) res.writeHead(502); res.end(); });
        if (body.length) up.write(body);
        up.end();
      });
    });
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      const proxyUrl = `http://127.0.0.1:${port}`;
      log("proxy", "cache proxy listening", { proxyUrl, upstream: upstream.origin });
      resolve(proxyUrl);
    });
  });
}
