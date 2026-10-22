# Ask AI (task F, worktree z-ai)

Ask AI explains any part Luora shows: a Trace row, a Graph node, a rule, a Zebra error match or a PCZT action.
The AI explains, the user judges, and privacy holds: with no AI connected Luora still answers from the real
fields and the ZIP text, and nothing leaves the tab.

## What works

- **Ask from anywhere.** A Phosphor `Sparkle` IconButton labelled "Ask AI …" on the active or hovered Trace row,
  on every Graph node (inside the SVG, keyboard focusable), on every Rules row, on each Why-rejected match, on each
  PCZT action and PCZT signer check. Keyboard `A` asks "Explain this part" about the selection (active Trace row,
  selected Graph node, first failing or warning rule, first Zebra match, first PCZT action). `A` is ignored while
  typing or while a dialog is open.
- **Quick prompts.** Explain this part · Why does this rule pass or fail here? · What should an auditor check? ·
  What would change at another height? Free text and follow-ups in the same thread.
- **Answer panel.** Right side, 400 px, on `sm` and up; a 72 dvh bottom sheet on phones. It holds the context chip
  (what was asked about, its byte offset and parents), the thread, a Stop button while streaming, the quick
  prompts, a follow-up box and the privacy line ("Built-in: nothing leaves this tab" or "Sends to … Not sent: …").
  At `xl` the page gets right padding so the panel never covers the content.
- **Reference chips.** `@1706` (a byte offset that exists in this trace) selects that row in the Trace and scrolls
  to it; `#branch-id` (a check id that exists) opens Rules, opens the "passed" group if needed and rings the rule;
  `ZIP 244` links to zips.z.cash. Unknown offsets and ids stay plain text.
- **Connect AI** (top bar "AI · None", or the provider chip in the panel): None, Your Claude Code, Local model,
  Own API key, with Test connection, model choice and Forget keys.
- **Streaming** for Anthropic (SSE `content_block_delta`), OpenAI / OpenRouter / local (OpenAI-compatible
  `chat/completions` with `stream: true`) and Your Claude Code (our route turns `claude` stream-json into SSE).
  Errors are plain: wrong key (401/403), endpoint down with the `OLLAMA_ORIGINS="<this origin>"` hint, model 404,
  Claude Code missing, hosted Luora.

## Providers

| Option | Who answers | What leaves the machine | Notes |
|---|---|---|---|
| **None** (default) | `lib/ai/builtin.ts` | nothing | Field values as shown in the UI, the related rule results with their source lines, a per-kind explanation and checklist, the upgrade table around the height (`data/upgrades.json`), and the best ZIP excerpt |
| **Your Claude Code** | `claude -p` on this laptop via `POST /api/ai/claude` | the prompt, to the local `claude` process | Runs in an empty temp folder (deleted after) with `--tools "" --strict-mcp-config --setting-sources "" --disable-slash-commands --no-session-persistence --permission-mode dontAsk --system-prompt <fixed>`; 2 at once, 3 min timeout, killed on Stop |
| **Local model** | Ollama / LM Studio / any OpenAI-compatible server | the prompt, browser → endpoint | Default `http://localhost:11434` (`/v1` appended). Only `http://localhost` and `http://127.0.0.1` are allowed, by the dialog and by the page's CSP |
| **Own API key** | Anthropic (`claude-sonnet-5` default, `claude-opus-5-5`), OpenAI (`gpt-5`), OpenRouter (`anthropic/claude-sonnet-5`) | the prompt and the key, browser → provider | Anthropic calls carry `anthropic-dangerous-direct-browser-access: true`. Keys live in React state; "Remember" puts them in `sessionStorage` (`luora.ai.keys`), gone when the tab closes |

The provider choice, the local endpoint and model names are kept in `localStorage` (`luora.ai.settings`). Keys are not.

### `/api/ai/claude` safety rule

`lib/ai/claude-guard.ts → refuseClaude`:

1. `VERCEL` or `LUORA_HOSTED` set → **404** (the route does not exist on a hosted Luora).
2. Host must be `localhost`, `127.0.0.1` or `[::1]` with an optional port → else 403 (stops DNS rebinding).
3. POST needs an `Origin` equal to `http://<same host:port>` → else 403 (stops other sites and other local ports).
   GET (the "is Claude Code installed" check) may omit Origin only when `Sec-Fetch-Site: same-origin`.
4. `Sec-Fetch-Site`, when present, must be `same-origin`.
5. Body: 1 to 24 `user`/`assistant` turns, ≤ 60,000 chars, model name `[a-z0-9.-]` only; the system prompt is fixed
   on the server, never taken from the request.

Checked with curl on the dev server: foreign Origin → 403, foreign Host → 403; and in the browser: Test connection
→ "Connected. Reply: ok", and a streamed answer about `#branch-id` (screenshot below).

`next dev` listens on all interfaces by default; start it with `-H 127.0.0.1` on a shared network.

## Privacy model

Shown, not claimed: the first question to each provider (per page load) stops and shows the exact text that will
leave the tab, with Send / Cancel. "What will be sent" under the input shows the same preview at any time,
with the four opt-in boxes.

Default payload (`lib/ai/payload.ts → buildContext`):

- network, the height the rules ran at and its upgrade, the transaction version
- the selected element: title, parents' labels, byte offset and length, its fields
- related rule results (`#id`, status, detail, ZIP clause, source line)
- ZIP excerpts (≤ 3 rounds over the relevant ZIPs, ≤ 4,200 chars, each section ≤ 1,400 chars)
- the question, and earlier turns of the same thread

Withheld unless ticked (`lib/ai/subject.ts → fieldPrivacy`, `payload.ts → renderField / redactText`):

| Box | Covers |
|---|---|
| Transaction ids | this txid, `prevout` txids, and any 64-hex string in free text |
| Transparent addresses and scripts | `address`, `scriptPubKey`, PCZT `recipient` / `userAddress`, and t-, u-, zs-, tex- addresses in free text (a PCZT signer check quotes the shown address) |
| Exact hashes | `cv`, `nullifier`, `rk`, `cmu`, `cmx`, `ephemeralKey`, anchors, nullifier and commitment lists (sizes and counts are still sent) |
| Raw transaction hex | the whole hex, first 12,000 chars |

Ciphertexts, proofs and signatures are only ever sent as sizes. Earlier assistant answers are scrubbed with the
same rules before a follow-up. The panel says why: an AI provider that sees a txid, an address or a nullifier
learns which transaction you care about. One residual: exact amounts plus the height can still narrow a
transparent transaction down; the default keeps them because the explanation needs them.

## Grounding

`scripts/fetch-zips.ts` pulls ZIPs 203, 225, 229, 244, 257, 258, 317, 374, 2009 from `zcash/zips` at the current
`main` commit, converts the `.rst` headings to Markdown, and writes `data/zips/zip-NNNN.md` (front matter: source
URL, commit, commit date, fetch date) and `data/zips/index.json`. Vendored from
`zcash/zips@2bdf39494320e5e04057ac93b1794031ebfb00b5` (2026-10-21), fetched 2026-10-22.

`lib/ai/zips.ts → pickExcerpts` splits each ZIP by heading (dropping change history, acknowledgements,
references, terminology), scores sections by the check's ZIP clause (own heading ×40, parent headings ×10), the
row's field names and kind hints (`VOUT` → `outputs_digest`, `ACTION` → `orchard_actions_compact_digest`, …)
and demotes rationale sections. The browser loads `index.json` as a lazy chunk the first time the panel opens.

System prompt (`payload.ts → SYSTEM_PROMPT`): plain words first, define jargon, cite ZIP sections, say when
something cannot be known from public data, refuse to guess senders, recipients, shielded amounts or owners and
refuse linking, never write attacks, use `@offset` / `#check-id` only from the context, under 200 words.

## Commands

```bash
pnpm install
pnpm --filter web exec next dev -p 3035 -H 127.0.0.1   # http://127.0.0.1:3035
pnpm --filter web test        # 17 Ask AI tests in src/lib/ai/ai.test.ts plus the existing ones
pnpm --filter web lint
pnpm --filter web build
cd scripts && npx tsx fetch-zips.ts                    # refresh data/zips
```

## Tests (`apps/web/src/lib/ai/ai.test.ts`, vitest, real data)

All on the real v6 Ironwood transfer `30cdd41fc24b39fa8b1e47078f17e0b56d4db2c09df44be6f7e484a9f1fc021c` (Mainnet
height 3,495,600) decoded by the WASM core, its real `check_tx` results, and the vendored ZIP text.

- payload builder: the default leaves out the txid, the prevout txid, the address, the script, the nullifier and
  the hex; each opt-in adds only its own item; free-text details and earlier answers are scrubbed; follow-up
  history keeps the context in the first turn
- reference-chip parser: known `@offset`, `#check`, `ZIP n` become chips; `a@21`, unknown offsets and ids,
  `url/#id` stay text; the text round-trips
- ZIP excerpt picker: sections keep `T.1: header_digest`, change history is dropped, the clause "Fee calculation"
  picks ZIP 317 § Fee calculation first, results stay in the requested ZIPs and budget, every ZIP records a commit
- `/api/ai/claude` guard: loopback + matching Origin allowed; LAN IP, foreign host and `localhost.evil.example`
  refused even with a matching Origin; foreign, other-port and missing Origin refused; cross-site refused; 404
  when hosted; body validation; stream-json parsing

## Screens (`docs/screens/ai/`)

The user's Chrome window is full screen, so desktop shots are at its real width (about 1,500 px, not exactly
1,440); the phone shot is the app in a 390 px same-origin iframe.

| File | Shows |
|---|---|
| `desktop-trace-action-builtin.jpg` | Ironwood action #0 (@356), built-in "Explain this part" |
| `desktop-first-send-payload-preview.jpg` | first question to Your Claude Code: opt-in boxes and the exact payload |
| `desktop-rule-your-claude-code.jpg` | streamed answer from the user's Claude Code about `#branch-id`, citing ZIP 244 § T.1 |
| `desktop-graph-header-height.jpg` | Graph sparkles; "What would change at another height?" on the Header of `1bee124c…9b62` (Mainnet 3,525,568) |
| `desktop-why-rejected.jpg` | `TransactionError::ExpiredTransaction` with the catalog note and ZIP 203 |
| `desktop-pczt-action.jpg` | Testnet PCZT `crates/core/tests/fixtures/pczt/3-signed.pczt`, auditor checklist with the failing signer check |
| `phone-390-vout-builtin-sheet.png` | bottom sheet on a phone, VOUT #0 with ZIP 244 § T.2c outputs_digest |

## Not done / known limits

- Built-in answers cover the four quick prompts; a free question in None mode gets the explanation plus the
  closest ZIP text and a note to connect an AI.
- Consent is per provider per page load (memory), not persisted.
- Local endpoints other than localhost / 127.0.0.1 (a LAN box) are blocked by design; widening that means editing
  `connect-src` in `apps/web/next.config.ts`.
- Not tried with a real Ollama, LM Studio, OpenAI, OpenRouter or Anthropic key in this session (no key or local
  model available); the streaming code follows each API's documented SSE shape. Your Claude Code was tried end to end.
- The Graph sparkle sits inside each node at the right; checked on the wide graph only, not on the narrow (phone) graph.

## Contract

No change to `contract/types.ts`. All Ask AI types live in `apps/web/src/lib/ai/`.

## References

Pinterest refs in `research/ux-refs.md` (not committed): Quarn node-selection panel (answer docked right, input
at the bottom), AI chat dashboards (quick-prompt chips under the input), Notion AI / "AI Mode" pills (sparkle
button next to the content, "Thinking…" state). Behaviour reference: `~/Documents/GitHub/luora/docs/ai-provider.md`
(provider table, local-only Claude bridge); no Luora source was copied.
