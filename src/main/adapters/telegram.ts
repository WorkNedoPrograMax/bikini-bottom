// Telegram remote-control bridge — lets Maksym answer questions, approve
// "keep cooking?" pauses, start new jobs (Mr. Krabs), and manage sessions from
// his phone. Long-polls the Telegram Bot API (no server / public URL needed),
// and is LOCKED to a single owner chat id — messages from anyone else are
// ignored. This module is pure transport + routing; the app logic (what each
// tap DOES) lives in main.ts via the callbacks below.

import { log } from "../log";

/** One row of inline buttons. `data` is the callback payload routed to onTap. */
export type TgButton = { text: string; data: string };

export interface TgHandlers {
  /** A button was tapped; `data` is its callback_data (e.g. "keep:bob"). */
  onTap: (data: string) => void | Promise<void>;
  /** A slash command, split into name (no slash) and the rest. */
  onCommand: (cmd: string, args: string) => void | Promise<void>;
  /** Any other free-text message (a typed answer or a job body). */
  onText: (text: string) => void | Promise<void>;
}

const API = "https://api.telegram.org/bot";

export class TelegramBridge {
  private offset = 0;
  private stopped = false;

  constructor(
    private readonly token: string,
    private readonly ownerChatId: number,
    private readonly h: TgHandlers,
  ) {}

  start(): void {
    this.stopped = false;
    log("tg", "bridge starting — long-poll loop");
    void this.loop();
  }

  stop(): void {
    this.stopped = true;
  }

  /** Send a message to the owner, optionally with inline button rows. Returns
   *  the sent message id (for later edits) or null on failure. */
  async send(text: string, buttons?: TgButton[][]): Promise<number | null> {
    const params: Record<string, unknown> = {
      chat_id: this.ownerChatId,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
    };
    if (buttons && buttons.length) {
      params.reply_markup = {
        inline_keyboard: buttons.map((row) => row.map((b) => ({ text: b.text, callback_data: b.data }))),
      };
    }
    const r = await this.api("sendMessage", params);
    return r?.result?.message_id ?? null;
  }

  /** Send a long body as PLAIN text (no HTML, so nothing can break formatting),
   *  auto-split into <=4096-char chunks — used for full character replies. */
  async sendLong(text: string): Promise<void> {
    const MAX = 3900; // safely under Telegram's 4096 hard limit
    const t = text || "";
    if (t.length <= MAX) {
      await this.api("sendMessage", { chat_id: this.ownerChatId, text: t, disable_web_page_preview: true });
      return;
    }
    for (let i = 0; i < t.length; i += MAX) {
      await this.api("sendMessage", { chat_id: this.ownerChatId, text: t.slice(i, i + MAX), disable_web_page_preview: true });
    }
  }

  /** Acknowledge a tapped button (stops the phone's spinner). */
  private async ackCallback(id: string, toast?: string): Promise<void> {
    await this.api("answerCallbackQuery", { callback_query_id: id, text: toast || undefined });
  }

  private async api(method: string, params: Record<string, unknown>): Promise<any> {
    try {
      const res = await fetch(API + this.token + "/" + method, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(params),
      });
      const j = await res.json();
      if (!j.ok) log("tg", `api ${method} not ok`, { desc: j.description });
      return j;
    } catch (e: any) {
      log("tg", `api ${method} failed`, { err: e?.message || String(e) });
      return null;
    }
  }

  private async loop(): Promise<void> {
    while (!this.stopped) {
      try {
        const res = await fetch(`${API}${this.token}/getUpdates?timeout=50&offset=${this.offset}`, {
          // getUpdates long-polls up to 50s; give the socket headroom past that.
          signal: AbortSignal.timeout(60_000),
        });
        const j = await res.json();
        if (!j?.ok) { await this.pause(3000); continue; }
        for (const u of j.result || []) {
          this.offset = u.update_id + 1;
          await this.dispatch(u);
        }
      } catch (e: any) {
        // Timeouts are normal on a quiet poll; back off briefly on real errors.
        if (e?.name !== "TimeoutError" && e?.name !== "AbortError") {
          log("tg", "poll error", { err: e?.message || String(e) });
          await this.pause(3000);
        }
      }
    }
    log("tg", "bridge stopped");
  }

  private async dispatch(u: any): Promise<void> {
    // Button tap.
    if (u.callback_query) {
      const cq = u.callback_query;
      if ((cq.message?.chat?.id ?? cq.from?.id) !== this.ownerChatId) return; // not the owner → ignore
      await this.ackCallback(cq.id);
      await this.h.onTap(String(cq.data || ""));
      return;
    }
    // Message.
    const m = u.message || u.edited_message;
    if (!m) return;
    if (m.chat?.id !== this.ownerChatId) return; // locked to the owner
    const text = (m.text || "").trim();
    if (!text) return;
    if (text.startsWith("/")) {
      const sp = text.indexOf(" ");
      const cmd = (sp === -1 ? text.slice(1) : text.slice(1, sp)).replace(/@\w+$/, "").toLowerCase(); // strip /cmd@bot
      const args = sp === -1 ? "" : text.slice(sp + 1).trim();
      await this.h.onCommand(cmd, args);
    } else {
      await this.h.onText(text);
    }
  }

  private pause(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }
}
