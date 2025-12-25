import argparse
import statistics
import time
from dataclasses import dataclass
from typing import Callable, Optional

from playwright.sync_api import sync_playwright, Page, TimeoutError as PWTimeoutError


def ms_now() -> float:
  return time.perf_counter() * 1000.0


def percentile(values: list[float], p: float) -> float:
  if not values:
    return float("nan")
  xs = sorted(values)
  if len(xs) == 1:
    return xs[0]
  k = (len(xs) - 1) * p
  f = int(k)
  c = min(f + 1, len(xs) - 1)
  if f == c:
    return xs[f]
  return xs[f] + (xs[c] - xs[f]) * (k - f)


@dataclass
class Metrics:
  page_ready_ms: float
  add_item_ms: float
  popup_visible_ms: float


# ---------- Generic find/click helpers (no data-testid) ----------

def click_plus_button(page: Page, timeout_ms: int) -> None:
  # Prefer "role=button name=+" if possible, else fallback to text selector.
  loc = page.get_by_role("button", name="+")
  if loc.count() > 0:
    loc.first.click(timeout=timeout_ms)
    return

  # Fallback: any clickable with visible "+" text
  loc = page.locator("button:has-text('+'), [role=button]:has-text('+')")
  loc.first.click(timeout=timeout_ms)


def wait_items_count_increase(page: Page, before: int, timeout_ms: int) -> None:
  # Generic list items: count <li> in the document.
  # (Works for your page; for other pages, you'll later generalize by config.)
  page.wait_for_function(
    """(before) => document.querySelectorAll('li').length > before""",
    before,
    timeout=timeout_ms,
  )


def click_first_item(page: Page, timeout_ms: int) -> None:
  # Click the first <li> that is visible and enabled-ish.
  # If no <li>, fallback: click any element matching common "row" patterns.
  li = page.locator("li").filter(has_not=page.locator("script, style"))
  if li.count() > 0:
    li.first.click(timeout=timeout_ms)
    return

  # Fallback: click first element that looks like a list row
  fallback = page.locator("[role=listitem], .row, .item, .list-item").first
  fallback.click(timeout=timeout_ms)


def wait_modal_visible(page: Page, timeout_ms: int) -> None:
  # Most generic: ARIA dialog (good practice and common)
  dialog = page.locator('[role="dialog"][aria-modal="true"]')
  if dialog.count() > 0:
    dialog.first.wait_for(state="visible", timeout=timeout_ms)
    return

  # Fallback: any dialog role
  dialog2 = page.locator('[role="dialog"]')
  if dialog2.count() > 0:
    dialog2.first.wait_for(state="visible", timeout=timeout_ms)
    return

  # Fallback: visible overlay/backdrop patterns (common in SPAs)
  # (This matches your page but also many apps)
  overlay = page.locator(
    ".backdrop[aria-hidden='false'], .modal:visible, .dialog:visible, "
    "[class*='modal']:visible, [class*='dialog']:visible"
  )
  overlay.first.wait_for(state="visible", timeout=timeout_ms)


def close_modal(page: Page, timeout_ms: int) -> None:
  # Prefer Escape (generic)
  page.keyboard.press("Escape")
  # Then wait for dialog/backdrop to go away (best effort)
  try:
    page.locator('[role="dialog"]').first.wait_for(state="hidden", timeout=timeout_ms)
    return
  except Exception:
    pass
  try:
    page.locator(".backdrop").first.wait_for(state="hidden", timeout=timeout_ms)
  except Exception:
    # If unknown, ignore (some apps keep dialog mounted)
    return


# ---------- Page-ready heuristics ----------

def wait_page_ready(page: Page, timeout_ms: int) -> None:
  # If there is a loading overlay with text "Chargement", wait for it to disappear.
  # Generic-ish: look for an overlay-ish element containing "Chargement".
  # If none, just wait for DOMContentLoaded + a tiny settle.
  try:
    loc = page.locator("text=Chargement")
    if loc.count() > 0:
      # wait until no "Chargement" visible
      page.wait_for_function(
        """() => {
          const el = document.querySelector('body');
          // if any visible node contains 'Chargement', not ready
          const tree = document.querySelectorAll('*');
          for (const n of tree) {
            if (!n || !n.textContent) continue;
            if (!n.textContent.includes('Chargement')) continue;
            const r = n.getBoundingClientRect();
            const visible = r.width > 0 && r.height > 0 && getComputedStyle(n).visibility !== 'hidden' && getComputedStyle(n).display !== 'none';
            if (visible) return false;
          }
          return true;
        }""",
        timeout=timeout_ms,
      )
  except PWTimeoutError:
    # fall back below
    pass

  # Basic settle: network idle isn't always meaningful for SPAs; keep it simple.
  page.wait_for_timeout(100)


# ---------- One run ----------

def run_once(page: Page, timeout_ms: int) -> Metrics:
  t0 = ms_now()
  wait_page_ready(page, timeout_ms=timeout_ms)
  t1 = ms_now()

  before = page.locator("li").count()
  t2 = ms_now()
  click_plus_button(page, timeout_ms=timeout_ms)
  wait_items_count_increase(page, before=before, timeout_ms=timeout_ms)
  t3 = ms_now()

  t4 = ms_now()
  click_first_item(page, timeout_ms=timeout_ms)
  wait_modal_visible(page, timeout_ms=timeout_ms)
  t5 = ms_now()

  # close (best effort, not measured here)
  close_modal(page, timeout_ms=timeout_ms)

  return Metrics(
    page_ready_ms=round(t1 - t0, 2),
    add_item_ms=round(t3 - t2, 2),
    popup_visible_ms=round(t5 - t4, 2),
  )


def main() -> None:
  ap = argparse.ArgumentParser()
  ap.add_argument("--url", required=True, help="URL (http(s)://... or file:///.../index.html)")
  ap.add_argument("--runs", type=int, default=10)
  ap.add_argument("--timeout-ms", type=int, default=5000)
  ap.add_argument("--headed", action="store_true", help="Run with visible browser")
  args = ap.parse_args()

  all_metrics: list[Metrics] = []

  with sync_playwright() as p:
    browser = p.chromium.launch(headless=not args.headed)
    page = browser.new_page()

    # Use domcontentloaded to start; then our own ready heuristic.
    page.goto(args.url, wait_until="domcontentloaded", timeout=args.timeout_ms)

    for i in range(args.runs):
      m = run_once(page, timeout_ms=args.timeout_ms)
      all_metrics.append(m)
      print(f"run {i+1}/{args.runs} -> page={m.page_ready_ms}ms add={m.add_item_ms}ms popup={m.popup_visible_ms}ms")

    browser.close()

  page_vals = [m.page_ready_ms for m in all_metrics]
  add_vals = [m.add_item_ms for m in all_metrics]
  pop_vals = [m.popup_visible_ms for m in all_metrics]

  def summarize(name: str, vals: list[float]) -> None:
    print(
      f"{name}: "
      f"n={len(vals)} "
      f"avg={round(statistics.mean(vals),2)}ms "
      f"p50={round(percentile(vals,0.50),2)}ms "
      f"p95={round(percentile(vals,0.95),2)}ms "
      f"min={round(min(vals),2)}ms "
      f"max={round(max(vals),2)}ms"
    )

  print("\n--- summary ---")
  summarize("page_ready", page_vals)
  summarize("add_item", add_vals)
  summarize("popup_visible", pop_vals)


if __name__ == "__main__":
  main()

