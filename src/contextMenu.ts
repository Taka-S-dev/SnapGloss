import { openUrl } from "@tauri-apps/plugin-opener";
import { $ } from "./ui";

export function showContextMenu(x: number, y: number, query: string) {
  const menu = $("ctx-menu");
  menu.innerHTML = `<button class="ctx-item">Web で検索：「${query}」</button>`;
  menu.querySelector("button")!.addEventListener("click", () => {
    openUrl(`https://www.google.com/search?q=${encodeURIComponent(query)}`);
    hideContextMenu();
  });
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
