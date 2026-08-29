import { TOKENS } from "./config.mjs";

const SCALE = 1_000_000n;
const SYMBOLS = Object.freeze(["BG", "ANTFUN", "USDT"]);

export class RiskAccountingService {
  constructor(config, store) {
    this.config = config;
    this.store = store;
  }

  contextFor({ action, quote, snapshot }) {
    const wallet = snapshot?.wallet;
    const prices = priceTable(snapshot?.impliedPrices);
    if (!wallet || !prices) {
      return {
        ready: false,
        inventoryReducing: null,
        sufficientInputBalance: null,
        dailyNotionalUsdtRaw: null,
        proposedNotionalUsdtRaw: null,
        dailyLossBps: null,
        reason: !wallet ? "Wallet balance snapshot is unavailable." : "USDT valuation prices are unavailable.",
      };
    }

    const balances = walletBalances(wallet);
    this.reconcileChainBalances(balances, prices);
    const projected = projectBalances(balances, action, quote);
    const inventory = inventoryDirection(balances, projected, prices, this.config.risk.inventoryTargetsBps, this.config.risk.inventoryToleranceBps);
    const proposedNotionalUsdtRaw = tradeNotional(action, quote, prices);
    const now = new Date();
    const day = accountingDay(now, this.config.accountingTimeZone);
    const openingEquityUsdtRaw = portfolioValue(balances, prices);
    const riskDay = this.store.ensureRiskDay(day.key, openingEquityUsdtRaw);
    const daily = this.store.dailyAccountingBetween(day.start, day.end);
    const opening = BigInt(riskDay.openingEquityUsdtRaw);
    const loss = daily.realizedPnlUsdtRaw < 0n ? -daily.realizedPnlUsdtRaw : 0n;
    const dailyLossBps = opening > 0n ? Number((loss * 10_000n + opening - 1n) / opening) : 0;

    return {
      ready: true,
      inventoryReducing: inventory.allowed,
      sufficientInputBalance: projected.sufficientInput,
      inventoryDistanceBeforeBps: inventory.beforeDistanceBps,
      inventoryDistanceAfterBps: inventory.afterDistanceBps,
      dailyNotionalUsdtRaw: daily.notionalUsdtRaw.toString(),
      proposedNotionalUsdtRaw: proposedNotionalUsdtRaw.toString(),
      dailyLossBps,
      openingEquityUsdtRaw: opening.toString(),
      realizedPnlUsdtRaw: daily.realizedPnlUsdtRaw.toString(),
      accountingDay: day.key,
      inventoryScope: "configured-wallet-known-token-accounts",
    };
  }

  buildExecution({ intent, signature, balanceBefore, balanceAfter }) {
    const action = intent.summary.action;
    const savedPrices = intent.summary.accounting?.prices;
    const prices = savedPrices?.BG
      ? Object.fromEntries(SYMBOLS.map((symbol) => [symbol, BigInt(savedPrices[symbol])]))
      : priceTable(intent.summary.impliedPrices);
    if (!prices) throw new Error("The approved intent has no immutable USDT valuation table.");
    const before = walletBalances(balanceBefore);
    const after = walletBalances(balanceAfter);
    const inputSymbol = action.inputSymbol;
    const outputSymbol = action.kind === "route-swap" ? (inputSymbol === "BG" ? "USDT" : "BG") : action.outputSymbol;
    const amountInRaw = positive(before[inputSymbol] - after[inputSymbol]);
    const amountOutRaw = positive(after[outputSymbol] - before[outputSymbol]);
    if (amountInRaw <= 0n || amountOutRaw <= 0n) throw new Error("Confirmed transaction balance deltas do not match the approved swap direction.");

    const basis = Object.fromEntries(SYMBOLS.map((symbol) => {
      const row = this.store.getCostBasis(symbol);
      return [symbol, row ? { quantityRaw: BigInt(row.quantityRaw), costUsdtRaw: BigInt(row.costUsdtRaw) } : { quantityRaw: before[symbol], costUsdtRaw: valueOf(before[symbol], symbol, prices) }];
    }));
    const costBasisUpdates = SYMBOLS.map((symbol) => ({ symbol, ...basis[symbol] }));
    let realizedPnlUsdtRaw = 0n;
    const removedCost = removeCost(basis[inputSymbol], amountInRaw);

    if (outputSymbol === "USDT") {
      realizedPnlUsdtRaw = amountOutRaw - removedCost;
    } else {
      basis[outputSymbol].quantityRaw += amountOutRaw;
      basis[outputSymbol].costUsdtRaw += inputSymbol === "USDT" ? amountInRaw : removedCost;
    }
    if (inputSymbol === "USDT") {
      basis.USDT.quantityRaw = after.USDT;
      basis.USDT.costUsdtRaw = after.USDT;
    }
    if (outputSymbol === "USDT") {
      basis.USDT.quantityRaw = after.USDT;
      basis.USDT.costUsdtRaw = after.USDT;
    }
    for (const update of costBasisUpdates) {
      update.quantityRaw = basis[update.symbol].quantityRaw.toString();
      update.costUsdtRaw = basis[update.symbol].costUsdtRaw.toString();
    }

    const solBefore = BigInt(balanceBefore?.solRaw ?? "0");
    const solAfter = BigInt(balanceAfter?.solRaw ?? "0");
    return {
      signature,
      inputSymbol,
      outputSymbol,
      amountInRaw: amountInRaw.toString(),
      amountOutRaw: amountOutRaw.toString(),
      notionalUsdtRaw: max(valueOf(amountInRaw, inputSymbol, prices), valueOf(amountOutRaw, outputSymbol, prices)).toString(),
      realizedPnlUsdtRaw: realizedPnlUsdtRaw.toString(),
      solFeeRaw: positive(solBefore - solAfter).toString(),
      balanceBefore,
      balanceAfter,
      costBasisUpdates,
    };
  }

  read(snapshot) {
    const prices = priceTable(snapshot?.impliedPrices);
    const balances = snapshot?.wallet ? walletBalances(snapshot.wallet) : null;
    if (prices && balances) this.reconcileChainBalances(balances, prices);
    const day = accountingDay(new Date(), this.config.accountingTimeZone);
    const daily = this.store.dailyAccountingBetween(day.start, day.end);
    const basis = this.store.listCostBasis();
    const unrealizedPnlUsdtRaw = prices && balances
      ? basis.reduce((total, row) => total + valueOf(balances[row.symbol] ?? 0n, row.symbol, prices) - BigInt(row.costUsdtRaw), 0n)
      : null;
    return {
      status: prices && balances ? "ready" : "degraded",
      day: day.key,
      timeZone: this.config.accountingTimeZone,
      inventoryScope: "configured-wallet-known-token-accounts",
      dailyNotionalUsdtRaw: daily.notionalUsdtRaw.toString(),
      dailyRealizedPnlUsdtRaw: daily.realizedPnlUsdtRaw.toString(),
      dailyExecutions: daily.executions,
      unrealizedPnlUsdtRaw: unrealizedPnlUsdtRaw?.toString() ?? null,
      costBasis: basis,
      balances: balances ? Object.fromEntries(SYMBOLS.map((symbol) => [symbol, balances[symbol].toString()])) : null,
      prices: prices ? Object.fromEntries(SYMBOLS.map((symbol) => [symbol, prices[symbol].toString()])) : null,
    };
  }

  reconcileChainBalances(balances, prices) {
    for (const symbol of SYMBOLS) {
      const current = this.store.getCostBasis(symbol);
      const observed = balances[symbol];
      if (!current) {
        this.store.reconcileCostBasis(symbol, observed, valueOf(observed, symbol, prices), "initial-chain-mark");
        continue;
      }
      const trackedQuantity = BigInt(current.quantityRaw);
      if (trackedQuantity === observed) continue;
      const trackedCost = BigInt(current.costUsdtRaw);
      const newCost = observed > trackedQuantity
        ? trackedCost + valueOf(observed - trackedQuantity, symbol, prices)
        : trackedQuantity > 0n ? trackedCost * observed / trackedQuantity : valueOf(observed, symbol, prices);
      this.store.reconcileCostBasis(symbol, observed, newCost, observed > trackedQuantity ? "external-inflow-mark" : "external-outflow-pro-rata");
    }
  }
}

export function priceTable(implied) {
  if (!implied || !Number.isFinite(Number(implied.bgInUsdt)) || !Number.isFinite(Number(implied.antfunInUsdt))) return null;
  const scaled = (value) => BigInt(Math.max(1, Math.ceil(Number(value) * Number(SCALE))));
  return { BG: scaled(implied.bgInUsdt), ANTFUN: scaled(implied.antfunInUsdt), USDT: SCALE };
}

export function walletBalances(wallet) {
  const balances = { BG: 0n, ANTFUN: 0n, USDT: 0n };
  for (const account of wallet?.tokenAccounts ?? []) {
    if (account.symbol in balances) balances[account.symbol] += BigInt(account.amountRaw ?? "0");
  }
  return balances;
}

function projectBalances(before, action, quote) {
  const after = { ...before };
  const outputSymbol = action.kind === "route-swap" ? (action.inputSymbol === "BG" ? "USDT" : "BG") : action.outputSymbol;
  const outputRaw = BigInt(quote.minOutRaw);
  const inputRaw = BigInt(action.amountInRaw);
  const sufficientInput = before[action.inputSymbol] >= inputRaw;
  after[action.inputSymbol] = before[action.inputSymbol] - inputRaw;
  after[outputSymbol] += outputRaw;
  return { ...after, sufficientInput };
}

function inventoryDirection(before, projected, prices, targets, toleranceBps) {
  const beforeDistanceBps = distanceBps(before, prices, targets);
  const afterDistanceBps = distanceBps(projected, prices, targets);
  return {
    beforeDistanceBps,
    afterDistanceBps,
    allowed: projected.sufficientInput && (beforeDistanceBps <= toleranceBps || afterDistanceBps < beforeDistanceBps),
  };
}

function distanceBps(balances, prices, targets) {
  const values = Object.fromEntries(SYMBOLS.map((symbol) => [symbol, valueOf(balances[symbol], symbol, prices)]));
  const total = SYMBOLS.reduce((sum, symbol) => sum + values[symbol], 0n);
  if (total <= 0n) return 10_000;
  const distance = SYMBOLS.reduce((sum, symbol) => sum + abs(values[symbol] * 10_000n - total * BigInt(targets[symbol])), 0n);
  return Number((distance + total - 1n) / total / 2n);
}

function tradeNotional(action, quote, prices) {
  const outputSymbol = action.kind === "route-swap" ? (action.inputSymbol === "BG" ? "USDT" : "BG") : action.outputSymbol;
  return max(valueOf(BigInt(action.amountInRaw), action.inputSymbol, prices), valueOf(BigInt(quote.minOutRaw), outputSymbol, prices));
}

function portfolioValue(balances, prices) {
  return SYMBOLS.reduce((sum, symbol) => sum + valueOf(balances[symbol], symbol, prices), 0n);
}

function valueOf(amountRaw, symbol, prices) {
  if (!(symbol in TOKENS)) throw new Error(`Unsupported accounting symbol: ${symbol}`);
  return BigInt(amountRaw) * prices[symbol] / SCALE;
}

function removeCost(basis, quantity) {
  if (quantity > basis.quantityRaw) throw new Error("Execution spent more inventory than the cost-basis ledger contains.");
  const removed = quantity === basis.quantityRaw ? basis.costUsdtRaw : basis.costUsdtRaw * quantity / basis.quantityRaw;
  basis.quantityRaw -= quantity;
  basis.costUsdtRaw -= removed;
  return removed;
}

function accountingDay(now, timeZone) {
  const formatter = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
  const key = formatter.format(now);
  const [year, month, day] = key.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + 1, 0, 0, 0));
  const offsetMinutes = timeZoneOffsetMinutes(new Date(Date.UTC(year, month - 1, day, 12)), timeZone);
  const start = new Date(Date.UTC(year, month - 1, day, 0, 0, 0) - offsetMinutes * 60_000).toISOString();
  const end = new Date(next.getTime() - offsetMinutes * 60_000 - 1).toISOString();
  return { key, start, end };
}

function timeZoneOffsetMinutes(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(date).reduce((all, part) => ({ ...all, [part.type]: part.value }), {});
  const asUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
  return Math.round((asUtc - date.getTime()) / 60_000);
}

function positive(value) { return value > 0n ? value : 0n; }
function max(a, b) { return a > b ? a : b; }
function abs(value) { return value < 0n ? -value : value; }
