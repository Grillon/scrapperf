(function () {
  if (window.__uiPerfAgent) {
    console.log("[ui-perf-agent] already loaded");
    return;
  }
  window.__uiPerfAgent = true;

  console.log("[ui-perf-agent] loading…");

  let shouldStop = false;
  let replyTarget = null; // 🔑 controller window (event.source)

  // ---------------- helpers ----------------
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

  function evalStop(selector, mode) {
    const el = selector ? safeQuery(selector) : null;
    if (mode === "visible") return isTrulyVisible(el);
    if (mode === "present") return !!el;
    if (mode === "hidden") return !isTrulyVisible(el);
    if (mode === "gone") return !el;
    return false;
  }

  function smartClick(el) {
    try { el.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })); } catch {}
    try { el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })); } catch {}
    try { el.dispatchEvent(new PointerEvent("pointerup", { bubbles: true })); } catch {}
    try { el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true })); } catch {}
    el.click();
  }

  function send(msg) {
    if (!replyTarget) {
      console.warn("[ui-perf-agent] no replyTarget, cannot send", msg);
      return;
    }
    replyTarget.postMessage(msg, "*");
  }

  // ---------------- core logic ----------------
  async function waitForStop(selector, mode, timeoutMs) {
    const t0 = performance.now();
    const deadline = t0 + timeoutMs;

    if (evalStop(selector, mode)) return 0;

    while (performance.now() < deadline) {
      if (shouldStop) throw new Error("stopped");
      if (evalStop(selector, mode)) {
        return Math.round(performance.now() - t0);
      }
      await new Promise(r => requestAnimationFrame(r));
    }
    throw new Error("timeout waiting STOP condition");
  }

  async function doAction(action) {
    if (!action) return;

    if (action.type === "key") {
      const key = action.key || "Escape";
      document.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
      document.dispatchEvent(new KeyboardEvent("keyup", { key, bubbles: true }));
      return;
    }

    const el = safeQuery(action.selector);
    if (!el) throw new Error("element not found: " + action.selector);
    smartClick(el);
  }

  async function runHook(hookCode) {
    if (!hookCode || !hookCode.trim()) return null;

    try {
      // Hook must RETURN an Element (or null)
      // eslint-disable-next-line no-new-func
      const fn = new Function(hookCode);
      const res = fn();
      if (res && typeof res.then === "function") return await res;
      return res;
    } catch (e) {
      throw new Error("hook error: " + String(e));
    }
  }

  async function runScenario(cfg) {
    shouldStop = false;

    for (let i = 1; i <= cfg.runs; i++) {
      const ts = new Date().toISOString();

      try {
        // ---- START ----
        if (cfg.hook && cfg.hook.trim()) {
          const el = await runHook(cfg.hook);
          if (!el) throw new Error("hook returned null");
          smartClick(el);
        } else {
          await doAction(cfg.start);
        }

        // ---- MEASURE ----
        const ms = await waitForStop(
          cfg.stop.selector,
          cfg.stop.mode,
          cfg.timeoutMs
        );

        send({
          type: "PERF_RUN_RESULT",
          payload: { run: i, ts, ok: true, ms, detail: "" }
        });

        // ---- EXIT (reset state) ----
        await doAction(cfg.exit);
        await sleep(cfg.cooldownMs);

      } catch (e) {
        send({
          type: "PERF_RUN_RESULT",
          payload: { run: i, ts, ok: false, ms: null, detail: String(e) }
        });

        await sleep(cfg.cooldownMs);
        if (shouldStop) break;
      }
    }

    send({ type: shouldStop ? "PERF_STOPPED" : "PERF_DONE" });
  }

  // ---------------- messaging ----------------
  window.addEventListener("message", (event) => {
    const msg = event.data;
    if (!msg || typeof msg !== "object") return;

    // 🔑 remember who to reply to
    if (msg.type === "PERF_RUN" || msg.type === "PERF_STOP") {
      replyTarget = event.source;
    }

    if (msg.type === "PERF_RUN") {
      console.log("[ui-perf-agent] PERF_RUN received");
      runScenario(msg.payload);
      return;
    }

    if (msg.type === "PERF_STOP") {
      console.log("[ui-perf-agent] PERF_STOP received");
      shouldStop = true;
      return;
    }
  });

  // announce readiness
  window.addEventListener("load", () => {
    // nothing
  });

  // Say hello if possible (best-effort)
  setTimeout(() => {
    if (window.opener) {
      window.opener.postMessage({ type: "AGENT_HELLO" }, "*");
    }
  }, 300);

  console.log("[ui-perf-agent] ready");
})();

