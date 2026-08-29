import { useMemo, useState } from "react";
import {
  Bell,
  CaretRight,
  ChartLineUp,
  Check,
  CheckCircle,
  CirclesThreePlus,
  Clock,
  Copy,
  CurrencyCircleDollar,
  Database,
  GearSix,
  Info,
  IntersectThree,
  ListBullets,
  MagnifyingGlass,
  Pause,
  Pulse,
  ShieldCheck,
  SlidersHorizontal,
  Strategy,
  Swap,
  TrendDown,
  TrendUp,
  Wallet,
  Warning,
  Waveform,
  XCircle,
} from "@phosphor-icons/react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const tooltipStyle = {
  background: "#111927",
  border: "1px solid #344158",
  borderRadius: 6,
  color: "#dfe6f1",
  fontSize: 12,
};

const hourlyFlow = [
  { time: "00:00", inflow: 12.4, outflow: 8.7, net: 3.7 },
  { time: "03:00", inflow: 18.1, outflow: 14.2, net: 3.9 },
  { time: "06:00", inflow: 13.8, outflow: 19.4, net: -5.6 },
  { time: "09:00", inflow: 27.5, outflow: 21.1, net: 6.4 },
  { time: "12:00", inflow: 32.9, outflow: 25.4, net: 7.5 },
  { time: "15:00", inflow: 24.6, outflow: 29.8, net: -5.2 },
  { time: "18:00", inflow: 38.2, outflow: 31.2, net: 7.0 },
  { time: "21:00", inflow: 41.6, outflow: 33.4, net: 8.2 },
];

const feeSeries = [
  { time: "08/21", bg: 66, ant: 19, total: 85 },
  { time: "08/22", bg: 81, ant: 22, total: 103 },
  { time: "08/23", bg: 74, ant: 24, total: 98 },
  { time: "08/24", bg: 96, ant: 27, total: 123 },
  { time: "08/25", bg: 108, ant: 31, total: 139 },
  { time: "08/26", bg: 117, ant: 35, total: 152 },
  { time: "08/27", bg: 131, ant: 39, total: 170 },
];

const pnlSeries = {
  "24h": [
    { t: "00", fee: 0, il: 0, net: 0 }, { t: "04", fee: 82, il: -28, net: 54 }, { t: "08", fee: 171, il: -61, net: 110 },
    { t: "12", fee: 308, il: -104, net: 204 }, { t: "16", fee: 442, il: -142, net: 300 }, { t: "20", fee: 531, il: -167, net: 364 }, { t: "24", fee: 608, il: -184, net: 424 },
  ],
  "7d": [
    { t: "08/21", fee: 85, il: -31, net: 54 }, { t: "08/22", fee: 188, il: -66, net: 122 }, { t: "08/23", fee: 286, il: -103, net: 183 },
    { t: "08/24", fee: 409, il: -141, net: 268 }, { t: "08/25", fee: 548, il: -175, net: 373 }, { t: "08/26", fee: 700, il: -218, net: 482 }, { t: "08/27", fee: 870, il: -266, net: 604 },
  ],
  "30d": [
    { t: "W1", fee: 510, il: -172, net: 338 }, { t: "W2", fee: 1086, il: -349, net: 737 }, { t: "W3", fee: 1692, il: -512, net: 1180 }, { t: "W4", fee: 2440, il: -691, net: 1749 },
  ],
};

const swapRows = [
  ["14:36:28", "BG/ANTFUN", "买入 BG", "8,420 ANTFUN", "272,447 BG", "0.10%", "25.26", "5nd7…Qp2k"],
  ["14:35:54", "BG/ANTFUN", "卖出 BG", "184,300 BG", "5,661 ANTFUN", "0.07%", "17.03", "3kL9…mR7x"],
  ["14:35:17", "BG/ANTFUN", "买入 BG", "3,250 ANTFUN", "105,411 BG", "0.04%", "9.75", "7aB2…Ls9e"],
  ["14:34:42", "BG/ANTFUN", "卖出 BG", "92,700 BG", "2,850 ANTFUN", "0.03%", "8.58", "1vQm…J8pA"],
  ["14:33:56", "ANTFUN/USDT", "买入 ANTFUN", "38,400 USDT", "20,158 ANTFUN", "0.18%", "115.20", "9zX3…Tt6y"],
  ["14:32:48", "ANTFUN/USDT", "卖出 ANTFUN", "12,600 ANTFUN", "24,000 USDT", "0.11%", "37.80", "2hP8…Vn4c"],
  ["14:31:29", "BG/ANTFUN", "买入 BG", "11,220 ANTFUN", "361,992 BG", "0.14%", "33.66", "8cW1…Kf5s"],
  ["14:30:14", "ANTFUN/USDT", "买入 ANTFUN", "17,600 USDT", "9,254 ANTFUN", "0.08%", "52.80", "4rT6…Bx9m"],
];

const alertsSeed = [
  { id: 1, time: "14:34:18", level: "warning", title: "BG 库存偏离目标 +6.4%", source: "库存护栏", pool: "BG/ANTFUN", status: "未读", detail: "BG 按 ANTFUN 计价的权重达到 56.4%，超过目标带上限 55%。系统仅提示，不会自动调仓。" },
  { id: 2, time: "14:22:05", level: "info", title: "24h 池费覆盖 IL 达到 3.30×", source: "收益监控", pool: "BG/ANTFUN", status: "未读", detail: "池费收益继续高于无常损失估算，当前无需调整安全储备。" },
  { id: 3, time: "13:58:42", level: "critical", title: "ANTFUN/USDT 单笔价格影响达到 0.91%", source: "价格影响护栏", pool: "ANTFUN/USDT", status: "已确认", detail: "该笔 Swap 接近 1.00% 告警阈值，但未超过阻断线。交易来自外部地址。" },
  { id: 4, time: "13:44:17", level: "success", title: "链上索引恢复正常", source: "数据健康", pool: "全局", status: "已读", detail: "Solana RPC 延迟已从 2.4 秒恢复到 412 毫秒，缺失区块已补齐。" },
  { id: 5, time: "12:56:09", level: "warning", title: "未领取费用超过 500 ANTFUN", source: "费用归集", pool: "BG/ANTFUN", status: "未读", detail: "当前未领取池费为 607.83 ANTFUN，可进入人工领取预览。" },
  { id: 6, time: "11:30:28", level: "info", title: "LP NFT 锁定比例无变化", source: "仓位监控", pool: "BG/ANTFUN", status: "已读", detail: "可用流动性 72%，锁定流动性 28%，归属中 0%。" },
];

function PageHeading({ icon: Icon, title, description, actions }) {
  return (
    <header className="subpage-heading">
      <div className="subpage-heading__icon"><Icon size={21} weight="duotone" /></div>
      <div><h2>{title}</h2><p>{description}</p></div>
      {actions && <div className="subpage-heading__actions">{actions}</div>}
    </header>
  );
}

function SectionHeading({ icon: Icon, title, subtitle, action }) {
  return (
    <div className="subsection-heading">
      <div><Icon size={16} weight="duotone" /><span><strong>{title}</strong>{subtitle && <small>{subtitle}</small>}</span></div>
      {action}
    </div>
  );
}

function Metric({ label, value, helper, tone = "default", icon: Icon }) {
  return (
    <article className="sub-metric">
      <div><span>{label}</span>{Icon && <Icon size={16} weight="duotone" />}</div>
      <strong className={`tone-${tone}`}>{value}</strong>
      <small>{helper}</small>
    </article>
  );
}

function Toggle({ checked, onChange, label }) {
  return <button type="button" className={`ui-toggle ${checked ? "is-on" : ""}`} onClick={() => onChange(!checked)} role="switch" aria-checked={checked} aria-label={label}><span /></button>;
}

function Pill({ children, tone = "neutral" }) {
  return <span className={`ui-pill ui-pill--${tone}`}>{children}</span>;
}

function FilterTabs({ value, onChange, options }) {
  return <div className="sub-tabs">{options.map(([key, label]) => <button key={key} className={value === key ? "is-active" : ""} onClick={() => onChange(key)}>{label}</button>)}</div>;
}

function CopyButton({ children }) {
  const [copied, setCopied] = useState(false);
  return <button className="inline-copy" onClick={() => { navigator.clipboard?.writeText(children); setCopied(true); window.setTimeout(() => setCopied(false), 1000); }}>{children}{copied ? <Check size={12} /> : <Copy size={12} />}</button>;
}

function LiquidityPositions({ openModal }) {
  const [pool, setPool] = useState("BG/ANTFUN");
  const [claimed, setClaimed] = useState(false);
  const position = pool === "BG/ANTFUN" ? {
    nft: "#48291", value: "6,564,328 ANTFUN", share: "18.42%", fees: "607.83 ANTFUN", unlocked: 72, locked: 28, bg: "19,644,038 BG", quote: "604,285.56 ANTFUN",
  } : { nft: "#52108", value: "228,540 USDT", share: "6.85%", fees: "482 USDT", unlocked: 100, locked: 0, bg: "8,740,500 ANTFUN", quote: "166,250 USDT" };
  return (
    <div className="subpage">
      <PageHeading icon={CirclesThreePlus} title="流动性仓位" description="管理 Meteora DAMM v2 LP Position NFT、费用与可用流动性。"
        actions={<><button className="button button--ghost" onClick={() => openModal("remove")}>移除预览</button><button className="button button--primary" onClick={() => openModal("add")}>增加流动性</button></>} />
      <div className="sub-metrics-grid">
        <Metric label="总仓位估值" value="1,541,400 USDT" helper="两池合计 · 模拟估值" icon={Wallet} />
        <Metric label="24h 费用收益" value="+1,168 USDT" helper="较昨日 +11.8%" tone="green" icon={TrendUp} />
        <Metric label="未领取费用" value={claimed ? "0.00 USDT" : "1,144 USDT"} helper={claimed ? "已进入领取预览" : "BG/ANTFUN 为主"} tone="violet" icon={CurrencyCircleDollar} />
        <Metric label="加权池份额" value="12.64%" helper="BG/ANTFUN + ANTFUN/USDT" icon={Database} />
      </div>
      <div className="two-column-layout liquidity-layout">
        <section className="panel sub-panel positions-list">
          <SectionHeading icon={ListBullets} title="LP Position NFT" subtitle="选择仓位查看组成与权限" action={<Pill tone="green">2 个活跃仓位</Pill>} />
          <div className="position-selector">
            {[{ pair: "BG/ANTFUN", nft: "#48291", share: "18.42%", value: "6.56M ANTFUN" }, { pair: "ANTFUN/USDT", nft: "#52108", share: "6.85%", value: "228,540 USDT" }].map((item) => (
              <button className={pool === item.pair ? "is-active" : ""} onClick={() => setPool(item.pair)} key={item.pair}>
                <span className="position-token"><IntersectThree size={18} weight="duotone" /></span>
                <span><strong>{item.pair}</strong><small>Position {item.nft}</small></span>
                <span><b>{item.value}</b><small>池份额 {item.share}</small></span><CaretRight size={15} />
              </button>
            ))}
          </div>
          <div className="position-detail-grid">
            <div><span>仓位 NFT</span><CopyButton>{position.nft} · 8Aqk…7mPx</CopyButton></div><div><span>仓位估值</span><strong>{position.value}</strong></div>
            <div><span>池份额</span><strong>{position.share}</strong></div><div><span>未领取费用</span><strong className="positive">{claimed ? "0.00" : position.fees}</strong></div>
            <div><span>池型</span><strong>Full Range · x·y=k</strong></div><div><span>签名权限</span><strong>人工确认</strong></div>
          </div>
          <button className="claim-row" disabled={claimed} onClick={() => setClaimed(true)}><CurrencyCircleDollar size={16} />{claimed ? "费用领取预览已创建" : `领取 ${position.fees} 预览`}<CaretRight size={14} /></button>
        </section>
        <section className="panel sub-panel position-composition">
          <SectionHeading icon={Database} title="仓位组成" subtitle={pool} />
          <div className="composition-value"><span>当前池份额</span><strong>{position.share}</strong><small>按当前储备比例拆分</small></div>
          <div className="asset-split"><div><span>{pool === "BG/ANTFUN" ? "BG" : "ANTFUN"}</span><strong>{position.bg}</strong><b>50.0%</b></div><div><span>{pool === "BG/ANTFUN" ? "ANTFUN" : "USDT"}</span><strong>{position.quote}</strong><b>50.0%</b></div></div>
          <div className="liquidity-status-bar"><span style={{ width: `${position.unlocked}%` }} /><i style={{ width: `${position.locked}%` }} /></div>
          <div className="status-legend"><span><i className="dot dot--green" />可用 {position.unlocked}%</span><span><i className="dot dot--violet" />锁定 {position.locked}%</span></div>
        </section>
      </div>
      <section className="panel sub-panel chart-wide">
        <SectionHeading icon={ChartLineUp} title="费用累积趋势" subtitle="过去 7 天 · 按池拆分" action={<FilterTabs value="7d" onChange={() => {}} options={[["7d", "7 天"]]} />} />
        <div className="sub-chart"><ResponsiveContainer width="100%" height="100%"><AreaChart data={feeSeries} margin={{ top: 14, right: 22, left: 0, bottom: 0 }}><CartesianGrid stroke="#202a3b" strokeDasharray="3 5" vertical={false} /><XAxis dataKey="time" tick={{ fill: "#79869a", fontSize: 11 }} tickLine={false} /><YAxis tick={{ fill: "#79869a", fontSize: 11 }} tickLine={false} axisLine={false} /><Tooltip contentStyle={tooltipStyle} /><Area type="monotone" dataKey="total" stroke="#9b6cf5" fill="#9b6cf5" fillOpacity={0.12} strokeWidth={2} /><Line type="monotone" dataKey="ant" stroke="#4b95f5" dot={false} /></AreaChart></ResponsiveContainer></div>
      </section>
    </div>
  );
}

function SwapFlow() {
  const [pool, setPool] = useState("all");
  const [direction, setDirection] = useState("all");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(swapRows[0]);
  const filtered = swapRows.filter((row) => (pool === "all" || row[1] === pool) && (direction === "all" || row[2].includes(direction)) && (!query || row.join(" ").toLowerCase().includes(query.toLowerCase())));
  return (
    <div className="subpage">
      <PageHeading icon={Swap} title="Swap 流量" description="追踪两个官方主池的链上交换、流向、价格影响与费用贡献。" actions={<button className="button button--ghost"><Clock size={14} />实时刷新 · 4s</button>} />
      <div className="sub-metrics-grid"><Metric label="24h Swap 量" value="250,419 ANTFUN" helper="两池折算" icon={Swap} /><Metric label="Swap 笔数" value="1,256" helper="成功率 99.84%" tone="green" icon={CheckCircle} /><Metric label="平均价格影响" value="0.074%" helper="P95 为 0.61%" icon={Waveform} /><Metric label="24h 池费" value="607.83 ANTFUN" helper="USDT 统一计价" tone="violet" icon={CurrencyCircleDollar} /></div>
      <div className="two-column-layout flow-layout">
        <section className="panel sub-panel">
          <SectionHeading icon={ChartLineUp} title="小时 Swap 流向" subtitle="K ANTFUN · 流入池与流出池" />
          <div className="sub-chart sub-chart--flow"><ResponsiveContainer width="100%" height="100%"><BarChart data={hourlyFlow} margin={{ top: 14, right: 16, left: -10, bottom: 0 }}><CartesianGrid stroke="#202a3b" strokeDasharray="3 5" vertical={false} /><XAxis dataKey="time" tick={{ fill: "#79869a", fontSize: 11 }} tickLine={false} /><YAxis tick={{ fill: "#79869a", fontSize: 11 }} tickLine={false} axisLine={false} /><Tooltip contentStyle={tooltipStyle} /><Bar dataKey="inflow" fill="#9b6cf5" radius={[2, 2, 0, 0]} /><Bar dataKey="outflow" fill="#4b95f5" radius={[2, 2, 0, 0]} /></BarChart></ResponsiveContainer></div>
        </section>
        <section className="panel sub-panel flow-detail">
          <SectionHeading icon={Database} title="选中 Swap" subtitle={selected[7]} action={<Pill tone="green">已确认</Pill>} />
          <dl><div><dt>池</dt><dd>{selected[1]}</dd></div><div><dt>方向</dt><dd>{selected[2]}</dd></div><div><dt>支付</dt><dd>{selected[3]}</dd></div><div><dt>获得</dt><dd>{selected[4]}</dd></div><div><dt>价格影响</dt><dd>{selected[5]}</dd></div><div><dt>池费</dt><dd>{selected[6]}</dd></div></dl>
          <CopyButton>{selected[7]}</CopyButton>
        </section>
      </div>
      <section className="panel sub-panel data-panel">
        <SectionHeading icon={ListBullets} title="链上 Swap 记录" subtitle={`${filtered.length} 条结果`} action={<div className="table-toolbar"><FilterTabs value={pool} onChange={setPool} options={[["all", "全部池"], ["BG/ANTFUN", "BG/ANTFUN"], ["ANTFUN/USDT", "ANTFUN/USDT"]]} /><label className="search-box"><MagnifyingGlass size={13} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索签名或金额" /></label></div>} />
        <div className="secondary-filter"><FilterTabs value={direction} onChange={setDirection} options={[["all", "全部方向"], ["买入", "买入"], ["卖出", "卖出"]]} /></div>
        <div className="sub-table-wrap"><table className="sub-table"><thead><tr><th>时间</th><th>池</th><th>方向</th><th>支付</th><th>获得</th><th>价格影响</th><th>池费</th><th>签名</th></tr></thead><tbody>{filtered.map((row) => <tr className={selected[7] === row[7] ? "is-selected" : ""} key={row[7]} onClick={() => setSelected(row)}>{row.map((cell, index) => <td key={`${row[7]}-${index}`} className={index === 2 ? (cell.includes("买入") ? "positive" : "violet-text") : ""}>{cell}</td>)}</tr>)}</tbody></table></div>
      </section>
    </div>
  );
}

function InventoryPnl() {
  const [range, setRange] = useState("24h");
  const data = pnlSeries[range];
  return (
    <div className="subpage">
      <PageHeading icon={ChartLineUp} title="库存与损益" description="把池费、无常损失和库存价格变动拆开，避免把资产涨跌误判为做市收益。" actions={<FilterTabs value={range} onChange={setRange} options={[["24h", "24 小时"], ["7d", "7 天"], ["30d", "30 天"]]} />} />
      <div className="sub-metrics-grid"><Metric label="净资产估值" value="1,543,920 USDT" helper="USDT 统一计价；SOL 单列为手续费" icon={Wallet} /><Metric label="累计池费" value={`+${data.at(-1).fee.toLocaleString()} ANTFUN`} helper="已实现收益" tone="green" icon={TrendUp} /><Metric label="无常损失" value={`${data.at(-1).il.toLocaleString()} ANTFUN`} helper="相对持币基准" tone="red" icon={TrendDown} /><Metric label="净 LP 收益" value={`+${data.at(-1).net.toLocaleString()} ANTFUN`} helper="池费扣除 IL" tone="violet" icon={CurrencyCircleDollar} /></div>
      <section className="panel sub-panel pnl-chart-panel"><SectionHeading icon={ChartLineUp} title="损益归因曲线" subtitle="ANTFUN 计价 · 模拟估值" action={<div className="chart-key"><span><i className="dot dot--green" />池费</span><span><i className="dot dot--violet" />净收益</span><span><i className="dot dot--red" />IL</span></div>} /><div className="sub-chart sub-chart--pnl"><ResponsiveContainer width="100%" height="100%"><LineChart data={data} margin={{ top: 15, right: 24, left: 0, bottom: 0 }}><CartesianGrid stroke="#202a3b" strokeDasharray="3 5" vertical={false} /><XAxis dataKey="t" tick={{ fill: "#79869a", fontSize: 11 }} tickLine={false} /><YAxis tick={{ fill: "#79869a", fontSize: 11 }} tickLine={false} axisLine={false} /><Tooltip contentStyle={tooltipStyle} /><ReferenceLine y={0} stroke="#536079" /><Line type="monotone" dataKey="fee" stroke="#45d690" strokeWidth={2} dot={false} /><Line type="monotone" dataKey="net" stroke="#9b6cf5" strokeWidth={2.3} dot={false} /><Line type="monotone" dataKey="il" stroke="#ef6571" strokeWidth={1.6} dot={false} /></LineChart></ResponsiveContainer></div></section>
      <div className="three-column-layout">
        <section className="panel sub-panel"><SectionHeading icon={Database} title="库存暴露" subtitle="按 USDT 计价" /><div className="exposure-list">{[["BG", "56.4%", "+6.4%", "warning"], ["ANTFUN", "34.2%", "−5.8%", "normal"], ["USDT", "9.4%", "−0.6%", "normal"]].map(([asset, share, drift, state]) => <div key={asset}><span>{asset}</span><strong>{share}</strong><b className={state === "warning" ? "is-warning" : ""}>{drift}</b><div><i style={{ width: share }} /></div></div>)}</div></section>
        <section className="panel sub-panel"><SectionHeading icon={CurrencyCircleDollar} title="收益归因" subtitle="净收益构成" /><div className="attribution-list"><div><span>Swap 池费</span><strong className="positive">+607.83</strong></div><div><span>无常损失</span><strong className="negative">−184.26</strong></div><div><span>价格变动</span><strong>+96.42</strong></div><div className="total"><span>净变化</span><strong>+520.00 ANTFUN</strong></div></div></section>
        <section className="panel sub-panel"><SectionHeading icon={Warning} title="再平衡建议" subtitle="仅建议，不自动执行" /><div className="recommendation"><span className="recommendation-icon"><Warning size={18} weight="fill" /></span><strong>BG 权重偏高 6.4%</strong><p>优先等待自然卖出流量。若偏离超过 10%，再进入人工移除/换币预览。</p><button className="button button--ghost">查看模拟方案</button></div></section>
      </div>
    </div>
  );
}

function AutomationStrategies({ automation, setAutomation, openModal }) {
  const [states, setStates] = useState({ impact: true, inventory: true, fees: true, health: true });
  const strategies = [
    ["impact", "价格影响护栏", "单笔影响 ≥ 1.00% 时告警", ShieldCheck, "监控"],
    ["inventory", "库存偏离护栏", "偏离目标权重 ≥ 10% 时升级", SlidersHorizontal, "监控"],
    ["fees", "费用领取提醒", "未领取费用 ≥ 500 ANTFUN", CurrencyCircleDollar, "提醒"],
    ["health", "链上数据健康", "RPC 延迟 ≥ 2 秒时冻结建议", Pulse, "保护"],
  ];
  return (
    <div className="subpage">
      <PageHeading icon={Strategy} title="自动化策略" description="自动观察与生成预览，所有资产操作都保留人工签名确认。" actions={<button className={`button ${automation === "running" ? "button--danger" : "button--primary"}`} onClick={() => automation === "running" ? openModal("stop") : setAutomation("running")}>{automation === "running" ? <><Pause size={14} />暂停全部监控</> : <><Pulse size={14} />恢复全部监控</>}</button>} />
      <div className="automation-banner"><span className="status-pulse" /><div><strong>{automation === "running" ? "自动化监控运行中" : "自动化监控已暂停"}</strong><small>执行模式：只读监控 + 人工确认 · 不会自动广播链上交易</small></div><Pill tone={automation === "running" ? "green" : "warning"}>{automation === "running" ? "4/4 正常" : "0/4 暂停"}</Pill></div>
      <div className="strategy-grid">{strategies.map(([key, title, rule, Icon, type]) => <article className="panel strategy-card" key={key}><div className="strategy-card__head"><span><Icon size={19} weight="duotone" /></span><Pill tone="neutral">{type}</Pill><Toggle checked={states[key] && automation === "running"} onChange={(value) => setStates((s) => ({ ...s, [key]: value }))} label={`${title}开关`} /></div><h3>{title}</h3><p>{rule}</p><div className="strategy-card__meta"><span>最后触发</span><strong>{key === "inventory" ? "2 分钟前" : key === "impact" ? "38 分钟前" : "未触发"}</strong></div><button className="strategy-edit">编辑条件 <CaretRight size={13} /></button></article>)}</div>
      <div className="two-column-layout automation-bottom">
        <section className="panel sub-panel"><SectionHeading icon={SlidersHorizontal} title="全局执行边界" subtitle="策略不可覆盖这些限制" /><div className="rules-form"><label><span>最大可接受价格影响</span><div><input value="1.00" readOnly /><b>%</b></div></label><label><span>最大库存偏离</span><div><input value="10.0" readOnly /><b>%</b></div></label><label><span>最小安全储备</span><div><input value="10.0" readOnly /><b>SOL</b></div></label><label><span>交易签名模式</span><div className="locked-input"><ShieldCheck size={13} />始终人工确认</div></label></div></section>
        <section className="panel sub-panel"><SectionHeading icon={ListBullets} title="最近状态事件" subtitle="自动化状态机审计" /><div className="event-timeline">{[["14:34:18", "库存偏离护栏", "触发提醒", "warning"], ["13:58:42", "价格影响护栏", "接近阈值", "critical"], ["13:44:17", "链上数据健康", "恢复正常", "success"], ["12:56:09", "费用领取提醒", "生成预览", "info"]].map(([time, name, state, tone]) => <div key={time}><i className={`event-dot event-dot--${tone}`} /><span>{time}</span><strong>{name}</strong><Pill tone={tone}>{state}</Pill></div>)}</div></section>
      </div>
    </div>
  );
}

function WalletFunds() {
  const [wallet, setWallet] = useState("MM-001");
  const [preview, setPreview] = useState(false);
  const wallets = [
    { id: "MM-001", role: "主 LP 钱包", address: "8Aqk…7mPx", sol: "18.42", status: "只读连接", value: "1,315,400 USDT" },
    { id: "MM-002", role: "ANTFUN/USDT 仓位", address: "3Nv7…9bWk", sol: "8.76", status: "只读连接", value: "230,200 USDT" },
    { id: "SAFE-01", role: "安全储备", address: "7Kq2…4dLm", sol: "12.60", status: "监控地址", value: "12.6 SOL" },
  ];
  const current = wallets.find((item) => item.id === wallet);
  return (
    <div className="subpage">
      <PageHeading icon={Wallet} title="钱包与资金" description="查看运营地址、池内资产和安全储备；助记词与私钥不进入本系统。" actions={<button className="button button--primary" onClick={() => setPreview(true)}>资金划转预览</button>} />
      <div className="security-notice"><ShieldCheck size={16} weight="fill" /><span>当前页面仅展示公开地址与模拟估值。不会读取、显示或上传助记词和私钥。</span></div>
      <div className="sub-metrics-grid"><Metric label="资金总估值" value="1,548,120 USDT" helper="交易资产统一计价" icon={Wallet} /><Metric label="池内资产" value="1,541,400 USDT" helper="99.57% 已部署" tone="violet" icon={Database} /><Metric label="可用 USDT" value="6,720 USDT" helper="未部署交易资金" tone="green" icon={CurrencyCircleDollar} /><Metric label="SOL 手续费储备" value="12.60 SOL" helper="高于 10 SOL 下限" icon={ShieldCheck} /></div>
      <div className="two-column-layout wallet-layout">
        <section className="panel sub-panel"><SectionHeading icon={Wallet} title="运营地址" subtitle="3 个公开地址" /><div className="wallet-list">{wallets.map((item) => <button key={item.id} className={wallet === item.id ? "is-active" : ""} onClick={() => setWallet(item.id)}><span className="wallet-avatar">{item.id.slice(0, 2)}</span><span><strong>{item.id}</strong><small>{item.role}</small></span><span><b>{item.value}</b><small>{item.address}</small></span><Pill tone={item.id === "SAFE-01" ? "warning" : "green"}>{item.status}</Pill></button>)}</div></section>
        <section className="panel sub-panel wallet-detail"><SectionHeading icon={Database} title={current.id} subtitle={current.role} action={<CopyButton>{current.address}</CopyButton>} /><div className="wallet-balance"><span>SOL 余额</span><strong>{current.sol} SOL</strong><small>链上公开余额 · 模拟刷新</small></div><div className="fund-allocation"><div><span>LP 仓位</span><strong>{current.id === "SAFE-01" ? "0%" : "82%"}</strong></div><div><span>可用资产</span><strong>{current.id === "SAFE-01" ? "100%" : "12%"}</strong></div><div><span>费用待领</span><strong>{current.id === "SAFE-01" ? "0%" : "6%"}</strong></div></div></section>
      </div>
      <section className="panel sub-panel permissions-panel"><SectionHeading icon={ShieldCheck} title="权限与签名策略" subtitle="系统级安全边界" /><div className="permissions-grid"><div><span>读取公开余额</span><Pill tone="green">允许</Pill></div><div><span>生成交易预览</span><Pill tone="green">允许</Pill></div><div><span>自动签名</span><Pill tone="critical">禁止</Pill></div><div><span>读取助记词 / 私钥</span><Pill tone="critical">禁止</Pill></div><div><span>广播交易</span><Pill tone="warning">人工确认</Pill></div><div><span>移除全部流动性</span><Pill tone="warning">二次确认</Pill></div></div></section>
      {preview && <div className="inline-action-preview"><button aria-label="关闭资金预览" onClick={() => setPreview(false)}><XCircle size={18} /></button><CurrencyCircleDollar size={22} /><div><strong>资金划转预览</strong><span>选择来源、目标与金额后才能生成预览；当前未连接钱包。</span></div><button className="button button--ghost" disabled>等待钱包集成</button></div>}
    </div>
  );
}

function RiskControl({ openModal }) {
  const [rules, setRules] = useState({ impact: true, reserve: true, inventory: true, rpc: true, loss: true });
  const [testState, setTestState] = useState("idle");
  const riskRules = [
    ["impact", "最大价格影响", "1.00%", "接近阈值时告警，不拦截外部 Swap"],
    ["reserve", "最小安全储备", "10.0 SOL", "低于下限时禁止生成资金划转预览"],
    ["inventory", "库存偏离上限", "10.0%", "超过上限时升级为严重告警"],
    ["rpc", "RPC 延迟上限", "2,000 ms", "超时后冻结所有自动化建议"],
    ["loss", "单日 IL 预警", "2.00%", "相对持币基准评估"],
  ];
  return (
    <div className="subpage">
      <PageHeading icon={ShieldCheck} title="风险控制" description="集中管理价格影响、储备、库存、数据健康和损失护栏。" actions={<button className="button button--danger" onClick={() => openModal("stop")}><Pause size={14} />暂停全部自动化</button>} />
      <div className="risk-overview"><div className="risk-score"><ShieldCheck size={26} weight="duotone" /><span><strong>低风险</strong><small>综合分 18 / 100</small></span></div>{[["价格影响", "正常", "green"], ["安全储备", "正常", "green"], ["库存偏离", "需关注", "warning"], ["数据健康", "正常", "green"]].map(([label, state, tone]) => <div key={label}><span>{label}</span><Pill tone={tone}>{state}</Pill></div>)}</div>
      <div className="two-column-layout risk-layout">
        <section className="panel sub-panel"><SectionHeading icon={SlidersHorizontal} title="风险规则" subtitle="5 条已验证护栏" /><div className="risk-rules">{riskRules.map(([key, name, value, desc]) => <div key={key}><Toggle checked={rules[key]} onChange={(checked) => setRules((current) => ({ ...current, [key]: checked }))} label={`${name}开关`} /><span><strong>{name}</strong><small>{desc}</small></span><b>{value}</b><button>编辑</button></div>)}</div></section>
        <section className="panel sub-panel"><SectionHeading icon={Waveform} title="风险矩阵" subtitle="概率 × 影响" /><div className="risk-matrix"><div className="matrix-axis">影响 →</div>{["低", "中", "高", "严重"].map((impact, i) => ["低", "中", "高", "极高"].map((prob, j) => <div className={`matrix-cell matrix-cell--${Math.min(i + j, 3)}`} key={`${impact}-${prob}`}><small>{prob}/{impact}</small>{i === 2 && j === 1 && <span>库存</span>}{i === 1 && j === 2 && <span>影响</span>}</div>))}</div><div className="matrix-legend"><span>当前风险项位于可控区域</span><Pill tone="green">无阻断项</Pill></div></section>
      </div>
      <section className="panel sub-panel stress-panel"><SectionHeading icon={Warning} title="压力测试" subtitle="不发起交易，仅重算风险指标" action={<button className="button button--ghost" onClick={() => { setTestState("running"); window.setTimeout(() => setTestState("done"), 700); }}>{testState === "running" ? "计算中…" : "运行模拟"}</button>} /><div className="stress-grid">{[["BG −20%", "IL 1.84%", "库存偏离 8.2%", "warning"], ["ANTFUN −20%", "IL 1.67%", "储备 12.6 SOL", "green"], ["Swap 量 ×3", "池费 +146%", "P95 影响 0.88%", "green"], ["RPC 中断 5m", "冻结建议", "仓位不变", "warning"]].map(([scenario, result, guard, tone]) => <div key={scenario}><span>{scenario}</span><strong>{result}</strong><Pill tone={tone}>{guard}</Pill></div>)}</div>{testState === "done" && <div className="test-result"><CheckCircle size={15} />压力测试完成：没有场景触发资产操作。</div>}</section>
    </div>
  );
}

function AlertLogs() {
  const [level, setLevel] = useState("all");
  const [readIds, setReadIds] = useState(new Set(alertsSeed.filter((item) => item.status !== "未读").map((item) => item.id)));
  const [selected, setSelected] = useState(alertsSeed[0]);
  const filtered = alertsSeed.filter((item) => level === "all" || item.level === level);
  const unread = alertsSeed.filter((item) => !readIds.has(item.id)).length;
  return (
    <div className="subpage">
      <PageHeading icon={Bell} title="告警日志" description="查看库存、价格影响、费用和数据健康事件的完整审计记录。" actions={<button className="button button--ghost" onClick={() => setReadIds(new Set(alertsSeed.map((item) => item.id)))}><Check size={14} />全部标为已读</button>} />
      <div className="sub-metrics-grid"><Metric label="未读告警" value={unread.toString()} helper="需要人工查看" tone="red" icon={Bell} /><Metric label="严重事件" value="1" helper="过去 24 小时" tone="red" icon={Warning} /><Metric label="已恢复" value="8" helper="无需进一步处理" tone="green" icon={CheckCircle} /><Metric label="平均确认时间" value="2m 18s" helper="较昨日 −34s" icon={Clock} /></div>
      <div className="two-column-layout alert-layout">
        <section className="panel sub-panel alert-list-panel"><SectionHeading icon={ListBullets} title="事件流" subtitle={`${filtered.length} 条事件`} action={<FilterTabs value={level} onChange={setLevel} options={[["all", "全部"], ["critical", "严重"], ["warning", "警告"], ["info", "信息"]]} />} /><div className="alert-list">{filtered.map((alert) => <button key={alert.id} className={`${selected.id === alert.id ? "is-active" : ""} ${readIds.has(alert.id) ? "is-read" : ""}`} onClick={() => { setSelected(alert); setReadIds((ids) => new Set([...ids, alert.id])); }}><i className={`alert-icon alert-icon--${alert.level}`}>{alert.level === "critical" || alert.level === "warning" ? <Warning size={15} weight="fill" /> : alert.level === "success" ? <CheckCircle size={15} weight="fill" /> : <Info size={15} weight="fill" />}</i><span><strong>{alert.title}</strong><small>{alert.time} · {alert.source} · {alert.pool}</small></span>{!readIds.has(alert.id) && <b />}</button>)}</div></section>
        <section className="panel sub-panel alert-detail"><SectionHeading icon={Bell} title="告警详情" subtitle={`事件 #${selected.id}`} action={<Pill tone={selected.level}>{selected.level === "critical" ? "严重" : selected.level === "warning" ? "警告" : "信息"}</Pill>} /><div className="detail-title"><span>{selected.time}</span><h3>{selected.title}</h3><p>{selected.detail}</p></div><dl><div><dt>来源</dt><dd>{selected.source}</dd></div><div><dt>池</dt><dd>{selected.pool}</dd></div><div><dt>处理状态</dt><dd>{readIds.has(selected.id) ? "已读" : selected.status}</dd></div><div><dt>资产操作</dt><dd>无</dd></div></dl><div className="alert-actions"><button className="button button--ghost">查看相关数据</button><button className="button button--primary" onClick={() => setReadIds((ids) => new Set([...ids, selected.id]))}>确认事件</button></div></section>
      </div>
    </div>
  );
}

function SettingsPage() {
  const [tab, setTab] = useState("general");
  const [saved, setSaved] = useState(false);
  const [settings, setSettings] = useState({ compact: true, live: true, sound: false, desktop: true, email: false, stale: true, confirm: true, telemetry: false });
  const update = (key) => (value) => setSettings((current) => ({ ...current, [key]: value }));
  return (
    <div className="subpage">
      <PageHeading icon={GearSix} title="设置" description="配置界面、数据源、通知和安全确认；敏感凭证不在前端保存。" actions={<button className="button button--primary" onClick={() => { setSaved(true); window.setTimeout(() => setSaved(false), 1600); }}><Check size={14} />保存设置</button>} />
      <div className="settings-layout">
        <aside className="panel settings-nav">{[["general", "常规", GearSix], ["data", "数据源", Database], ["notifications", "通知", Bell], ["security", "安全", ShieldCheck]].map(([key, label, Icon]) => <button className={tab === key ? "is-active" : ""} onClick={() => setTab(key)} key={key}><Icon size={16} /><span>{label}</span><CaretRight size={13} /></button>)}</aside>
        <section className="panel settings-content">
          {tab === "general" && <><SectionHeading icon={GearSix} title="常规设置" subtitle="显示与刷新体验" /><SettingRow title="紧凑控制台布局" desc="在一个桌面视口中展示更多 AMM 指标"><Toggle checked={settings.compact} onChange={update("compact")} label="紧凑布局" /></SettingRow><SettingRow title="实时数据刷新" desc="每 4 秒刷新模拟链上数据"><Toggle checked={settings.live} onChange={update("live")} label="实时刷新" /></SettingRow><SettingRow title="默认页面" desc="登录后首先进入的菜单"><select defaultValue="overview"><option value="overview">池总览</option><option value="positions">流动性仓位</option><option value="risk">风险控制</option></select></SettingRow><SettingRow title="计价单位" desc="金额与收益的主显示单位"><select defaultValue="usdt"><option value="usdt">USDT</option><option value="antfun">ANTFUN</option></select></SettingRow></>}
          {tab === "data" && <><SectionHeading icon={Database} title="数据源" subtitle="公开链上数据连接" /><div className="data-source-card"><span className="status-pulse" /><div><strong>Solana Mainnet RPC</strong><small>延迟 412 ms · 最后同步 4 秒前</small></div><Pill tone="green">正常</Pill></div><div className="data-source-card"><span className="status-pulse" /><div><strong>Meteora DAMM v2</strong><small>两个官方主池 · met-dbc 来源</small></div><Pill tone="green">正常</Pill></div><SettingRow title="数据过期告警" desc="超过 30 秒未更新时显示全局提示"><Toggle checked={settings.stale} onChange={update("stale")} label="数据过期告警" /></SettingRow><SettingRow title="RPC 端点" desc="当前原型仅展示连接状态"><input value="Mainnet · managed endpoint" readOnly /></SettingRow></>}
          {tab === "notifications" && <><SectionHeading icon={Bell} title="通知设置" subtitle="告警到达方式" /><SettingRow title="桌面通知" desc="严重和警告级事件"><Toggle checked={settings.desktop} onChange={update("desktop")} label="桌面通知" /></SettingRow><SettingRow title="声音提醒" desc="只对严重风险事件播放"><Toggle checked={settings.sound} onChange={update("sound")} label="声音提醒" /></SettingRow><SettingRow title="邮件摘要" desc="每日发送费用、IL 和库存摘要"><Toggle checked={settings.email} onChange={update("email")} label="邮件摘要" /></SettingRow><SettingRow title="免打扰时段" desc="严重事件不受免打扰限制"><select defaultValue="none"><option value="none">关闭</option><option value="night">23:00–08:00</option></select></SettingRow></>}
          {tab === "security" && <><SectionHeading icon={ShieldCheck} title="安全设置" subtitle="签名与本地数据边界" /><div className="security-lock"><ShieldCheck size={22} weight="duotone" /><div><strong>助记词与私钥隔离</strong><small>本系统不读取、不显示、不传输钱包秘密。</small></div><Pill tone="green">已启用</Pill></div><SettingRow title="高风险操作二次确认" desc="移除全部流动性与资金划转"><Toggle checked={settings.confirm} onChange={update("confirm")} label="二次确认" /></SettingRow><SettingRow title="匿名产品遥测" desc="不包含地址、余额或交易签名"><Toggle checked={settings.telemetry} onChange={update("telemetry")} label="匿名遥测" /></SettingRow><SettingRow title="会话模式" desc="当前原型固定为只读模式"><div className="locked-input"><ShieldCheck size={13} />只读 + 人工确认</div></SettingRow></>}
        </section>
      </div>
      {saved && <div className="save-toast"><CheckCircle size={16} weight="fill" />设置已保存到本地原型状态</div>}
    </div>
  );
}

function SettingRow({ title, desc, children }) {
  return <div className="setting-row"><div><strong>{title}</strong><small>{desc}</small></div><div>{children}</div></div>;
}

export function SubPageRouter({ page, automation, setAutomation, openModal }) {
  const component = useMemo(() => ({
    "流动性仓位": <LiquidityPositions openModal={openModal} />,
    "Swap 流量": <SwapFlow />,
    "库存与损益": <InventoryPnl />,
    "自动化策略": <AutomationStrategies automation={automation} setAutomation={setAutomation} openModal={openModal} />,
    "钱包与资金": <WalletFunds />,
    "风险控制": <RiskControl openModal={openModal} />,
    "告警日志": <AlertLogs />,
    "设置": <SettingsPage />,
  }), [page, automation, setAutomation, openModal]);
  return component[page] || null;
}
