// Modular AI service layer. Keys stay server-side (environment variables);
// the browser only calls these server functions.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export type AiTask = "restoration" | "face" | "colorization" | "scratch" | "superres";

const PROVIDERS = {
  replicate: "REPLICATE_API_TOKEN",
  huggingface: "HUGGINGFACE_API_TOKEN",
  custom: "CUSTOM_RESTORE_ENDPOINT",
} as const;

export const getAiStatus = createServerFn({ method: "GET" }).handler(async () => {
  const configured = Object.entries(PROVIDERS)
    .filter(([, env]) => !!process.env[env])
    .map(([p]) => p);
  return { configured, available: configured.length > 0 };
});

export const runAiTask = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ task: z.enum(["restoration", "face", "colorization", "scratch", "superres"]), image: z.string().max(15_000_000) }).parse(d))
  .handler(async ({ data }) => {
    const endpoint = process.env["CUSTOM_RESTORE_ENDPOINT"];
    if (!endpoint) {
      return { ok: false as const, error: "No AI provider is configured. Add an API credential to enable AI processing." };
    }
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env["CUSTOM_RESTORE_KEY"] ?? ""}` },
      body: JSON.stringify(data),
    });
    if (!res.ok) return { ok: false as const, error: `AI service error (${res.status})` };
    const json = (await res.json()) as { image?: string };
    if (!json.image) return { ok: false as const, error: "AI service returned no image" };
    return { ok: true as const, image: json.image };
  });
