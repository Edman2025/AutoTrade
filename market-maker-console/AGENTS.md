# Prototype Instructions

Run the local server yourself and open the preview in the browser available to this environment. Do not give the user server-start instructions when you can run it.

Before making substantial visual changes, use the Product Design plugin's `get-context` skill when the visual source is unclear or no longer matches the current goal. When the user gives durable prototype-specific design feedback, preferences, or decisions, record them in `AGENTS.md`.

When implementing from a selected generated mock, treat that image as the source of truth for layout, component anatomy, density, spacing, color, typography, visible content, and hierarchy.

Build app UI in `src/`. Keep `.openai/hosting.json`, `worker/index.js`, `scripts/prepare-sites-build.mjs`, and `tests/sites-worker.test.mjs` intact so the same local prototype can be handed to Sites. Before a Sites handoff, run `npm run build` and `npm run test:sites`; the build must leave `dist/client/index.html`, `dist/server/index.js`, and `dist/.openai/hosting.json`.

## Prototype decisions

- The selected visual source is Direction 1 of the AMM redesign: a midnight AMM pool-operations console.
- Bingan is a meme-token launchpad using Dynamic Bonding Curve before graduation and Meteora DAMM v2 constant-product AMM after graduation; the product must not use order-book language or concepts.
- On 2026-08-27 the operator explicitly removed `SOL/USDT`. The only approved production trading topology is `BG/ANTFUN ↔ ANTFUN/USDT`; SOL is a native fee reserve only and must not appear as a quote, route, valuation, or market-making asset. Do not imply direct `BG/SOL` or `ANTFUN/SOL` pools, and do not select alternative pool addresses without fresh identity/liquidity verification.
- The core screen prioritizes token lifecycle, pool reserves, executable price impact, LP Position NFT, fee accrual, inventory/impermanent-loss risk, Swap flows, reserve safety, and human-confirmed automation state.
- The default local UI is the production-data console and may call the read-only market-maker API for snapshots, audit data, and real quotes. It must never accept a seed phrase/private key, store the admin bearer token in browser storage, sign a transaction, or broadcast directly. Historical design fixtures remain available only behind the explicit `VITE_ENABLE_DESIGN_FIXTURES=1` developer flag.
- Readability preference: keep Chinese desktop UI text comfortably legible at 100% browser zoom. Avoid microcopy below 10px; use roughly 11-13px for captions/body text and preserve clear hierarchy without returning to the former 6-9px dense type scale.
- The Emit-inspired v0.4 capability set is deliberately AMM-safe: fixed-route batch quotes, external-signing execution queues, current priority-fee telemetry, explicit Jito/Nozomi configuration state, and BG Mint/holder intelligence. Do not add browser-held signing keys, fake atomicity, alternative DEX routes, wash-volume automation, holder inflation, or price-manipulation controls.
- Operator-facing growth labels must preserve those semantics: “成交增长” means verified pool-volume analytics, “持有人洞察” means real Mint/account-distribution data, and buy/sell inventory execution means risk-gated fixed-route slicing without price targets. Renaming must never conceal wash trading, fake-holder creation, pumping, or dumping.
