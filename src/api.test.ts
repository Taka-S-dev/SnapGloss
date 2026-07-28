import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// state.ts がモジュールスコープで localStorage を読むため、import より先にシムを入れる
vi.hoisted(() => {
  const store = new Map<string, string>();
  (globalThis as Record<string, unknown>).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, v); },
    removeItem: (k: string) => { store.delete(k); },
  };
});

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => "test-key") }));
vi.mock("./settings", () => ({
  loadSettings: () => ({
    endpoint: "https://api.example.com/v1/chat/completions",
    model: "gpt-5.6-sol",
    temperature: 0.7,
    maxTokens: 4000,
  }),
}));
vi.mock("./ui", () => ({
  $: vi.fn(() => ({ style: {}, classList: { add: vi.fn(), remove: vi.fn() } })),
  updateContent: vi.fn(),
  showError: vi.fn(),
  showNotice: vi.fn(),
  setLoading: vi.fn(),
  highlightInContent: vi.fn(),
  clearHighlights: vi.fn(),
  wrapWordsInContent: vi.fn(),
}));
vi.mock("./mermaidRender", () => ({ renderMermaidIn: vi.fn() }));
vi.mock("./history", () => ({ addHistory: vi.fn() }));

import { callApi } from "./api";

// 指定ミリ秒後に SSE チャンク（または done）を返す reader を持つ Response もどき
function sseResponse(reads: Array<{ delayMs: number; data?: string }>) {
  let i = 0;
  return {
    ok: true,
    headers: { get: () => "text/event-stream" },
    body: {
      getReader: () => ({
        read: () => {
          const step = reads[i++];
          return new Promise(resolve => {
            setTimeout(() => {
              resolve(step?.data !== undefined
                ? { done: false, value: new TextEncoder().encode(step.data) }
                : { done: true, value: undefined });
            }, step?.delayMs ?? 0);
          });
        },
        cancel: () => Promise.resolve(),
      }),
    },
  };
}

const chunk = (text: string) =>
  `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n`;

describe("callApi timeouts", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("waits beyond 30s for the first streamed chunk (reasoning latency)", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(sseResponse([
      { delayMs: 60_000, data: chunk("Hello") },
      { delayMs: 10 }, // done
    ]))));
    const result = callApi([{ role: "user", content: "hi" }]);
    result.catch(() => {}); // RED 時の unhandled rejection 警告を抑止
    await vi.advanceTimersByTimeAsync(60_100);
    await expect(result).resolves.toBe("Hello");
  });

  it("still cuts off a stream that stalls 30s after the first chunk", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(sseResponse([
      { delayMs: 10, data: chunk("partial") },
      { delayMs: 120_000, data: chunk("never shown") },
    ]))));
    const result = callApi([{ role: "user", content: "hi" }]);
    const assertion = expect(result).rejects.toThrow("タイムアウト");
    await vi.advanceTimersByTimeAsync(10 + 30_100);
    await assertion;
  });
});
