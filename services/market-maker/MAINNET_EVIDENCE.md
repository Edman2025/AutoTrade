# Mainnet evidence record

Checked on 2026-08-27. Values such as TVL and volume are observations, not
constants; pool identities and mint pairs are revalidated by the service.

## Bingan / Meteora mechanism

The deployed Bingan web bundle identifies its public API as
`https://api.bingan.app`, Meteora Dynamic Bonding Curve program as
`dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN`, and Meteora DAMM v2 program as
`cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG`. Bingan launches tokens on a
bonding curve and migrates graduated liquidity to DAMM v2; the production
model is AMM liquidity and swaps, not an order book.

Official implementation references:

- https://github.com/MeteoraAg/docs/blob/main/developer-guides/damm-v2/index.mdx
- https://github.com/MeteoraAg/damm-v2-sdk
- https://github.com/MeteoraAg/dynamic-bonding-curve

## Supported assets

- BG mint: `HSkHx26EFANEcBjrmN4H8uAmRFCFGUn5uoRMh9bgxgan`
- ANTFUN mint: `CWZ6BsdnjkDVTGkmL6bGbJXXig6ceef12KvyGQW14cMt`
- USDT mint: `Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB`

## Verified BG main pool

- BG/ANTFUN DAMM v2:
  `AJJxmAV2C2WTHVHD4FEP71Vt8Rdu5day1v4Pr1FJPXEy`
- Program: `cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG`
- Expected pair: exact BG and ANTFUN mints above

The service does not trust the address alone. It verifies the on-chain account
owner, both pool mints, enabled state, vault balances, and executable quotes.

## Direct ANTFUN/SOL discovery result

The official Meteora indexes returned four exact-mint candidates:

| Pool | Type | Mainnet observation |
| --- | --- | --- |
| `H82sig6Ksx1QTwfyukGrkZ8DYki1qVdCieUgKR2fQfSv` | DLMM | zero reserves / no usable bins |
| `37XmiaBCyYUz4isFuo7uNqPR1BgXkRYYeCutzpfznhSS` | DLMM | dust only; roughly 22.78 ANTFUN and 0.0116 SOL, no active liquidity |
| `Cs5jgAZdSCZqRwHrSZ7n7hR7J4sB4QE2jqjPYdfAEkXc` | DAMM v2 | indexed liquidity zero |
| `3mFeTWPyYiUUMQpNziH2PnhYZLMhS1NUC2v3DGL9NK9y` | DAMM v2 | indexed liquidity zero |

Discovery sources:

- https://damm-v2.datapi.meteora.ag/pools?query=CWZ6BsdnjkDVTGkmL6bGbJXXig6ceef12KvyGQW14cMt&page_size=100
- https://dlmm.datapi.meteora.ag/pools?query=CWZ6BsdnjkDVTGkmL6bGbJXXig6ceef12KvyGQW14cMt&page_size=100

None met the minimum condition of exact identity plus enabled executable
liquidity. None is part of the approved production topology.

## Approved stablecoin market

The deep ANTFUN market observed at the same check was ANTFUN/USDT DLMM pool
`54Vp27uLaw4wNLo5n7r4fcC6zLamoQc28xBARjss4EUJ`, owned by program
`LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo`. At the 2026-08-27 check it had
about $42.2M indexed TVL and $11.6M indexed 24-hour volume.

For completeness, an earlier investigation also observed a SOL/USDT DLMM pool at
`C8G7RiugU2cznu7SAtCJ9aAShEzFEELUCm87ydRW8fSZ`, with the same DLMM program. At
the same check it had about $3.2K indexed TVL and $14.1K indexed 24-hour volume.
This historical observation is not part of the approved topology.

On 2026-08-27 the operator subsequently removed the SOL/USDT leg and explicitly
approved only:

`BG/ANTFUN ↔ ANTFUN/USDT`

SOL remains a native network-fee reserve only. This decision does not authorize
a particular trade or relax any risk limit.

## Recorded decision

The fixed production topology is now the two-pool USDT-denominated route above.
Live execution still requires a reliable private RPC, a public
operator wallet, fresh on-chain verification, portfolio accounting, external
signing, and action-specific approval.
