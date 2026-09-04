# Scraper Completion Animation — Design Brief

## Context
The scraper tool (`scraperTool.js` + `scraper.html`) has a working busy-state shimmer
(text-only green gradient sweep via `background-clip: text`). The **completion**
animation — what plays after the fetch finishes and the log shows "Done." — is
broken and needs a clean redesign.

## What exists now (busy shimmer — KEEP THIS)
- Text-only gradient sweep using `background-clip: text`
- Green lit-up style: `rgba(230,255,245,0.55)` → `rgba(44,255,179,0.95)` → `rgba(230,255,245,0.55)`
- Loops at 1.25s, smooth, looks good
- Applied via `.scraper-shimmer` class on the log line element

## What the user wants (completion sequence)

### Phase 1: Fill sweep
The gradient sweeps left-to-right across the text, and as it passes, the text
**stays lit** — it fills up. Not a sweep-then-fade. The text progressively
becomes fully bright green and **stays that way** until the next phase.
Think: a loading bar, but on the text itself. The bright edge moves across,
and behind it the text is fully lit.

### Phase 2: Soft glow pulse
Once the text is fully lit from the fill, it gently pulses — a breathing
glow effect. Soft, not aggressive. The text stays green/bright and
oscillates subtly in intensity. This should feel like the system is
"settling" after work is done.

### Phase 3: Settle
The glow fades out cleanly and the text returns to its normal idle color
(`rgba(230,255,245,0.55)`). This transition should feel intentional, not
jarring — the user's complaint is that the current version "goes back to
static idle instead of looking clean."

## What failed (do NOT repeat)
- Opacity fade-out on the completion sweep (`scraper-done-sweep`) — looked like
  a "weird poor fade to static low contrast grey"
- The fill animation using `background-size` animation from 200% to 100% —
  didn't produce a visible fill effect at all
- Transition from `.scraper-done` directly to `.scraper-idle` — felt abrupt
  and dead

## Technical constraints
- Must use `background-clip: text` + `background-size: 200% 100%` (existing
  pattern, works for busy shimmer)
- Green gradient: `rgba(44,255,179,0.95)` peak, `rgba(230,255,245,0.55)` base
- The `.scraper-log-text` element is a `<span>` inside `#scraperLog`
- CSS classes are toggled by JS `sweepComplete()` in scraperTool.js
- JS flow: `.scraper-shimmer` removed → `.scraper-done` added (fill) →
  `.scraper-glow` added (breathe) → `.scraper-idle` (settle)
- All CSS lives in `tools/scraper.html` inside a `<style>` block
- No external dependencies, no canvas, no DOM restructuring
- The field shimmer overlay (`.scraper-shimmer-field::after`) is separate
  and fine, don't touch it

## Files to edit
- `neuronet/frontend/tools/scraper.html` — CSS keyframes and classes
- `neonet/frontend/src/tools/scraperTool.js` — `sweepComplete()` function
  (line ~574), orchestrates the class transitions

## The JS orchestrator (current broken version for reference)
```js
function sweepComplete() {
  if (!scratchLine) scratch("Done.", false);
  scratchLine.classList.remove("scraper-shimmer");
  scratchLine.classList.add("scraper-done");          // phase 1
  setTimeout(() => {
    scratchLine.classList.remove("scraper-done");
    scratchLine.classList.add("scraper-glow");        // phase 2
    setTimeout(() => {
      scratchLine.classList.remove("scraper-glow");
      scratchLine.classList.add("idle");               // phase 3
    }, 2000);
  }, 2000);
}
```

## Success criteria
- Fill sweep is visually obvious — text clearly lights up progressively left-to-right
- After fill, text stays fully lit (not fading back to dim mid-animation)
- Glow pulse is subtle and smooth, feels alive
- Settle to idle is clean and intentional
- Overall: feels like a polished "task complete" moment, not a broken fade
