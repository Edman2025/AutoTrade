import { createRequire } from "node:module";
import { BN } from "@coral-xyz/anchor";
import { CpAmm, PoolStatus } from "@meteora-ag/cp-amm-sdk";
import { Connection, PublicKey, SystemProgram } from "@solana/web3.js";
import { AccountLayout, getAssociatedTokenAddressSync, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { TOKENS, tokenByMint } from "./config.mjs";
import { jsonSafe } from "./json.mjs";

const require = createRequire(import.meta.url);
const DLMM = require("@meteora-ag/dlmm");

const DATA_API = Object.freeze({
  dammV2: "https://damm-v2.datapi.meteora.ag/pools",
  dlmm: "https://dlmm.datapi.meteora.ag/pools",
});

export class MarketDataService {
  constructor(config, connection = new Connection(config.rpcUrl, "confirmed")) {
    this.config = config;
    this.connection = installReadRetries(installDirectAccountFallback(connection));
    this.cpAmm = new CpAmm(this.connection);
  }

  async capture() {
    const capturedAt = new Date().toISOString();
    let slot;
    let blockTime;
    try {
      slot = await this.connection.getSlot("confirmed");
      blockTime = await this.connection.getBlockTime(slot);
    } catch (error) {
      return {
        capturedAt,
        slot: 0,
        blockTime: null,
        network: this.config.network,
        topologyReady: false,
        readOnly: this.config.mode === "observe",
        pools: {},
        errors: [{ pool: "GLOBAL", error: `Solana RPC unavailable: ${messageOf(error)}` }],
        impliedPrices: null,
      };
    }
    const pools = {};
    const errors = [];

    try { pools.bgAntfun = await this.snapshotDammV2(this.config.pools.bgAntfun, slot, blockTime); }
    catch (error) { errors.push({ pool: "BG/ANTFUN", error: messageOf(error) }); }

    try { pools.antfunUsdt = await this.snapshotDlmm(this.config.pools.antfunUsdt, slot); }
    catch (error) { errors.push({ pool: "ANTFUN/USDT", error: messageOf(error) }); }

    let wallet = null;
    if (this.config.walletAddress) {
      try { wallet = await this.snapshotWallet(this.config.walletAddress); }
      catch (error) { errors.push({ pool: "WALLET", error: messageOf(error) }); }
    }

    for (const pool of Object.values(pools)) pool.executable = poolExecutable(pool);

    const topologyReady = Boolean(
      pools.bgAntfun?.executable
      && pools.antfunUsdt?.executable,
    );
    return jsonSafe({
      capturedAt,
      slot,
      blockTime: blockTime == null ? null : new Date(blockTime * 1_000).toISOString(),
      network: this.config.network,
      topologyReady,
      readOnly: this.config.mode === "observe",
      pools,
      wallet,
      errors,
      impliedPrices: impliedPrices(pools),
    });
  }

  async snapshotDammV2(poolConfig, slot = null, blockTime = null) {
    const address = new PublicKey(poolConfig.address);
    const [accountInfo, state] = await Promise.all([
      this.connection.getAccountInfo(address, "confirmed"),
      this.cpAmm.fetchPoolState(address),
    ]);
    if (!accountInfo) throw new Error("Pool account does not exist.");
    const tokenA = tokenByMint(state.tokenAMint.toBase58());
    const tokenB = tokenByMint(state.tokenBMint.toBase58());
    const expectedMints = [TOKENS[poolConfig.tokenX].mint, TOKENS[poolConfig.tokenY].mint].sort();
    const actualMints = [tokenA.mint, tokenB.mint].sort();
    const ownerVerified = accountInfo.owner.toBase58() === poolConfig.programId;
    const mintPairVerified = expectedMints.join(":") === actualMints.join(":");
    const [reserveA, reserveB] = await Promise.all([
      this.tokenAccountAmount(state.tokenAVault),
      this.tokenAccountAmount(state.tokenBVault),
    ]);
    const effectiveSlot = slot ?? await this.connection.getSlot("confirmed");
    const effectiveBlockTime = blockTime ?? await this.connection.getBlockTime(effectiveSlot) ?? Math.floor(Date.now() / 1_000);
    const quotes = await this.cpQuoteMatrix({ state, slot: effectiveSlot, blockTime: effectiveBlockTime, tokenA, tokenB });
    const positions = this.config.walletAddress && this.config.enablePositionIndex
      ? await this.cpAmm.getUserPositionByPool(address, new PublicKey(this.config.walletAddress)).then((items) => items.map(serializeCpPosition))
      : [];

    return {
      address: poolConfig.address,
      pair: `${poolConfig.tokenX}/${poolConfig.tokenY}`,
      kind: "damm-v2",
      programId: accountInfo.owner.toBase58(),
      identity: {
        verified: ownerVerified && mintPairVerified,
        ownerVerified,
        mintPairVerified,
        expectedProgramId: poolConfig.programId,
        expectedMints,
        actualMints,
      },
      enabled: Number(state.poolStatus) === PoolStatus.Enable,
      collectFeeMode: Number(state.collectFeeMode),
      tokenA: reserveRecord(tokenA, reserveA, state.tokenAVault),
      tokenB: reserveRecord(tokenB, reserveB, state.tokenBVault),
      price: reservePrice(tokenA, reserveA, tokenB, reserveB),
      liquidityRaw: state.liquidity?.toString?.() ?? String(state.liquidity),
      sqrtPriceRaw: state.sqrtPrice?.toString?.() ?? String(state.sqrtPrice),
      quotes,
      positions,
      positionsIndexed: Boolean(this.config.enablePositionIndex),
    };
  }

  async snapshotDlmm(poolConfig, slot = null) {
    const address = new PublicKey(poolConfig.address);
    const [accountInfo, instance] = await Promise.all([
      this.connection.getAccountInfo(address, "confirmed"),
      DLMM.create(this.connection, address),
    ]);
    if (!accountInfo) throw new Error("Pool account does not exist.");
    const tokenX = tokenByMint(instance.tokenX.publicKey.toBase58());
    const tokenY = tokenByMint(instance.tokenY.publicKey.toBase58());
    const expectedMints = [TOKENS[poolConfig.tokenX].mint, TOKENS[poolConfig.tokenY].mint].sort();
    const actualMints = [tokenX.mint, tokenY.mint].sort();
    const ownerVerified = accountInfo.owner.toBase58() === poolConfig.programId;
    const mintPairVerified = expectedMints.join(":") === actualMints.join(":");
    const activeBin = await instance.getActiveBin();
    const effectiveSlot = slot ?? await this.connection.getSlot("confirmed");
    const quotes = await this.dlmmQuoteMatrix(instance, tokenX, tokenY);
    const userPositions = this.config.walletAddress && this.config.enablePositionIndex
      ? await instance.getPositionsByUserAndLbPair(new PublicKey(this.config.walletAddress)).then((result) => (result.userPositions ?? []).map(serializeDlmmPosition))
      : [];

    return {
      address: poolConfig.address,
      pair: `${poolConfig.tokenX}/${poolConfig.tokenY}`,
      kind: "dlmm",
      programId: accountInfo.owner.toBase58(),
      identity: {
        verified: ownerVerified && mintPairVerified,
        ownerVerified,
        mintPairVerified,
        expectedProgramId: poolConfig.programId,
        expectedMints,
        actualMints,
      },
      enabled: Number(instance.lbPair.status) === 0,
      activeBin: {
        binId: activeBin.binId,
        price: String(activeBin.price),
        pricePerToken: String(activeBin.pricePerToken),
        xAmountRaw: activeBin.xAmount?.toString?.() ?? null,
        yAmountRaw: activeBin.yAmount?.toString?.() ?? null,
      },
      tokenX: reserveRecord(tokenX, instance.tokenX.amount, instance.tokenX.reserve),
      tokenY: reserveRecord(tokenY, instance.tokenY.amount, instance.tokenY.reserve),
      price: reservePrice(tokenX, instance.tokenX.amount, tokenY, instance.tokenY.amount),
      currentSlot: effectiveSlot,
      quotes,
      positions: userPositions,
      positionsIndexed: Boolean(this.config.enablePositionIndex),
    };
  }

  async cpQuote(poolAddress, inputMint, amountInRaw, slippageBps) {
    const state = await this.cpAmm.fetchPoolState(new PublicKey(poolAddress));
    const tokenA = tokenByMint(state.tokenAMint.toBase58());
    const tokenB = tokenByMint(state.tokenBMint.toBase58());
    const slot = await this.connection.getSlot("confirmed");
    const blockTime = await this.connection.getBlockTime(slot) ?? Math.floor(Date.now() / 1_000);
    return quoteCp(this.cpAmm, state, tokenA, tokenB, inputMint, BigInt(amountInRaw), slippageBps, slot, blockTime);
  }

  async dlmmQuote(poolAddress, inputMint, amountInRaw, slippageBps) {
    const instance = await DLMM.create(this.connection, new PublicKey(poolAddress));
    const tokenX = tokenByMint(instance.tokenX.publicKey.toBase58());
    const tokenY = tokenByMint(instance.tokenY.publicKey.toBase58());
    return quoteDlmm(instance, tokenX, tokenY, inputMint, BigInt(amountInRaw), slippageBps);
  }

  async probeConfiguredTopology() {
    const results = [];
    for (const [key, pool] of Object.entries(this.config.pools)) {
      const baseUrl = pool.kind === "damm-v2" ? DATA_API.dammV2 : DATA_API.dlmm;
      const candidate = await discoverPoolByAddress(baseUrl, pool);
      results.push({
        key,
        pair: `${pool.tokenX}/${pool.tokenY}`,
        expected: pool,
        indexed: candidate,
        indexReady: Boolean(candidate?.hasIndexedLiquidity),
      });
    }
    return jsonSafe({ checkedAt: new Date().toISOString(), topologyReadyInIndex: results.every((item) => item.indexReady), pools: results });
  }

  async tokenAccountAmount(address) {
    const account = await this.connection.getAccountInfo(address, "confirmed");
    if (!account) throw new Error(`Token account does not exist: ${address.toBase58()}`);
    return BigInt(AccountLayout.decode(account.data).amount.toString());
  }

  async snapshotWallet(address) {
    const owner = new PublicKey(address);
    const tokenEntries = Object.entries(TOKENS);
    const mintKeys = tokenEntries.map(([, token]) => new PublicKey(token.mint));
    const [solRaw, ownerInfo, mintAccounts] = await Promise.all([
      this.connection.getBalance(owner, "confirmed"),
      this.connection.getAccountInfo(owner, "confirmed"),
      this.connection.getMultipleAccountsInfo(mintKeys, "confirmed"),
    ]);
    const associatedAccounts = tokenEntries.map(([, token], index) => {
      const programId = mintAccounts[index]?.owner;
      if (!programId || ![TOKEN_PROGRAM_ID.toBase58(), TOKEN_2022_PROGRAM_ID.toBase58()].includes(programId.toBase58())) {
        throw new Error(`Unsupported token program for ${token.mint}.`);
      }
      return getAssociatedTokenAddressSync(new PublicKey(token.mint), owner, false, programId);
    });
    const parsed = await this.connection.getMultipleParsedAccounts(associatedAccounts, "confirmed");
    return {
      address,
      addressVerified: Boolean(ownerInfo && ownerInfo.owner.equals(SystemProgram.programId) && solRaw > 0),
      ownerProgram: ownerInfo?.owner?.toBase58?.() ?? null,
      solRaw: String(solRaw),
      solUi: rawToUi(BigInt(solRaw), 9),
      tokenAccounts: aggregateParsedTokenAccounts(parsed.value.filter(Boolean).map((account) => ({ account }))),
      discovery: "known-associated-token-accounts",
    };
  }

  async tokenIntelligence(symbol = "BG") {
    const token = TOKENS[symbol];
    if (!token) throw Object.assign(new Error(`Unsupported token symbol: ${symbol}`), { statusCode: 400 });
    const mint = new PublicKey(token.mint);
    const capturedAt = new Date().toISOString();
    const warnings = [];
    let mintAccount = null;
    let supply = null;
    let largest = [];

    const results = await Promise.allSettled([
      this.connection.getParsedAccountInfo(mint, "confirmed"),
      this.connection.getTokenSupply(mint, "confirmed"),
      this.connection.getTokenLargestAccounts(mint, "confirmed"),
    ]);
    if (results[0].status === "fulfilled") mintAccount = results[0].value?.value ?? null;
    else warnings.push(rpcCapabilityWarning("Mint 账户", results[0].reason));
    if (results[1].status === "fulfilled") supply = results[1].value?.value ?? null;
    if (results[2].status === "fulfilled") largest = results[2].value?.value ?? [];
    else warnings.push(rpcCapabilityWarning("最大账户索引", results[2].reason));

    const info = mintAccount?.data?.parsed?.info ?? null;
    if (results[1].status === "rejected" && !info?.supply) warnings.push(rpcCapabilityWarning("供应量", results[1].reason));
    const supplyRaw = supply?.amount ?? info?.supply ?? null;
    const rankedAccounts = largest.map((item, index) => ({
      rank: index + 1,
      address: item.address?.toBase58?.() ?? String(item.address),
      amountRaw: item.amount,
      amountUi: item.uiAmountString ?? rawToUi(BigInt(item.amount), token.decimals),
      shareBps: shareBps(item.amount, supplyRaw),
    }));
    const topTenRaw = rankedAccounts.slice(0, 10).reduce((total, item) => total + BigInt(item.amountRaw), 0n);
    const programId = mintAccount?.owner?.toBase58?.() ?? null;

    return jsonSafe({
      capturedAt,
      network: this.config.network,
      symbol,
      mint: token.mint,
      decimals: supply?.decimals ?? info?.decimals ?? token.decimals,
      programId,
      tokenProgram: programId === TOKEN_2022_PROGRAM_ID.toBase58() ? "token-2022" : programId === TOKEN_PROGRAM_ID.toBase58() ? "spl-token" : "unknown",
      initialized: info?.isInitialized ?? null,
      supplyRaw,
      supplyUi: supply?.uiAmountString ?? (supplyRaw ? rawToUi(BigInt(supplyRaw), token.decimals) : null),
      mintAuthority: info?.mintAuthority ?? null,
      freezeAuthority: info?.freezeAuthority ?? null,
      authoritiesRevoked: info ? !info.mintAuthority && !info.freezeAuthority : null,
      largestAccounts: rankedAccounts,
      concentration: {
        top1Bps: rankedAccounts[0]?.shareBps ?? null,
        top5Bps: rankedAccounts.length ? shareBps(rankedAccounts.slice(0, 5).reduce((total, item) => total + BigInt(item.amountRaw), 0n), supplyRaw) : null,
        top10Bps: rankedAccounts.length ? shareBps(topTenRaw, supplyRaw) : null,
        accountsSampled: rankedAccounts.length,
      },
      warnings,
    });
  }

  async executionInfrastructure() {
    const capturedAt = new Date().toISOString();
    const warnings = [];
    let latestBlockhash = null;
    let fees = [];
    const results = await Promise.allSettled([
      this.connection.getLatestBlockhashAndContext("confirmed"),
      this.connection.getRecentPrioritizationFees(),
    ]);
    if (results[0].status === "fulfilled") latestBlockhash = results[0].value;
    else warnings.push(`Latest blockhash: ${messageOf(results[0].reason)}`);
    if (results[1].status === "fulfilled") fees = results[1].value ?? [];
    else warnings.push(`Priority fees: ${messageOf(results[1].reason)}`);
    const samples = fees.map((item) => Number(item.prioritizationFee)).filter(Number.isFinite).sort((a, b) => a - b);

    return jsonSafe({
      capturedAt,
      network: this.config.network,
      rpcPolicy: this.config.rpcPolicyMode,
      latestSlot: latestBlockhash?.context?.slot ?? null,
      lastValidBlockHeight: latestBlockhash?.value?.lastValidBlockHeight ?? null,
      priorityFeeMicroLamports: {
        p50: percentile(samples, 0.5),
        p75: percentile(samples, 0.75),
        p90: percentile(samples, 0.9),
        max: samples.at(-1) ?? null,
        sampleCount: samples.length,
      },
      deliveryChannels: {
        standardRpc: { configured: true, ready: Boolean(this.config.rpcPolicyVerified) },
        jito: { configured: false, ready: false, reason: "尚未配置 Jito Block Engine；不会静默改用第三方提交通道。" },
        nozomi: { configured: false, ready: false, reason: "尚未配置 Nozomi；不会向未授权端点发送已签名交易。" },
      },
      signing: { mode: "external", browserSigning: false, bundleBroadcast: false },
      warnings,
    });
  }

  async cpQuoteMatrix({ state, slot, blockTime, tokenA, tokenB }) {
    const inputs = [tokenA, tokenB];
    const matrix = [];
    for (const input of inputs) {
      for (const amountUi of quoteSizes(input.symbol)) {
        try {
          matrix.push(quoteCp(this.cpAmm, state, tokenA, tokenB, input.mint, uiToRaw(amountUi, input.decimals), this.config.risk.maxSlippageBps, slot, blockTime));
        } catch (error) {
          matrix.push({ inputSymbol: input.symbol, amountUi, error: messageOf(error) });
        }
      }
    }
    return matrix;
  }

  async dlmmQuoteMatrix(instance, tokenX, tokenY) {
    const matrix = [];
    for (const input of [tokenX, tokenY]) {
      for (const amountUi of quoteSizes(input.symbol)) {
        try { matrix.push(await quoteDlmm(instance, tokenX, tokenY, input.mint, uiToRaw(amountUi, input.decimals), this.config.risk.maxSlippageBps)); }
        catch (error) { matrix.push({ inputSymbol: input.symbol, amountUi, error: messageOf(error) }); }
      }
    }
    return matrix;
  }
}

function quoteCp(cpAmm, state, tokenA, tokenB, inputMint, amountInRaw, slippageBps, slot, blockTime) {
  const input = tokenByMint(inputMint);
  const output = input.mint === tokenA.mint ? tokenB : tokenA;
  const quote = cpAmm.getQuote({
    inAmount: new BN(amountInRaw.toString()),
    inputTokenMint: new PublicKey(input.mint),
    slippage: slippageBps,
    poolState: state,
    currentTime: blockTime,
    currentSlot: slot,
    tokenADecimal: tokenA.decimals,
    tokenBDecimal: tokenB.decimals,
    hasReferral: false,
  });
  return {
    quotedAt: new Date().toISOString(),
    inputSymbol: input.symbol,
    outputSymbol: output.symbol,
    inputMint: input.mint,
    outputMint: output.mint,
    amountInRaw: amountInRaw.toString(),
    amountInUi: rawToUi(amountInRaw, input.decimals),
    expectedOutRaw: quote.swapOutAmount.toString(),
    expectedOutUi: rawToUi(BigInt(quote.swapOutAmount.toString()), output.decimals),
    minOutRaw: quote.minSwapOutAmount.toString(),
    minOutUi: rawToUi(BigInt(quote.minSwapOutAmount.toString()), output.decimals),
    feeRaw: quote.totalFee.toString(),
    priceImpactBps: percentToBps(quote.priceImpact),
    slippageBps,
  };
}

async function quoteDlmm(instance, tokenX, tokenY, inputMint, amountInRaw, slippageBps) {
  const input = tokenByMint(inputMint);
  const swapForY = input.mint === tokenX.mint;
  const output = swapForY ? tokenY : tokenX;
  const bins = await instance.getBinArrayForSwap(swapForY, 4);
  const quote = instance.swapQuote(new BN(amountInRaw.toString()), swapForY, new BN(slippageBps), bins, false);
  const consumed = BigInt(quote.consumedInAmount.toString());
  if (consumed !== amountInRaw) throw new Error("Pool cannot consume the full input amount.");
  return {
    quotedAt: new Date().toISOString(),
    inputSymbol: input.symbol,
    outputSymbol: output.symbol,
    inputMint: input.mint,
    outputMint: output.mint,
    amountInRaw: amountInRaw.toString(),
    amountInUi: rawToUi(amountInRaw, input.decimals),
    expectedOutRaw: quote.outAmount.toString(),
    expectedOutUi: rawToUi(BigInt(quote.outAmount.toString()), output.decimals),
    minOutRaw: quote.minOutAmount.toString(),
    minOutUi: rawToUi(BigInt(quote.minOutAmount.toString()), output.decimals),
    feeRaw: quote.fee.toString(),
    priceImpactBps: percentToBps(quote.priceImpact),
    slippageBps,
    binArrays: quote.binArraysPubkey.map((key) => key.toBase58()),
  };
}

async function discoverPoolByAddress(baseUrl, poolConfig) {
  const response = await fetch(`${baseUrl}?query=${poolConfig.address}&page_size=10`, { signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`${poolConfig.kind} Data API returned HTTP ${response.status}.`);
  const body = await response.json();
  const expectedMints = [TOKENS[poolConfig.tokenX].mint, TOKENS[poolConfig.tokenY].mint].sort();
  const pool = (body.data ?? []).find((item) => {
    const actualMints = [item.token_x?.address, item.token_y?.address].sort();
    return item.address === poolConfig.address && actualMints.join(":") === expectedMints.join(":");
  });
  if (!pool) return null;
  return {
    kind: poolConfig.kind,
    address: pool.address,
    name: pool.name,
    tvlUsd: Number(pool.tvl ?? 0),
    volume24hUsd: Number(pool.volume?.["24h"] ?? 0),
    hasIndexedLiquidity: Number(pool.tvl ?? 0) > 1 || Number(pool.volume?.["24h"] ?? 0) > 1,
    poolConfig: pool.pool_config ?? null,
  };
}

function reserveRecord(token, amount, vault) {
  return {
    symbol: token.symbol,
    mint: token.mint,
    decimals: token.decimals,
    vault: vault.toBase58(),
    amountRaw: BigInt(amount).toString(),
    amountUi: rawToUi(BigInt(amount), token.decimals),
  };
}

export function percentToBps(value) {
  const text = String(value?.toString?.() ?? value);
  if (!/^\d+(?:\.\d+)?$/.test(text)) throw new Error("Price impact must be a non-negative percentage.");
  const [whole, fraction = ""] = text.split(".");
  const digits = `${fraction}000`;
  const rounded = BigInt(digits.slice(0, 2)) + (Number(digits[2]) >= 5 ? 1n : 0n);
  const result = BigInt(whole) * 100n + rounded;
  if (result > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("Price impact exceeds the supported range.");
  return Number(result);
}

export function aggregateParsedTokenAccounts(accounts) {
  const totals = new Map();
  for (const account of accounts) {
    const info = account?.account?.data?.parsed?.info;
    if (!info?.mint || !info?.tokenAmount?.amount) continue;
    let token;
    try { token = tokenByMint(info.mint); } catch { continue; }
    const current = totals.get(info.mint) ?? { symbol: token.symbol, mint: token.mint, decimals: token.decimals, amountRaw: 0n, accounts: 0 };
    current.amountRaw += BigInt(info.tokenAmount.amount);
    current.accounts += 1;
    totals.set(info.mint, current);
  }
  return [...totals.values()].map((item) => ({
    symbol: item.symbol,
    mint: item.mint,
    decimals: item.decimals,
    amountRaw: item.amountRaw.toString(),
    amountUi: rawToUi(item.amountRaw, item.decimals),
    accounts: item.accounts,
  }));
}

export function poolExecutable(pool) {
  if (!pool?.identity?.verified || !pool.enabled) return false;
  const reserves = [pool.tokenA, pool.tokenB, pool.tokenX, pool.tokenY].filter(Boolean);
  if (reserves.length !== 2 || reserves.some((reserve) => BigInt(reserve.amountRaw ?? "0") <= 0n)) return false;
  const successfulQuotes = (pool.quotes ?? []).filter((quote) => !quote.error && BigInt(quote.expectedOutRaw ?? "0") > 0n);
  return reserves.every((reserve) => successfulQuotes.some((quote) => quote.inputSymbol === reserve.symbol));
}

function reservePrice(tokenA, reserveA, tokenB, reserveB) {
  if (BigInt(reserveA) === 0n || BigInt(reserveB) === 0n) return null;
  const a = Number(rawToUi(BigInt(reserveA), tokenA.decimals));
  const b = Number(rawToUi(BigInt(reserveB), tokenB.decimals));
  return {
    base: tokenA.symbol,
    quote: tokenB.symbol,
    baseInQuote: b / a,
    quoteInBase: a / b,
  };
}

function serializeCpPosition(item) {
  const state = item.positionState;
  return {
    position: item.position.toBase58(),
    positionNftAccount: item.positionNftAccount.toBase58(),
    pool: state.pool.toBase58(),
    nftMint: state.nftMint.toBase58(),
    liquidityRaw: state.unlockedLiquidity?.toString?.() ?? state.liquidity?.toString?.() ?? "0",
    permanentLockedLiquidityRaw: state.permanentLockedLiquidity?.toString?.() ?? "0",
  };
}

function serializeDlmmPosition(item) {
  const data = item.positionData ?? item;
  return {
    position: item.publicKey?.toBase58?.() ?? data.publicKey?.toBase58?.() ?? null,
    lowerBinId: data.lowerBinId,
    upperBinId: data.upperBinId,
    totalXAmountRaw: data.totalXAmount?.toString?.() ?? null,
    totalYAmountRaw: data.totalYAmount?.toString?.() ?? null,
    feeXRaw: data.feeX?.toString?.() ?? null,
    feeYRaw: data.feeY?.toString?.() ?? null,
  };
}

export function impliedPrices(pools) {
  const bg = pools.bgAntfun?.price;
  const antfunUsdt = pools.antfunUsdt?.price;
  if (!bg || !antfunUsdt) return null;
  const bgInAntfun = priceFor(bg, "BG");
  const antfunInUsdt = priceFor(antfunUsdt, "ANTFUN");
  if (![bgInAntfun, antfunInUsdt].every((value) => Number.isFinite(value) && value > 0)) return null;
  return { bgInAntfun, antfunInUsdt, bgInUsdt: bgInAntfun * antfunInUsdt };
}

function priceFor(price, symbol) {
  if (price.base === symbol) return price.baseInQuote;
  if (price.quote === symbol) return price.quoteInBase;
  return NaN;
}

function quoteSizes(symbol) {
  if (symbol === "USDT") return [1];
  return [100];
}

function shareBps(amount, supply) {
  if (amount == null || supply == null) return null;
  const total = BigInt(supply);
  if (total <= 0n) return null;
  return Number((BigInt(amount) * 10_000n + total / 2n) / total);
}

function percentile(values, ratio) {
  if (!values.length) return null;
  const index = Math.max(0, Math.min(values.length - 1, Math.ceil(values.length * ratio) - 1));
  return values[index];
}

export function uiToRaw(amount, decimals) {
  const text = String(amount);
  const [whole, fraction = ""] = text.split(".");
  const padded = (fraction + "0".repeat(decimals)).slice(0, decimals);
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(padded || "0");
}

export function rawToUi(amount, decimals) {
  const negative = amount < 0n;
  const value = negative ? -amount : amount;
  const divisor = 10n ** BigInt(decimals);
  const whole = value / divisor;
  const fraction = (value % divisor).toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole}${fraction ? `.${fraction}` : ""}`;
}

function messageOf(error) { return error instanceof Error ? error.message : String(error); }

function rpcCapabilityWarning(label, error) {
  const message = messageOf(error);
  if (/Indexed requests require a personal token|403 Forbidden/i.test(message)) return `${label}：当前公共 RPC 不支持该索引查询。`;
  if (/429|Too Many Requests/i.test(message)) return `${label}：公共 RPC 正在限流，请稍后重试。`;
  return `${label}：${message.split("\n", 1)[0].slice(0, 180)}`;
}

function installDirectAccountFallback(connection) {
  const marker = Symbol.for("autotrade.fixed-account-rpc-fallback");
  if (connection[marker] || typeof connection.getMultipleAccountsInfo !== "function") return connection;
  const native = connection.getMultipleAccountsInfo.bind(connection);
  connection.getMultipleAccountsInfo = async (publicKeys, commitmentOrConfig) => {
    try {
      return await native(publicKeys, commitmentOrConfig);
    } catch (error) {
      const blocked = /Request blocked|Indexed requests require a personal token/.test(messageOf(error));
      if (!blocked || publicKeys.length > 32) throw error;
      return Promise.all(publicKeys.map((publicKey) => connection.getAccountInfo(publicKey, commitmentOrConfig)));
    }
  };
  Object.defineProperty(connection, marker, { value: true });
  return connection;
}

function installReadRetries(connection) {
  const marker = Symbol.for("autotrade.rpc-read-retries");
  if (connection[marker]) return connection;
  for (const method of [
    "getAccountInfo", "getBalance", "getBlockTime", "getMultipleAccountsInfo", "getMultipleParsedAccounts", "getSlot",
    "getParsedAccountInfo", "getTokenSupply", "getTokenLargestAccounts", "getLatestBlockhashAndContext", "getRecentPrioritizationFees",
  ]) {
    if (typeof connection[method] !== "function") continue;
    const native = connection[method].bind(connection);
    connection[method] = (...args) => retryRpcRead(() => native(...args));
  }
  Object.defineProperty(connection, marker, { value: true });
  return connection;
}

export async function retryRpcRead(operation, { attempts = 3, delayMs = 250 } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt === attempts || !isRetryableRpcError(error)) throw error;
      await new Promise((resolve) => setTimeout(resolve, delayMs * attempt));
    }
  }
  throw lastError;
}

function isRetryableRpcError(error) {
  return /fetch failed|timed? ?out|ECONNRESET|ECONNREFUSED|EAI_AGAIN|socket hang up|HTTP 429|HTTP 5\d\d/i.test(messageOf(error));
}
