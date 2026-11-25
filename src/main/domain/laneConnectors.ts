// Which claude.ai connectors a character's session does NOT load.
//
// Every connector on the account is offered to every session: its tool names,
// and for the signed-in ones a block of instructions, ride along on every model
// call. Measured 2026-11-23 from the town's own log: a lane session connects 78
// servers and carries 306 tools, 278 of them from connectors.
//
// The list is BY NAME, never a wildcard. The wildcard tried on 2026-09-29
// ("mcp__claude_ai_*") also cut Jira in every lane with nothing to show why. A
// name that is not written here stays available — so a connector added to the
// account later is kept until someone decides to cut it.
//
// KEPT, because lanes really called them between 2026-11-09 and 2026-11-23
// (counted from the session records of all seven lanes):
//   claude.ai Atlassian MCP   1,048 calls (Jira, Confluence)
//   claude.ai Slack              61 calls
//   claude.ai Gmail              42 calls
//   claude.ai Google Drive       14 calls (backend town)
//   claude.ai Supabase            3 calls (backend town)
// Also untouched: every plugin server (Figma plugin, Maestro, Playwright,
// Codemagic, the stores, Mazarax, pg) and the town's own `bikini` tools.
//
// DENIED below: every other claude.ai connector the account had on 2026-11-23
// (names exactly as `claude mcp list` prints them) — none was called by any
// lane in those two weeks. To give one back, delete its line.

/** Kept on purpose — here so the check can prove the deny list never names one. */
export const KEPT_CONNECTORS: readonly string[] = [
  "claude.ai Atlassian MCP",
  "claude.ai Slack",
  "claude.ai Gmail",
  "claude.ai Google Drive",
  "claude.ai Supabase",
];

export const DENIED_CONNECTORS: readonly string[] = [
  // The unauthorized twin of the signed-in Figma plugin: while it is offered,
  // the engine hides BOTH and a character has no Figma at all (2026-09-30).
  // Remove once it is authorized or deleted at claude.ai/customize/connectors.
  "claude.ai Figma",
  // Signed in on the account, never called from a lane.
  "claude.ai Claude Data",
  "claude.ai Claude Docs",
  "claude.ai Meetings",
  "claude.ai Google Slides",
  "claude.ai Google Docs",
  "claude.ai Google Sheets",
  "claude.ai Google Calendar",
  "claude.ai Intuit QuickBooks",
  "claude.ai Shopify",
  "claude.ai Context7",
  "claude.ai Wiseflow",
  "claude.ai Spotify",
  "claude.ai tldraw",
  "claude.ai Notion",
  "claude.ai GoDaddy",
  // Not signed in: each still adds its sign-in tools to every session.
  "claude.ai Brex",
  "claude.ai Rho",
  "claude.ai Typefully - Social Media Scheduler",
  "claude.ai Interactive Brokers (IBKR)",
  "claude.ai Base44",
  "claude.ai PostHog",
  "claude.ai Google Cloud BigQuery",
  "claude.ai EULER",
  "claude.ai Docusign",
  "claude.ai Postman",
  "claude.ai Mobbin",
  "claude.ai Zapier",
  "claude.ai SalaryMCP",
  "claude.ai Empat Agents",
  "claude.ai Otterly",
  "claude.ai DataMCP",
  "claude.ai Magnific",
  "claude.ai Moz Local",
  "claude.ai Moz Data",
  "claude.ai Vercel",
  "claude.ai Trello",
  "claude.ai Attention",
  "claude.ai Ahrefs",
  "claude.ai HubSpot Empat Edition",
  "claude.ai Mixpanel",
  "claude.ai PandaDoc",
  "claude.ai Wiseflow Dev",
  "claude.ai Granola",
  "claude.ai tldv",
  "claude.ai ClickUp",
  "claude.ai Apollo.io",
  "claude.ai Semrush",
  "claude.ai Sentry",
  "claude.ai Webflow",
  "claude.ai Miro",
  "claude.ai CB Insights",
  "claude.ai Make",
  "claude.ai Mercury",
  "claude.ai monday.com",
  "claude.ai Linear",
  "claude.ai Intercom",
  "claude.ai HubSpot",
  "claude.ai Canva",
  "claude.ai Box",
];

// PER TOWN (2026-11-25). The same rule — never called in two weeks — applied to
// each town separately and to plugin servers too. Counted from the session
// records of the lanes, main sessions and helpers, 2026-11-09..25:
//   phone-app town (highcap mobile): Atlassian MCP 926, Figma plugin 122, Slack 63,
//     Mazarax 31, Gmail 29, Maestro (flutter) 16, Codemagic 4, Maestro (empat-qa) 2
//     — never: Supabase, Google Drive, Playwright (both), App Store Connect,
//     Google Play, Dart
//   other towns (highcap backend): Atlassian MCP 459, Slack 27, Gmail 18,
//     Google Drive 15, Playwright (empat-qa) 5, Supabase 3, Figma plugin 2
//     — never: either Maestro, Codemagic, App Store Connect, Google Play, Dart,
//     Mazarax, Playwright (browser extension)
// Why it matters: which servers finish connecting before a session's first call
// is random, and each one connected adds its tool names and instructions to
// every call — a mobile session started at 100k with 64 connector tools and at
// 111-113k with 231 (town log "session ready" joined to the first call,
// 2026-11-23..25). Probe 2026-11-25: deniedMcpServers removes a plugin server
// ("plugin:flutter:google-play") and a local one ("playwright-ext") by name.

/** Never reachable from a headless lane (its tools are already disallowed). */
export const DENIED_EVERYWHERE: readonly string[] = ["playwright-ext"];

/** Denied in the phone-app town (a repo with pubspec.yaml). */
export const DENIED_IN_APP_TOWN: readonly string[] = [
  "claude.ai Supabase",
  "claude.ai Google Drive",
  "plugin:empat-qa:playwright",
  "plugin:flutter:app-store-connect",
  "plugin:flutter:google-play",
  "plugin:flutter:dart",
];

/** Denied in every other town: the phone, store and Flutter servers. */
export const DENIED_IN_OTHER_TOWNS: readonly string[] = [
  "plugin:flutter:maestro",
  "plugin:empat-qa:maestro",
  "plugin:flutter:codemagic",
  "plugin:flutter:app-store-connect",
  "plugin:flutter:google-play",
  "plugin:flutter:dart",
  "mazarax",
];

/** Kept per town — here so the check can prove the deny lists never name one. */
export const KEPT_IN_APP_TOWN: readonly string[] = ["claude.ai Atlassian MCP", "claude.ai Slack", "claude.ai Gmail", "plugin:figma:figma", "mazarax", "plugin:flutter:maestro", "plugin:empat-qa:maestro", "plugin:flutter:codemagic"];
export const KEPT_IN_OTHER_TOWNS: readonly string[] = ["claude.ai Atlassian MCP", "claude.ai Slack", "claude.ai Gmail", "claude.ai Google Drive", "claude.ai Supabase", "plugin:empat-qa:playwright", "plugin:figma:figma", "plugin:pg:pg-aiguide"];

export type TownKind = "app" | "other";

/** Every server name a lane of this kind of town does not load. */
export function deniedServers(kind: TownKind): string[] {
  return [...DENIED_CONNECTORS, ...DENIED_EVERYWHERE, ...(kind === "app" ? DENIED_IN_APP_TOWN : DENIED_IN_OTHER_TOWNS)];
}

/** The settings overlay every character session starts with (the engine's
 *  --settings JSON; merges on top of user/project/local settings). */
export function laneSettings(kind: TownKind = "other"): string {
  return JSON.stringify({ deniedMcpServers: deniedServers(kind).map((serverName) => ({ serverName })) });
}
