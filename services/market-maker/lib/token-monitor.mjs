import { Connection, PublicKey } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { TOKENS } from "./config.mjs";

const TOKEN_DECIMALS = TOKENS.SIAM.decimals;
const QUOTE_DECIMALS = TOKENS.ANTFUN.decimals;

export class TokenMonitorService {
  constructor(config, store, options = {}) {
    this.config = config;
    this.store = store;
    this.indexer = options.indexer ?? new Connection(config.indexerRpcUrl, {
      commitment: "confirmed",
      disableRetryOnRateLimit: true,
    });
    this.activityRpc = options.activityRpc ?? new Connection(config.rpcUrl, {
      commitment: "confirmed",
      disableRetryOnRateLimit: true,
    });
    const cachedHolders = store.getMonitorCache("siam-holders-v1");
    this.holderSnapshot = cachedHolders ? { ...cachedHolders.payload, capturedAt: cachedHolders.capturedAt } : null;
    this.holderAttemptAt = 0;
    this.activityAttemptAt = 0;
    this.holderError = null;
    this.activityError = null;
    this.liquiditySnapshot = null;
    this.liquiditySnapshotAt = null;
    this.inFlight = null;
  }

  async read(snapshot) {
    void this.warm(snapshot);
    return this.build(snapshot);
  }

  warm(snapshot) {
    return this.refresh(snapshot).catch(() => {});
  }

  async refresh(snapshot) {
    if (this.inFlight) return this.inFlight;
    const tasks = [];
    const now = Date.now();
    if (!this.holderAttemptAt || now - this.holderAttemptAt >= this.config.tokenHolderRefreshMs) {
      this.holderAttemptAt = now;
      tasks.push(this.refreshHolders(snapshot));
    }
    if (!this.activityAttemptAt || now - this.activityAttemptAt >= this.config.tokenActivityRefreshMs) {
      this.activityAttemptAt = now;
      tasks.push(this.refreshActivity(snapshot));
    }
    if (!tasks.length) return;
    this.inFlight = Promise.allSettled(tasks).finally(() => { this.inFlight = null; });
    await this.inFlight;
  }

  async refreshHolders(snapshot) {
    try {
      const [accounts, supply] = await withTimeout(Promise.all([
        this.indexer.getParsedProgramAccounts(TOKEN_PROGRAM_ID, {
          commitment: "confirmed",
          filters: [
            { dataSize: 165 },
            { memcmp: { offset: 0, bytes: TOKENS.SIAM.mint } },
          ],
        }),
        this.indexer.getTokenSupply(new PublicKey(TOKENS.SIAM.mint), "confirmed"),
      ]), 20_000, "持有人索引查询超时");
      this.holderSnapshot = aggregateHolders(accounts, {
        supplyRaw: supply.value.amount,
        poolVault: reserveFor(snapshot?.pools?.siamAntfun, "SIAM")?.vault,
        operationalWallet: this.config.walletAddress,
      });
      this.holderSnapshot.capturedAt = this.store.saveMonitorCache("siam-holders-v1", this.holderSnapshot);
      this.holderError = null;
    } catch (error) {
      this.holderError = friendlyRpcError(error, "持有人索引");
    }
  }

  async refreshActivity(snapshot) {
    const poolAddress = this.config.pools.siamAntfun.address;
    try {
      const signatures = await withTimeout(
        this.activityRpc.getSignaturesForAddress(new PublicKey(poolAddress), { limit: this.config.tokenActivityLimit }, "confirmed"),
        12_000,
        "实时交易签名查询超时",
      );
      const missing = signatures.filter((item) => !this.store.hasTokenActivity(item.signature))
        .slice(0, this.config.tokenActivityParseBatch);
      const siamVault = reserveFor(snapshot?.pools?.siamAntfun, "SIAM")?.vault;
      const antfunVault = reserveFor(snapshot?.pools?.siamAntfun, "ANTFUN")?.vault;
      if (!siamVault || !antfunVault) throw new Error("主池 vault 尚未通过快照验证");
      for (const item of missing) {
        try {
          const transaction = await withTimeout(
            this.activityRpc.getParsedTransaction(item.signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 }),
            10_000,
            "交易解析超时",
          );
          if (!transaction) continue;
          const parsed = parsePoolSwap(transaction, {
            signature: item.signature,
            siamMint: TOKENS.SIAM.mint,
            antfunMint: TOKENS.ANTFUN.mint,
            siamVault,
            antfunVault,
          });
          this.store.upsertTokenActivity(parsed ?? {
            signature: item.signature,
            slot: transaction.slot ?? item.slot,
            blockTime: isoBlockTime(transaction.blockTime ?? item.blockTime),
            kind: "ignored",
          });
        } catch (error) {
          if (isRateLimit(error)) throw error;
        }
        await delay(90);
      }
      this.activityError = null;
    } catch (error) {
      this.activityError = friendlyRpcError(error, "实时交易");
    }
  }

  build(snapshot) {
    const activities = this.store.listTokenActivities(1_000);
    const antfunInUsdt = finite(snapshot?.impliedPrices?.antfunInUsdt);
    const siamInUsdt = finite(snapshot?.impliedPrices?.siamInUsdt);
    const enrichedActivities = activities.map((item) => enrichActivity(item, antfunInUsdt));
    const holderRows = this.holderSnapshot?.holders ?? [];
    const profitability = computeProfitability(enrichedActivities, this.holderSnapshot?.holders, { siamInUsdt, antfunInUsdt });
    const walletStats = new Map(profitability.wallets.map((item) => [item.address, item]));
    const holders = holderRows.map((holder) => {
      const stats = walletStats.get(holder.address);
      return {
        ...holder,
        buys: stats?.buys ?? 0,
        sells: stats?.sells ?? 0,
        lastActivityAt: stats?.lastActivityAt ?? null,
        estimatedPnlUsdt: stats?.estimatedPnlUsdt ?? null,
        pnlCoverage: stats?.coverage ?? "none",
      };
    });
    if (!this.liquiditySnapshot || this.liquiditySnapshotAt !== snapshot?.capturedAt) {
      this.liquiditySnapshot = buildLiquidityHistory(
        this.store.listSnapshotsSince(new Date(Date.now() - 7 * 86_400_000).toISOString(), 20_160),
      );
      this.liquiditySnapshotAt = snapshot?.capturedAt ?? null;
    }
    const liquidity = this.liquiditySnapshot;
    return {
      capturedAt: new Date().toISOString(),
      mint: TOKENS.SIAM.mint,
      symbol: "SIAM",
      displayName: TOKENS.SIAM.name,
      holders: {
        status: this.holderSnapshot ? (this.holderError ? "stale" : "ready") : "unavailable",
        source: "Solana getProgramAccounts · 正余额 Token Account 按 owner 聚合",
        capturedAt: this.holderSnapshot?.capturedAt ?? null,
        distinctHolders: this.holderSnapshot?.distinctHolders ?? null,
        positiveTokenAccounts: this.holderSnapshot?.positiveTokenAccounts ?? null,
        indexedAmountRaw: this.holderSnapshot?.indexedAmountRaw ?? null,
        indexedAmountUi: this.holderSnapshot?.indexedAmountUi ?? null,
        supplyRaw: this.holderSnapshot?.supplyRaw ?? null,
        supplyCoverageBps: this.holderSnapshot?.supplyCoverageBps ?? null,
        top10Bps: this.holderSnapshot?.top10Bps ?? null,
        items: holders,
        error: this.holderError,
      },
      activity: {
        status: enrichedActivities.length ? (this.activityError ? "stale" : "ready") : this.activityError ? "unavailable" : "warming",
        source: "Solana 主池已确认交易 · vault 余额差解析",
        window: activityWindow(enrichedActivities),
        items: enrichedActivities.slice(0, 200),
        error: this.activityError,
      },
      profitability: {
        status: enrichedActivities.length ? "estimated" : "warming",
        method: "已索引主池交易的移动平均成本；ANTFUN 损益按当前 ANTFUN/USDT 隐含价折算",
        scope: "analysis-window",
        window: activityWindow(enrichedActivities),
        analyzedWallets: profitability.wallets.length,
        profitableWallets: profitability.profitable.length,
        items: profitability.profitable,
      },
      liquidity,
      limitations: [
        "盈利为当前服务已索引分析窗口内的估算，不代表地址全历史、跨池或跨链收益。",
        "公共 RPC 限流时保留最近成功数据并标记 stale，不用模拟数据补位。",
      ],
    };
  }
}

export function aggregateHolders(accounts, { supplyRaw, poolVault, operationalWallet } = {}) {
  const owners = new Map();
  let positiveTokenAccounts = 0;
  let indexedAmountRaw = 0n;
  for (const entry of accounts ?? []) {
    const info = entry?.account?.data?.parsed?.info;
    const amountText = info?.tokenAmount?.amount;
    if (!info?.owner || !/^\d+$/.test(String(amountText ?? ""))) continue;
    const raw = BigInt(amountText);
    if (raw <= 0n) continue;
    positiveTokenAccounts += 1;
    indexedAmountRaw += raw;
    const current = owners.get(info.owner) ?? { address: info.owner, amountRaw: 0n, tokenAccounts: 0, accountAddresses: [] };
    current.amountRaw += raw;
    current.tokenAccounts += 1;
    current.accountAddresses.push(entry.pubkey?.toBase58?.() ?? String(entry.pubkey ?? ""));
    owners.set(info.owner, current);
  }
  const denominator = /^\d+$/.test(String(supplyRaw ?? "")) && BigInt(supplyRaw) > 0n ? BigInt(supplyRaw) : indexedAmountRaw;
  const holders = [...owners.values()].sort((a, b) => compareBigInt(b.amountRaw, a.amountRaw)).map((entry, index) => {
    const tags = [];
    if (entry.address === operationalWallet) tags.push("运营钱包");
    if (poolVault && entry.accountAddresses.includes(poolVault)) tags.push("主池流动性");
    return {
      rank: index + 1,
      address: entry.address,
      tokenAccounts: entry.tokenAccounts,
      amountRaw: entry.amountRaw.toString(),
      amountUi: rawToUi(entry.amountRaw, TOKEN_DECIMALS),
      shareBps: denominator > 0n ? Number(entry.amountRaw * 10_000n / denominator) : null,
      tags,
    };
  });
  return {
    distinctHolders: holders.length,
    positiveTokenAccounts,
    indexedAmountRaw: indexedAmountRaw.toString(),
    indexedAmountUi: rawToUi(indexedAmountRaw, TOKEN_DECIMALS),
    supplyRaw: denominator.toString(),
    supplyCoverageBps: denominator > 0n ? Number(indexedAmountRaw * 10_000n / denominator) : null,
    top10Bps: denominator > 0n ? Number(holders.slice(0, 10).reduce((sum, item) => sum + BigInt(item.amountRaw), 0n) * 10_000n / denominator) : null,
    holders,
  };
}

export function parsePoolSwap(transaction, { signature, siamMint, antfunMint, siamVault, antfunVault }) {
  if (!transaction?.meta || transaction.meta.err) return null;
  const keys = transaction.transaction?.message?.accountKeys?.map((entry) => entry?.pubkey?.toBase58?.() ?? String(entry?.pubkey ?? entry)) ?? [];
  const balanceRows = mergeTokenBalances(transaction.meta.preTokenBalances, transaction.meta.postTokenBalances, keys);
  const siamVaultDelta = balanceRows.find((row) => row.address === siamVault && row.mint === siamMint)?.deltaRaw ?? 0n;
  const quoteVaultDelta = balanceRows.find((row) => row.address === antfunVault && row.mint === antfunMint)?.deltaRaw ?? 0n;
  if (siamVaultDelta === 0n || quoteVaultDelta === 0n || sameSign(siamVaultDelta, quoteVaultDelta)) return null;
  const side = siamVaultDelta > 0n ? "sell" : "buy";
  const siamCandidate = largestOpposite(balanceRows.filter((row) => row.mint === siamMint && row.address !== siamVault), siamVaultDelta);
  const walletAddress = siamCandidate?.owner ?? null;
  const quoteCandidate = largestForOwner(balanceRows.filter((row) => row.mint === antfunMint && row.address !== antfunVault), walletAddress, quoteVaultDelta);
  const tokenAmountRaw = absolute(siamCandidate?.deltaRaw ?? siamVaultDelta);
  const quoteAmountRaw = absolute(quoteCandidate?.deltaRaw ?? quoteVaultDelta);
  if (!walletAddress || tokenAmountRaw <= 0n || quoteAmountRaw <= 0n) return null;
  return {
    signature,
    slot: transaction.slot,
    blockTime: isoBlockTime(transaction.blockTime),
    kind: "swap",
    walletAddress,
    side,
    tokenAmountRaw: tokenAmountRaw.toString(),
    quoteAmountRaw: quoteAmountRaw.toString(),
    tokenPriceInQuote: Number(quoteAmountRaw) / Number(tokenAmountRaw),
  };
}

export function computeProfitability(activities, holders, { siamInUsdt, antfunInUsdt } = {}) {
  const holdingIndexed = Array.isArray(holders);
  const currentHolding = new Map((holders ?? []).map((item) => [item.address, BigInt(item.amountRaw)]));
  const wallets = new Map();
  const ordered = [...(activities ?? [])].sort((a, b) => Date.parse(a.blockTime ?? 0) - Date.parse(b.blockTime ?? 0));
  for (const item of ordered) {
    if (!item.walletAddress || !/^\d+$/.test(String(item.tokenAmountRaw)) || !/^\d+$/.test(String(item.quoteAmountRaw))) continue;
    const row = wallets.get(item.walletAddress) ?? {
      address: item.walletAddress, buys: 0, sells: 0, buyRaw: 0n, sellRaw: 0n,
      trackedRaw: 0n, costQuoteRaw: 0, realizedQuoteRaw: 0, uncoveredSellRaw: 0n,
      firstActivityAt: item.blockTime, lastActivityAt: item.blockTime,
    };
    const tokenRaw = BigInt(item.tokenAmountRaw);
    const quoteRaw = Number(item.quoteAmountRaw);
    if (item.side === "buy") {
      row.buys += 1;
      row.buyRaw += tokenRaw;
      row.trackedRaw += tokenRaw;
      row.costQuoteRaw += quoteRaw;
    } else if (item.side === "sell") {
      row.sells += 1;
      row.sellRaw += tokenRaw;
      const matched = tokenRaw < row.trackedRaw ? tokenRaw : row.trackedRaw;
      if (matched > 0n && row.trackedRaw > 0n) {
        const fraction = Number(matched) / Number(tokenRaw);
        const matchedProceeds = quoteRaw * fraction;
        const matchedCost = row.costQuoteRaw * (Number(matched) / Number(row.trackedRaw));
        row.realizedQuoteRaw += matchedProceeds - matchedCost;
        row.costQuoteRaw -= matchedCost;
        row.trackedRaw -= matched;
      }
      if (tokenRaw > matched) row.uncoveredSellRaw += tokenRaw - matched;
    }
    row.lastActivityAt = item.blockTime;
    wallets.set(item.walletAddress, row);
  }
  const tokenQuoteNow = finite(siamInUsdt) != null && finite(antfunInUsdt) > 0 ? siamInUsdt / antfunInUsdt : null;
  const result = [...wallets.values()].map((row) => {
    const unrealizedQuoteRaw = tokenQuoteNow == null ? null : Number(row.trackedRaw) * tokenQuoteNow - row.costQuoteRaw;
    const totalQuoteRaw = unrealizedQuoteRaw == null ? null : row.realizedQuoteRaw + unrealizedQuoteRaw;
    const quoteToUsdt = finite(antfunInUsdt);
    const scale = 10 ** QUOTE_DECIMALS;
    return {
      address: row.address,
      buys: row.buys,
      sells: row.sells,
      currentHoldingRaw: holdingIndexed ? (currentHolding.get(row.address) ?? 0n).toString() : null,
      currentHoldingUi: holdingIndexed ? rawToUi(currentHolding.get(row.address) ?? 0n, TOKEN_DECIMALS) : null,
      trackedPositionRaw: row.trackedRaw.toString(),
      trackedPositionUi: rawToUi(row.trackedRaw, TOKEN_DECIMALS),
      realizedPnlUsdt: quoteToUsdt == null ? null : row.realizedQuoteRaw / scale * quoteToUsdt,
      unrealizedPnlUsdt: quoteToUsdt == null || unrealizedQuoteRaw == null ? null : unrealizedQuoteRaw / scale * quoteToUsdt,
      estimatedPnlUsdt: quoteToUsdt == null || totalQuoteRaw == null ? null : totalQuoteRaw / scale * quoteToUsdt,
      coverage: row.uncoveredSellRaw > 0n ? "partial" : "window",
      firstActivityAt: row.firstActivityAt,
      lastActivityAt: row.lastActivityAt,
    };
  }).sort((a, b) => (b.estimatedPnlUsdt ?? -Infinity) - (a.estimatedPnlUsdt ?? -Infinity));
  return { wallets: result, profitable: result.filter((item) => Number(item.estimatedPnlUsdt) > 0) };
}

export function buildLiquidityHistory(snapshots, maxPoints = 240) {
  const rows = [];
  for (const snapshot of snapshots ?? []) {
    const siamPool = snapshot?.pools?.siamAntfun;
    const bridgePool = snapshot?.pools?.antfunUsdt;
    const siam = reserveFor(siamPool, "SIAM");
    const poolAntfun = reserveFor(siamPool, "ANTFUN");
    const bridgeAntfun = reserveFor(bridgePool, "ANTFUN");
    const usdt = reserveFor(bridgePool, "USDT");
    const siamPrice = finite(snapshot?.impliedPrices?.siamInUsdt);
    const antfunPrice = finite(snapshot?.impliedPrices?.antfunInUsdt);
    if (!snapshot?.capturedAt || !siam || !poolAntfun || !bridgeAntfun || !usdt || siamPrice == null || antfunPrice == null) continue;
    const siamPoolUsd = Number(siam.amountUi) * siamPrice + Number(poolAntfun.amountUi) * antfunPrice;
    const bridgePoolUsd = Number(bridgeAntfun.amountUi) * antfunPrice + Number(usdt.amountUi);
    if (![siamPoolUsd, bridgePoolUsd].every(Number.isFinite)) continue;
    rows.push({
      capturedAt: snapshot.capturedAt,
      siamPoolUsd,
      bridgePoolUsd,
      totalLiquidityUsd: siamPoolUsd + bridgePoolUsd,
      siamReserve: Number(siam.amountUi),
      antfunReserve: Number(poolAntfun.amountUi),
      siamPriceUsdt: siamPrice,
    });
  }
  const points = downsample(rows, maxPoints);
  const first = rows[0];
  const current = rows.at(-1);
  return {
    status: current ? "ready" : "warming",
    source: "服务端主网池快照 · vault 储备按快照隐含价估值",
    window: { from: first?.capturedAt ?? null, to: current?.capturedAt ?? null, samples: rows.length },
    current: current ?? null,
    changeBps: first && current && first.totalLiquidityUsd > 0 ? Math.round((current.totalLiquidityUsd / first.totalLiquidityUsd - 1) * 10_000) : null,
    points,
  };
}

function mergeTokenBalances(preRows = [], postRows = [], keys = []) {
  const rows = new Map();
  for (const [phase, balances] of [["pre", preRows ?? []], ["post", postRows ?? []]]) {
    for (const balance of balances) {
      const key = `${balance.accountIndex}:${balance.mint}`;
      const row = rows.get(key) ?? {
        address: keys[balance.accountIndex] ?? String(balance.accountIndex), mint: balance.mint,
        owner: balance.owner ?? null, preRaw: 0n, postRaw: 0n,
      };
      row.owner = balance.owner ?? row.owner;
      const amount = balance.uiTokenAmount?.amount;
      if (/^\d+$/.test(String(amount ?? ""))) row[`${phase}Raw`] = BigInt(amount);
      rows.set(key, row);
    }
  }
  return [...rows.values()].map((row) => ({ ...row, deltaRaw: row.postRaw - row.preRaw }));
}

function largestOpposite(rows, reference) {
  return rows.filter((row) => row.owner && row.deltaRaw !== 0n && !sameSign(row.deltaRaw, reference))
    .sort((a, b) => compareBigInt(absolute(b.deltaRaw), absolute(a.deltaRaw)))[0] ?? null;
}

function largestForOwner(rows, owner, reference) {
  const candidates = rows.filter((row) => row.owner && row.deltaRaw !== 0n && !sameSign(row.deltaRaw, reference));
  const sameOwner = candidates.filter((row) => row.owner === owner);
  return (sameOwner.length ? sameOwner : candidates).sort((a, b) => compareBigInt(absolute(b.deltaRaw), absolute(a.deltaRaw)))[0] ?? null;
}

function enrichActivity(item, antfunInUsdt) {
  const tokenAmountUi = rawToUi(BigInt(item.tokenAmountRaw), TOKEN_DECIMALS);
  const quoteAmountUi = rawToUi(BigInt(item.quoteAmountRaw), QUOTE_DECIMALS);
  return {
    ...item,
    tokenAmountUi,
    quoteAmountUi,
    estimatedUsdt: antfunInUsdt == null ? null : Number(quoteAmountUi) * antfunInUsdt,
  };
}

function activityWindow(items) {
  const times = items.map((item) => item.blockTime).filter(Boolean).sort();
  return { from: times[0] ?? null, to: times.at(-1) ?? null, swaps: items.length };
}

function reserveFor(pool, symbol) {
  return [pool?.tokenA, pool?.tokenB, pool?.tokenX, pool?.tokenY].find((item) => item?.symbol === symbol) ?? null;
}

function downsample(rows, maxPoints) {
  if (rows.length <= maxPoints) return rows;
  const stride = Math.ceil(rows.length / maxPoints);
  const result = rows.filter((_, index) => index % stride === 0);
  if (result.at(-1) !== rows.at(-1)) result.push(rows.at(-1));
  return result;
}

function rawToUi(raw, decimals) {
  const value = typeof raw === "bigint" ? raw : BigInt(raw);
  const scale = 10n ** BigInt(decimals);
  const whole = value / scale;
  const fraction = (value % scale).toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${whole}${fraction ? `.${fraction}` : ""}`;
}

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function absolute(value) { return value < 0n ? -value : value; }
function sameSign(a, b) { return (a > 0n && b > 0n) || (a < 0n && b < 0n); }
function compareBigInt(a, b) { return a < b ? -1 : a > b ? 1 : 0; }
function delay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function isoBlockTime(value) { return Number.isFinite(Number(value)) ? new Date(Number(value) * 1_000).toISOString() : null; }
function isRateLimit(error) { return /429|Too Many Requests/i.test(error instanceof Error ? error.message : String(error)); }
function friendlyRpcError(error, label) {
  const message = error instanceof Error ? error.message : String(error);
  if (/429|Too Many Requests/i.test(message)) return `${label}：公共 RPC 正在限流，保留最近成功数据。`;
  if (/403|personal token|Indexed requests/i.test(message)) return `${label}：当前 RPC 不支持全量索引查询，请配置支持 getProgramAccounts 的 RPC。`;
  return `${label}：${message}`;
}
function withTimeout(promise, ms, message) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), ms); }),
  ]).finally(() => clearTimeout(timer));
}
