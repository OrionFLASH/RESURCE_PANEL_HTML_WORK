// Загрузка links.js / panel.js в vm-контекст без document.
import vm from "node:vm";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function makeCtx() {
  const ctx = {};
  ctx.window = ctx;
  return vm.createContext(ctx);
}

export function loadLinks(text) {
  const src = text ?? fs.readFileSync(path.join(root, "links.js"), "utf8");
  const ctx = makeCtx();
  vm.runInContext(src, ctx, { filename: "links.js" });
  return JSON.parse(JSON.stringify(ctx.RP_LINKS)); // клон: убирает объекты чужого realm
}

export function loadCore() {
  const ctx = makeCtx();
  vm.runInContext(fs.readFileSync(path.join(root, "panel.js"), "utf8"), ctx, { filename: "panel.js" });
  return ctx.RP.core;
}
