import { useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  ArrowRight,
  Bell,
  ChartLineUp,
  CheckCircle,
  CirclesFour,
  Clock,
  Database,
  GearSix,
  Lightning,
  ListBullets,
  LockKey,
  Plus,
  Pulse,
  Scan,
  ShieldCheck,
  SlidersHorizontal,
  Stack,
  Swap,
  Trash,
  TrendDown,
  TrendUp,
  Wallet,
  Warning,
  XCircle,
} from "@phosphor-icons/react";

const pageMeta = {
  "池总览": [CirclesFour, "池总览", "BG/ANTFUN 与 ANTFUN/USDT 两池主网拓扑；SOL 仅作手续费储备。"],
  "流动性仓位": [Database, "流动性仓位", "仅显示配置钱包公开拥有的真实 Position NFT。"],
  "成交增长": [ChartLineUp, "成交增长", "观察真实 Swap、流动性深度和自然成交质量；不生成对敲或虚假成交。"],
  "持有人洞察": [Scan, "持有人洞察", "读取 BG Mint 权限、供应量与最大账户分布；不批量制造虚假持有人。"],
  "买方库存执行": [TrendUp, "买方库存执行", "将 USDT→ANTFUN→BG 拆分为受风控保护的库存补充计划；不设价格拉升目标。"],
  "卖方库存执行": [TrendDown, "卖方库存执行", "将 BG→ANTFUN→USDT 拆分为受风控保护的库存降低计划；不设价格打压目标。"],
  "库存与损益": [ChartLineUp, "库存与损益", "损益必须由链上仓位和执行账本计算，不使用界面模拟值。"],
  "自动化策略": [SlidersHorizontal, "自动化策略", "策略状态由服务端控制；浏览器不保存管理员密钥。"],
  "钱包与资金": [Wallet, "钱包与资金", "只读取配置的公开地址；助记词和私钥永不进入本系统。"],
  "风险控制": [ShieldCheck, "风险控制", "所有执行均经过池身份、报价时效、滑点、价格影响和熔断检查。"],
  "告警日志": [Bell, "告警与审计", "不可变更的本地审计事件与失败原因。"],
  "设置": [GearSix, "运行设置", "当前进程公开配置；敏感值不会通过 API 返回。"],
};

export function OperationalPageRouter({ page, maker }) {
  const meta = pageMeta[page] ?? pageMeta["池总览"];
  return (
    <div className="ops-page">
      <OpsHeading meta={meta} maker={maker} />
      {page === "池总览" && <Overview maker={maker} />}
      {page === "流动性仓位" && <Positions maker={maker} />}
      {page === "成交增长" && <Intents maker={maker} />}
      {page === "持有人洞察" && <TokenRadar maker={maker} />}
      {page === "买方库存执行" && <InventoryExecution maker={maker} side="buy" />}
      {page === "卖方库存执行" && <InventoryExecution maker={maker} side="sell" />}
      {page === "库存与损益" && <Accounting maker={maker} />}
      {page === "自动化策略" && <Automation maker={maker} />}
      {page === "钱包与资金" && <WalletView maker={maker} />}
      {page === "风险控制" && <Risk maker={maker} />}
      {page === "告警日志" && <Audit maker={maker} />}
      {page === "设置" && <Settings maker={maker} />}
    </div>
  );
}

function OpsHeading({ meta, maker }) {
  const [Icon, title, description] = meta;
  return (
    <header className="ops-heading">
      <span><Icon size={22} weight="duotone" /></span>
      <div><h2>{title}</h2><p>{description}</p></div>
      <StatePill ok={maker.status === "live"}>{maker.status === "live" ? "主网已验证" : maker.status === "degraded" ? "执行已阻断" : "服务未连接"}</StatePill>
    </header>
  );
}

function Overview({ maker }) {
  const snapshot = maker.snapshot;
  const pools = maker.health?.snapshotFresh ? (snapshot?.pools ?? {}) : {};
  const volume = maker.volume;
  return <>
    <div className="ops-metrics">
      <Metric label="今日池成交额" value={volume ? usd(volume.today?.totalUsd) : "—"} note="北京时间 · 两池全量" tone="ok" />
      <Metric label="运行模式" value={maker.config?.mode ?? "—"} note={maker.config?.mutationsEnabled ? "写入端点已启用" : "不允许写入"} />
      <Metric label="主网 Slot" value={snapshot?.slot ? snapshot.slot.toLocaleString() : "—"} note={snapshot?.capturedAt ? time(snapshot.capturedAt) : "等待快照"} />
      <Metric label="执行状态" value={maker.health?.paused ? "已暂停" : "可运行"} note={maker.status === "live" ? "两池拓扑通过" : "拓扑未就绪"} tone={maker.status === "live" ? "ok" : "warn"} />
    </div>
    <section className="ops-grid ops-grid--pools">
      <PoolCard name="BG / ANTFUN" expected={maker.config?.pools?.bgAntfun} pool={pools.bgAntfun} />
      <PoolCard name="ANTFUN / USDT" expected={maker.config?.pools?.antfunUsdt} pool={pools.antfunUsdt} />
    </section>
    <Blockers maker={maker} />
  </>;
}

function PoolCard({ name, expected, pool }) {
  const reserves = [pool?.tokenA, pool?.tokenB, pool?.tokenX, pool?.tokenY].filter(Boolean);
  return (
    <article className="ops-card">
      <div className="ops-card__title"><div><strong>{name}</strong><small>{expected?.kind ?? "未配置"}</small></div><StatePill ok={pool?.executable}>{pool?.executable ? "报价可执行" : pool?.identity?.verified ? "流动性不足" : "身份待验证"}</StatePill></div>
      <dl className="ops-kv">
        <Row label="池地址" value={expected?.address ?? "未配置有效主池"} mono />
        <Row label="程序" value={expected?.programId ?? "—"} mono />
        <Row label="程序所有者" value={pool?.identity?.ownerVerified ? "已验证" : "—"} />
        <Row label="Mint 对" value={pool?.identity?.mintPairVerified ? "已验证" : "—"} />
        <Row label="池开关" value={pool ? (pool.enabled ? "Enabled" : "Disabled") : "—"} />
      </dl>
      <div className="ops-reserves">
        {reserves.length ? reserves.map((reserve) => <div key={reserve.mint}><span>{reserve.symbol}</span><strong>{amount(reserve.amountUi)}</strong><small>链上 vault 余额</small></div>) : <Empty compact>未取得可验证的链上储备</Empty>}
      </div>
    </article>
  );
}

function Positions({ maker }) {
  const positions = Object.values(maker.health?.snapshotFresh ? (maker.snapshot?.pools ?? {}) : {}).flatMap((pool) => (pool.positions ?? []).map((position) => ({ ...position, pair: pool.pair })));
  if (!maker.config?.walletAddress) return <Empty icon={Wallet} title="尚未配置公开运营地址">设置 MAKER_WALLET_ADDRESS 后，服务只读查询该地址的 Position NFT。不要提供助记词或私钥。</Empty>;
  if (!maker.config?.enablePositionIndex) return <Empty icon={Database} title="LP 仓位索引未启用">当前无密钥 RPC 只读取固定池和已知 Token Account。切换到支持 getProgramAccounts 的认证 RPC 后，才能可靠发现 Position NFT。</Empty>;
  return <section className="ops-card"><CardTitle icon={Database} title="主网 Position NFT" note={`${positions.length} 个`} />{positions.length ? <DataTable headers={["交易对", "Position", "NFT Mint", "可用流动性", "永久锁定"]} rows={positions.map((item) => [item.pair, item.position, item.nftMint, item.liquidityRaw, item.permanentLockedLiquidityRaw ?? "—"])} /> : <Empty compact>该公开地址在已验证池中没有仓位。</Empty>}</section>;
}

function Intents({ maker }) {
  const volume = maker.volume;
  return <>
    <div className="ops-metrics">
      <Metric label="今日池成交额" value={volume ? usd(volume.today?.totalUsd) : "—"} note="官方索引 · 两池全量" tone="ok" />
      <Metric label="BG / ANTFUN" value={volume ? usd(volume.today?.pools?.bgAntfun) : "—"} note="今日池级成交额" />
      <Metric label="ANTFUN / USDT" value={volume ? usd(volume.today?.pools?.antfunUsdt) : "—"} note="今日池级成交额" />
      <Metric label="系统今日执行量" value={volume ? usd(volume.today?.systemUsd) : "—"} note={`${volume?.today?.systemExecutions ?? 0} 笔 · 与池全量分开`} />
    </div>
    <div className="ops-policy-callout"><ShieldCheck size={17} weight="fill" /><div><strong>真实成交口径</strong><span>只统计 Meteora 官方池 Swap 与本系统已确认执行；不通过关联钱包对敲来制造成交量。</span></div></div>
    <VolumeTrend volume={volume} />
    <RouteQuote maker={maker} />
    <section className="ops-card"><CardTitle icon={ListBullets} title="交易意图账本" note="报价 → 准备 → 审批 → 外部签名 → 逐腿确认" />{maker.intents.length ? <DataTable headers={["创建时间", "类型", "状态", "输入", "最低输出", "签名 / 路线进度"]} rows={maker.intents.map((item) => [time(item.createdAt), item.kind, item.state, `${item.summary?.action?.amountInRaw ?? "—"} ${item.summary?.action?.inputSymbol ?? ""}`, item.summary?.quote?.minOutUi ?? item.summary?.minOutRaw ?? "—", item.routeLegs?.length ? `${item.routeLegs.filter((leg) => leg.state === "confirmed").length}/${item.routeLegs.length} 腿已确认` : item.signature ?? "—"])} /> : <Empty compact>尚未生成交易意图。</Empty>}</section>
  </>;
}

function InventoryExecution({ maker, side }) {
  const isBuy = side === "buy";
  const inputSymbol = isBuy ? "USDT" : "BG";
  const outputSymbol = isBuy ? "BG" : "USDT";
  const [amountUi, setAmountUi] = useState(isBuy ? "1" : "100");
  const [slices, setSlices] = useState(4);
  const [intervalMinutes, setIntervalMinutes] = useState(5);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const slippageBps = Number(maker.config?.risk?.maxSlippageBps ?? 100);

  async function quotePlan() {
    setLoading(true); setError(null); setResult(null);
    try {
      const totalRaw = BigInt(decimalToRaw(amountUi, 6));
      const sliceCount = Math.max(1, Math.min(12, Number(slices) || 1));
      const quotient = totalRaw / BigInt(sliceCount);
      const remainder = totalRaw % BigInt(sliceCount);
      if (quotient <= 0n) throw new Error("总数量不足以拆分为当前批次数");
      const actions = Array.from({ length: sliceCount }, (_, index) => ({
        id: `${side}-inventory-${index + 1}`,
        kind: "route-swap",
        inputSymbol,
        amountInRaw: (quotient + (BigInt(index) < remainder ? 1n : 0n)).toString(),
        slippageBps,
      }));
      const response = await fetch(`${maker.apiBase}/api/public/v1/batch-route-quotes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "batch-route-quotes", actions }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? `API ${response.status}`);
      setResult(body);
    } catch (quoteError) { setError(quoteError.message); }
    finally { setLoading(false); }
  }

  const planRows = result?.results?.map((item, index) => {
    if (!item.ok) return [`${index + 1}`, "—", "—", "—", item.error];
    const quote = item.quote;
    return [
      `${index + 1}`,
      `${rawToDecimal(quote.action.amountInRaw, 6)} ${inputSymbol}`,
      `${rawToDecimal(quote.minOutRaw, 6)} ${outputSymbol}`,
      bps(quote.compoundedSlippageBps),
      quote.risk?.passed ? "通过" : quote.risk?.reasons?.map(riskReasonZh).join("；") || "阻断",
    ];
  }) ?? [];

  return <>
    <div className="ops-metrics">
      <Metric label="固定方向" value={`${inputSymbol} → ${outputSymbol}`} note={`${inputSymbol} → ANTFUN → ${outputSymbol}`} tone="ok" />
      <Metric label="拆分批次" value={`${slices} 批`} note="每批独立报价与风控" />
      <Metric label="建议间隔" value={`${intervalMinutes} 分钟`} note="外部执行端参考，不自动定时广播" />
      <Metric label="单腿滑点上限" value={bps(slippageBps)} note="服务端硬上限，不可在页面放宽" />
    </div>

    <div className="ops-policy-callout"><ShieldCheck size={17} weight="fill" /><div><strong>{isBuy ? "库存补充，不是自动拉盘" : "库存降低，不是自动砸盘"}</strong><span>计划不接受目标价格、涨跌幅或市场冲击目标；每批必须通过库存方向、余额、滑点和价格影响检查。</span></div></div>

    <section className="ops-card inventory-execution-card">
      <CardTitle icon={isBuy ? TrendUp : TrendDown} title={isBuy ? "买方库存拆分计划" : "卖方库存拆分计划"} note="主网报价 · 外部签名 · 不自动广播" />
      <div className="inventory-execution-form">
        <label><span>总输入数量</span><div><input value={amountUi} inputMode="decimal" onChange={(event) => setAmountUi(event.target.value.replace(/[^0-9.]/g, ""))} /><b>{inputSymbol}</b></div></label>
        <label><span>拆分批次</span><select value={slices} onChange={(event) => setSlices(Number(event.target.value))}>{Array.from({ length: 12 }, (_, index) => <option value={index + 1} key={index + 1}>{index + 1} 批</option>)}</select></label>
        <label><span>批次间隔</span><select value={intervalMinutes} onChange={(event) => setIntervalMinutes(Number(event.target.value))}>{[1, 2, 5, 10, 15, 30, 60].map((value) => <option value={value} key={value}>{value} 分钟</option>)}</select></label>
        <button className="button button--primary" type="button" onClick={quotePlan} disabled={loading}>{loading ? "生成计划中…" : "生成主网报价计划"}<ArrowRight size={15} /></button>
      </div>
      <div className="inventory-plan-note"><Clock size={16} /><span>预计计划时长 <strong>{Math.max(0, (Number(slices) - 1) * Number(intervalMinutes))} 分钟</strong></span><span>执行方式 <strong>逐批人工批准 / 外部签名</strong></span><span>路由 <strong>{inputSymbol} → ANTFUN → {outputSymbol}</strong></span></div>
      {error && <div className="ops-quote-error"><Warning size={16} weight="fill" />{error}</div>}
      {result && <><div className="ops-route-summary"><div><span>计划批次</span><strong>{result.total}</strong></div><div><span>通过风控</span><strong className="is-positive">{result.passed}</strong></div><div><span>阻断 / 失败</span><strong className={result.failed ? "is-warning" : "is-positive"}>{result.failed}</strong></div></div><DataTable headers={["批次", "输入", "最低可得", "串联滑点", "风控结论"]} rows={planRows} /></>}
      {!result && !error && <Empty compact>输入总量并生成计划后，系统会对每一批调用真实双池主网报价；不会创建或广播交易。</Empty>}
    </section>
  </>;
}

function VolumeTrend({ volume }) {
  if (!volume) return <section className="ops-card"><CardTitle icon={ChartLineUp} title="每日交易量" note="正在读取 Meteora 官方索引" /><Empty compact>等待真实池级成交量。</Empty></section>;
  const chartData = (volume.daily ?? []).map((row) => ({
    ...row,
    label: row.date?.slice(5),
    bgAntfun: row.pools?.bgAntfun ?? 0,
    antfunUsdt: row.pools?.antfunUsdt ?? 0,
  }));
  const sourceState = volume.status === "ready" ? "官方索引正常" : volume.status === "stale" ? "正在显示缓存" : "部分数据降级";
  return <section className="ops-card ops-volume-card">
    <CardTitle icon={ChartLineUp} title="每日交易量趋势" note={`北京时间 · USD · ${sourceState}`} />
    <div className="ops-volume-layout">
      <div className="ops-volume-chart">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 14, right: 18, bottom: 4, left: 12 }}>
            <CartesianGrid stroke="#202a3b" strokeDasharray="3 5" vertical={false} />
            <XAxis dataKey="label" tick={{ fill: "#8995a8", fontSize: 12 }} tickLine={false} axisLine={{ stroke: "#263249" }} />
            <YAxis tickFormatter={compactUsdAxis} tick={{ fill: "#8995a8", fontSize: 12 }} tickLine={false} axisLine={false} width={58} />
            <Tooltip content={<VolumeTooltip />} cursor={{ stroke: "#63718a", strokeDasharray: "4 4" }} />
            <Line type="monotone" dataKey="antfunUsdt" name="ANTFUN / USDT" stroke="#42d7ae" strokeWidth={2.4} dot={{ r: 2.5 }} activeDot={{ r: 4 }} />
            <Line type="monotone" dataKey="bgAntfun" name="BG / ANTFUN" stroke="#a77df6" strokeWidth={2.4} dot={{ r: 2.5 }} activeDot={{ r: 4 }} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <aside className="ops-volume-summary">
        <div><span>近 {volume.days} 日池成交额</span><strong>{usd(volume.period?.totalUsd)}</strong><small>两池全量，不等于本系统成交</small></div>
        <div><span>近 {volume.days} 日系统执行量</span><strong>{usd(volume.period?.systemUsd)}</strong><small>{volume.period?.systemExecutions ?? 0} 笔已执行意图 · 报价口径</small></div>
        <div><span>官方索引最后小时桶</span><strong>{volume.lastBucketAt ? hour(volume.lastBucketAt) : "—"}</strong><small>Meteora 小时聚合可能存在延迟</small></div>
      </aside>
    </div>
    <div className="ops-volume-footnote"><span><i className="ops-series ops-series--green" />ANTFUN / USDT</span><span><i className="ops-series ops-series--violet" />BG / ANTFUN</span><b>来源：Meteora Data API · 池全量与系统执行量已分离</b></div>
    {volume.errors?.length ? <div className="ops-quote-error"><Warning size={16} weight="fill" />{volume.errors.join("；")}</div> : null}
  </section>;
}

function VolumeTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return <div className="ops-volume-tooltip"><strong>{label}</strong>{payload.map((item) => <span key={item.dataKey}><i style={{ background: item.color }} />{item.name}<b>{usd(item.value)}</b></span>)}</div>;
}

function RouteQuote({ maker }) {
  const [inputSymbol, setInputSymbol] = useState("USDT");
  const [amountUi, setAmountUi] = useState("1");
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const decimals = 6;
  const slippageBps = Number(maker.config?.risk?.maxSlippageBps ?? 100);
  async function quote() {
    setLoading(true); setError(null); setResult(null);
    try {
      const amountInRaw = decimalToRaw(amountUi, decimals);
      const response = await fetch(`${maker.apiBase}/api/public/v1/route-quotes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "route-swap", inputSymbol, amountInRaw, slippageBps }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? `API ${response.status}`);
      setResult(body);
    } catch (quoteError) { setError(quoteError.message); }
    finally { setLoading(false); }
  }
  return <section className="ops-card"><CardTitle icon={Swap} title="两池路径实时报价" note={`每腿 ${bps(slippageBps)} 滑点保护 · 公开端点限速 · 不返回交易`} />
    <div className="ops-quote-form"><label><span>方向</span><select value={inputSymbol} onChange={(event) => { const value = event.target.value; setInputSymbol(value); setAmountUi(value === "USDT" ? "1" : "100"); }}><option value="USDT">USDT → ANTFUN → BG</option><option value="BG">BG → ANTFUN → USDT</option></select></label><label><span>输入数量</span><input value={amountUi} inputMode="decimal" onChange={(event) => setAmountUi(event.target.value.replace(/[^0-9.]/g, ""))} /><b>{inputSymbol}</b></label><button className="button button--primary" onClick={quote} disabled={loading}>{loading ? "报价中…" : "获取主网报价"}</button></div>
    {error && <div className="ops-quote-error"><Warning size={16} weight="fill" />{error}</div>}
    {result && <><div className="ops-route-summary"><div><span>最终最低可得</span><strong>{rawToDecimal(result.minOutRaw, 6)} {result.outputSymbol}</strong></div><div><span>串联滑点上限</span><strong>{bps(result.compoundedSlippageBps)}</strong></div><div><span>执行风控</span><strong>{result.risk?.passed ? "通过" : "阻断"}</strong></div></div><DataTable headers={["腿", "池", "输入", "预计输出", "最低输出", "价格影响"]} rows={result.legs.map((leg, index) => [`${index + 1}`, leg.pool, `${leg.quote.amountInUi} ${leg.inputSymbol}`, `${leg.quote.expectedOutUi} ${leg.outputSymbol}`, `${leg.quote.minOutUi} ${leg.outputSymbol}`, bps(leg.quote.priceImpactBps)])} /></>}
  </section>;
}

function BatchConsole({ maker }) {
  const infrastructure = maker.executionInfrastructure;
  const [rows, setRows] = useState([
    { id: "route-1", inputSymbol: "USDT", amountUi: "1" },
    { id: "route-2", inputSymbol: "BG", amountUi: "100" },
  ]);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  function updateRow(id, patch) {
    setRows((current) => current.map((row) => row.id === id ? { ...row, ...patch } : row));
  }
  function addRow() {
    setRows((current) => current.length >= 12 ? current : [...current, { id: `route-${Date.now()}`, inputSymbol: "USDT", amountUi: "1" }]);
  }
  function removeRow(id) {
    setRows((current) => current.length === 1 ? current : current.filter((row) => row.id !== id));
  }
  async function quoteBatch() {
    setLoading(true); setError(null); setResult(null);
    try {
      const actions = rows.map((row) => ({
        id: row.id,
        kind: "route-swap",
        inputSymbol: row.inputSymbol,
        amountInRaw: decimalToRaw(row.amountUi, 6),
        slippageBps: Number(maker.config?.risk?.maxSlippageBps ?? 100),
      }));
      const response = await fetch(`${maker.apiBase}/api/public/v1/batch-route-quotes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "batch-route-quotes", actions }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? `API ${response.status}`);
      setResult(body);
    } catch (quoteError) { setError(quoteError.message); }
    finally { setLoading(false); }
  }

  const resultRows = result?.results?.map((item, index) => {
    const quote = item.quote;
    const inputSymbol = quote?.action?.inputSymbol;
    return [
      `${index + 1}`,
      item.ok ? `${inputSymbol} → ANTFUN → ${quote.outputSymbol}` : "—",
      item.ok ? `${rawToDecimal(quote.action.amountInRaw, 6)} ${inputSymbol}` : "—",
      item.ok ? `${rawToDecimal(quote.minOutRaw, 6)} ${quote.outputSymbol}` : "—",
      item.ok ? bps(quote.compoundedSlippageBps) : "—",
      item.ok ? (quote.risk?.passed ? "通过" : quote.risk?.reasons?.map(riskReasonZh).join("；") || "阻断") : item.error,
    ];
  }) ?? [];

  return <>
    <div className="ops-metrics">
      <Metric label="标准 RPC" value={infrastructure?.deliveryChannels?.standardRpc?.ready ? "就绪" : "未就绪"} note={infrastructure?.rpcPolicy === "public-risk-accepted" ? "公共 RPC · 风险已接受" : infrastructure?.rpcPolicy ?? "等待检测"} tone={infrastructure?.deliveryChannels?.standardRpc?.ready ? "ok" : "warn"} />
      <Metric label="优先费 P50" value={microLamports(infrastructure?.priorityFeeMicroLamports?.p50)} note={`${infrastructure?.priorityFeeMicroLamports?.sampleCount ?? 0} 个主网样本`} />
      <Metric label="优先费 P90" value={microLamports(infrastructure?.priorityFeeMicroLamports?.p90)} note="用于拥堵预算，不自动提交" />
      <Metric label="MEV 加速" value={infrastructure?.deliveryChannels?.jito?.ready ? "Jito 已就绪" : "待配置"} note="未授权前不发送签名交易" tone={infrastructure?.deliveryChannels?.jito?.ready ? "ok" : "warn"} />
    </div>

    <section className="ops-card batch-planner">
      <CardTitle icon={Stack} title="批量路径报价" note={`最多 12 个动作 · 每腿 ${bps(maker.config?.risk?.maxSlippageBps)} · 不广播`} />
      <div className="batch-toolbar">
        <div><strong>任务编排</strong><span>只允许 BG↔ANTFUN↔USDT 固定双池路径；逐项返回风控结果。</span></div>
        <button className="button button--ghost" type="button" onClick={addRow} disabled={rows.length >= 12}><Plus size={15} />添加任务</button>
      </div>
      <div className="batch-rows">
        {rows.map((row, index) => <div className="batch-row" key={row.id}>
          <span className="batch-index">{String(index + 1).padStart(2, "0")}</span>
          <label><span>方向</span><select value={row.inputSymbol} onChange={(event) => updateRow(row.id, { inputSymbol: event.target.value, amountUi: event.target.value === "USDT" ? "1" : "100" })}><option value="USDT">USDT → BG</option><option value="BG">BG → USDT</option></select></label>
          <label><span>输入数量</span><div className="batch-amount"><input value={row.amountUi} inputMode="decimal" onChange={(event) => updateRow(row.id, { amountUi: event.target.value.replace(/[^0-9.]/g, "") })} /><b>{row.inputSymbol}</b></div></label>
          <div className="batch-route"><span>固定路径</span><strong>{row.inputSymbol === "USDT" ? "USDT → ANTFUN → BG" : "BG → ANTFUN → USDT"}</strong></div>
          <button className="batch-remove" type="button" aria-label={`删除任务 ${index + 1}`} onClick={() => removeRow(row.id)} disabled={rows.length === 1}><Trash size={16} /></button>
        </div>)}
      </div>
      <div className="batch-actions"><span><ShieldCheck size={16} />批量报价不生成交易、不签名、不广播。</span><button className="button button--primary" type="button" onClick={quoteBatch} disabled={loading}>{loading ? "批量报价中…" : "获取批量主网报价"}<ArrowRight size={15} /></button></div>
      {error && <div className="ops-quote-error"><Warning size={16} weight="fill" />{error}</div>}
      {result && <><div className="ops-route-summary"><div><span>任务总数</span><strong>{result.total}</strong></div><div><span>通过风控</span><strong className="is-positive">{result.passed}</strong></div><div><span>阻断 / 失败</span><strong className={result.failed ? "is-warning" : "is-positive"}>{result.failed}</strong></div></div><DataTable headers={["任务", "方向", "输入", "最低可得", "串联滑点", "风控结论"]} rows={resultRows} /></>}
    </section>

    <div className="ops-grid execution-grid">
      <section className="ops-card"><CardTitle icon={Lightning} title="交易加速通道" note="Emit 能力的安全化接入状态" /><dl className="ops-kv"><Row label="标准 RPC" value={infrastructure?.deliveryChannels?.standardRpc?.ready ? "可用" : "不可用"} /><Row label="Jito Block Engine" value={infrastructure?.deliveryChannels?.jito?.configured ? "已配置" : "未配置"} /><Row label="Nozomi" value={infrastructure?.deliveryChannels?.nozomi?.configured ? "已配置" : "未配置"} /><Row label="签名方式" value="外部钱包 / 硬件钱包" /><Row label="Bundle 广播" value={infrastructure?.signing?.bundleBroadcast ? "已启用" : "未启用"} /></dl></section>
      <section className="ops-card"><CardTitle icon={ListBullets} title="签名与执行队列" note={`${maker.intents.length} 个历史意图`} />{maker.intents.length ? <DataTable headers={["Intent", "类型", "状态", "创建时间"]} rows={maker.intents.slice(0, 8).map((intent) => [intent.id, intent.kind, intent.state, time(intent.createdAt)])} /> : <Empty compact>尚无已准备的链上执行意图。批量报价不会自动创建意图。</Empty>}</section>
    </div>
  </>;
}

function TokenRadar({ maker }) {
  const intelligence = maker.tokenIntelligence;
  const concentration = intelligence?.concentration ?? {};
  const poolVerified = Boolean(maker.snapshot?.pools?.bgAntfun?.identity?.verified);
  return <>
    <div className="ops-metrics">
      <Metric label="BG 总供应量" value={intelligence?.supplyUi ? amount(intelligence.supplyUi) : "—"} note={`Decimals ${intelligence?.decimals ?? "—"}`} />
      <Metric label="Mint 权限" value={intelligence ? (intelligence.mintAuthority ? "未撤销" : "已撤销") : "—"} note={intelligence?.mintAuthority ? "仍可增发" : "主网 Mint 账户校验"} tone={intelligence && !intelligence.mintAuthority ? "ok" : "warn"} />
      <Metric label="冻结权限" value={intelligence ? (intelligence.freezeAuthority ? "未撤销" : "已撤销") : "—"} note={intelligence?.freezeAuthority ? "可冻结 Token Account" : "主网 Mint 账户校验"} tone={intelligence && !intelligence.freezeAuthority ? "ok" : "warn"} />
      <Metric label="Top 10 集中度" value={bps(concentration.top10Bps)} note={concentration.accountsSampled ? `${concentration.accountsSampled} 个最大账户样本` : "公共 RPC 未提供索引"} tone={concentration.top10Bps == null ? undefined : Number(concentration.top10Bps) <= 8000 ? "ok" : "warn"} />
    </div>

    <div className="ops-grid token-grid">
      <section className="ops-card"><CardTitle icon={Scan} title="BG Mint 主网画像" note={intelligence?.capturedAt ? time(intelligence.capturedAt) : "等待 RPC"} /><dl className="ops-kv"><Row label="Mint" value={intelligence?.mint ?? "—"} mono /><Row label="Token Program" value={intelligence?.tokenProgram ?? "—"} /><Row label="Program ID" value={intelligence?.programId ?? "—"} mono /><Row label="初始化状态" value={intelligence?.initialized == null ? "—" : intelligence.initialized ? "已初始化" : "异常"} /><Row label="供应量 (raw)" value={intelligence?.supplyRaw ?? "—"} mono /></dl></section>
      <section className="ops-card"><CardTitle icon={ShieldCheck} title="发行与池身份检查" note="实时结论" /><ul className="ops-checklist"><Check ok={Boolean(intelligence?.initialized)}>Mint 账户已初始化</Check><Check ok={intelligence?.mintAuthority === null}>Mint 增发权限已撤销</Check><Check ok={intelligence?.freezeAuthority === null}>Token Account 冻结权限已撤销</Check><Check ok={poolVerified}>BG/ANTFUN 官方 DAMM v2 主池身份已验证</Check><Check ok={Boolean(maker.snapshot?.pools?.antfunUsdt?.identity?.verified)}>ANTFUN/USDT 桥接主池身份已验证</Check></ul></section>
    </div>

    <div className="ops-policy-callout"><ShieldCheck size={17} weight="fill" /><div><strong>只做真实持有人洞察</strong><span>不会批量创建空钱包、拆分代币余额或把 Token Account 数量包装成独立持有人增长。</span></div></div>
    <section className="ops-card holder-card"><CardTitle icon={ChartLineUp} title="最大 Token Account 分布" note="RPC 返回最大账户样本；不等同于独立持有人数量" />{intelligence?.largestAccounts?.length ? <div className="holder-list">{intelligence.largestAccounts.slice(0, 10).map((account) => <div className="holder-row" key={account.address}><span>#{account.rank}</span><div><strong className="ops-mono" title={account.address}>{short(account.address)}</strong><i><b style={{ width: `${Math.max(1, Math.min(100, Number(account.shareBps ?? 0) / 100))}%` }} /></i></div><em>{amount(account.amountUi)} BG</em><b>{bps(account.shareBps)}</b></div>)}</div> : <Empty compact>公共 RPC 暂未返回最大账户列表；系统不会用模拟数据填充。</Empty>}{intelligence?.warnings?.length ? <div className="ops-quote-error"><Warning size={16} weight="fill" />{intelligence.warnings.join("；")}</div> : null}</section>
  </>;
}

function Accounting({ maker }) {
  const accounting = maker.accounting;
  return <>
    <div className="ops-metrics">
      <Metric label="今日已确认执行" value={String(accounting?.dailyExecutions ?? 0)} note={`${accounting?.timeZone ?? "Asia/Shanghai"} 日界线`} />
      <Metric label="今日已实现损益" value={usdtRaw(accounting?.dailyRealizedPnlUsdtRaw)} note="平均成本账本 · 已确认余额差" tone={Number(accounting?.dailyRealizedPnlUsdtRaw ?? 0) >= 0 ? "ok" : "warn"} />
      <Metric label="未实现损益" value={usdtRaw(accounting?.unrealizedPnlUsdtRaw)} note="链上公开余额按当前两池隐含价估值" />
      <Metric label="今日风控名义金额" value={usdtRaw(accounting?.dailyNotionalUsdtRaw)} note="与池全量成交额分开" />
    </div>
    <section className="ops-card"><CardTitle icon={LockKey} title="USDT 成本基准" note={accounting?.status === "ready" ? "可复算" : "等待链上估值"} />{accounting?.costBasis?.length ? <DataTable headers={["资产", "账本数量 (raw)", "成本 (USDT)", "最后对账"]} rows={accounting.costBasis.map((item) => [item.symbol, item.quantityRaw, usdtRaw(item.costUsdtRaw), time(item.updatedAt)])} /> : <Empty compact>首次取得有效钱包快照和两池隐含价格后建立链上期初基准。</Empty>}<div className="ops-volume-footnote"><b>口径：{accounting?.inventoryScope ?? "配置钱包已知 Token Account"}；外部转入按当时市场价增加成本，外部转出按比例移除成本。</b></div></section>
  </>;
}

function Automation({ maker }) {
  return <>
    <section className="ops-card"><CardTitle icon={Pulse} title="控制状态" note="服务端状态机" /><dl className="ops-kv ops-kv--wide"><Row label="状态" value={maker.health?.paused ? "暂停" : "运行"} /><Row label="运行模式" value={maker.config?.mode ?? "—"} /><Row label="连续失败" value={String(maker.health?.consecutiveFailures ?? 0)} /><Row label="写入端点" value={maker.config?.mutationsEnabled ? "已启用" : "已禁用"} /></dl></section>
    <Empty icon={ShieldCheck} title="浏览器不直接恢复或启动 live 交易">恢复需要服务端管理员令牌与精确确认头；管理员令牌不写入 sessionStorage/localStorage。当前拓扑未验证时，服务端会拒绝恢复。</Empty>
  </>;
}

function WalletView({ maker }) {
  const wallet = maker.health?.snapshotFresh ? maker.snapshot?.wallet : null;
  return <>
    <div className="ops-metrics"><Metric label="公开地址" value={maker.config?.walletAddress ? "已配置" : "未配置"} note="不会加载签名材料" /><Metric label="原生 SOL" value={wallet ? `${amount(wallet.solUi)} SOL` : "—"} note="仅作链上手续费储备" /><Metric label="交易 Token Account" value={wallet ? String(wallet.tokenAccounts?.filter((item) => item.symbol !== "SOL").length ?? 0) : "—"} note="BG / ANTFUN / USDT" /><Metric label="签名模式" value="外部人工签名" note="二阶段确认" tone="ok" /></div>
    <section className="ops-card"><CardTitle icon={Wallet} title="公开运营地址" note="只读" /><dl className="ops-kv ops-kv--wide"><Row label="地址" value={maker.config?.walletAddress ?? "未配置"} mono /><Row label="签名位置" value="外部钱包 / 硬件钱包" /><Row label="助记词" value="禁止进入服务或浏览器" /><Row label="私钥" value="禁止进入服务或浏览器" /></dl>{wallet?.tokenAccounts?.length ? <DataTable headers={["资产", "余额", "Token Account 数", "Mint"]} rows={wallet.tokenAccounts.map((item) => [item.symbol, amount(item.amountUi), item.accounts, item.mint])} /> : <Empty compact>配置公开地址并取得有效 RPC 快照后，才会显示 SOL 余额与 Token Account。</Empty>}</section>
  </>;
}

function Risk({ maker }) {
  const risk = maker.config?.risk ?? {};
  return <>
    <div className="ops-metrics"><Metric label="最大滑点" value={bps(risk.maxSlippageBps)} note="服务端上限" /><Metric label="最大价格影响" value={bps(risk.maxPriceImpactBps)} note="超过即拒绝" /><Metric label="库存目标 BG / ANTFUN / USDT" value={risk.inventoryTargetsBps ? `${bps(risk.inventoryTargetsBps.BG)} / ${bps(risk.inventoryTargetsBps.ANTFUN)} / ${bps(risk.inventoryTargetsBps.USDT)}` : "—"} note={`容忍带 ${bps(risk.inventoryToleranceBps)}`} /><Metric label="每日损失上限" value={bps(risk.dailyLossLimitBps)} note="基于已实现损益账本" /></div>
    <Blockers maker={maker} />
  </>;
}

function Audit({ maker }) {
  return <section className="ops-card"><CardTitle icon={Bell} title="审计事件" note={`${maker.audit.length} 条`} />{maker.audit.length ? <DataTable headers={["时间", "Actor", "动作", "详情"]} rows={maker.audit.map((event) => [time(event.createdAt), event.actor, event.action, compactJson(event.payload)])} /> : <Empty compact>暂无审计事件，或主网服务未连接。</Empty>}</section>;
}

function Settings({ maker }) {
  const config = maker.config;
  return <div className="ops-grid">
    <section className="ops-card"><CardTitle icon={GearSix} title="进程配置" note="公开字段" /><dl className="ops-kv"><Row label="API" value={maker.apiBase} mono /><Row label="网络" value={config?.network ?? "—"} /><Row label="模式" value={config?.mode ?? "—"} /><Row label="RPC 策略" value={config?.rpcPolicy?.mode === "public-risk-accepted" ? "公共 RPC · 风险已接受" : config?.rpcPolicy?.mode ?? "—"} /><Row label="钱包" value={config?.walletAddress ?? "未配置"} mono /><Row label="允许来源" value={config?.allowedOrigins?.join(", ") ?? "—"} /><Row label="实时事件流" value={maker.stream === "connected" ? "已连接" : maker.stream === "degraded" ? "连续失败 · 轮询接管" : "重连中"} /></dl></section>
    <section className="ops-card"><CardTitle icon={LockKey} title="生产启用条件" note="缺一不可" /><ul className="ops-checklist"><Check ok={Boolean(config?.walletAddress && maker.health?.walletIdentityVerified)}>运营地址已通过 Solana 主网账户校验</Check><Check ok={Boolean(config?.pools?.bgAntfun && config?.pools?.antfunUsdt)}>固定两池已配置</Check><Check ok={Boolean(maker.health?.topologyReady)}>新鲜快照的两池程序、Mint 与流动性校验通过</Check><Check ok={config?.mode === "live"}>显式 live 模式确认</Check><Check ok={Boolean(maker.health?.accountingReady)}>每日 USDT 名义金额、库存方向与损益账本</Check><Check ok={Boolean(maker.health?.rpcPolicyReady)}>{maker.health?.rpcPolicyMode === "public-risk-accepted" ? "公共 RPC live 风险已由运营方明确接受" : "认证私有 RPC 与提交 SLA 验收"}</Check><Check ok={Boolean(maker.health?.solReserveReady)}>运营钱包 SOL 手续费储备达到服务端下限</Check></ul></section>
  </div>;
}

function Blockers({ maker }) {
  const errors = [...(maker.snapshot?.errors ?? (maker.error ? [{ pool: "API", error: maker.error }] : []))];
  if (maker.config?.mode !== "observe" && !maker.health?.rpcPolicyReady) errors.push({ pool: "RPC", error: "live 执行要求认证私有 RPC，或显式接受公共 RPC 的限流与提交失败风险。" });
  if (maker.config?.walletAddress && !maker.health?.walletIdentityVerified) errors.push({ pool: "WALLET", error: "运营地址尚未通过 Solana 主网账户校验。" });
  if (maker.config?.mode !== "observe" && !maker.health?.accountingReady) errors.push({ pool: "ACCOUNTING", error: "钱包余额或两池 USDT 隐含价格不可用，风控账本未就绪。" });
  if (maker.config?.mode !== "observe" && maker.health?.solReserveReady === false) errors.push({ pool: "SOL", error: "运营钱包的 SOL 手续费储备低于服务端安全下限。" });
  if (maker.stream === "degraded") errors.push({ pool: "SSE", error: "实时事件流连续失败；当前由定时轮询维持数据。" });
  return <section className="ops-card ops-blockers"><CardTitle icon={errors.length ? Warning : CheckCircle} title="执行就绪检查" note={errors.length ? `${errors.length} 个阻断项` : "未发现阻断项"} />{errors.length ? <ul>{errors.map((item, index) => <li key={`${item.pool}-${index}`}><XCircle size={17} weight="fill" /><div><strong>{item.pool}</strong><span>{item.error}</span></div></li>)}</ul> : <div className="ops-ok"><CheckCircle size={18} weight="fill" />当前快照的两池身份与拓扑已验证。</div>}</section>;
}

function Metric({ label, value, note, tone }) { return <article className={`ops-metric ${tone ? `ops-metric--${tone}` : ""}`}><span>{label}</span><strong>{value}</strong><small>{note}</small></article>; }
function CardTitle({ icon: Icon, title, note }) { return <div className="ops-card__title"><div>{Icon && <Icon size={18} weight="duotone" />}<span><strong>{title}</strong><small>{note}</small></span></div></div>; }
function StatePill({ ok, children }) { return <span className={`ops-pill ${ok ? "ops-pill--ok" : "ops-pill--blocked"}`}>{children}</span>; }
function Row({ label, value, mono }) { return <div><dt>{label}</dt><dd className={mono ? "ops-mono" : ""} title={String(value)}>{value}</dd></div>; }
function Check({ ok, children }) { return <li className={ok ? "is-ok" : "is-blocked"}>{ok ? <CheckCircle size={17} weight="fill" /> : <XCircle size={17} weight="fill" />}<span>{children}</span></li>; }
function Empty({ icon: Icon = Warning, title, compact = false, children }) { return <div className={`ops-empty ${compact ? "ops-empty--compact" : ""}`}><Icon size={compact ? 18 : 28} weight="duotone" />{title && <strong>{title}</strong>}<p>{children}</p></div>; }
function DataTable({ headers, rows }) { return <div className="ops-table-wrap"><table className="ops-table"><thead><tr>{headers.map((header) => <th key={header}>{header}</th>)}</tr></thead><tbody>{rows.map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, cellIndex) => <td key={cellIndex} title={String(cell)}>{cell}</td>)}</tr>)}</tbody></table></div>; }
function amount(value) { const number = Number(value); return Number.isFinite(number) ? number.toLocaleString(undefined, { maximumFractionDigits: 6 }) : "—"; }
function usdtRaw(value) { if (value == null || !/^-?\d+$/.test(String(value))) return "—"; return `${rawToDecimal(String(value), 6)} USDT`; }
function usd(value) { const number = Number(value); return Number.isFinite(number) ? number.toLocaleString("zh-CN", { style: "currency", currency: "USD", maximumFractionDigits: number >= 1_000 ? 0 : 2 }) : "—"; }
function compactUsdAxis(value) { const number = Number(value); if (!Number.isFinite(number)) return "—"; if (Math.abs(number) >= 1_000_000) return `$${(number / 1_000_000).toFixed(1)}M`; if (Math.abs(number) >= 1_000) return `$${(number / 1_000).toFixed(0)}K`; return `$${number.toFixed(0)}`; }
function bps(value) { return value == null ? "—" : `${(Number(value) / 100).toFixed(2)}%`; }
function time(value) { return value ? new Date(value).toLocaleString("zh-CN", { hour12: false }) : "—"; }
function hour(value) { return value ? new Date(value).toLocaleString("zh-CN", { hour12: false, month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Shanghai" }) : "—"; }
function compactJson(value) { const text = JSON.stringify(value ?? {}); return text.length > 110 ? `${text.slice(0, 107)}…` : text; }
function microLamports(value) { return value == null ? "—" : `${Number(value).toLocaleString()} μ-lamports/CU`; }
function short(value) { const text = String(value ?? ""); return text.length > 20 ? `${text.slice(0, 9)}…${text.slice(-8)}` : text || "—"; }
function riskReasonZh(value) { const translations = { "Configured wallet balance is below the approved input amount.": "运营钱包输入资产余额不足", "Action would increase an already out-of-band inventory exposure.": "该方向会扩大已超出容忍带的库存敞口", "System is in observe mode.": "系统处于观察模式", "Automation is paused.": "自动化已暂停" }; return translations[value] ?? value; }
function decimalToRaw(value, decimals) { const text = String(value).trim(); if (!/^\d+(?:\.\d+)?$/.test(text)) throw new Error("请输入有效的正数金额"); const [whole, fraction = ""] = text.split("."); if (fraction.length > decimals) throw new Error(`最多支持 ${decimals} 位小数`); const raw = BigInt(whole) * 10n ** BigInt(decimals) + BigInt((fraction + "0".repeat(decimals)).slice(0, decimals)); if (raw <= 0n) throw new Error("金额必须大于 0"); return raw.toString(); }
function rawToDecimal(value, decimals) { if (value == null) return "—"; const raw = BigInt(value); const negative = raw < 0n; const absolute = negative ? -raw : raw; const scale = 10n ** BigInt(decimals); const whole = absolute / scale; const fraction = (absolute % scale).toString().padStart(decimals, "0").replace(/0+$/, ""); return `${negative ? "-" : ""}${whole}${fraction ? `.${fraction}` : ""}`; }
