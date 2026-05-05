import { type Prompt } from "./state";
import { loadSettings } from "./settings";
import { $, setLoading } from "./ui";
import { processText } from "./api";

let _filteredPrompts: Prompt[] = [];
let _activeIdx = 0;

function renderFilteredList(query: string) {
  const s = loadSettings();
  const q = query.toLowerCase();
  _filteredPrompts = q
    ? s.prompts.filter(p => p.name.toLowerCase().includes(q))
    : [...s.prompts];
  _activeIdx = Math.min(_activeIdx, Math.max(_filteredPrompts.length - 1, 0));

  const list = $("mo-list");
  list.innerHTML = "";
  _filteredPrompts.forEach((p, i) => {
    const btn = document.createElement("button");
    btn.textContent = p.name;
    btn.classList.toggle("active", i === _activeIdx);
    btn.onclick = () => selectMode(p.name, p.text);
    btn.addEventListener("mouseenter", () => { _activeIdx = i; updateActiveBtn(); });
    list.appendChild(btn);
  });
}

function updateActiveBtn() {
  const btns = document.querySelectorAll<HTMLElement>("#mo-list button");
  btns.forEach((b, i) => b.classList.toggle("active", i === _activeIdx));
  btns[_activeIdx]?.scrollIntoView({ block: "nearest" });
}

function selectMode(modeName: string, prompt: string) {
  const text = ($("mo-text") as HTMLTextAreaElement).value.trim();
  if (!text) return;
  localStorage.setItem("snap-gloss:lastMode", modeName);
  closeModeOverlay();
  setLoading(true, modeName);
  processText(text, modeName, prompt);
}

export function closeModeOverlay() {
  $("mode-overlay").classList.remove("open");
}

export function showModeOverlay(text: string) {
  const ta = $("mo-text") as HTMLTextAreaElement;
  ta.value = text;
  ta.scrollTop = 0;
  ($("mo-search") as HTMLInputElement).value = "";
  _activeIdx = 0;
  const lastMode = localStorage.getItem("snap-gloss:lastMode");
  if (lastMode) {
    const idx = loadSettings().prompts.findIndex(p => p.name === lastMode);
    if (idx >= 0) _activeIdx = idx;
  }
  renderFilteredList("");
  $("mode-overlay").classList.add("open");

  const blankMatch = text.match(/---+/);
  if (blankMatch && blankMatch.index !== undefined) {
    ta.focus();
    ta.setSelectionRange(blankMatch.index, blankMatch.index + blankMatch[0].length);
    const onPaste = () => {
      ta.removeEventListener("paste", onPaste);
      requestAnimationFrame(() => ($("mo-search") as HTMLInputElement).focus());
    };
    ta.addEventListener("paste", onPaste);
  } else {
    ($("mo-search") as HTMLInputElement).focus();
  }
}

export function initModeOverlay() {
  $("mode-overlay").addEventListener("click", e => {
    if (e.target === $("mode-overlay")) closeModeOverlay();
  });
  ($("mo-search") as HTMLInputElement).addEventListener("input", e => {
    _activeIdx = 0;
    renderFilteredList((e.target as HTMLInputElement).value);
  });
  ($("mo-search") as HTMLInputElement).addEventListener("keydown", e => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      _activeIdx = Math.min(_activeIdx + 1, _filteredPrompts.length - 1);
      updateActiveBtn();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      _activeIdx = Math.max(_activeIdx - 1, 0);
      updateActiveBtn();
    } else if (e.key === "Enter") {
      e.preventDefault();
      const p = _filteredPrompts[_activeIdx];
      if (p) selectMode(p.name, p.text);
    }
  });
}
