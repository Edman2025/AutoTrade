# AutoTrade local wallet

## Mainnet AMM control plane

The production-oriented service now lives in
`services/market-maker/`. It verifies Bingan/Meteora pool identities on chain,
captures read-only mainnet snapshots, exposes the console API, persists an
audit log, constructs and simulates unsigned swaps, and enforces a two-phase
approval workflow. It starts paused in `observe` mode and never accepts a seed
phrase or private key through its API.

```sh
npm run maker:test
npm run maker:probe
npm run maker:check
npm run maker:serve
```

Current mainnet evidence does not support a liquid direct ANTFUN/SOL main pool.
The operator has approved only the stablecoin-denominated two-pool topology
`BG/ANTFUN ↔ ANTFUN/USDT`; SOL is retained only as the wallet's native fee
reserve and is not a quoting, routing, valuation, or market-making asset. The live gate remains closed until the
private RPC, public wallet, accounting, and dependency-security gates pass. See
`services/market-maker/README.md` for the
verified pool findings, operating modes, deployment gates, and environment
variables; `services/market-maker/RUNBOOK.md` contains the operator procedure
and `services/market-maker/MAINNET_EVIDENCE.md` records the dated pool evidence.

The older `bg:*` scripts below are isolated legacy utilities. They are not
invoked by the mainnet control-plane service because they bypass its audit,
external-signature, and broadcast-time risk controls.

## Encrypted bulk test-wallet fixtures

Generate 1,000 independent test wallets, each with its own 24-word BIP-39
recovery phrase and derived EVM/Solana address:

```sh
npm run generate:test-wallets
```

The encrypted recovery-phrase backup is written to
`.autotrade/test-wallets-vault.json`; its random 256-bit vault password is held
in the current Mac user's login Keychain. A secret-free address manifest is
written to `.autotrade/test-wallet-addresses.json`. Both files are mode `0600`
and `.autotrade/` is ignored by Git. The generator refuses to overwrite either
file.

Verify every mnemonic and re-derived address without displaying secrets:

```sh
npm run test-wallets:verify
```

Reveal exactly one recovery phrase only when it must be imported into a test
wallet:

```sh
npm run test-wallets:reveal -- --id=1 --i-understand-this-prints-a-recovery-phrase
```

These fixtures are for local development and public testnets only. Do not fund
them on mainnet or use them to evade platform account, incentive, or airdrop
rules. Copying only the encrypted JSON is not a complete off-device backup: the
matching Keychain item is also required to decrypt it.

This workspace creates a non-custodial hierarchical deterministic wallet with one recovery phrase and two default accounts:

| Network family | Derivation path | Purpose |
| --- | --- | --- |
| EVM chains | `m/44'/60'/0'/0/0` | Ethereum-compatible chains |
| Solana | `m/44'/501'/0'/0'` | Bingan / SOL trading |

Run `npm run wallet:create` once. It writes no seed phrase or private key to the console. The recovery phrase is encrypted using AES-256-GCM at `.autotrade/wallet-vault.json` (mode `0600`); the separate vault key is held by the local macOS login Keychain. The vault folder is ignored by Git.

Before funding, reveal the phrase locally with `npm run wallet:reveal-recovery`, write it down offline, and verify it is complete. Anyone with the phrase controls all assets. `npm run wallet:addresses` shows only public addresses.

## Bingan `$BG` trade support

Target mint: `HSkHx26EFANEcBjrmN4H8uAmRFCFGUn5uoRMh9bgxgan`.

The token has graduated from Bingan's curve, so the script uses Bingan's documented Meteora DAMM v2 endpoint (`/trade/create-pool-swap-transaction`). It first calls the documented status endpoint to determine the pool if `--pool` is omitted. Bingan returns an unsigned transaction; it is signed only in this local wallet.

Set credentials only in the active terminal session:

```sh
export BINGAN_API_KEY='your-key'
export SOLANA_RPC_URL='https://your-solana-rpc.example'
```

Construct and inspect a trade (default; does not sign or send):

```sh
npm run bingan:swap -- --action=buy --amount=1000000 --min-out=123456
```

Amounts are base units, not display units. `--min-out` is mandatory and must be non-zero. Broadcasting additionally simulates first, then needs a deliberately supplied RPC URL:

```sh
npm run bingan:swap -- --action=buy --amount=1000000 --min-out=123456 --broadcast=true
```

Every broadcast should be separately reviewed and explicitly authorized. This starter does not add Jito tips or other MEV routing; use a trusted RPC and keep slippage protection enabled.

## BG +3% automatic take-profit

The local take-profit script reverses the verified Meteora route used for the purchase:

`BG -> ANTFUN -> USDT -> SOL`

It uses the recorded entry of `0.01 SOL` for `496.500584 BG` and sells the full BG balance only when the compounded, slippage-protected minimum output is at least `0.0103 SOL`. Each leg is capped at 1% slippage, approximately 2.97% compounded. A check without broadcasting is safe:

```sh
npm run bg:take-profit
```

The live one-shot check is intended for the scheduled monitor. It broadcasts only after the threshold is met and writes resumable state to `.autotrade/bg-take-profit.json`:

```sh
npm run bg:take-profit:live
```

## Read-only BG arbitrage monitor

The legacy arbitrage monitor checks the official BG/ANTFUN pool against every
discoverable Meteora DAMM v2 and DLMM BG/ANTFUN or BG/SOL pool. It is not part
of the approved market-maker control plane and must not be used to infer an
authorized production route. It never opens the wallet vault, signs a
transaction, or broadcasts anything.

Run one scan:

```sh
npm run bg:arb-once
```

Continuously emit one JSON record every 30 seconds:

```sh
npm run bg:arb-monitor
```

The defaults quote a 1,000 ANTFUN cycle, reject secondary pools below $1,000
effective TVL, allow 20 bps conservative slippage per leg, subtract 25 ANTFUN
for priority-fee/tip/failure risk, and alert only above 80 bps net return. All
thresholds are configurable:

```sh
npm run bg:arb-once -- \
  --amount-antfun=5000 \
  --min-secondary-tvl-usd=5000 \
  --min-net-bps=100 \
  --fixed-cost-antfun=50
```

Use `SOLANA_RPC_URL` for a reliable private read-only RPC. An `opportunity`
record is only a signal for review; the monitor intentionally has no execution
mode.
