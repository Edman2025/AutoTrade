# Mainnet operator runbook

This runbook does not authorize a trade. Each mainnet action still requires an
operator decision, an intent-specific confirmation, and a signature from the
configured external wallet.

## 1. Prerequisites

- Node.js 24 or the supplied container image
- a reliable private Solana mainnet RPC URL
- the public address of the operator wallet; never its seed phrase or private key
- a reviewed HTTPS origin for the console
- the approved two-pool topology recorded in `MAINNET_EVIDENCE.md`
- resolved/accepted SDK dependency advisories

Keep the environment file mode `0600`. Do not place it in the web root or ship
it in the console bundle.

For local observe-mode verification, the checked-in example can be replaced by
the no-key PublicNode endpoint and `MAKER_ENABLE_POSITION_INDEX=false`. This
fixed-account mode deliberately omits LP position discovery. Do not promote a
shared public endpoint to prepare/live deployment; use an authenticated RPC
with indexed-account access, defined rate limits, and transaction landing SLA.

## 2. Observe mode

```sh
export MAKER_MODE=observe
export SOLANA_RPC_URL='https://your-private-mainnet-rpc.example'
export MAKER_WALLET_ADDRESS='PUBLIC_ADDRESS_ONLY'
npm run maker:check
npm run maker:serve
```

Expected behavior:

- `GET /api/health` returns `ready` only when a recent snapshot verifies both
  exact pools, their owner programs, mint pairs, and executable liquidity.
- mutation endpoints return `403`.
- the process starts paused.

## 3. Prepare mode

Generate a random administrator token of at least 32 characters and provide it
through the service environment. Avoid putting it in a browser storage API.

```sh
export MAKER_MODE=prepare
export MAKER_ADMIN_TOKEN='REDACTED_32_PLUS_RANDOM_CHARACTERS'
```

Prepare mode supports authenticated quote-to-transaction construction and RPC
simulation, but `submit-signed` is hard-disabled. A request body uses base units:

```json
{
  "kind": "swap",
  "pool": "bgAntfun",
  "inputSymbol": "ANTFUN",
  "amountInRaw": "1000000",
  "slippageBps": 50
}
```

The authorized `POST /api/v1/intents` response includes a short-lived unsigned
transaction. Sign that exact message in an external wallet. The server never
asks for signing material.

## 4. Approval and broadcast protocol

The sequence is fixed:

1. Refresh a quote.
2. Prepare and simulate an intent.
3. Review the decoded action, minimum output, fee payer, programs, and logs.
4. Approve with `X-Maker-Confirm: APPROVE_<intent-id>`.
5. Sign the exact unsigned message outside the service.
6. In explicitly acknowledged `live` mode, submit with
   `X-Maker-Confirm: EXECUTE_<intent-id>`.
7. The service refreshes the quote, reruns risk checks, byte-compares the signed
   message, simulates again, then broadcasts.

Live mode additionally requires:

```sh
export MAKER_MODE=live
export MAKER_LIVE_ACK=I_UNDERSTAND_MAINNET
```

Those variables do not bypass risk gates. The current build deliberately
rejects live execution while topology, inventory direction, daily notional,
and daily-loss accounting are incomplete.

## 5. Emergency pause

`POST /api/v1/control/pause` is authenticated but does not require the resume
confirmation string. Use it as the first response to uncertain RPC state,
unexpected inventory, transaction failures, or a suspected credential leak.
Pausing does not remove liquidity or sell assets.

Resume requires both:

- `X-Maker-Confirm: RESUME_MAINNET`; and
- a fresh, fully verified two-pool snapshot.

## 6. Deployment

The supplied `Dockerfile` runs as UID 10001 and includes a process health check.
The supplied systemd unit runs as an unprivileged `maker` account with a
read-only filesystem except for the SQLite data directory.

Terminate TLS and add request-rate limiting in a trusted reverse proxy. Do not
publish the service directly to the internet. Back up the SQLite database as
operational/audit data; it contains no seed phrase or private key.

## 7. Legacy isolation

Do not run root-level `bg:*` scripts as part of this service. Some are historical
utilities with routes that are no longer approved; they bypass the new intent ledger, external-signature
protocol, and broadcast-time risk revalidation.
