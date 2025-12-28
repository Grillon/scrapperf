(function () {
  const LS_KEY = "__ui_perf_autorun_cfg_v1";
  if (window.__uiPerfAutoPanel) {
    alert("UI Perf Auto panel already installed");
    return;
  }

  // ------------------ state ------------------
  let running = false;
  let shouldStop = false;
  let resultsWin = null;
  let results = [];

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
    // a bit more robust than el.click() alone
    try { el.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })); } catch {}
    try { el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })); } catch {}
    try { el.dispatchEvent(new PointerEvent("pointerup", { bubbles: true })); } catch {}
    try { el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true })); } catch {}
    el.click();
  }

  function fmtNow() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }

  function pctl(arr, p) {
    const xs = [...arr].sort((a,b)=>a-b);
    if (!xs.length) return NaN;
    const k = (xs.length - 1) * p;
    const f = Math.floor(k);
    const c = Math.min(xs.length - 1, f + 1);
    if (f === c) return xs[f];
    return xs[f] + (xs[c] - xs[f]) * (k - f);
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
    .btnrow { display:flex; gap:8px; margin: 10px 0; }
    textarea { width:100%; height:140px; font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 12px; }
  </style>
</head>
<body>
  <h1>UI Perf Results</h1>
  <div class="meta" id="meta"></div>

  <div class="btnrow">
    <button class="btn" id="btnCopyJson">Copy JSON</button>
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

    window.__setMeta = (html) => { window.__metaEl.innerHTML = html; };
    window.__appendRow = (rowHtml) => {
      const tr = document.createElement("tr");
      tr.innerHTML = rowHtml;
      window.__rowsEl.appendChild(tr);
    };
    window.__setSummary = (text) => { window.__summaryEl.textContent = text; };
    window.__setRaw = (text) => { window.__rawEl.value = text; };

    document.getElementById("btnCopyJson").onclick = async () => {
      try {
        await navigator.clipboard.writeText(window.__rawEl.value);
        alert("JSON copied");
      } catch {
        alert("Clipboard blocked. You can manually copy the textarea.");
      }
    };

    document.getElementById("btnClear").onclick = () => {
      window.__rowsEl.innerHTML = "";
      window.__setSummary("");
      window.__setRaw("");
    };
  </script>
</body>
</html>`;
    resultsWin.document.open();
    resultsWin.document.write(html);
    resultsWin.document.close();
  }

  function updateResultsMeta(cfg) {
    ensureResultsTab();
    resultsWin.__setMeta(`
      runs=${cfg.runs} timeout=${cfg.timeoutMs}ms cooldown=${cfg.cooldownMs}ms postExitWait=${cfg.postExitWaitMs}ms<br/>
      start=<code>${escapeHtml(cfg.startClickSelector)}</code>
      stop=<code>${escapeHtml(cfg.stopSelector)}</code> (${cfg.stopMode})
      exit=<code>${escapeHtml(cfg.exitMode === "key" ? cfg.exitKey : cfg.exitClickSelector)}</code>
    `);
  }

  function updateResultsSummary() {
    ensureResultsTab();
    const okVals = results.filter(r => r.ok && typeof r.ms === "number").map(r => r.ms);
    const errCount = results.filter(r => !r.ok).length;

    const avg = okVals.length ? Math.round(okVals.reduce((a,b)=>a+b,0)/okVals.length) : "—";
    const p50 = okVals.length ? Math.round(pctl(okVals, 0.50)) : "—";
    const p95 = okVals.length ? Math.round(pctl(okVals, 0.95)) : "—";

    resultsWin.__setSummary(`OK=${okVals.length} ERR=${errCount} | avg=${avg}ms p50=${p50}ms p95=${p95}ms`);
    resultsWin.__setRaw(JSON.stringify(results, null, 2));
  }

  function addResultRow(row) {
    results.push(row);
    ensureResultsTab();
    resultsWin.__appendRow(`
      <td>${row.run}</td>
      <td>${escapeHtml(row.ts)}</td>
      <td class="right">${row.ms != null ? row.ms : ""}</td>
      <td class="${row.ok ? "ok" : "err"}">${row.ok ? "OK" : "ERR"}</td>
      <td>${escapeHtml(row.detail || "")}</td>
    `);
    updateResultsSummary();
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"
    }[c]));
  }

  // ------------------ runner core ------------------
  async function waitForStop(cfg) {
    const t0 = performance.now();
    const deadline = t0 + cfg.timeoutMs;

    // if already satisfied, return 0
    if (evalStop(cfg.stopSelector, cfg.stopMode)) return 0;

    while (performance.now() < deadline) {
      if (shouldStop) throw new Error("stopped by user");
      if (evalStop(cfg.stopSelector, cfg.stopMode)) {
        return Math.round(performance.now() - t0);
      }
      await new Promise(r => requestAnimationFrame(r));
    }
    throw new Error("timeout waiting STOP condition");
  }

  async function doExit(cfg) {
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

  async function runOnce(cfg, runIndex) {
    const ts = fmtNow();

    // If popup/result is already visible, try to exit first (best-effort)
    if (evalStop(cfg.stopSelector, cfg.stopMode)) {
      try { await doExit(cfg); } catch {}
    }

    const startEl = safeQuery(cfg.startClickSelector);
    if (!startEl) throw new Error("start element not found: " + cfg.startClickSelector);

    // Click start and measure until stop
    smartClick(startEl);
    const dt = await waitForStop(cfg);

    // record
    addResultRow({ run: runIndex, ts, ms: dt, ok: true, detail: "" });

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
        addResultRow({ run: i, ts: fmtNow(), ms: null, ok: false, detail: String(e) });
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
    width: 420px;
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
        <div style="margin-bottom:4px;color:#9bb0d1;">START click selector</div>
        <input data-start placeholder="ex: li.itemRow:nth-of-type(6)" style="width:100%;padding:6px;border-radius:8px;border:1px solid rgba(255,255,255,.15);background:rgba(255,255,255,.06);color:#e7eefc;">
      </div>

      <div>
        <div style="margin-bottom:4px;color:#9bb0d1;">STOP condition</div>
        <div style="display:flex;gap:6px;">
          <input data-stop placeholder="ex: .modalHead" style="flex:1;padding:6px;border-radius:8px;border:1px solid rgba(255,255,255,.15);background:rgba(255,255,255,.06);color:#e7eefc;">
          <select data-stopmode style="width:110px;padding:6px;border-radius:8px;border:1px solid rgba(255,255,255,.15);background:rgba(255,255,255,.06);color:#e7eefc;">
            <option value="visible" selected>visible</option>
            <option value="present">present</option>
            <option value="hidden">hidden</option>
            <option value="gone">gone</option>
          </select>
        </div>
      </div>

      <div>
        <div style="margin-bottom:4px;color:#9bb0d1;">EXIT action</div>
        <div style="display:flex;gap:6px;align-items:center;">
          <select data-exitmode style="width:110px;padding:6px;border-radius:8px;border:1px solid rgba(255,255,255,.15);background:rgba(255,255,255,.06);color:#e7eefc;">
            <option value="click" selected>click</option>
            <option value="key">key</option>
          </select>
          <input data-exitclick placeholder="ex: #closeBtn" style="flex:1;padding:6px;border-radius:8px;border:1px solid rgba(255,255,255,.15);background:rgba(255,255,255,.06);color:#e7eefc;">
          <input data-exitkey placeholder="Escape" style="width:90px;padding:6px;border-radius:8px;border:1px solid rgba(255,255,255,.15);background:rgba(255,255,255,.06);color:#e7eefc;display:none;">
        </div>
        <div style="margin-top:4px;color:#9bb0d1;">Exit sert à fermer la popup / revenir pour permettre la run suivante.</div>
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

    <div style="margin-top:8px;color:#9bb0d1;line-height:1.35;">
      Preset typique : start=<b>li.itemRow:nth-of-type(6)</b>, stop=<b>.modalHead</b> (visible), exit=<b>#closeBtn</b>
    </div>
  `;

  document.body.appendChild(panel);
  window.__uiPerfAutoPanel = panel;

  const statusEl = panel.querySelector("[data-status]");
  const startEl = panel.querySelector("[data-start]");
  const stopEl = panel.querySelector("[data-stop]");
  const stopModeEl = panel.querySelector("[data-stopmode]");
  const exitModeEl = panel.querySelector("[data-exitmode]");
  const exitClickEl = panel.querySelector("[data-exitclick]");
  const exitKeyEl = panel.querySelector("[data-exitkey]");
  const runsEl = panel.querySelector("[data-runs]");
  const timeoutEl = panel.querySelector("[data-timeout]");
  const cooldownEl = panel.querySelector("[data-cooldown]");
  const postExitEl = panel.querySelector("[data-postexit]");

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

  function readCfgFromUI() {
    const exitMode = exitModeEl.value;
    return {
      startClickSelector: startEl.value.trim(),
      stopSelector: stopEl.value.trim(),
      stopMode: stopModeEl.value,
      exitMode,
      exitClickSelector: exitClickEl.value.trim(),
      exitKey: exitKeyEl.value.trim() || "Escape",
      runs: Math.max(1, parseInt(runsEl.value || "10", 10)),
      timeoutMs: Math.max(1000, parseInt(timeoutEl.value || "20000", 10)),
      cooldownMs: Math.max(0, parseInt(cooldownEl.value || "400", 10)),
      postExitWaitMs: Math.max(0, parseInt(postExitEl.value || "200", 10)),
    };
  }

  function applyCfgToUI(cfg) {
    startEl.value = cfg.startClickSelector || "li.itemRow:nth-of-type(6)";
    stopEl.value = cfg.stopSelector || ".modalHead";
    stopModeEl.value = cfg.stopMode || "visible";
    exitModeEl.value = cfg.exitMode || "click";
    exitClickEl.value = cfg.exitClickSelector || "#closeBtn";
    exitKeyEl.value = cfg.exitKey || "Escape";
    runsEl.value = String(cfg.runs ?? 10);
    timeoutEl.value = String(cfg.timeoutMs ?? 20000);
    cooldownEl.value = String(cfg.cooldownMs ?? 400);
    postExitEl.value = String(cfg.postExitWaitMs ?? 200);
    syncExitModeUI();
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

  exitModeEl.addEventListener("change", syncExitModeUI);

  btnRun.onclick = async () => {
    try {
      const cfg = readCfgFromUI();

      if (!cfg.startClickSelector) {
        setStatus("Missing startClickSelector", "#ff6b6b");
        return;
      }
      if (!cfg.stopSelector) {
        setStatus("Missing stopSelector", "#ff6b6b");
        return;
      }
      if (cfg.exitMode === "click" && !cfg.exitClickSelector) {
        setStatus("Missing exitClickSelector (or switch exit to key)", "#ff6b6b");
        return;
      }

      ensureResultsTab();
      updateResultsMeta(cfg);

      await runAll(cfg);
    } catch (e) {
      setStatus(String(e), "#ff6b6b");
    }
  };

  btnStop.onclick = () => {
    shouldStop = true;
    setStatus("Stopping…", "#ffb86b");
  };

  btnOpen.onclick = () => {
    try {
      ensureResultsTab();
      // keep summary/JSON in sync even if opened late
      updateResultsSummary();
    } catch (e) {
      setStatus(String(e), "#ff6b6b");
    }
  };

  btnSave.onclick = () => {
    const cfg = readCfgFromUI();
    saveCfg(cfg);
    setStatus("Saved ✅", "#7aa7ff");
    setTimeout(() => setStatus("idle", "#00ffcc"), 700);
  };

  panel.querySelector("[data-x]").onclick = () => {
    shouldStop = true;
    panel.remove();
    window.__uiPerfAutoPanel = null;
  };

  // Load config or preset
  const saved = loadCfg();
  if (saved) {
    applyCfgToUI(saved);
    setStatus("Loaded config ✅", "#7aa7ff");
    setTimeout(() => setStatus("idle", "#00ffcc"), 700);
  } else {
    applyCfgToUI({
      startClickSelector: "li.itemRow:nth-of-type(6)",
      stopSelector: ".modalHead",
      stopMode: "visible",
      exitMode: "click",
      exitClickSelector: "#closeBtn",
      exitKey: "Escape",
      runs: 10,
      timeoutMs: 20000,
      cooldownMs: 400,
      postExitWaitMs: 200
    });
    setStatus("idle", "#00ffcc");
  }

})();

