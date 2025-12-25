import argparse
import json
import math
import statistics
import time
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Any, Dict, List, Optional

from playwright.sync_api import sync_playwright, Page


def ms_now() -> float:
  return time.perf_counter() * 1000.0


def percentile(values: List[float], p: float) -> float:
  if not values:
    return float("nan")
  xs = sorted(values)
  if len(xs) == 1:
    return xs[0]
  k = (len(xs) - 1) * p
  f = int(math.floor(k))
  c = min(f + 1, len(xs) - 1)
  if f == c:
    return xs[f]
  return xs[f] + (xs[c] - xs[f]) * (k - f)


def summarize(values: List[float]) -> Dict[str, float]:
  if not values:
    return {"n": 0}
  return {
    "n": len(values),
    "avg_ms": round(statistics.mean(values), 2),
    "p50_ms": round(percentile(values, 0.50), 2),
    "p95_ms": round(percentile(values, 0.95), 2),
    "min_ms": round(min(values), 2),
    "max_ms": round(max(values), 2),
  }


@dataclass
class OneMeasurementResult:
  name: str
  ok: bool
  duration_ms: float
  error: Optional[str] = None
  details: Optional[Dict[str, Any]] = None  # e.g. wait_any winner


@dataclass
class OneRunResult:
  run_index: int
  measurements: List[OneMeasurementResult]


def _locator(page: Page, selector: str):
  return page.locator(selector).first


def do_trigger(page: Page, trig: Dict[str, Any], base_url: str, timeout_ms: int) -> None:
  t = trig.get("type")
  if t == "goto":
    wait_until = trig.get("wait_until", "domcontentloaded")
    page.goto(base_url, wait_until=wait_until, timeout=timeout_ms)
    return

  if t == "click":
    sel = trig["selector"]
    _locator(page, sel).click(timeout=timeout_ms)
    return

  if t == "fill":
    sel = trig["selector"]
    text = trig.get("text", "")
    _locator(page, sel).fill(text, timeout=timeout_ms)
    return

  if t == "press":
    key = trig["key"]
    page.keyboard.press(key)
    return

  if t == "sleep":
    ms = int(trig.get("ms", 0))
    page.wait_for_timeout(ms)
    return

  raise ValueError(f"Unsupported trigger type: {t}")


def _do_wait_stable(page: Page, stable_ms: int, poll_ms: int, timeout_ms: int) -> None:
  page.wait_for_function(
    """
    async ({stableMs, pollMs}) => {
      let lastChange = performance.now();

      function snap() {
        const docEl = document.documentElement;
        const nodes = document.getElementsByTagName('*').length;
        const h = docEl.scrollHeight;
        const w = docEl.scrollWidth;
        const rs = document.readyState;
        return { nodes, h, w, rs };
      }

      let prev = snap();

      while (true) {
        await new Promise(r => setTimeout(r, pollMs));
        const cur = snap();
        const changed =
          cur.nodes !== prev.nodes ||
          cur.h !== prev.h ||
          cur.w !== prev.w ||
          cur.rs !== prev.rs;

        if (changed) {
          lastChange = performance.now();
          prev = cur;
        }

        if (performance.now() - lastChange >= stableMs) {
          return true;
        }
      }
    }
    """,
    arg={"stableMs": stable_ms, "pollMs": poll_ms},
    timeout=timeout_ms,
  )


def do_target(page: Page, tgt: Dict[str, Any], timeout_ms: int) -> Optional[Dict[str, Any]]:
  """
  Executes the target wait. Returns optional details (used by wait_any).
  """
  t = tgt.get("type")

  if t in ("wait_visible", "wait_hidden", "wait_attached", "wait_detached"):
    sel = tgt["selector"]
    state_map = {
      "wait_visible": "visible",
      "wait_hidden": "hidden",
      "wait_attached": "attached",
      "wait_detached": "detached",
    }
    _locator(page, sel).wait_for(state=state_map[t], timeout=timeout_ms)
    return None

  if t == "sleep":
    ms = int(tgt.get("ms", 0))
    page.wait_for_timeout(ms)
    return None

  if t == "wait_stable":
    stable_ms = int(tgt.get("stable_ms", 600))
    poll_ms = int(tgt.get("poll_ms", 100))
    _do_wait_stable(page, stable_ms=stable_ms, poll_ms=poll_ms, timeout_ms=timeout_ms)
    return None

  if t == "wait_any":
    """
    Wait for the first condition that succeeds among a list of targets.

    JSON:
    {
      "type": "wait_any",
      "timeout_ms": 15000,          // optional override
      "targets": [ {target1}, {target2}, ... ]
    }

    It will try repeatedly with short per-target time slices until total timeout.
    """
    targets = tgt.get("targets")
    if not isinstance(targets, list) or not targets:
      raise ValueError("wait_any requires a non-empty 'targets' list")

    total_timeout_ms = int(tgt.get("timeout_ms", timeout_ms))
    slice_ms = int(tgt.get("slice_ms", 400))  # time budget per target attempt
    poll_gap_ms = int(tgt.get("poll_gap_ms", 50))

    deadline = ms_now() + total_timeout_ms
    last_errs: List[str] = []

    while ms_now() < deadline:
      for idx, sub in enumerate(targets):
        remaining = int(max(0, deadline - ms_now()))
        if remaining <= 0:
          break

        per_try = min(slice_ms, remaining)
        try:
          # Try this sub-target with a smaller timeout
          do_target(page, sub, timeout_ms=per_try)
          return {
            "wait_any_winner_index": idx,
            "wait_any_winner": sub,
          }
        except Exception as e:
          last_errs.append(f"[{idx}] {type(e).__name__}: {e}")

      page.wait_for_timeout(poll_gap_ms)

    # If we reach here: none succeeded in total_timeout_ms
    tail = last_errs[-6:]  # keep last few for debugging
    raise TimeoutError("wait_any timed out. Recent errors: " + " | ".join(tail))

  raise ValueError(f"Unsupported target type: {t}")


def run_once(page: Page, cfg: Dict[str, Any]) -> List[OneMeasurementResult]:
  url = cfg["url"]
  timeout_ms = int(cfg.get("timeout_ms", 10000))
  measurements = cfg.get("measurements", [])

  out: List[OneMeasurementResult] = []

  for m in measurements:
    name = m.get("name", "unnamed")
    trig = m.get("trigger", {})
    tgt = m.get("target", {})

    t0 = ms_now()
    try:
      do_trigger(page, trig, base_url=url, timeout_ms=timeout_ms)
      details = do_target(page, tgt, timeout_ms=timeout_ms)
      t1 = ms_now()
      out.append(OneMeasurementResult(
        name=name,
        ok=True,
        duration_ms=round(t1 - t0, 2),
        details=details
      ))
    except Exception as e:
      t1 = ms_now()
      out.append(OneMeasurementResult(
        name=name,
        ok=False,
        duration_ms=round(t1 - t0, 2),
        error=str(e)
      ))

  return out


def main() -> None:
  ap = argparse.ArgumentParser()
  ap.add_argument("--config", required=True, help="Path to scenario json")
  ap.add_argument("--out", default="results.json", help="Output json file")
  args = ap.parse_args()

  cfg = json.loads(Path(args.config).read_text(encoding="utf-8"))

  runs = int(cfg.get("runs", 10))
  timeout_ms = int(cfg.get("timeout_ms", 10000))
  headed = bool(cfg.get("headed", False))

  all_runs: List[OneRunResult] = []

  with sync_playwright() as p:
    browser = p.chromium.launch(headless=not headed)
    page = browser.new_page()
    page.set_default_timeout(timeout_ms)

    for i in range(runs):
      results = run_once(page, cfg)
      all_runs.append(OneRunResult(run_index=i + 1, measurements=results))

      parts = []
      for r in results:
        if r.ok:
          extra = ""
          if r.details and "wait_any_winner_index" in r.details:
            extra = f" (any→{r.details['wait_any_winner_index']})"
          parts.append(f"{r.name}={r.duration_ms}ms{extra}")
        else:
          parts.append(f"{r.name}=ERR({r.error})")
      print(f"run {i+1}/{runs} :: " + " | ".join(parts))

    browser.close()

  by_name: Dict[str, List[float]] = {}
  errors: Dict[str, int] = {}

  for run in all_runs:
    for m in run.measurements:
      if m.ok:
        by_name.setdefault(m.name, []).append(m.duration_ms)
      else:
        errors[m.name] = errors.get(m.name, 0) + 1

  summary = {
    "scenario": cfg.get("name"),
    "url": cfg.get("url"),
    "runs": runs,
    "timeout_ms": timeout_ms,
    "headed": headed,
    "stats": {name: summarize(vals) for name, vals in by_name.items()},
    "errors": errors,
    "raw": [asdict(r) for r in all_runs],
  }

  Path(args.out).write_text(json.dumps(summary, indent=2, ensure_ascii=False), encoding="utf-8")
  print(f"\nWrote results to: {args.out}")


if __name__ == "__main__":
  main()

