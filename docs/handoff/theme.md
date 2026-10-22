# Handoff: light mode and theme toggle

Branch `Bimajadivaaa/z-theme`. Not pushed. Checked in headless Chrome against `next dev` on port 3044 on 2026-10-22.

## What works

- **Three choices**: System (default, follows `prefers-color-scheme`), Light, Dark. The button in the top bar and in
  the `/about` and `/chains` headers cycles System → Light → Dark with a monitor, sun or moon icon. Its label says the
  current choice and the next one ("Theme: System. Switch to Light").
- **No flash**: an explicit choice is stored in `localStorage["luora.theme"]` (`light` or `dark`; System removes the
  key). A blocking inline `<script>` in `<head>` (`THEME_SCRIPT` in `apps/web/src/lib/theme.ts`, injected in
  `apps/web/src/app/layout.tsx` as in Next 16's "Preventing flash before hydration" guide) sets `data-theme` on
  `<html>` before the first paint. `<html>` has `suppressHydrationWarning`. Storage errors are caught; the page then
  follows the system.
- **Dev remount**: `ThemeToggle` (`apps/web/src/components/theme-toggle.tsx`) re-applies the stored choice in a
  `useLayoutEffect`, because React's Strict Mode remount clears attributes it does not manage on `<html>`. The
  current choice is read with `useSyncExternalStore` (server snapshot `system`), so the icon never causes a hydration
  error, and a change in another tab follows through the `storage` event.
- **Browser chrome**: `viewport.themeColor` has one colour per `prefers-color-scheme`, `colorScheme` is `light dark`.
- **Logo**: `public/brand/logo-text.png` is white on transparent, so `BrandLogo` draws it as a CSS mask filled with
  `--fg`. The ZEC coin is yellow with a white Z and reads on both themes, so it stays an `<img>`.

## Tokens

All colours live on `:root` in `apps/web/src/app/globals.css` as `light-dark(<light>, <dark>)`. The dark values are
the ones the app had before. `color-scheme` picks the side:

| Selector | `color-scheme` |
|---|---|
| `:root` | `light dark` (System) |
| `:root[data-theme="light"]` | `light` |
| `:root[data-theme="dark"]` | `dark` |

`--caret` (the `<select>` chevron, an SVG data URI) is the one value `light-dark()` cannot hold, so it is overridden
under `[data-theme="light"]` and under `prefers-color-scheme: light` without `data-theme="dark"`.

| Token | Light | Dark | Used for |
|---|---|---|---|
| `--canvas`, `--dot` | `#f4f4f5`, `#d9d9dd` | `#0e0e10`, `#232327` | page and dot grid |
| `--card-top/bot`, `--inner-top/bot` | white → `#fafafa`, `#fcfcfc` → `#f6f6f7` | as before | card gradients |
| `--surface`, `--raised`, `--hover`, `--inset`, `--field` | `#fff`, `#eeeef0`, `#e6e6e9`, `#f4f4f5`, `#fff` | as before | surfaces |
| `--border`, `--border-strong` | zinc-900 at 9 % and 16 % | white at 7 % and 13 % | borders |
| `--fg` … `--dim` | `#18181b` `#27272a` `#3f3f46` `#52525b` `#57575e` `#626269` | as before | text |
| `--primary`, `--primary-fg`, `--primary-hover` | `#18181b`, white, `#3f3f46` | `#f4f4f5`, `#0e0e10`, white | primary button, active tab |
| `--wire`, `--wire-on` | `#a1a1aa`, `#18181b` | as before | graph wires |
| `--green` `--yellow` `--red` `--blue` `--pink` | `#11703a` `#865a00` `#bb1e1e` `#1d4ed8` `#be185d` | as before | status text, dots, badges |
| `--mint`, `--mint-hover` | `#15803d`, `#166534` | `#86efac`, `#a7f3c4` | Inspect button (text is `--primary-fg`) |
| `--overlay` | `#18181b` | white | translucent tints: `ring-overlay/25`, `border-overlay/15`, `hover:bg-overlay/[.035]`, `decoration-overlay/30`, SVG focus strokes |
| `--scrim` | zinc-900 at 30 % | `rgba(5,5,6,.55)` | full-screen scrim, drawer and dialog backdrops |
| `--shadow`, `--shadow-strong` | zinc-900 at 10 % and 16 % | black at 45 % and 55 % | `shadow-soft`, `shadow-float`, picker, graph node drop shadow, graph inset |
| `--guide` | zinc-900 at 12 % | white at 9 % | Trace indent guides |
| `--graph`, `--graph-dot`, `--graph-glow` | `#f8f8f9`, `#d4d4d8`, white at 80 % | `#121214`, `#34343a`, white at 5 % | graph and Trace canvas |
| `--track`, `--meter` | `#e4e4e7`, `#52525b` | `#151517`, `#d4d4d8` | `Meter` |
| `--field-fg` | `#18181b` | `#f0f0f2` | text in inputs and selects |

Contrast (WCAG 2.1, light): every text token and every status colour is at least 4.5:1 on canvas, cards, raised,
hover, inset and the graph canvas. Lowest: `--dim` on `--hover` 4.86, `--yellow` on `--hover` 4.85, `--green` on
`--hover` 4.96. White on `--mint` is 5.02, white on `--primary` 17.7. Dark values are unchanged.

## Adding a colour

1. Add `--name: light-dark(<light>, <dark>);` to `:root` in `globals.css`. Check the light value against the surfaces
   it sits on (4.5:1 for text, 3:1 for icons and borders that carry meaning).
2. If Tailwind utilities need it, add `--color-name: var(--name);` to `@theme inline`; then `bg-name`, `text-name/50`
   and so on work. SVG attributes take `var(--name)` directly.
3. For a translucent tint of the foreground, use `overlay/<alpha>` rather than a new token. For a tint of a status
   colour, use `<status>/<alpha>` or `color-mix(in srgb, var(--status) N%, transparent)` in CSS.
4. Never write a hex, `white/…` or `black/…` in a component.

## Screens (`docs/screens/theme/`)

`<view>-<light|dark>-<desktop|390>.jpg`, desktop at 1440 px, phone at 390 px, full page: `landing`, `trace`, `graph`,
`rules`, `why-rejected`, `stall-doctor`, `block-trace`, `chains`, `about`. Taken with Playwright from the local npx
cache driving the installed Chrome; nothing was added to the project.

## Changed outside the palette

- The selected provider in Connect AI used `Dot tone="solid"` (`bg-primary-fg`), which was close to invisible on
  `bg-hover` in both themes; it is now the green `ok` dot.
