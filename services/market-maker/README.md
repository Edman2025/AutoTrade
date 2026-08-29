# Bingan AMM mainnet control plane

This service is the mainnet-facing backend for the visual AMM console. It is
not an order-book bot. It models Bingan's lifecycle as Dynamic Bonding Curve
before graduation and Meteora DAMM v2 after graduation.

## Enforced topology

- BG/ANTFUN DAMM v2 pool:
  `AJJxmAV2C2WTHVHD4FEP71Vt8Rdu5day1v4Pr1FJPXEy`
- ANTFUN/USDT DLMM pool:
  `54Vp27uLaw4wNLo5n7r4fcC6zLamoQc28xBARjss4EUJ`
- Direct BG/SOL and the empty/dust ANTFUN/SOL pools are rejected.
- SOL is retained only as the wallet's native transaction-fee reserve. It is
  not a quote, route, valuation, or market-making asset.

The current Meteora mainnet index shows that all four same-mint ANTFUN/SOL
pools are empty, inactive, or dust-only. The only deep ANTFUN price-discovery
market is currently ANTFUN/USDT. On 2026-08-27 the operator explicitly selected
the two-pool USDT-denominated topology. The service now requires both fixed pools
to pass fresh on-chain identity and liquidity checks before it can resume.
The dated pool-by-pool evidence is recorded in `MAINNET_EVIDENCE.md`.
Operational startup and approval steps are recorded in `RUNBOOK.md`.

## Modes

- `observe`: reads public pool/RPC state, saves snapshots, provides quotes, and
  disables all mutation endpoints. When a public wallet address is configured,
  its native SOL, supported token accounts, and pool positions are also read.
- `prepare`: enables transaction construction, simulation, and an auditable
  prepare/approve workflow. It cannot broadcast.
- `live`: additionally permits submission of a separately signed transaction,
  but only after an intent-specific confirmation header. Mainnet live mode is
  still blocked while inventory and daily-PnL gates are unavailable.

No endpoint accepts a seed phrase or private key. The backend returns unsigned
transactions for external wallet signing. Signed transactions are checked
against the configured fee payer, the saved intent, and a program whitelist
before preflight and broadcast.

The admin bearer token must contain at least 32 characters. CORS accepts HTTPS
origins and loopback HTTP origins only. The SQLite database and its directory
are created under a restrictive process umask.

## Read-only start

Use a reliable private Solana RPC. The public endpoint is kept only as a
read-only fallback and is not reliable enough for production.

The current local observe-mode fallback is PublicNode
(`https://solana-rpc.publicnode.com`). Because anonymous shared RPCs restrict
expensive indexed methods, `MAKER_ENABLE_POSITION_INDEX=false` reads only the
fixed pool accounts and the configured wallet's known BG, ANTFUN, and USDT
associated token accounts. Enable LP position discovery only with an
authenticated RPC that supports `getProgramAccounts`. Live mode still requires
an authenticated endpoint with a reviewed rate limit and transaction-submission
SLA.

```sh
export SOLANA_RPC_URL='https://your-private-mainnet-rpc.example'
npm run maker:probe
npm run maker:check
npm run maker:serve
```

API endpoints:

- `GET /api/health`
- `GET /api/v1/config`
- `GET /api/v1/snapshot`
- `GET /api/v1/events` (SSE)
- `GET /api/v1/audit`
- `POST /api/v1/quotes`
- authenticated prepare/approve/control endpoints; a prepared response returns
  the unsigned transaction to that authorized caller, while list responses
  always redact it

`POST /api/v1/quotes` accepts either a one-pool `swap` or a quote-only
`route-swap` with `inputSymbol` equal to `BG` or `USDT`. Route quotes chain each
leg's protected minimum output into the next leg and report compounded
slippage. Multi-leg broadcasting remains disabled until resumable execution
state is implemented and tested.

The console reads `VITE_MAKER_API_URL`; its default is
`http://127.0.0.1:8788` for local development.

The console defaults to production-data mode. Its former visual fixture data is
available only when a developer explicitly starts Vite with
`VITE_ENABLE_DESIGN_FIXTURES=1`; production builds must leave that variable
unset.

## Mainnet gates

Execution requires all of the following:

- fresh snapshot with exact pool owner program and mint-pair match;
- two-pool topology verified;
- operator has explicitly resumed the initially paused service;
- fresh quote, bounded slippage, bounded price impact, fee reserve, cooldown,
  daily notional, daily loss, and inventory-direction checks;
- transaction simulation succeeds;
- one-time intent approval;
- the external wallet signs the exact prepared transaction;
- the service refreshes the quote and reruns every risk gate immediately before
  accepting the signed transaction;
- submission carries the intent-specific `EXECUTE_<intent-id>` confirmation.

The API never exposes `MAKER_ADMIN_TOKEN`, an RPC credential, unsigned raw
transaction bytes in public/list responses, a seed phrase, or a private key.
Before broadcast, the signed transaction message is byte-compared with the
saved approved message, in addition to fee-payer and program-whitelist checks.

## Known deployment blocker

`npm audit` currently reports unresolved high-severity transitive advisories in
the official Meteora/Solana SDK dependency chain. There is no compatible fix
published in the installed package graph. Live deployment should therefore be
isolated, use trusted RPC responses only, run as an unprivileged OS account,
and remain disabled until the dependency risk is accepted or patched.

Official integration references:

- https://github.com/MeteoraAg/docs/blob/main/developer-guides/damm-v2/index.mdx
- https://github.com/MeteoraAg/damm-v2-sdk
- https://github.com/MeteoraAg/dynamic-bonding-curve
