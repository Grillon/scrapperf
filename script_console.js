(function () {
  const LS_KEY = "__perf_timer_cfg_v2";
  if (window.__perfTimerPanelV2) {
    alert("Perf timer already installed");
    return;
  }

  // ---------- state ----------
  let running = false;
  let startTime = 0;
  let rafId = null;
  let stopObserver = null;
  let stopPoll = null;

  // click listener references
  let clickArmed = false;

  // ---------- helpers ----------
  const now = () => performance.now();

  function loadCfg() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  }
  function saveCfg(cfg) {
    try { localStorage.setItem(LS_KEY, JSON.stringify(cfg)); } catch {}
  }

  function qs(sel) {
    try { return document.querySelector(sel); }
    catch { return null; }
  }

  function isTrulyVisible(el) {
    if (!el) return false;
    const s = getComputedStyle(el);
    if (s.display === "none" || s.visibility === "hidden" || s.opacity === "0") return false;

    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;

    // not covered check (perçu)
    const x = Math.min(innerWidth - 1, Math.max(0, r.left + r.width / 2));
    const y = Math.min(innerHeight - 1, Math.max(0, r.top + r.height / 2));
    const top = document.elementFromPoint(x, y);
    return !!top && (top === el || el.contains(top));
  }

  function cleanup() {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = null;

    if (stopObserver) stopObserver.disconnect();
    stopObserver = null;

    if (stopPoll) clearInterval(stopPoll);
    stopPoll = null;

    running = false;
  }

  function setStatus(text, color) {
    statusEl.textContent = text;
    if (color) statusEl.style.color = color;
  }

  function tick() {
    if (!running) return;
    const dt = Math.round(now() - startTime);
    statusEl.textContent = `⏱ ${dt} ms`;
    rafId = requestAnimationFrame(tick);
  }

  function stopWithResult(labelOk) {
    const total = Math.round(now() - startTime);
    cleanup();
    setStatus(labelOk ? `✅ ${total} ms` : "⏹ stopped", labelOk ? "#7CFF7C" : "#ffb86b");
  }

  function startTimer() {
    if (running) return;
    running = true;
    startTime = now();
    setStatus("⏱ 0 ms", "#00ffcc");
    tick();

    const stopSelector = stopSel.value.trim();
    const stopMode = stopModeSel.value; // visible | present | hidden | gone
    const timeoutMs = parseInt(timeoutInput.value || "20000", 10);

    const deadline = now() + (Number.isFinite(timeoutMs) ? timeoutMs : 20000);

    const checkStop = () => {
      if (!running) return;

      if (now() > deadline) {
        cleanup();
        setStatus("⛔ timeout", "#ff6b6b");
        return;
      }

      const el = stopSelector ? qs(stopSelector) : null;

      const ok =
        stopMode === "visible" ? isTrulyVisible(el) :
        stopMode === "present" ? !!el :
        stopMode === "hidden" ? !isTrulyVisible(el) :
        stopMode === "gone" ? !el :
        false;

      if (ok) stopWithResult(true);
    };

    stopObserver = new MutationObserver(checkStop);
    stopObserver.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["style", "class", "aria-hidden", "hidden"]
    });

    stopPoll = setInterval(checkStop, 50);
    checkStop();
  }

  // ---------- click arming ----------
  function onClickCapture(e) {
    if (!clickArmed) return;

    const startSelector = startSel.value.trim();
    if (!startSelector) return;

    // match by closest() so clicking inside <li> works
    let matched = null;
    try {
      matched = e.target && e.target.closest ? e.target.closest(startSelector) : null;
    } catch {
      matched = null;
    }

    if (!matched) return;

    // consume only once
    clickArmed = false;
    setStatus("starting…", "#7aa7ff");

    // start after current event loop (avoids interference with click handlers)
    setTimeout(() => startTimer(), 0);
  }

  document.addEventListener("click", onClickCapture, true);

  function arm() {
    cleanup();
    clickArmed = true;
    setStatus("ARMED (click start target)", "#00ffcc");
  }

  function stopHard() {
    cleanup();
    clickArmed = false;
    setStatus("⏹ stopped", "#ffb86b");
  }

  // ---------- UI ----------
  const panel = document.createElement("div");
  panel.style.cssText = `
    position: fixed;
    right: 16px;
    bottom: 16px;
    z-index: 999999;
    width: 360px;
    background: rgba(0,0,0,0.88);
    color: #e7eefc;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
    font-size: 12px;
    border-radius: 10px;
    box-shadow: 0 6px 24px rgba(0,0,0,.45);
    padding: 10px;
  `;

  panel.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
      <div style="font-weight:700;">Perf Timer</div>
      <button data-x style="background:transparent;border:1px solid rgba(255,255,255,.2);color:#e7eefc;border-radius:6px;padding:2px 6px;cursor:pointer;">x</button>
    </div>

    <div data-status style="margin-bottom:8px;color:#00ffcc">idle</div>

    <div style="display:grid;gap:10px;margin-bottom:10px;">
      <div>
        <div style="margin-bottom:4px;color:#9bb0d1;">START (click on selector)</div>
        <input data-start-sel placeholder="ex: li.itemRow" style="width:100%;padding:6px;border-radius:6px;border:1px solid rgba(255,255,255,.15);background:rgba(255,255,255,.06);color:#e7eefc;">
        <div style="margin-top:4px;color:#9bb0d1;">Le chrono démarre quand tu cliques un élément qui match ce sélecteur.</div>
      </div>

      <div>
        <div style="margin-bottom:4px;color:#9bb0d1;">STOP (condition)</div>
        <div style="display:flex;gap:6px;">
          <input data-stop-sel placeholder="ex: .modalHead" style="flex:1;padding:6px;border-radius:6px;border:1px solid rgba(255,255,255,.15);background:rgba(255,255,255,.06);color:#e7eefc;">
          <select data-stop-mode style="width:92px;padding:6px;border-radius:6px;border:1px solid rgba(255,255,255,.15);background:rgba(255,255,255,.06);color:#e7eefc;">
            <option value="visible" selected>visible</option>
            <option value="present">present</option>
            <option value="hidden">hidden</option>
            <option value="gone">gone</option>
          </select>
        </div>
      </div>

      <div>
        <div style="margin-bottom:4px;color:#9bb0d1;">Timeout (ms)</div>
        <input data-timeout placeholder="20000" style="width:120px;padding:6px;border-radius:6px;border:1px solid rgba(255,255,255,.15);background:rgba(255,255,255,.06);color:#e7eefc;">
      </div>
    </div>

    <div style="display:flex;gap:6px;">
      <button data-arm style="flex:1;padding:6px;border-radius:6px;border:1px solid rgba(255,255,255,.15);background:#1d2a44;color:#e7eefc;cursor:pointer;">Arm</button>
      <button data-stop style="flex:1;padding:6px;border-radius:6px;border:1px solid rgba(255,255,255,.15);background:#3b2a1d;color:#e7eefc;cursor:pointer;">Stop</button>
      <button data-save style="flex:1;padding:6px;border-radius:6px;border:1px solid rgba(255,255,255,.15);background:#1d4431;color:#e7eefc;cursor:pointer;">Save</button>
    </div>

    <div style="margin-top:8px;color:#9bb0d1;line-height:1.35;">
      Preset pour ta page :<br/>
      START = <b>li.itemRow</b><br/>
      STOP = <b>.modalHead</b> (visible)
    </div>
  `;

  document.body.appendChild(panel);
  window.__perfTimerPanelV2 = panel;

  const statusEl = panel.querySelector("[data-status]");
  const startSel = panel.querySelector("[data-start-sel]");
  const stopSel = panel.querySelector("[data-stop-sel]");
  const stopModeSel = panel.querySelector("[data-stop-mode]");
  const timeoutInput = panel.querySelector("[data-timeout]");

  panel.querySelector("[data-arm]").onclick = arm;
  panel.querySelector("[data-stop]").onclick = stopHard;
  panel.querySelector("[data-save]").onclick = () => {
    saveCfg({
      startSelector: startSel.value.trim(),
      stopSelector: stopSel.value.trim(),
      stopMode: stopModeSel.value,
      timeoutMs: parseInt(timeoutInput.value || "20000", 10) || 20000
    });
    setStatus("Saved ✅", "#7aa7ff");
    setTimeout(() => setStatus("idle", "#00ffcc"), 700);
  };

  panel.querySelector("[data-x]").onclick = () => {
    stopHard();
    panel.remove();
    window.__perfTimerPanelV2 = null;
  };

  // Load config or apply preset
  const cfg = loadCfg();
  if (cfg) {
    startSel.value = cfg.startSelector || "li.itemRow";
    stopSel.value = cfg.stopSelector || ".modalHead";
    stopModeSel.value = cfg.stopMode || "visible";
    timeoutInput.value = String(cfg.timeoutMs || 20000);
    setStatus("Loaded config ✅", "#7aa7ff");
    setTimeout(() => setStatus("idle", "#00ffcc"), 700);
  } else {
    startSel.value = "li.itemRow";
    stopSel.value = ".modalHead";
    stopModeSel.value = "visible";
    timeoutInput.value = "20000";
    setStatus("idle", "#00ffcc");
  }
})();

