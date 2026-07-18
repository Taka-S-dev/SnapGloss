import { openUrl } from "@tauri-apps/plugin-opener";
import { $ } from "./ui";
import { state } from "./state";

function menuItem(label: string, onClick: () => void): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.className = "ctx-item";
  btn.textContent = label;
  btn.addEventListener("click", () => { onClick(); hideContextMenu(); });
  return btn;
}

export function showContextMenu(x: number, y: number, query: string) {
  const menu = $("ctx-menu");
  menu.innerHTML = "";
  const short = query.length > 40 ? query.slice(0, 40) + "…" : query;
  menu.appendChild(menuItem(`Web で検索：「${short}」`, () => {
    openUrl(`https://www.google.com/search?q=${encodeURIComponent(query)}`);
  }));
  if (state.conv.lastResult) {
    menu.appendChild(menuItem(`この部分について質問：「${short}」`, () => {
      const input = $("followup-input") as HTMLTextAreaElement;
      input.value = `「${query}」について、`;
      input.dispatchEvent(new Event("input")); // 高さを引用文に合わせて伸ばす
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    }));
  }
  const mx = Math.min(x, window.innerWidth - 210);
  const my = Math.min(y, window.innerHeight - 50);
  menu.style.left = mx + "px";
  menu.style.top  = my + "px";
  menu.classList.add("open");
}

export function hideContextMenu() {
  $("ctx-menu").classList.remove("open");
}

export function initContextMenu() {
  document.addEventListener("mousedown", e => {
    if (!($("ctx-menu")).contains(e.target as Node)) hideContextMenu();
  });
}
