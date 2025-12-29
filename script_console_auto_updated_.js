(function () {
  // Single-config key kept for backward compatibility
  const LS_KEY = "__ui_perf_autorun_cfg_v1";

  // Multi-config list storage
  const LS_KEY_LIST = "__ui_perf_autorun_cfg_list_v1";

  if (window.__uiPerfAutoPanel) {
    alert("UI Perf Auto panel already installed");
    return;
  }

  // ------------------ state ------------------
  let running = false;
  let shouldStop = false;
  let resultsWin = null;
  let results = [];

  // config list state
  let cfgList = null;

  // ------------------ helpers ------------------
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  function safeQuery(sel) {
    try { return document.querySelector(sel); } catch { return null; }
  }

  function isTrulyVisible(el) {
    if (!el) return false;
    const s = getComputedStyle(el);
    if (s.display === "none" || s.visibility === "hidden" || s.opacity === "0") return false;

    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;

    const x = Math.min(innerWidth - 1, Math.max(0, r.left + r.width / 2));
    const y = Math.min(innerHeight - 1, Math.max(0, r.top + r.height / 2));
    const top = document.elementFromPoint(x, y);
    return !!top && (top === el || el.contains(top));
  }

  function evalStop(stopSelector, stopMode) {
    const el = stopSelector ? safeQuery(stopSelector) : null;
    if (stopMode === "visible") return isTrulyVisible(el);
    if (stopMode === "present") return !!el;
    if (stopMode === "hidden") return !isTrulyVisible(el);
    if (stopMode === "gone") return !el;
    return false;
  }

  function smartClick(el) {
    try { el.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })); } catch {}
    try { el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })); } catch {}
    try { el.dispatchEvent(new PointerEvent("pointerup", { bubbles: true })); } catch {}
    try { el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true })); } catch {}
    el.click();
  }

  function fmtNow() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function pctl(arr, p) {
    const xs = [...arr].sort((a, b) => a - b);
    if (!xs.length) return NaN;
    const k = (xs.length - 1) * p;
    const f = Math.floor(k);
    const c = Math.min(xs.length - 1, f + 1);
    if (f === c) return xs[f];
    return xs[f] + (xs[c] - xs[f]) * (k - f);
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      try {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.left = "-9999px";
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        const ok = document.execCommand("copy");
        ta.remove();
        return ok;
      } catch {
        return false;
      }
    }
  }

  function genId() {
    return "cfg_" + Math.random().toString(16).slice(2) + "_" + Date.now();
  }

  function loadCfg() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  }
  function saveCfg(cfg) {
    try { localStorage.setItem(LS_KEY, JSON.stringify(cfg)); } catch {}
  }

  function loadCfgList() {
    try {
      const raw = localStorage.getItem(LS_KEY_LIST);
      if (!raw) return { selectedId: null, items: [] };
      const o = JSON.parse(raw);
      if (!o || !Array.isArray(o.items)) return { selectedId: null, items: [] };
      return o;
    } catch {
      return { selectedId: null, items: [] };
    }
  }

  function saveCfgList(list) {
    try { localStorage.setItem(LS_KEY_LIST, JSON.stringify(list)); } catch {}
  }

  function upsertCfgItem(list, item) {
    const idx = list.items.findIndex(x => x.id === item.id);
    if (idx >= 0) list.items[idx] = item;
    else list.items.push(item);
  }

  function getSelectedItem(list) {
    return list.items.find(x => x.id === list.selectedId) || null;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#039;"
    }[c]));
  }

  function runUserScript(src, ctxName) {
    if (!src || !src.trim()) return null;
    try {
      // Run as IIFE, return its return value.
      const fn = new Function(`return (function(){\n${src}\n})();`);
      return fn();
    } catch (e) {
      throw new Error(`${ctxName} script error: ${e && e.message ? e.message : e}`);
    }
  }

  // ------------------ results tab ------------------
  function ensureResultsTab() {
    if (resultsWin && !resultsWin.closed) return;

    resultsWin = window.open("", "_blank");
    if (!resultsWin) {
      throw new Error("Popup blocked. Allow popups to open the results tab.");
    }

    const html = `
<!doctype html>
<html>
<head>
  <meta charset="utf-8"/>
  <title>UI Perf Results</title>
  <style>
    body { font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial; margin: 18px; }
    h1 { font-size: 18px; margin: 0 0 10px; }
    .meta { color: #555; font-size: 12px; margin-bottom: 12px; line-height: 1.4; }
    table { border-collapse: collapse; width: 100%; font-size: 13px; }
    th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
    th { background: #f6f6f6; }
    tr:nth-child(even) { background: #fafafa; }
    .ok { color: #0a7; font-weight: 600; }
    .err { color: #c33; font-weight: 600; }
    .right { text-align: right; }
    .summary { margin-top: 10px; font-size: 12px; color: #444; }
    code { background: #f3f3f3; padding: 1px 4px; border-radius: 4px; }
    .btn { padding: 6px 10px; border: 1px solid #ddd; border-radius: 8px; background:#fff; cursor:pointer; }
    .btnrow { display:flex; gap:8px; margin: 10px 0; flex-wrap: wrap; }
    textarea { width:100%; height:140px; font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 12px; }
  </style>
</head>
<body>
  <h1>UI Perf Results</h1>
  <div class="meta" id="meta"></div>

  <div class="btnrow">
    <button class="btn" id="btnCopyJson">Copy JSON</button>
    <button class="btn" id="btnCopyCsv">Copy CSV</button>
    <button class="btn" id="btnClear">Clear table</button>
  </div>

  <table>
    <thead>
      <tr>
        <th>#</th>
        <th>Date/heure</th>
        <th class="right">Mesure (ms)</th>
        <th>Statut</th>
        <th>Détail</th>
      </tr>
    </thead>
    <tbody id="rows"></tbody>
  </table>

  <div class="summary" id="summary"></div>

  <h2 style="font-size:14px;margin:16px 0 8px;">Raw JSON</h2>
  <textarea id="raw"></textarea>

  <script>
    window.__rowsEl = document.getElementById("rows");
    window.__metaEl = document.getElementById("meta");
    window.__summaryEl = document.getElementById("summary");
    window.__rawEl = document.getElementById("raw");

    function toCsvValue(v) {
      const s = (v === null || v === undefined) ? "" : String(v);
      if (/[,"\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
      return s;
    }

    function jsonToCsv(rows) {
      const headers = ["run","ts","ok","ms","detail"];
      const lines = [];
      lines.push(headers.map(toCsvValue).join(","));
      for (const r of rows) {
        lines.push([
          r.run,
          r.ts,
          r.ok,
          r.ms,
          r.detail
        ].map(toCsvValue).join(","));
      }
      return lines.join("\\n");
    }

    async function copyText(text) {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch (e) {
        try {
          const ta = document.createElement("textarea");
          ta.value = text;
          ta.style.position = "fixed";
          ta.style.left = "-9999px";
          ta.style.top = "0";
          document.body.appendChild(ta);
          ta.focus();
          ta.select();
          const ok = document.execCommand("copy");
          ta.remove();
          return ok;
        } catch {
          return false;
        }
      }
    }

    document.getElementById("btnCopyJson").onclick = async () => {
      const ok = await copyText(window.__rawEl.value || "");
      alert(ok ? "JSON copied" : "Copy failed (clipboard blocked). Manually copy the textarea.");
    };

    document.getElementById("btnCopyCsv").onclick = async () => {
      try {
        const rows = JSON.parse(window.__rawEl.value || "[]");
        const csv = jsonToCsv(Array.isArray(rows) ? rows : []);
        const ok = await copyText(csv);
        alert(ok ? "CSV copied" : "Copy failed (clipboard blocked).");
      } catch (e) {
        alert("Could not generate/copy CSV: " + String(e && e.message ? e.message : e));
      }
    };

    document.getElementById("btnClear").onclick = () => {
      window.__rowsEl.innerHTML = "";
      window.__summaryEl.textContent = "";
      window.__rawEl.value = "";
    };
  </script>
</body>
</html>`;
    resultsWin.document.open();
    resultsWin.document.write(html);
    resultsWin.document.close();
  }

  function ensureResultsApi() {
    ensureResultsTab();
    const d = resultsWin.document;
    return {
      d,
      metaEl: d.getElementById("meta"),
      rowsEl: d.getElementById("rows"),
      summaryEl: d.getElementById("summary"),
      rawEl: d.getElementById("raw"),
    };
  }

  function updateResultsMeta(cfg) {
    const api = ensureResultsApi();
    api.metaEl.innerHTML =
      `runs=${cfg.runs} timeout=${cfg.timeoutMs}ms cooldown=${cfg.cooldownMs}ms postExitWait=${cfg.postExitWaitMs}ms<br/>` +
      `startMode=<code>${escapeHtml(cfg.startMode)}</code> stopMode=<code>${escapeHtml(cfg.stopModeKind)}</code> exitMode=<code>${escapeHtml(cfg.exitModeKind)}</code><br/>` +
      `start=<code>${escapeHtml(cfg.startMode === "script" ? "[script]" : cfg.startClickSelector)}</code> ` +
      `stop=<code>${escapeHtml(cfg.stopModeKind === "script" ? "[script]" : cfg.stopSelector)}</code> ` +
      `${cfg.stopModeKind === "selector" ? "(" + escapeHtml(cfg.stopMode) + ")" : ""} ` +
      `exit=<code>${escapeHtml(cfg.exitModeKind === "script" ? "[script]" : (cfg.exitMode === "key" ? cfg.exitKey : cfg.exitClickSelector))}</code>`;
  }

  function updateResultsSummary() {
    const api = ensureResultsApi();
    const okVals = results.filter(r => r.ok && typeof r.ms === "number").map(r => r.ms);
    const errCount = results.filter(r => !r.ok).length;

    const avg = okVals.length ? Math.round(okVals.reduce((a, b) => a + b, 0) / okVals.length) : "—";
    const p50 = okVals.length ? Math.round(pctl(okVals, 0.50)) : "—";
    const p95 = okVals.length ? Math.round(pctl(okVals, 0.95)) : "—";

    api.summaryEl.textContent = `OK=${okVals.length} ERR=${errCount} | avg=${avg}ms p50=${p50}ms p95=${p95}ms`;
    api.rawEl.value = JSON.stringify(results, null, 2);
  }

  function addResultRow(row) {
    results.push(row);
    const api = ensureResultsApi();
    const tr = api.d.createElement("tr");
    tr.innerHTML = `
      <td>${row.run}</td>
      <td>${escapeHtml(row.ts)}</td>
      <td class="right">${row.ms != null ? row.ms : ""}</td>
      <td class="${row.ok ? "ok" : "err"}">${row.ok ? "OK" : "ERR"}</td>
      <td>${escapeHtml(row.detail || "")}</td>
    `;
    api.rowsEl.appendChild(tr);
    updateResultsSummary();
  }

  // ------------------ runner core ------------------
  function stopSatisfied(cfg) {
    if (cfg.stopModeKind === "script") {
      const out = runUserScript(cfg.stopScript, "STOP");
      return !!out;
    }
    return evalStop(cfg.stopSelector, cfg.stopMode);
  }

  async function waitForStop(cfg) {
    const t0 = performance.now();
    const deadline = t0 + cfg.timeoutMs;

    if (stopSatisfied(cfg)) return 0;

    while (performance.now() < deadline) {
      if (shouldStop) throw new Error("stopped by user");
      if (stopSatisfied(cfg)) return Math.round(performance.now() - t0);
      await new Promise(r => requestAnimationFrame(r));
    }
    throw new Error("timeout waiting STOP condition");
  }

  async function doExit(cfg) {
    if (cfg.exitModeKind === "script") {
      runUserScript(cfg.exitScript, "EXIT");
      await sleep(cfg.postExitWaitMs);
      return;
    }

    if (cfg.exitMode === "key") {
      const key = cfg.exitKey || "Escape";
      document.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
      document.dispatchEvent(new KeyboardEvent("keyup", { key, bubbles: true }));
      await sleep(cfg.postExitWaitMs);
      return;
    }

    const exitEl = safeQuery(cfg.exitClickSelector);
    if (!exitEl) throw new Error("exit element not found: " + cfg.exitClickSelector);
    smartClick(exitEl);
    await sleep(cfg.postExitWaitMs);
  }

  async function doStart(cfg) {
    if (cfg.startMode === "script") {
      const out = runUserScript(cfg.startScript, "START");
      // Script may have performed the action itself; if it returns something, we can click it.
      if (out) {
        if (typeof out === "string") {
          const el = safeQuery(out);
          if (!el) throw new Error("START script returned selector not found: " + out);
          smartClick(el);
          return "start:script→selector";
        }
        if (out && out.nodeType === 1) {
          smartClick(out);
          return "start:script→element";
        }
        throw new Error("START script returned unsupported type: " + (typeof out));
      }
      return "start:script";
    }

    const el = safeQuery(cfg.startClickSelector);
    if (!el) throw new Error("start element not found: " + cfg.startClickSelector);
    smartClick(el);
    return "start:selector";
  }

  async function runOnce(cfg, runIndex) {
    const ts = fmtNow();

    // Best-effort cleanup if stop already satisfied
    if (stopSatisfied(cfg)) {
      try { await doExit(cfg); } catch {}
    }

    const startDetail = await doStart(cfg);

    // measure until stop
    const dt = await waitForStop(cfg);

    addResultRow({ run: runIndex, ts, ms: dt, ok: true, detail: startDetail });

    // exit then cooldown
    await doExit(cfg);
    await sleep(cfg.cooldownMs);
  }

  async function runAll(cfg) {
    if (running) return;
    running = true;
    shouldStop = false;

    results = [];
    ensureResultsTab();
    // clear table content
    try {
      const api = ensureResultsApi();
      api.rowsEl.innerHTML = "";
      api.rawEl.value = "";
      api.summaryEl.textContent = "";
    } catch {}

    updateResultsMeta(cfg);
    updateResultsSummary();

    setStatus("RUNNING…", "#00ffcc");
    setBtnState(true);

    for (let i = 1; i <= cfg.runs; i++) {
      if (shouldStop) break;

      try {
        setStatus(`RUNNING… (${i}/${cfg.runs})`, "#00ffcc");
        await runOnce(cfg, i);
      } catch (e) {
        addResultRow({ run: i, ts: fmtNow(), ms: null, ok: false, detail: String(e && e.message ? e.message : e) });
        // attempt cleanup for next run
        try { await doExit(cfg); } catch {}
        await sleep(cfg.cooldownMs);
      }
    }

    running = false;
    setBtnState(false);
    setStatus(shouldStop ? "STOPPED" : "DONE", shouldStop ? "#ffb86b" : "#7CFF7C");
  }

  // ------------------ UI ------------------
  const panel = document.createElement("div");
  panel.style.cssText = `
    position: fixed;
    right: 16px;
    bottom: 16px;
    z-index: 999999;
    width: 560px;
    background: rgba(0,0,0,0.88);
    color: #e7eefc;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
    font-size: 12px;
    border-radius: 12px;
    box-shadow: 0 6px 24px rgba(0,0,0,.45);
    padding: 10px;
  `;

  panel.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
      <div style="font-weight:700;">UI Perf Auto-run</div>
      <button data-x style="background:transparent;border:1px solid rgba(255,255,255,.2);color:#e7eefc;border-radius:6px;padding:2px 6px;cursor:pointer;">x</button>
    </div>

    <div data-status style="margin-bottom:10px;color:#00ffcc;">idle</div>

    <div style="display:grid;gap:10px;margin-bottom:10px;">

      <div>
        <div style="margin-bottom:4px;color:#9bb0d1;">Config</div>
        <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
          <select data-cfgsel style="flex:1;min-width:160px;padding:6px;border-radius:8px;border:1px solid rgba(255,255,255,.15);background:rgba(255,255,255,.06);color:#e7eefc;"></select>
          <button data-cfgnew style="padding:6px 10px;border-radius:10px;border:1px solid rgba(255,255,255,.15);background:#222;color:#e7eefc;cursor:pointer;">New</button>
          <button data-cfgsave style="padding:6px 10px;border-radius:10px;border:1px solid rgba(255,255,255,.15);background:#1d2a44;color:#e7eefc;cursor:pointer;">Save</button>
          <button data-cfgdel style="padding:6px 10px;border-radius:10px;border:1px solid rgba(255,255,255,.15);background:#3b2a1d;color:#e7eefc;cursor:pointer;">Del</button>
          <button data-cfgexp style="padding:6px 10px;border-radius:10px;border:1px solid rgba(255,255,255,.15);background:#111;color:#e7eefc;cursor:pointer;">Export</button>
          <button data-cfgimp style="padding:6px 10px;border-radius:10px;border:1px solid rgba(255,255,255,.15);background:#111;color:#e7eefc;cursor:pointer;">Import</button>
        </div>
      </div>

      <div>
        <div style="margin-bottom:4px;color:#9bb0d1;">START</div>
        <div style="display:flex;gap:6px;align-items:center;margin-bottom:6px;">
          <select data-startmode style="width:110px;padding:6px;border-radius:8px;border:1px solid rgba(255,255,255,.15);background:rgba(255,255,255,.06);color:#e7eefc;">
            <option value="selector" selected>selector</option>
            <option value="script">script</option>
          </select>
          <input data-start placeholder="ex: #addBtn" style="flex:1;padding:6px;border-radius:8px;border:1px solid rgba(255,255,255,.15);background:rgba(255,255,255,.06);color:#e7eefc;">
        </div>
        <textarea data-startscript style="display:none;width:100%;height:80px;padding:6px;border-radius:8px;border:1px solid rgba(255,255,255,.15);background:rgba(255,255,255,.06);color:#e7eefc;"
          placeholder="Start script. May click itself, or return Element, or return selector string.
Example n+1:
const xs=document.querySelectorAll('li.itemRow');
return xs.length? xs[xs.length-1] : null;"></textarea>
      </div>

      <div>
        <div style="margin-bottom:4px;color:#9bb0d1;">STOP</div>
        <div style="display:flex;gap:6px;align-items:center;margin-bottom:6px;">
          <select data-stopmodekind style="width:110px;padding:6px;border-radius:8px;border:1px solid rgba(255,255,255,.15);background:rgba(255,255,255,.06);color:#e7eefc;">
            <option value="selector" selected>selector</option>
            <option value="script">script</option>
          </select>

          <input data-stop placeholder="ex: .modalHead" style="flex:1;padding:6px;border-radius:8px;border:1px solid rgba(255,255,255,.15);background:rgba(255,255,255,.06);color:#e7eefc;">

          <select data-stopvis style="width:110px;padding:6px;border-radius:8px;border:1px solid rgba(255,255,255,.15);background:rgba(255,255,255,.06);color:#e7eefc;">
            <option value="visible" selected>visible</option>
            <option value="present">present</option>
            <option value="hidden">hidden</option>
            <option value="gone">gone</option>
          </select>
        </div>

        <textarea data-stopscript style="display:none;width:100%;height:100px;padding:6px;border-radius:8px;border:1px solid rgba(255,255,255,.15);background:rgba(255,255,255,.06);color:#e7eefc;"
          placeholder="Stop script: return true when done else false.
Example visible:
const el=document.querySelector('.modalHead');
if(!el) return false;
const r=el.getBoundingClientRect();
return r.width>2 && r.height>2;"></textarea>
      </div>

      <div>
        <div style="margin-bottom:4px;color:#9bb0d1;">EXIT</div>
        <div style="display:flex;gap:6px;align-items:center;margin-bottom:6px;">
          <select data-exitmodekind style="width:110px;padding:6px;border-radius:8px;border:1px solid rgba(255,255,255,.15);background:rgba(255,255,255,.06);color:#e7eefc;">
            <option value="selector" selected>selector</option>
            <option value="script">script</option>
          </select>

          <select data-exitmode style="width:110px;padding:6px;border-radius:8px;border:1px solid rgba(255,255,255,.15);background:rgba(255,255,255,.06);color:#e7eefc;">
            <option value="click" selected>click</option>
            <option value="key">key</option>
          </select>

          <input data-exitclick placeholder="ex: #closeBtn" style="flex:1;padding:6px;border-radius:8px;border:1px solid rgba(255,255,255,.15);background:rgba(255,255,255,.06);color:#e7eefc;">
          <input data-exitkey placeholder="Escape" style="width:90px;padding:6px;border-radius:8px;border:1px solid rgba(255,255,255,.15);background:rgba(255,255,255,.06);color:#e7eefc;display:none;">
        </div>

        <textarea data-exitscript style="display:none;width:100%;height:80px;padding:6px;border-radius:8px;border:1px solid rgba(255,255,255,.15);background:rgba(255,255,255,.06);color:#e7eefc;"
          placeholder="Exit script: close/reset UI for next run.
Example:
document.querySelector('#closeBtn')?.click();"></textarea>
      </div>

      <div style="display:flex;gap:10px;">
        <div style="flex:1;">
          <div style="margin-bottom:4px;color:#9bb0d1;">Runs</div>
          <input data-runs type="number" min="1" step="1" style="width:100%;padding:6px;border-radius:8px;border:1px solid rgba(255,255,255,.15);background:rgba(255,255,255,.06);color:#e7eefc;">
        </div>
        <div style="flex:1;">
          <div style="margin-bottom:4px;color:#9bb0d1;">Timeout (ms)</div>
          <input data-timeout type="number" min="1000" step="500" style="width:100%;padding:6px;border-radius:8px;border:1px solid rgba(255,255,255,.15);background:rgba(255,255,255,.06);color:#e7eefc;">
        </div>
      </div>

      <div style="display:flex;gap:10px;">
        <div style="flex:1;">
          <div style="margin-bottom:4px;color:#9bb0d1;">Cooldown (ms)</div>
          <input data-cooldown type="number" min="0" step="50" style="width:100%;padding:6px;border-radius:8px;border:1px solid rgba(255,255,255,.15);background:rgba(255,255,255,.06);color:#e7eefc;">
        </div>
        <div style="flex:1;">
          <div style="margin-bottom:4px;color:#9bb0d1;">Post-exit wait (ms)</div>
          <input data-postexit type="number" min="0" step="50" style="width:100%;padding:6px;border-radius:8px;border:1px solid rgba(255,255,255,.15);background:rgba(255,255,255,.06);color:#e7eefc;">
        </div>
      </div>

    </div>

    <div style="display:flex;gap:8px;">
      <button data-run style="flex:1;padding:8px;border-radius:10px;border:1px solid rgba(255,255,255,.15);background:#1d4431;color:#e7eefc;cursor:pointer;">Run</button>
      <button data-stopbtn style="flex:1;padding:8px;border-radius:10px;border:1px solid rgba(255,255,255,.15);background:#3b2a1d;color:#e7eefc;cursor:pointer;" disabled>Stop</button>
      <button data-save style="flex:1;padding:8px;border-radius:10px;border:1px solid rgba(255,255,255,.15);background:#1d2a44;color:#e7eefc;cursor:pointer;">Save</button>
      <button data-open style="flex:1;padding:8px;border-radius:10px;border:1px solid rgba(255,255,255,.15);background:#222;color:#e7eefc;cursor:pointer;">Results</button>
    </div>
  `;

  document.body.appendChild(panel);
  window.__uiPerfAutoPanel = panel;

  const statusEl = panel.querySelector("[data-status]");

  // config list widgets
  const cfgSelEl = panel.querySelector("[data-cfgsel]");
  const btnCfgNew = panel.querySelector("[data-cfgnew]");
  const btnCfgSave = panel.querySelector("[data-cfgsave]");
  const btnCfgDel = panel.querySelector("[data-cfgdel]");
  const btnCfgExp = panel.querySelector("[data-cfgexp]");
  const btnCfgImp = panel.querySelector("[data-cfgimp]");

  // fields
  const startModeKindEl = panel.querySelector("[data-startmode]");
  const startEl = panel.querySelector("[data-start]");
  const startScriptEl = panel.querySelector("[data-startscript]");

  const stopModeKindEl = panel.querySelector("[data-stopmodekind]");
  const stopEl = panel.querySelector("[data-stop]");
  const stopVisModeEl = panel.querySelector("[data-stopvis]");
  const stopScriptEl = panel.querySelector("[data-stopscript]");

  const exitModeKindEl = panel.querySelector("[data-exitmodekind]");
  const exitModeEl = panel.querySelector("[data-exitmode]");
  const exitClickEl = panel.querySelector("[data-exitclick]");
  const exitKeyEl = panel.querySelector("[data-exitkey]");
  const exitScriptEl = panel.querySelector("[data-exitscript]");

  const runsEl = panel.querySelector("[data-runs]");
  const timeoutEl = panel.querySelector("[data-timeout]");
  const cooldownEl = panel.querySelector("[data-cooldown]");
  const postExitEl = panel.querySelector("[data-postexit]");

  // bottom buttons
  const btnRun = panel.querySelector("[data-run]");
  const btnStop = panel.querySelector("[data-stopbtn]");
  const btnSave = panel.querySelector("[data-save]");
  const btnOpen = panel.querySelector("[data-open]");

  function setStatus(text, color) {
    statusEl.textContent = text;
    statusEl.style.color = color || "#00ffcc";
  }

  function setBtnState(isRunning) {
    btnStop.disabled = !isRunning;
    btnRun.disabled = isRunning;
  }

  function syncExitModeUI() {
    const mode = exitModeEl.value;
    if (mode === "key") {
      exitKeyEl.style.display = "block";
      exitClickEl.style.display = "none";
    } else {
      exitKeyEl.style.display = "none";
      exitClickEl.style.display = "block";
    }
  }

  function syncModeUI() {
    // START
    const sm = startModeKindEl.value;
    startEl.style.display = (sm === "selector") ? "block" : "none";
    startScriptEl.style.display = (sm === "script") ? "block" : "none";

    // STOP
    const stm = stopModeKindEl.value;
    stopEl.style.display = (stm === "selector") ? "block" : "none";
    stopVisModeEl.style.display = (stm === "selector") ? "block" : "none";
    stopScriptEl.style.display = (stm === "script") ? "block" : "none";

    // EXIT
    const em = exitModeKindEl.value;
    exitModeEl.style.display = (em === "selector") ? "block" : "none";
    if (em === "selector") {
      syncExitModeUI();
      exitScriptEl.style.display = "none";
    } else {
      exitClickEl.style.display = "none";
      exitKeyEl.style.display = "none";
      exitScriptEl.style.display = "block";
    }
  }

  function readCfgFromUI() {
    const exitMode = exitModeEl.value;
    return {
      startMode: startModeKindEl.value, // selector|script
      startClickSelector: startEl.value.trim(),
      startScript: startScriptEl.value || "",

      stopModeKind: stopModeKindEl.value, // selector|script
      stopSelector: stopEl.value.trim(),
      stopMode: stopVisModeEl.value,      // visible/present/hidden/gone
      stopScript: stopScriptEl.value || "",

      exitModeKind: exitModeKindEl.value, // selector|script
      exitMode,
      exitClickSelector: exitClickEl.value.trim(),
      exitKey: exitKeyEl.value.trim() || "Escape",
      exitScript: exitScriptEl.value || "",

      runs: Math.max(1, parseInt(runsEl.value || "10", 10)),
      timeoutMs: Math.max(1000, parseInt(timeoutEl.value || "20000", 10)),
      cooldownMs: Math.max(0, parseInt(cooldownEl.value || "400", 10)),
      postExitWaitMs: Math.max(0, parseInt(postExitEl.value || "200", 10)),
    };
  }

  function applyCfgToUI(cfg) {
    startModeKindEl.value = cfg.startMode || "selector";
    startEl.value = cfg.startClickSelector || "li.itemRow:nth-of-type(6)";
    startScriptEl.value = cfg.startScript || "";

    stopModeKindEl.value = cfg.stopModeKind || "selector";
    stopEl.value = cfg.stopSelector || ".modalHead";
    stopVisModeEl.value = cfg.stopMode || "visible";
    stopScriptEl.value = cfg.stopScript || "";

    exitModeKindEl.value = cfg.exitModeKind || "selector";
    exitModeEl.value = cfg.exitMode || "click";
    exitClickEl.value = cfg.exitClickSelector || "#closeBtn";
    exitKeyEl.value = cfg.exitKey || "Escape";
    exitScriptEl.value = cfg.exitScript || "";

    runsEl.value = String(cfg.runs ?? 10);
    timeoutEl.value = String(cfg.timeoutMs ?? 20000);
    cooldownEl.value = String(cfg.cooldownMs ?? 400);
    postExitEl.value = String(cfg.postExitWaitMs ?? 200);

    syncModeUI();
  }

  function renderCfgSelect() {
    cfgSelEl.innerHTML = "";
    if (!cfgList.items.length) {
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = "(no configs)";
      cfgSelEl.appendChild(opt);
      return;
    }
    for (const it of cfgList.items) {
      const opt = document.createElement("option");
      opt.value = it.id;
      opt.textContent = it.name || it.id;
      if (it.id === cfgList.selectedId) opt.selected = true;
      cfgSelEl.appendChild(opt);
    }
  }

  function loadSelectedCfgIntoUI() {
    const it = getSelectedItem(cfgList);
    if (it && it.cfg) applyCfgToUI(it.cfg);
  }

  function ensureCfgListBoot() {
    cfgList = loadCfgList();

    // Migration from old single-config if list empty
    if (!cfgList.items.length) {
      const legacy = loadCfg();
      const base = legacy || {
        startMode: "selector",
        startClickSelector: "li.itemRow:nth-of-type(6)",
        startScript: "",

        stopModeKind: "selector",
        stopSelector: ".modalHead",
        stopMode: "visible",
        stopScript: "",

        exitModeKind: "selector",
        exitMode: "click",
        exitClickSelector: "#closeBtn",
        exitKey: "Escape",
        exitScript: "",

        runs: 10,
        timeoutMs: 20000,
        cooldownMs: 400,
        postExitWaitMs: 200
      };

      const it = { id: genId(), name: legacy ? "Imported (legacy)" : "Default", cfg: base, updatedAt: nowIso() };
      cfgList.items.push(it);
      cfgList.selectedId = it.id;
      saveCfgList(cfgList);
    }

    // If selectedId invalid, fix it
    if (!getSelectedItem(cfgList) && cfgList.items.length) {
      cfgList.selectedId = cfgList.items[0].id;
      saveCfgList(cfgList);
    }

    renderCfgSelect();
    loadSelectedCfgIntoUI();
  }

  // -------- config list events --------
  cfgSelEl.addEventListener("change", () => {
    cfgList.selectedId = cfgSelEl.value || null;
    saveCfgList(cfgList);
    loadSelectedCfgIntoUI();
    setStatus("Loaded config ✅", "#7aa7ff");
    setTimeout(() => setStatus("idle", "#00ffcc"), 700);
  });

  btnCfgNew.onclick = () => {
    const name = prompt("Config name?", "New config");
    if (!name) return;
    const it = { id: genId(), name, cfg: readCfgFromUI(), updatedAt: nowIso() };
    upsertCfgItem(cfgList, it);
    cfgList.selectedId = it.id;
    saveCfgList(cfgList);
    renderCfgSelect();
    setStatus("Config created ✅", "#7aa7ff");
    setTimeout(() => setStatus("idle", "#00ffcc"), 700);
  };

  btnCfgSave.onclick = () => {
    let it = getSelectedItem(cfgList);
    if (!it) {
      it = { id: genId(), name: "Default", cfg: readCfgFromUI(), updatedAt: nowIso() };
      upsertCfgItem(cfgList, it);
      cfgList.selectedId = it.id;
    } else {
      it.cfg = readCfgFromUI();
      it.updatedAt = nowIso();
      upsertCfgItem(cfgList, it);
    }
    saveCfgList(cfgList);
    renderCfgSelect();
    setStatus("Config saved ✅", "#7aa7ff");
    setTimeout(() => setStatus("idle", "#00ffcc"), 700);
  };

  btnCfgDel.onclick = () => {
    const it = getSelectedItem(cfgList);
    if (!it) return;
    if (!confirm(`Delete config "${it.name || it.id}"?`)) return;
    cfgList.items = cfgList.items.filter(x => x.id !== it.id);
    cfgList.selectedId = cfgList.items.length ? cfgList.items[0].id : null;
    saveCfgList(cfgList);
    renderCfgSelect();
    loadSelectedCfgIntoUI();
    setStatus("Deleted ✅", "#ffb86b");
    setTimeout(() => setStatus("idle", "#00ffcc"), 700);
  };

  btnCfgExp.onclick = async () => {
    const payload = JSON.stringify(cfgList, null, 2);
    const ok = await copyText(payload);
    if (!ok) prompt("Copy config list JSON:", payload);
    setStatus("Config list exported ✅", "#7aa7ff");
    setTimeout(() => setStatus("idle", "#00ffcc"), 900);
  };

  btnCfgImp.onclick = () => {
    const raw = prompt("Paste config list JSON (format: {selectedId, items:[{id,name,cfg}]})");
    if (!raw) return;
    try {
      const obj = JSON.parse(raw);
      if (!obj || !Array.isArray(obj.items)) throw new Error("Invalid format");
      for (const it of obj.items) {
        const item = {
          id: it.id || genId(),
          name: it.name || "Imported",
          cfg: it.cfg || {},
          updatedAt: it.updatedAt || nowIso()
        };
        upsertCfgItem(cfgList, item);
      }
      if (obj.selectedId) cfgList.selectedId = obj.selectedId;
      if (!getSelectedItem(cfgList) && cfgList.items.length) cfgList.selectedId = cfgList.items[0].id;
      saveCfgList(cfgList);
      renderCfgSelect();
      loadSelectedCfgIntoUI();
      setStatus("Imported ✅", "#7aa7ff");
      setTimeout(() => setStatus("idle", "#00ffcc"), 900);
    } catch (e) {
      setStatus("Import error: " + String(e && e.message ? e.message : e), "#ff6b6b");
    }
  };

  // -------- UI events --------
  startModeKindEl.addEventListener("change", syncModeUI);
  stopModeKindEl.addEventListener("change", syncModeUI);
  exitModeKindEl.addEventListener("change", syncModeUI);
  exitModeEl.addEventListener("change", syncModeUI);

  btnRun.onclick = async () => {
    try {
      const cfg = readCfgFromUI();

      // validation
      if (cfg.startMode === "selector" && !cfg.startClickSelector) {
        setStatus("Missing START selector", "#ff6b6b");
        return;
      }
      if (cfg.startMode === "script" && !cfg.startScript.trim()) {
        setStatus("Missing START script", "#ff6b6b");
        return;
      }

      if (cfg.stopModeKind === "selector" && !cfg.stopSelector) {
        setStatus("Missing STOP selector", "#ff6b6b");
        return;
      }
      if (cfg.stopModeKind === "script" && !cfg.stopScript.trim()) {
        setStatus("Missing STOP script", "#ff6b6b");
        return;
      }

      if (cfg.exitModeKind === "selector" && cfg.exitMode === "click" && !cfg.exitClickSelector) {
        setStatus("Missing EXIT selector (or switch EXIT click/key)", "#ff6b6b");
        return;
      }
      if (cfg.exitModeKind === "script" && !cfg.exitScript.trim()) {
        setStatus("Missing EXIT script", "#ff6b6b");
        return;
      }

      ensureResultsTab();
      updateResultsMeta(cfg);

      await runAll(cfg);
    } catch (e) {
      setStatus(String(e && e.message ? e.message : e), "#ff6b6b");
    }
  };

  btnStop.onclick = () => {
    shouldStop = true;
    setStatus("Stopping…", "#ffb86b");
  };

  btnOpen.onclick = () => {
    try {
      ensureResultsTab();
      updateResultsSummary();
    } catch (e) {
      setStatus(String(e && e.message ? e.message : e), "#ff6b6b");
    }
  };

  // Save button saves legacy + current selection
  btnSave.onclick = () => {
    const cfg = readCfgFromUI();
    saveCfg(cfg);         // legacy single save
    btnCfgSave.onclick(); // save into list
  };

  panel.querySelector("[data-x]").onclick = () => {
    shouldStop = true;
    panel.remove();
    window.__uiPerfAutoPanel = null;
  };

  // Boot config list + load selection
  ensureCfgListBoot();
  syncModeUI();

  setStatus("idle", "#00ffcc");
})();
