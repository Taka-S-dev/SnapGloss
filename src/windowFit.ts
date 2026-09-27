import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow, LogicalSize } from "@tauri-apps/api/window";

// 設定・履歴・ヘルプのオーバーレイが収まるよう、開いている間だけウィンドウを広げ、
// 閉じたら元のサイズに戻す。一時的な拡大なので main.ts のサイズ保存はこの間スキップする。
// 要 capabilities: core:window:allow-set-size

const MIN_W = 640;
const MIN_H = 640;
// これより小さい値は表示直後の過渡状態（再スケール中など）とみなし、覚えない・戻さない
export const SANE_MIN_W = 320;
export const SANE_MIN_H = 200;
let _sizeBefore: { w: number; h: number } | null = null;

/** 一時的な拡大中か（main.ts がウィンドウサイズを保存しないための目印） */
export function isTemporaryResize(): boolean { return _sizeBefore !== null; }

export async function enlargeForOverlay() {
  if (_sizeBefore) return; // 既に広げている（別のオーバーレイから続けて開いた）
  const w = window.innerWidth, h = window.innerHeight;
  if (w >= MIN_W && h >= MIN_H) return;
  if (w < SANE_MIN_W || h < SANE_MIN_H) return; // 過渡状態。触らない
  _sizeBefore = { w, h };
  await getCurrentWindow().setSize(new LogicalSize(Math.max(w, MIN_W), Math.max(h, MIN_H)))
    .catch(e => console.error("setSize failed:", e));
  // 画面の端に寄せてあると広げた分がモニターの外に出るので、収まる位置へずらす
  await invoke("fit_window_in_monitor").catch(e => console.error("fit_window_in_monitor failed:", e));
}

export async function restoreAfterOverlay() {
  const prev = _sizeBefore;
  if (!prev) return;
  await getCurrentWindow().setSize(new LogicalSize(prev.w, prev.h)).catch(e => console.error("setSize failed:", e));
  // 復元のリサイズイベントが流れきってから目印を外す（保存スキップを効かせる）
  setTimeout(() => { _sizeBefore = null; }, 600);
}
