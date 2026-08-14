// The Claude auth adapter (AD-8). Confirms the app can reach Claude using
// Maksym's EXISTING subscription login — no API key, no metered billing.
// The definitive check is a real tiny query (proven to auto-pick-up the
// subscription OAuth from a prior `claude login`).

import { query } from "@anthropic-ai/claude-agent-sdk";

export interface ClaudeCheck {
  connected: boolean;
  message: string;
}

/** Belt-and-suspenders (AD-8): a stray key silently switches to metered
 *  billing, so we clear it from our process before spawning the SDK/CLI. */
export function clearStrayApiKey(): void {
  if (process.env.ANTHROPIC_API_KEY) delete process.env.ANTHROPIC_API_KEY;
}

export async function checkClaude(): Promise<ClaudeCheck> {
  clearStrayApiKey();

  const attempt = (async (): Promise<ClaudeCheck> => {
    try {
      for await (const msg of query({
        prompt: "Reply with exactly one word: pong",
        options: { maxTurns: 1 },
      })) {
        if (msg.type === "result") {
          if (msg.subtype === "success") {
            return {
              connected: true,
              message: "Connected using the Claude you already have — no key, no extra cost.",
            };
          }
          return {
            connected: false,
            message: "Claude answered oddly. You can open the town and try again in a moment.",
          };
        }
      }
      return { connected: false, message: "Claude didn't answer. You can open the town and check again later." };
    } catch (e) {
      return {
        connected: false,
        message:
          "I couldn't reach Claude with your login yet. Open the town anyway — you can sort this out later without losing anything.",
      };
    }
  })();

  const timeout = new Promise<ClaudeCheck>((resolve) =>
    setTimeout(
      () => resolve({ connected: false, message: "Claude is taking a while. Open the town and check again later." }),
      30000
    )
  );

  return Promise.race([attempt, timeout]);
}
