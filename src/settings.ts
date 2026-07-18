import { invoke } from "@tauri-apps/api/core";
import { DEFAULT_PROMPTS, type Prompt, type Settings } from "./state";
import { he } from "./renderer";
import { $ } from "./ui";

export function loadSettings(): Settings {
  return {
    endpoint:    localStorage.getItem("snap-gloss:endpoint")    ?? "https://api.openai.com/v1/chat/completions",
    model:       localStorage.getItem("snap-gloss:model")       ?? "gpt-5.6-luna",
    temperature: parseFloat(localStorage.getItem("snap-gloss:temp")   ?? "0.5"),
    maxTokens:   parseInt(localStorage.getItem("snap-gloss:tokens") ?? "2000"),
    hotkey:      localStorage.getItem("snap-gloss:hotkey")      ?? "ctrl+shift+z",
    autoHide:    localStorage.getItem("snap-gloss:autoHide") === "1",
    theme:       (localStorage.getItem("snap-gloss:theme") as Settings["theme"]) ?? "auto",
    prompts: (() => {
      const saved: Prompt[] = JSON.parse(localStorage.getItem("snap-gloss:prompts") ?? "null") ?? DEFAULT_PROMPTS;
      const names = new Set(saved.map(p => p.name));
      DEFAULT_PROMPTS.filter(p => !names.has(p.name)).forEach(p => saved.push(p));
      return saved;
    })(),
  };
}

/** 設定値（auto のときは OS 状態）に応じて data-theme を付け替える */
export function applyTheme() {
  const t = loadSettings().theme;
  const dark = t === "dark" || (t === "auto" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
}

export function saveSettings(s: Settings): void {
  localStorage.setItem("snap-gloss:endpoint", s.endpoint);
  localStorage.setItem("snap-gloss:model",    s.model);
  localStorage.setItem("snap-gloss:temp",     String(s.temperature));
  localStorage.setItem("snap-gloss:tokens",   String(s.maxTokens));
  localStorage.setItem("snap-gloss:hotkey",   s.hotkey);
  localStorage.setItem("snap-gloss:autoHide", s.autoHide ? "1" : "0");
  localStorage.setItem("snap-gloss:theme",    s.theme);
  localStorage.setItem("snap-gloss:prompts",  JSON.stringify(s.prompts));
}

// ── Settings modal ────────────────────────────────────────────────────────────

function makePromptRow(name: string, text: string): HTMLElement {
  const row = document.createElement("div");
  row.className = "p-row";
  row.innerHTML = `
    <div class="p-header">
      <input class="p-name" type="text" value="${he(name)}" placeholder="プロンプト名">
      <button class="p-del">削除</button>
    </div>
    <textarea class="p-text" rows="3">${he(text)}</textarea>`;
  row.querySelector(".p-del")!.addEventListener("click", () => row.remove());
  return row;
}

function renderPrompts(prompts: Prompt[]) {
  const list = $("prompts-list");
  list.innerHTML = "";
  prompts.forEach(p => list.appendChild(makePromptRow(p.name, p.text)));
}

function getPrompts(): Prompt[] {
  return Array.from(document.querySelectorAll<HTMLElement>(".p-row")).map(row => ({
    name: (row.querySelector(".p-name") as HTMLInputElement).value.trim(),
    text: (row.querySelector(".p-text") as HTMLTextAreaElement).value.trim(),
  })).filter(p => p.name && p.text);
}

// モデル候補（フォーカスで全件表示。価格は 1M トークンあたり入力/出力）
const MODEL_SUGGESTIONS: { name: string; desc: string }[] = [
  { name: "gpt-5.6-luna",  desc: "おすすめ。安価で高速、翻訳・要約向け（$1/$6）" },
  { name: "gpt-5.6-terra", desc: "バランス型。精度とコストの中間（$2.50/$15）" },
  { name: "gpt-5.6-sol",   desc: "最高性能。難文の翻訳・SVOC精度重視（$5/$30）" },
  { name: "gpt-5.4-mini",  desc: "さらに安価な軽量モデル（$0.75/$4.50）" },
  { name: "gpt-5.4-nano",  desc: "最安・最速。簡単な翻訳向け（$0.20/$1.25）" },
  { name: "gpt-4o",        desc: "旧世代（2024）。特に理由がなければ 5.6 系を推奨" },
  { name: "gpt-4o-mini",   desc: "旧世代の軽量モデル（2024）" },
];

function initModelMenu() {
  const input = $("s-model") as HTMLInputElement;
  const menu = $("model-menu");
  const hide = () => menu.classList.remove("open");
  const show = () => {
    menu.innerHTML = "";
    for (const m of MODEL_SUGGESTIONS) {
      const opt = document.createElement("div");
      opt.className = "model-opt" + (m.name === input.value.trim() ? " selected" : "");
      const name = document.createElement("div");
      name.className = "m-name";
      name.textContent = m.name;
      const desc = document.createElement("div");
      desc.className = "m-desc";
      desc.textContent = m.desc;
      opt.append(name, desc);
      // blur より先に発火する mousedown で確定する
      opt.addEventListener("mousedown", e => {
        e.preventDefault();
        input.value = m.name;
        hide();
      });
      menu.appendChild(opt);
    }
    // スクロールコンテナにクリップされないよう fixed で入力欄の直下に出す
    const r = input.getBoundingClientRect();
    menu.style.left = r.left + "px";
    menu.style.top = (r.bottom + 2) + "px";
    menu.style.width = r.width + "px";
    menu.style.maxHeight = Math.max(120, Math.min(240, window.innerHeight - r.bottom - 12)) + "px";
    menu.classList.add("open");
  };
  input.addEventListener("focus", show);
  input.addEventListener("blur", hide);
  input.addEventListener("keydown", e => {
    if (e.key === "Escape") { hide(); e.stopPropagation(); }
  });
  // 設定タブのスクロールやウィンドウリサイズで位置がずれるので閉じる
  $("tab-api").addEventListener("scroll", hide);
  window.addEventListener("resize", hide);
}

function codeToStr(code: string): string {
  if (code.startsWith("Key"))   return code.slice(3).toLowerCase();
  if (code.startsWith("Digit")) return code.slice(5);
  if (/^F\d+$/.test(code))      return code.toLowerCase();
  const map: Record<string, string> = {
    Space: "space", Tab: "tab", Enter: "enter", Backspace: "backspace",
    Escape: "escape", Delete: "delete", Home: "home", End: "end",
    PageUp: "pageup", PageDown: "pagedown",
    ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right",
  };
  return map[code] ?? "";
}

function switchTab(tab: string) {
  $("tab-api").style.display     = tab === "api"     ? "" : "none";
  $("tab-prompts").style.display = tab === "prompts" ? "" : "none";
  document.querySelectorAll<HTMLElement>(".s-tab").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.tab === tab);
  });
}

async function doSaveSettings() {
  const endpoint = ($("s-endpoint") as HTMLInputElement).value.trim();
  const apiKey   = ($("s-apikey")   as HTMLInputElement).value.trim();
  const isLocal  = endpoint.includes("localhost") || endpoint.includes("127.0.0.1");
  const msg = $("settings-msg");

  if (!isLocal && !apiKey) {
    msg.textContent = "APIキーを入力してください。"; msg.className = "err"; return;
  }
  const hotkey = ($("s-hotkey") as HTMLInputElement).value.trim() || "ctrl+shift+z";
  const s: Settings = {
    endpoint,
    model:       ($("s-model")  as HTMLInputElement).value.trim() || "gpt-5.6-luna",
    temperature: parseFloat(($("s-temp")   as HTMLInputElement).value) || 0.5,
    maxTokens:   parseInt(($("s-tokens") as HTMLInputElement).value) || 2000,
    hotkey,
    autoHide:    ($("s-autohide") as HTMLInputElement).checked,
    theme:       ($("s-theme") as HTMLSelectElement).value as Settings["theme"],
    prompts:     getPrompts(),
  };

  try {
    await invoke("register_shortcut", { shortcutStr: hotkey });
    await invoke("set_api_key", { key: apiKey });
    const stored = await invoke<string>("get_api_key");
    if (apiKey && !stored) {
      msg.textContent = "APIキーの保存に失敗しました（読み返し空）"; msg.className = "err"; return;
    }
  } catch (e) {
    msg.textContent = String(e); msg.className = "err"; return;
  }

  saveSettings(s);
  applyTheme();
  msg.textContent = "保存しました ✓"; msg.className = "ok";
  setTimeout(closeSettings, 800);
}

export async function openSettings() {
  const s = loadSettings();
  ($("s-apikey")   as HTMLInputElement).value  = await invoke<string>("get_api_key");
  ($("s-endpoint") as HTMLInputElement).value  = s.endpoint;
  ($("s-model")    as HTMLInputElement).value  = s.model;
  ($("s-temp")     as HTMLInputElement).value  = String(s.temperature);
  ($("s-tokens")   as HTMLInputElement).value  = String(s.maxTokens);
  ($("s-hotkey")   as HTMLInputElement).value  = s.hotkey;
  ($("s-autohide") as HTMLInputElement).checked = s.autoHide;
  ($("s-theme") as HTMLSelectElement).value = s.theme;
  renderPrompts(s.prompts);
  $("settings-msg").textContent = "";
  $("settings-msg").className = "";
  switchTab("api");
  $("settings-overlay").classList.add("open");
}

export function closeSettings() {
  $("settings-overlay").classList.remove("open");
}

export function initSettingsModal() {
  initModelMenu();
  const input = $("s-hotkey") as HTMLInputElement;
  input.readOnly = true;
  let recording = false;

  input.addEventListener("click", () => {
    recording = true;
    input.value = "キーを押してください…";
    input.classList.add("recording");
  });
  input.addEventListener("blur", () => {
    if (recording) {
      recording = false;
      input.value = loadSettings().hotkey;
      input.classList.remove("recording");
    }
  });
  input.addEventListener("keydown", e => {
    if (!recording) return;
    e.preventDefault(); e.stopPropagation();
    if (e.key === "Escape") {
      recording = false;
      input.value = loadSettings().hotkey;
      input.classList.remove("recording");
      return;
    }
    if (["Control", "Shift", "Alt", "Meta"].includes(e.key)) return;
    const parts: string[] = [];
    if (e.ctrlKey)  parts.push("ctrl");
    if (e.shiftKey) parts.push("shift");
    if (e.altKey)   parts.push("alt");
    if (e.metaKey)  parts.push("win");
    const key = codeToStr(e.code);
    if (key) parts.push(key);
    if (parts.length > 0) {
      input.value = parts.join("+");
      recording = false;
      input.classList.remove("recording");
    }
  });

  $("settings-overlay").addEventListener("click", e => {
    if (e.target === $("settings-overlay")) closeSettings();
  });
  $("settings-cancel").addEventListener("click", closeSettings);
  $("settings-save").addEventListener("click", doSaveSettings);
  $("prompts-add").addEventListener("click", () => $("prompts-list").appendChild(makePromptRow("", "")));
  document.querySelectorAll<HTMLElement>(".s-tab").forEach(btn => {
    btn.addEventListener("click", () => switchTab(btn.dataset.tab!));
  });
}
