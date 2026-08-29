export class RiskEngine {
  constructor(config, store) {
    this.config = config;
    this.store = store;
  }

  evaluate(action, context) {
    const reasons = [];
    const risk = this.config.risk;
    const control = this.store.controlState();
    const now = context.now ?? Date.now();

    if (this.config.mode === "observe") reasons.push("System is in observe mode.");
    if (control.paused) reasons.push(`System is paused: ${control.pauseReason}`);
    if (control.consecutiveFailures >= risk.maxConsecutiveFailures) reasons.push("Consecutive failure circuit breaker is open.");
    if (control.lastExecutionAt && now - Date.parse(control.lastExecutionAt) < risk.cooldownMs) reasons.push("Execution cooldown is active.");
    if (!context.identityVerified) reasons.push("Pool identity or program whitelist verification failed.");
    if (!context.topologyVerified) reasons.push("The complete BG/ANTFUN and ANTFUN/USDT topology is not verified.");
    if (this.config.mode === "live" && !context.rpcPolicyVerified) reasons.push("Live execution requires either an authenticated private RPC or an explicit public-RPC risk acceptance.");
    if (this.config.mode === "live" && !context.walletIdentityVerified) reasons.push("The configured maker wallet is not verified as a funded Solana mainnet system account.");
    if (now - Date.parse(context.quotedAt) > risk.quoteStaleMs) reasons.push("Quote is stale.");
    if (action.slippageBps > risk.maxSlippageBps) reasons.push("Requested slippage exceeds the configured maximum.");
    if (context.priceImpactBps > risk.maxPriceImpactBps) reasons.push("Price impact exceeds the configured maximum.");
    if (context.walletSolRaw != null && BigInt(context.walletSolRaw) < risk.minSolReserveRaw) reasons.push("SOL fee reserve is below its floor.");

    const inputRaw = BigInt(action.amountInRaw);
    if (action.inputSymbol === "BG" && inputRaw > risk.maxTradeBgRaw) reasons.push("BG trade size exceeds the single-trade limit.");
    if (action.inputSymbol === "ANTFUN" && inputRaw > risk.maxTradeAntfunRaw) reasons.push("ANTFUN trade size exceeds the single-trade limit.");
    if (action.inputSymbol === "USDT" && inputRaw > risk.maxTradeUsdtRaw) reasons.push("USDT trade size exceeds the single-trade limit.");
    if (context.sufficientInputBalance === false) reasons.push("Configured wallet balance is below the approved input amount.");
    if (context.dailyNotionalUsdtRaw != null && BigInt(context.dailyNotionalUsdtRaw) + BigInt(context.proposedNotionalUsdtRaw ?? "0") > risk.maxDailyNotionalUsdtRaw) reasons.push("Daily USDT notional limit would be exceeded by this action.");
    if (context.dailyLossBps != null && Number(context.dailyLossBps) >= risk.dailyLossLimitBps) reasons.push("Daily loss circuit breaker is open.");
    if (context.inventoryReducing === false) reasons.push("Action would increase an already out-of-band inventory exposure.");
    if (this.config.mode === "live" && context.inventoryReducing == null) reasons.push("Live inventory-direction check is unavailable.");
    if (this.config.mode === "live" && context.dailyNotionalUsdtRaw == null) reasons.push("Live USDT daily-notional accounting is unavailable.");
    if (this.config.mode === "live" && context.dailyLossBps == null) reasons.push("Live daily-loss accounting is unavailable.");

    return {
      passed: reasons.length === 0,
      reasons,
      checkedAt: new Date(now).toISOString(),
      gates: {
        mode: this.config.mode,
        paused: control.paused,
        quoteAgeMs: Math.max(0, now - Date.parse(context.quotedAt)),
        maxSlippageBps: risk.maxSlippageBps,
        maxPriceImpactBps: risk.maxPriceImpactBps,
        rpcPolicyMode: this.config.rpcPolicyMode ?? "unverified",
      },
    };
  }
}
