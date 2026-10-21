# Luora Z web

Next.js App Router UI for Luora Z. See `HANDOFF.md` at the repo root for build, run and test commands.

- `pnpm dev` serves on port 3031.
- The WASM decoder is loaded at runtime from `public/wasm/luora_z_core.js` (built by `crates/core`) through `public/core-loader.mjs`, so the bundler never touches it and the CSP only needs `'wasm-unsafe-eval'`.
