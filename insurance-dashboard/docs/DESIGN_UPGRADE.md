# fox · design upgrade (lane D, 23.10.26)

## Diagnosis

The last two days fixed what the ws4 review found broken — one type scale, one radius set, one toolbar, provenance on every figure, 40 px targets, a real dark theme — and in doing so stripped the site of everything that made it feel like *fox* rather than a well-behaved admin panel. Compared with the pre-cleanup build (commits before `cc781d84`) the live site has: hairline white panels on a cool grey ground with no depth; nine 1.6 px wire icons (the only glyphs on the site) and the mark at 36 px; dashed empty boxes and a bare "טוען…" for loading; page titles as plain text; a single navy bar as the whole brand. Both themes read as "correct, flat, anonymous". The owner is right that the 3-D icon set carried warmth and material — navy, ember, peach as *objects* — and nothing replaced that.

What it must not become again: isometric clip-art in the rail (two icon languages by theme, 150 px masthead scene, first number at y ≈ 560), aurora/glass/glow/spotlight, hover lift, blur page-ins, 20 radii. Those hurt reading and performance, and PRODUCT.md lists them as anti-references.

## Principles

1. **Depth from material, not effects.** Surfaces get an elevation scale (`--e-1` hairline + a breath of shadow at rest; `--e-2` for sheets and menus); the dark theme gets a 1 px inset highlight so panels read as raised plates on warm ink. No lift, no glow, no blur.
2. **Icons as objects.** One duotone language in both themes: a soft fill under a 1.6 px stroke, filled in the ember where a place is active. Dimensional without raster, 2 KB total, theme-independent.
3. **Warm paper, navy ink, one ember.** The light ground moves from cool grey to warm paper (`#F5F3EE`, lines `#D8D4CA`); figures stay navy. The ember-to-magenta gradient lives in the mark and in exactly one chrome moment: a 2 px hairline under the top bar.
4. **A house tick.** Every panel title and section band starts with a 3 px ember rule — the deck's heading mark — so the page has rhythm at a glance.
5. **Motion = arrival and state.** Page fade-in (160 ms, opacity only), the mark flaps only while data is loading, pressed controls transition 120 ms. `prefers-reduced-motion` stills everything.

## Changes, ranked by impact / effort

| # | Change | Where | Impact | Effort |
|---|---|---|---|---|
| 1 | Duotone icon system (26 glyphs: nav, sections, states), `tone="ember"`, `.icotile` lead tiles | `components/Icon.tsx`, `styles.css` | high | S |
| 2 | Rail: mark at 40 px, active place = ember-soft tile + ember bar + ember glyph; phone bar: 24 px glyphs, ember underline | `styles.css` shell, `Layout.tsx` | high | S |
| 3 | Tokens: warm paper/lines, spacing rhythm `--s-1..7`, elevation `--e-1/--e-2`, `--brand-rule`; dark panels raised a step | `styles.css` :root | high | S |
| 4 | Panels, KPI strips, segmented controls, buttons, subnav on `--e-1`; chips framed; panel titles carry the ember tick | `styles.css` | high | S |
| 5 | Chart theme: flat bars at 0.92 with 2 px top radius, 2 px lines, solid faint gridlines (never dashed), 10×10 square legend swatches in the text colour, tooltips lifted (`--e-2`, 8 px radius), axis labels 11 px | `lib/foxchart.ts`, `lib/theme.tsx` | med | S |
| 6 | Empty / loading / error states: glyph on a soft tile, the mark flapping while loading | `components/ui.tsx` | med | S |
| 7 | Page titles: section glyph tile on the hub pages (industry, funds, data, valuation, calendar, debt, ownership, holdings, restatements, presentations, mine); `.eyebrow` available | 11 one-line page edits | med | S |
| 8 | Top bar brand hairline; wordmark dot in the ember | `styles.css` | med | XS |
| 9 | Page arrival fade (160 ms) | `styles.css` | low | XS |

Shell cost: JS 117.3 → 119.6 kB (gzip 44.7 → 45.5), CSS 67.4 → 70.2 kB (gzip 14.3 → 14.9). No new dependency; CSP untouched.

## Deliberately not brought back

- **Isometric 3-D icons in navigation.** They were literal clip-art (a house for "home", a coin stack for "value"), changed with the theme, and said nothing about CSM, solvency or filings. The duotone set keeps the *material* (fill + stroke, ember on the active place) and adds the glyphs the product is about.
- **The masthead scene and the 120 px wordmark.** The home is a working screen; the brand lives in the rail mark (40 px), the top-bar hairline, and the loading moment.
- **Aurora, grid, pointer spotlight, glass blur, glow, hover lift, blur page-in, count-ups outside valuation.** Each cost reading or paint time and none encoded anything.
- **Gradient fills on bars, pills and buttons.** The gradient is the mark's; charts stay flat so identity colours stay readable.
- **The `light` theme and 999 px pills on cards.** One system, two colour sets.

## Requests (other lanes)

- **Lane H (home):** use `<Icon name="home" tone="ember" />` or `.icotile` beside the home's first heading; feed rows could carry the duotone `filing`/`statement` glyphs instead of text chips; the mark at 40–56 px on the empty "since your last visit" state (`<Logo size={56} />`, no animation). Keep the first number inside the first 110 px.
- **Lane A2 (company header):** the identity dot could become a 14 px ring (`.iddot` with a 3 px soft halo in the company colour) — the one place the avatar can lead.
- **Lane G/F (`ChartBookLink`, `MineLink`):** swap the raw `<svg>` for `<Icon name="book" />` / `<Icon name="mine" />` so the header buttons get the duotone fill (the old stroke rule still styles them today).
