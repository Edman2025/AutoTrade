import { useEffect, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowRight,
  ArrowSquareOut,
  ArrowUp,
  Bell,
  CaretDown,
  ChartDonut,
  ChartLineUp,
  Check,
  CheckCircle,
  CirclesFour,
  Clock,
  Copy,
  Database,
  GearSix,
  Info,
  LinkSimple,
  LockKey,
  Pause,
  Pulse,
  Scan,
  ShieldCheck,
  SlidersHorizontal,
  Stack,
  Swap,
  TrendDown,
  TrendUp,
  Wallet,
  Warning,
  X,
} from "@phosphor-icons/react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useMakerData } from "./useMakerData.js";
import { OperationalPageRouter } from "./OperationalPages.jsx";

const navItems = [
  ["池总览", CirclesFour],
  ["流动性仓位", ChartDonut],
  ["成交增长", Pulse],
  ["持有人洞察", Scan],
  ["买方库存执行", TrendUp],
  ["卖方库存执行", TrendDown],
  ["库存与损益", ChartLineUp],
  ["自动化策略", SlidersHorizontal],
  ["钱包与资金", Wallet],
  ["风险控制", ShieldCheck],
  ["告警日志", Bell],
  ["设置", GearSix],
];

const impactCurve = [
  { size: 0, buy: 0, sell: 0 },
  { size: 250, buy: 0.03, sell: -0.03 },
  { size: 500, buy: 0.06, sell: -0.06 },
  { size: 1000, buy: 0.12, sell: -0.12 },
  { size: 2500, buy: 0.3, sell: -0.29 },
  { size: 5000, buy: 0.6, sell: -0.58 },
  { size: 7500, buy: 0.89, sell: -0.86 },
  { size: 10000, buy: 1.18, sell: -1.14 },
];

const quotePresets = [
  { amount: 100, label: "100", receive: "3,237.4 BG", impact: "0.01%", min: "3,205.0 BG", fee: "0.30 ANTFUN" },
  { amount: 1000, label: "1K", receive: "32,338.2 BG", impact: "0.12%", min: "32,014.8 BG", fee: "3.00 ANTFUN" },
  { amount: 10000, label: "10K", receive: "319,838.6 BG", impact: "1.18%", min: "316,640.2 BG", fee: "30.00 ANTFUN" },
];

const swaps = [
  { time: "14:36:28", direction: "in", from: "8,420 ANTFUN", to: "272,447 BG", impact: "0.10%", fee: "25.26 ANTFUN", signature: "5nd7…Qp2k" },
  { time: "14:35:54", direction: "out", from: "184,300 BG", to: "5,661 ANTFUN", impact: "0.07%", fee: "17.03 ANTFUN", signature: "3kL9…mR7x" },
  { time: "14:35:17", direction: "in", from: "3,250 ANTFUN", to: "105,411 BG", impact: "0.04%", fee: "9.75 ANTFUN", signature: "7aB2…Ls9e" },
  { time: "14:34:42", direction: "out", from: "92,700 BG", to: "2,850 ANTFUN", impact: "0.03%", fee: "8.58 ANTFUN", signature: "1vQm…J8pA" },
];

const reserveChanges = [
  { token: "BG", value: "106,645,157.95", delta: "+0.09%", direction: "up" },
  { token: "ANTFUN", value: "3,280,594.80", delta: "−0.08%", direction: "down" },
];

function copyText(text) {
  navigator.clipboard?.writeText(text);
}

function ShortAddress({ children, label = "复制地址" }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="copy-address"
      onClick={() => {
        copyText(children);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1200);
      }}
      aria-label={label}
    >
      <span>{children}</span>
      {copied ? <Check size={13} weight="bold" /> : <Copy size={13} />}
    </button>
  );
}

function PanelHeading({ icon: Icon, title, subtitle, action }) {
  return (
    <div className="panel-heading">
      <div className="panel-title">
        {Icon && <Icon size={18} weight="duotone" />}
        <div>
          <h2>{title}</h2>
          {subtitle && <p>{subtitle}</p>}
        </div>
      </div>
      {action}
    </div>
  );
}

function Lifecycle() {
  const steps = [
    ["DBC", "已完成"],
    ["Graduated", "已迁移"],
    ["DAMM v2", "运营中"],
  ];
  return (
    <section className="lifecycle" aria-label="代币生命周期">
      <div className="section-kicker">代币生命周期</div>
      <div className="lifecycle-track">
        {steps.map(([name, status], index) => (
          <div className="lifecycle-step" key={name}>
            <span className="lifecycle-dot"><Check size={12} weight="bold" /></span>
            <div><strong>{name}</strong><small>{status}</small></div>
            {index < steps.length - 1 && <ArrowRight className="lifecycle-arrow" size={18} />}
          </div>
        ))}
      </div>
    </section>
  );
}

function Topology() {
  return (
    <section className="topology" aria-label="官方池拓扑">
      <div className="section-kicker">官方主池拓扑</div>
      <div className="topology-route">
        <span className="token token--bg">BG</span>
        <div className="route-line"><Swap size={14} /><small>Meteora</small></div>
        <span className="token token--ant">ANTFUN</span>
        <div className="route-line"><Swap size={14} /><small>Meteora</small></div>
        <span className="token token--usdt">USDT</span>
      </div>
      <p>两池主网路径 · SOL 仅作手续费储备</p>
    </section>
  );
}

function ReserveCard({ token, amount, usd, share, tone }) {
  return (
    <article className="reserve-card">
      <div className="reserve-card__head">
        <span className={`token token--${tone}`}>{token.slice(0, 2)}</span>
        <div><span>{token} 储备</span><small>池内实时余额</small></div>
        <Pulse size={17} />
      </div>
      <strong>{amount}</strong>
      <div className="reserve-card__foot"><span>{usd}</span><b>{share}</b></div>
    </article>
  );
}

function ImpactTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const values = Object.fromEntries(payload.map((item) => [item.dataKey, item.value]));
  return (
    <div className="chart-tooltip">
      <strong>{Number(label).toLocaleString()} ANTFUN</strong>
      <span><i className="swatch swatch--violet" />买入 BG +{values.buy?.toFixed(2)}%</span>
      <span><i className="swatch swatch--blue" />卖出 BG {values.sell?.toFixed(2)}%</span>
    </div>
  );
}

function ImpactPanel({ selectedQuote, setSelectedQuote }) {
  const current = quotePresets[selectedQuote];
  return (
    <section className="panel impact-panel">
      <PanelHeading
        icon={ChartLineUp}
        title="可执行价格影响"
        subtitle="恒定乘积 AMM · 含 0.30% 基础费率 · 模拟报价"
        action={<span className="freshness"><span /> 4 秒前更新</span>}
      />
      <div className="impact-body">
        <div className="impact-chart">
          <div className="chart-legend"><span><i className="swatch swatch--violet" />ANTFUN → BG</span><span><i className="swatch swatch--blue" />BG → ANTFUN</span></div>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={impactCurve} margin={{ top: 10, right: 18, bottom: 6, left: 6 }}>
              <CartesianGrid stroke="#202a3b" strokeDasharray="3 5" vertical={false} />
              <XAxis dataKey="size" tickFormatter={(value) => value === 0 ? "0" : `${value / 1000}K`} tick={{ fill: "#78859c", fontSize: 12 }} tickLine={false} axisLine={{ stroke: "#263249" }} />
              <YAxis domain={[-1.3, 1.3]} tickFormatter={(value) => `${value}%`} tick={{ fill: "#78859c", fontSize: 12 }} tickLine={false} axisLine={false} width={38} />
              <Tooltip content={<ImpactTooltip />} cursor={{ stroke: "#63718a", strokeDasharray: "4 4" }} />
              <Area type="monotone" dataKey="buy" stroke="none" fill="#8457e6" fillOpacity={0.15} />
              <Area type="monotone" dataKey="sell" stroke="none" fill="#3c86ee" fillOpacity={0.12} />
              <Line type="monotone" dataKey="buy" stroke="#9c70ff" strokeWidth={2.2} dot={false} />
              <Line type="monotone" dataKey="sell" stroke="#4c98ff" strokeWidth={2.2} dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
          <div className="chart-axis-label">交易规模（ANTFUN）</div>
        </div>
        <div className="quote-simulator">
          <div className="simulator-title"><div><strong>交易规模模拟器</strong><small>ANTFUN → BG</small></div><span>模拟数据</span></div>
          <div className="preset-row">
            {quotePresets.map((quote, index) => (
              <button key={quote.label} className={index === selectedQuote ? "is-active" : ""} onClick={() => setSelectedQuote(index)}>{quote.label}</button>
            ))}
          </div>
          <dl className="quote-details">
            <div><dt>支付</dt><dd>{current.amount.toLocaleString()} ANTFUN</dd></div>
            <div><dt>预计获得</dt><dd>{current.receive}</dd></div>
            <div><dt>价格影响</dt><dd className={selectedQuote === 2 ? "is-warning" : "is-positive"}>{current.impact}</dd></div>
            <div><dt>最低获得（1%）</dt><dd>{current.min}</dd></div>
            <div><dt>池费</dt><dd>{current.fee}</dd></div>
          </dl>
          <div className="price-note"><Info size={14} /> 当前池价：1 ANTFUN ≈ 32.50 BG</div>
        </div>
      </div>
    </section>
  );
}

function InventoryPanel() {
  const pieData = [{ name: "BG", value: 56.4, fill: "#9664f2" }, { name: "ANTFUN", value: 43.6, fill: "#498ff5" }];
  return (
    <section className="panel inventory-panel">
      <PanelHeading icon={ChartDonut} title="库存构成" subtitle="按 ANTFUN 计价的池内资产" />
      <div className="inventory-content">
        <div className="donut-wrap">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart><Pie data={pieData} dataKey="value" innerRadius={46} outerRadius={63} startAngle={90} endAngle={-270} stroke="#0b111d" strokeWidth={4} /></PieChart>
          </ResponsiveContainer>
          <div className="donut-label"><strong>50/50</strong><span>目标权重</span></div>
        </div>
        <div className="inventory-legend">
          <div><span><i className="swatch swatch--violet" />BG</span><strong>56.4%</strong><small>偏离 +6.4%</small></div>
          <div><span><i className="swatch swatch--blue" />ANTFUN</span><strong>43.6%</strong><small>偏离 −6.4%</small></div>
        </div>
      </div>
      <div className="panel-callout"><Warning size={15} weight="fill" /><span>库存偏离目标范围，建议评估单边流量后再调整流动性。</span></div>
    </section>
  );
}

function EconomicsPanel() {
  return (
    <section className="panel economics-panel">
      <PanelHeading icon={TrendUp} title="费用收益 vs 库存风险" subtitle="过去 24 小时 · 模拟估值" />
      <div className="economics-grid">
        <div><span>累计池费</span><strong className="positive">+607.83 ANTFUN</strong><small>USDT 统一计价</small></div>
        <div><span>无常损失估算</span><strong className="negative">−184.26 ANTFUN</strong><small>相对持币基准</small></div>
        <div><span>净 LP 收益</span><strong>+423.57 ANTFUN</strong><small>费用扣除 IL</small></div>
        <div><span>费用 / IL 覆盖</span><strong>3.30×</strong><small>高于 1.00×</small></div>
      </div>
    </section>
  );
}

function DepthPanel() {
  const rows = [
    ["±0.10%", "825 ANTFUN", "26.8K BG"],
    ["±0.50%", "4.18K ANTFUN", "135.2K BG"],
    ["±1.00%", "8.44K ANTFUN", "271.9K BG"],
  ];
  return (
    <section className="panel depth-panel">
      <PanelHeading icon={Database} title="可执行深度" subtitle="按价格影响阈值测算" />
      <div className="depth-table"><div className="depth-row depth-head"><span>影响阈值</span><span>ANTFUN → BG</span><span>BG → ANTFUN</span></div>{rows.map((row) => <div className="depth-row" key={row[0]}>{row.map((cell) => <strong key={cell}>{cell}</strong>)}</div>)}</div>
    </section>
  );
}

function SwapPanel({ swapFilter, setSwapFilter }) {
  const filtered = swaps.filter((swap) => swapFilter === "all" || swap.direction === swapFilter);
  return (
    <section className="panel swaps-panel">
      <PanelHeading
        icon={Swap}
        title="实时 Swap 流量"
        subtitle="官方 BG/ANTFUN 主池 · 不是订单与成交"
        action={<div className="filter-tabs">{[["all", "全部"], ["in", "买入 BG"], ["out", "卖出 BG"]].map(([key, label]) => <button className={swapFilter === key ? "is-active" : ""} onClick={() => setSwapFilter(key)} key={key}>{label}</button>)}</div>}
      />
      <div className="swap-table-wrap">
        <table>
          <thead><tr><th>时间</th><th>流向</th><th>支付</th><th>获得</th><th>价格影响</th><th>池费</th><th>交易签名</th></tr></thead>
          <tbody>{filtered.map((swap) => (
            <tr key={swap.signature}>
              <td>{swap.time}</td>
              <td><span className={`flow flow--${swap.direction}`}>{swap.direction === "in" ? <ArrowDown size={12} /> : <ArrowUp size={12} />}{swap.direction === "in" ? "流入 ANTFUN" : "流出 ANTFUN"}</span></td>
              <td>{swap.from}</td><td>{swap.to}</td><td>{swap.impact}</td><td>{swap.fee}</td>
              <td><ShortAddress>{swap.signature}</ShortAddress></td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      <div className="swap-summary">
        <span>15 分钟储备净变化</span>
        {reserveChanges.map((item) => <div key={item.token}><strong>{item.token}</strong><b>{item.value}</b><em className={item.direction === "up" ? "positive" : "negative"}>{item.delta}</em></div>)}
      </div>
    </section>
  );
}

function PositionRail({ automation, setAutomation, openModal }) {
  return (
    <aside className="right-rail">
      <section className="panel lp-panel">
        <PanelHeading icon={Wallet} title="LP Position NFT" subtitle="Meteora DAMM v2" action={<button className="icon-button" aria-label="打开浏览器"><ArrowSquareOut size={15} /></button>} />
        <div className="nft-id"><span className="nft-mark"><CirclesFour size={22} weight="duotone" /></span><div><strong>#48291</strong><ShortAddress>8Aqk…7mPx</ShortAddress></div><span className="verified"><CheckCircle size={14} weight="fill" /> 已验证</span></div>
        <div className="position-value"><span>仓位估值</span><strong>6,564,328 ANTFUN</strong><small>模拟估值 · USDT 统一计价</small></div>
        <dl className="rail-list">
          <div><dt>池份额</dt><dd>18.42%</dd></div>
          <div><dt>未领取费用</dt><dd className="positive">607.83 ANTFUN</dd></div>
          <div><dt>创建区块</dt><dd>#352,184,927</dd></div>
        </dl>
        <button className="button button--primary button--full" onClick={() => openModal("add")}>增加流动性预览</button>
        <button className="button button--ghost button--full" onClick={() => openModal("remove")}>移除流动性预览</button>
      </section>

      <section className="panel liquidity-panel">
        <PanelHeading icon={LockKey} title="流动性状态" subtitle="可用、锁定与归属" />
        <div className="liquidity-bar"><span className="liquidity-unlocked" style={{ width: "72%" }} /><span className="liquidity-locked" style={{ width: "28%" }} /></div>
        <dl className="rail-list">
          <div><dt><i className="dot dot--green" />可用流动性</dt><dd>72.0%</dd></div>
          <div><dt><i className="dot dot--violet" />锁定流动性</dt><dd>28.0%</dd></div>
          <div><dt>归属中</dt><dd>0.0%</dd></div>
        </dl>
      </section>

      <section className="panel safety-panel">
        <PanelHeading icon={ShieldCheck} title="安全与自动化" subtitle="高风险操作需人工确认" />
        <div className={`automation-state automation-state--${automation}`}>
          <span className="status-pulse" />
          <div><strong>{automation === "running" ? "监控运行中" : "自动化已暂停"}</strong><small>{automation === "running" ? "只读监控 · 不自动广播" : "保留池数据与告警"}</small></div>
        </div>
        <dl className="rail-list">
          <div><dt>安全储备</dt><dd>12.6 SOL</dd></div>
          <div><dt>签名策略</dt><dd>人工确认</dd></div>
          <div><dt>最大价格影响</dt><dd>1.00%</dd></div>
          <div><dt>最后链上同步</dt><dd>4 秒前</dd></div>
        </dl>
        <button className={`button button--full ${automation === "running" ? "button--danger" : "button--primary"}`} onClick={() => automation === "running" ? openModal("stop") : setAutomation("running")}>
          {automation === "running" ? <><Pause size={15} weight="fill" />暂停自动化</> : <><Pulse size={15} />恢复监控</>}
        </button>
        <p className="safety-note"><Info size={13} /> 暂停不会撤出流动性，也不会出售资产。</p>
      </section>
    </aside>
  );
}

function ActionModal({ type, onClose, onStop }) {
  const [percentage, setPercentage] = useState(25);
  const [amount, setAmount] = useState("10000");
  if (!type) return null;
  if (type === "stop") {
    return (
      <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
        <div className="modal" role="dialog" aria-modal="true" aria-labelledby="stop-title">
          <button className="modal-close" onClick={onClose} aria-label="关闭"><X size={17} /></button>
          <span className="modal-icon modal-icon--danger"><Pause size={24} weight="fill" /></span>
          <h2 id="stop-title">暂停自动化监控？</h2>
          <p>系统将停止报价测算与自动告警。池内 LP 仓位保持不变，不会广播交易或移除流动性。</p>
          <div className="confirmation-box"><ShieldCheck size={17} /><span>这是可恢复操作，不涉及资产出售。</span></div>
          <div className="modal-actions"><button className="button button--ghost" onClick={onClose}>取消</button><button className="button button--danger" onClick={onStop}>确认暂停</button></div>
        </div>
      </div>
    );
  }
  const isAdd = type === "add";
  const pairBg = Number(amount || 0) * 32.5;
  const removeAnt = 3280594.8 * 0.1842 * (percentage / 100);
  const removeBg = 106645157.95 * 0.1842 * (percentage / 100);
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="liquidity-title">
        <button className="modal-close" onClick={onClose} aria-label="关闭"><X size={17} /></button>
        <span className="modal-icon"><Database size={24} weight="duotone" /></span>
        <h2 id="liquidity-title">{isAdd ? "增加流动性预览" : "移除流动性预览"}</h2>
        <p>恒定乘积池需要按当前储备比例同时提供或取回 BG 与 ANTFUN。</p>
        {isAdd ? (
          <div className="liquidity-form">
            <label><span>提供 ANTFUN</span><div><input value={amount} inputMode="decimal" onChange={(event) => setAmount(event.target.value.replace(/[^0-9.]/g, ""))} /><b>ANTFUN</b></div></label>
            <div className="paired-amount"><span>需配对 BG</span><strong>{pairBg.toLocaleString(undefined, { maximumFractionDigits: 2 })} BG</strong></div>
          </div>
        ) : (
          <div className="liquidity-form">
            <div className="percentage-row">{[25, 50, 100].map((value) => <button className={percentage === value ? "is-active" : ""} onClick={() => setPercentage(value)} key={value}>{value}%</button>)}</div>
            <div className="paired-amount"><span>预计取回</span><strong>{removeBg.toLocaleString(undefined, { maximumFractionDigits: 0 })} BG</strong><small>+ {removeAnt.toLocaleString(undefined, { maximumFractionDigits: 2 })} ANTFUN</small></div>
          </div>
        )}
        <div className="confirmation-box"><Info size={17} /><span>设计预览：未连接钱包，不会生成或广播链上交易。</span></div>
        <div className="modal-actions"><button className="button button--ghost" onClick={onClose}>关闭预览</button><button className="button button--primary" disabled>等待钱包集成</button></div>
      </div>
    </div>
  );
}

export function App() {
  const [activeNav, setActiveNav] = useState("池总览");
  const [selectedQuote, setSelectedQuote] = useState(1);
  const [swapFilter, setSwapFilter] = useState("all");
  const [automation, setAutomation] = useState("running");
  const [modal, setModal] = useState(null);
  const [accountOpen, setAccountOpen] = useState(false);
  const accountMenuRef = useRef(null);
  const maker = useMakerData();
  const bgPool = maker.health?.snapshotFresh ? maker.snapshot?.pools?.bgAntfun : null;
  const bgReserve = findReserve(bgPool, "BG");
  const antfunReserve = findReserve(bgPool, "ANTFUN");
  const backendLive = maker.status === "live" || maker.status === "degraded";
  const statusLabel = maker.status === "live" ? "主网拓扑已验证" : maker.status === "degraded" ? "主网风控阻断" : maker.status === "offline" ? "主网服务离线" : "连接主网服务";
  const issueCount = maker.snapshot?.errors?.length ?? 0;

  useEffect(() => {
    if (!accountOpen) return undefined;
    function closeOnOutsidePointer(event) {
      if (!accountMenuRef.current?.contains(event.target)) setAccountOpen(false);
    }
    function closeOnEscape(event) {
      if (event.key === "Escape") setAccountOpen(false);
    }
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [accountOpen]);

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark"><img src="/assets/autotrade-lockup-transparent.png" alt="AutoTrade" /></span>
          <div><strong>AMM Pool</strong><span>Operations</span></div>
        </div>
        <nav aria-label="主菜单">
          {navItems.map(([label, Icon]) => <button key={label} title={label} aria-label={label} className={activeNav === label ? "is-active" : ""} onClick={() => { setActiveNav(label); window.scrollTo({ top: 0, behavior: "smooth" }); }}><Icon size={18} weight={activeNav === label ? "fill" : "regular"} /><span>{label}</span></button>)}
        </nav>
        <div className="sidebar-status">
          <div><span className={`status-pulse ${maker.status === "offline" ? "is-offline" : ""}`} /><strong>{statusLabel}</strong></div>
          <span>Solana Mainnet</span><span>{maker.snapshot?.slot ? `Slot ${maker.snapshot.slot.toLocaleString()}` : "等待链上快照"}</span>
          <small>{backendLive ? "LIVE DATA API" : "SAFE FALLBACK"}</small>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div className="asset-identity">
            <div className="title-row"><h1>BG</h1><span className={`graduated ${bgPool?.identity?.verified ? "" : "is-unverified"}`}>{bgPool?.identity?.verified ? <CheckCircle size={14} weight="fill" /> : <Warning size={14} weight="fill" />}{bgPool?.identity?.verified ? "DAMM 主池已验证" : "主池待验证"}</span><span className="platform-tag">Meteora DAMM v2</span></div>
            <div className="address-row"><span>官方 BG/ANTFUN 主池</span><ShortAddress>AJJxmAV2…JPXEy</ShortAddress><span className="divider" /> <span>Mint</span><ShortAddress>HSkHx26E…xgan</ShortAddress></div>
          </div>
          <div className="top-actions">
            <span className="network"><span className="status-pulse" />Solana Mainnet</span>
            <button className="icon-button" aria-label="阻断项"><Bell size={18} />{issueCount > 0 && <i>{issueCount}</i>}</button>
            <div className="account-menu-wrap" ref={accountMenuRef}>
              <button
                className={`account-button ${accountOpen ? "is-open" : ""}`}
                type="button"
                aria-haspopup="menu"
                aria-expanded={accountOpen}
                aria-controls="operator-account-menu"
                onClick={() => setAccountOpen((open) => !open)}
              >
                <span>MM</span>
                <div><strong>运营账号</strong><small>{maker.config?.mode ?? "只读"} 模式</small></div>
                <CaretDown className={accountOpen ? "is-open" : ""} size={13} />
              </button>
              {accountOpen && (
                <section className="account-menu" id="operator-account-menu" role="menu" aria-label="运营账号">
                  <header className="account-menu__header">
                    <span>MM</span>
                    <div><strong>运营账号</strong><small>主网运营控制台</small></div>
                    <em><i className="status-pulse" />已连接</em>
                  </header>
                  <dl className="account-menu__details">
                    <div><dt>运行模式</dt><dd>{maker.config?.mode ?? "只读"}</dd></div>
                    <div><dt>公开地址</dt><dd className="ops-mono" title={maker.config?.walletAddress ?? "未配置"}>{shortAddress(maker.config?.walletAddress)}</dd></div>
                    <div><dt>签名策略</dt><dd>外部人工签名</dd></div>
                    <div><dt>权限范围</dt><dd>{maker.config?.mutationsEnabled ? "准备交易 · 外部签名" : "主网只读"}</dd></div>
                  </dl>
                  <button className="account-menu__action" type="button" role="menuitem" onClick={() => { setActiveNav("钱包与资金"); setAccountOpen(false); window.scrollTo({ top: 0, behavior: "smooth" }); }}>
                    <Wallet size={17} />查看钱包与资金<ArrowRight size={15} />
                  </button>
                  <p><ShieldCheck size={15} />仅展示公开地址，不读取或保存签名材料。</p>
                </section>
              )}
            </div>
          </div>
        </header>

        <div className={`truth-banner truth-banner--${maker.status}`}><Info size={15} weight="fill" /><span>{maker.status === "live"
          ? `已连接主网数据服务；池地址、程序、mint 与两池拓扑均已验证。${maker.health?.rpcPolicyMode === "public-risk-accepted" ? "当前使用公共 RPC 风险豁免，可能受限流或提交失败影响。" : ""}${maker.health?.executionReady ? "执行风控已就绪，交易仍需外部签名与二阶段确认。" : "当前只提供安全只读能力，执行前置条件尚未全部满足。"}`
          : maker.status === "degraded"
            ? `主网服务已连接，但执行被硬熔断：${maker.snapshot?.errors?.map((item) => `${item.pool} ${item.error}`).join("；") || "拓扑未完整验证"}`
            : "主网数据服务未连接。当前仅保留界面结构，不将设计示例金额视为真实数据。"}</span></div>

        <OperationalPageRouter page={activeNav} maker={maker} />
        <footer><span>数据源：Solana RPC · Meteora DAMM v2 / DLMM</span><span><Clock size={13} />最后更新 {maker.snapshot?.capturedAt ? new Date(maker.snapshot.capturedAt).toLocaleString("zh-CN") : "—"}</span><span>主网控制台 v0.5</span></footer>
      </main>
      <ActionModal type={modal} onClose={() => setModal(null)} onStop={() => { setAutomation("stopped"); setModal(null); }} />
    </div>
  );
}

function findReserve(pool, symbol) {
  if (!pool) return null;
  return [pool.tokenA, pool.tokenB, pool.tokenX, pool.tokenY].find((token) => token?.symbol === symbol) ?? null;
}

function formatToken(reserve) {
  if (!reserve?.amountUi) return "—";
  return Number(reserve.amountUi).toLocaleString(undefined, { maximumFractionDigits: 6 });
}

function formatNumber(value) {
  if (!Number.isFinite(value)) return "—";
  return value.toLocaleString(undefined, { maximumFractionDigits: 6 });
}

function shortAddress(value) {
  if (!value) return "未配置";
  return value.length > 18 ? `${value.slice(0, 8)}…${value.slice(-8)}` : value;
}
