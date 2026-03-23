import { useState, useMemo, useCallback } from 'react';
import { useTheme } from '../context/ThemeContext';
import {
  ResponsiveContainer,
  PieChart, Pie, Cell,
  AreaChart, Area,
  LineChart, Line,
  BarChart, Bar,
  XAxis, YAxis, CartesianGrid,
  Tooltip, Legend,
} from 'recharts';
import { useCurrency } from '../context/CurrencyContext';
import { formatCurrency } from '../utils/formatCurrency';
import {
  buildPieData,
  buildAreaData,
  buildGainLossData,
  buildDividendData,
  TYPE_COLORS,
  TYPE_LABELS,
} from '../utils/chartDataUtils';
import './ChartsSection.css';

// ---------------------------------------------------------------------------
// Shared style constants for Recharts — theme-aware via hook
// ---------------------------------------------------------------------------

function useChartStyles() {
  const { theme } = useTheme();
  const dark = theme === 'dark';
  return {
    TICK_STYLE: { fill: dark ? '#8888aa' : '#5a5a78', fontSize: 11 },
    GRID_COLOR: dark ? '#2a2a46' : '#d8d8e8',
    TOOLTIP_STYLE: {
      contentStyle: {
        background:   dark ? '#1a1a32' : '#ffffff',
        border:       `1px solid ${dark ? '#3a3a5c' : '#d0d0e8'}`,
        borderRadius: 6,
        fontSize:     12,
      },
      labelStyle: { color: dark ? '#c0c0e0' : '#1a1a2e' },
      itemStyle:  { color: dark ? '#c0c0e0' : '#1a1a2e' },
    },
    PIE_STROKE:     dark ? '#0f0f23' : '#f0f0f8',
    PIE_LABEL_FILL: dark ? '#b0b0cc' : '#4a4a6a',
    LEGEND_COLOR:   dark ? '#8888aa' : '#5a5a78',
    CURSOR_FILL:    dark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)',
    LABEL_LINE:     dark ? '#555577' : '#aaaacc',
  };
}

const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

// ---------------------------------------------------------------------------
// Shared: time-range filter
// ---------------------------------------------------------------------------
const RANGES = [
  { label: '1D',  months: 1  },
  { label: '5D',  months: 1  },
  { label: '1M',  months: 2  },
  { label: '6M',  months: 6  },
  { label: '1Y',  months: 12 },
  { label: '3Y',  months: 36 },
  { label: '5Y',  months: 60 },
];

function sliceRange(data, rangeLabel) {
  if (!rangeLabel) return data;
  const r = RANGES.find((x) => x.label === rangeLabel);
  if (!r) return data;
  return data.slice(Math.max(0, data.length - r.months));
}

function RangeButtons({ range, setRange }) {
  return (
    <div className="cs-range-btns">
      {RANGES.map((r) => (
        <button
          key={r.label}
          className={`cs-range-btn${range === r.label ? ' cs-range-btn--active' : ''}`}
          onClick={() => setRange(range === r.label ? null : r.label)}
        >
          {r.label}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared hook: currency-aware formatters
// ---------------------------------------------------------------------------
function useCurrencyFormatters() {
  const { convertToDisplay, displayCurrency } = useCurrency();

  // Compact y-axis tick: "$5.2K", "€120K", etc.
  const yTick = useCallback((usd) => {
    if (usd == null) return '';
    const v = convertToDisplay(usd);
    if (v == null) return '';
    return new Intl.NumberFormat('en-US', {
      style:              'currency',
      currency:           displayCurrency,
      notation:           'compact',
      maximumFractionDigits: 1,
    }).format(v);
  }, [convertToDisplay, displayCurrency]);

  // Full value for tooltips
  const fc = useCallback((usd) =>
    formatCurrency(usd, convertToDisplay, displayCurrency),
    [convertToDisplay, displayCurrency],
  );

  return { yTick, fc, displayCurrency };
}

// ---------------------------------------------------------------------------
// Chart 1 — Current Allocation (Pie)
// ---------------------------------------------------------------------------
const RADIAN = Math.PI / 180;
// Hide label + line only for truly invisible slivers (< 1 %)
const LABEL_MIN_PERCENT = 0.01;

function PieLabel({ cx, cy, midAngle, outerRadius, percent, label: typeName, labelFill }) {
  if (percent < LABEL_MIN_PERCENT) return null;
  const radius = outerRadius + 32;
  const x = cx + radius * Math.cos(-midAngle * RADIAN);
  const y = cy + radius * Math.sin(-midAngle * RADIAN);
  const anchor = x > cx ? 'start' : 'end';
  return (
    <text x={x} y={y} textAnchor={anchor} fill={labelFill} fontSize={11}>
      <tspan x={x} dy="-0.55em">{typeName}</tspan>
      <tspan x={x} dy="1.25em" fontSize={10} opacity={0.75}>{(percent * 100).toFixed(1)}%</tspan>
    </text>
  );
}

function PieLabelLine({ percent, points, stroke, strokeWidth }) {
  if (percent < LABEL_MIN_PERCENT || !points?.length) return null;
  return (
    <path
      stroke={stroke}
      strokeWidth={strokeWidth}
      fill="none"
      d={`M${points[0].x},${points[0].y}L${points[1].x},${points[1].y}`}
    />
  );
}

function AllocationPie({ allPositions }) {
  const { fc } = useCurrencyFormatters();
  const { TOOLTIP_STYLE, PIE_STROKE, PIE_LABEL_FILL, LEGEND_COLOR, LABEL_LINE } = useChartStyles();
  const data = useMemo(
    () => buildPieData(allPositions).sort((a, b) => b.percent - a.percent),
    [allPositions],
  );

  if (data.length === 0) return <p className="cs-no-data">No current price data available.</p>;

  return (
    <ResponsiveContainer width="100%" height={340}>
      <PieChart>
        <Pie
          data={data}
          dataKey="valueUSD"
          nameKey="label"
          cx="50%"
          cy="50%"
          outerRadius={110}
          label={(props) => <PieLabel {...props} labelFill={PIE_LABEL_FILL} />}
          labelLine={(props) => <PieLabelLine {...props} stroke={LABEL_LINE} strokeWidth={1} />}
        >
          {data.map((entry) => (
            <Cell key={entry.type} fill={entry.color} stroke={PIE_STROKE} strokeWidth={2} />
          ))}
        </Pie>
        <Tooltip
          {...TOOLTIP_STYLE}
          formatter={(value, name) => [fc(value), name]}
        />
        <Legend
          iconType="circle"
          iconSize={10}
          formatter={(value, entry) =>
            `${value} ${((entry.payload.percent ?? 0) * 100).toFixed(1)}%`
          }
          wrapperStyle={{ fontSize: 12, color: LEGEND_COLOR }}
        />
      </PieChart>
    </ResponsiveContainer>
  );
}

// ---------------------------------------------------------------------------
// Chart 2 — Allocation Over Time (Stacked Area)
// ---------------------------------------------------------------------------
function AllocationArea({ allPositions }) {
  const [range, setRange] = useState(null);
  const { TICK_STYLE, GRID_COLOR, TOOLTIP_STYLE, LEGEND_COLOR } = useChartStyles();
  const { data: allData, types } = useMemo(() => buildAreaData(allPositions), [allPositions]);
  const data = useMemo(() => sliceRange(allData, range), [allData, range]);

  if (allData.length === 0) return <p className="cs-no-data">Not enough historical data.</p>;

  const yTickFmt = (v) => `${v.toFixed(0)}%`;
  const xTickFmt = data.length < 4
    ? (m) => m
    : (m) => m.endsWith('-01') ? m.slice(0, 4) : '';

  return (
    <>
      <div className="cs-chart-header">
        <h2 className="cs-title">Allocation Over Time</h2>
        <RangeButtons range={range} setRange={setRange} />
      </div>
      <ResponsiveContainer width="100%" height={300}>
        <AreaChart data={data} margin={{ top: 10, right: 20, left: 10, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={GRID_COLOR} />
          <XAxis dataKey="month" tick={TICK_STYLE} tickFormatter={xTickFmt} interval={0} />
          <YAxis tick={TICK_STYLE} tickFormatter={yTickFmt} domain={[0, 100]} width={48} />
          <Tooltip
            {...TOOLTIP_STYLE}
            formatter={(value, name) => [`${Number(value).toFixed(1)}%`, TYPE_LABELS[name] ?? name]}
            labelFormatter={(m) => m}
          />
          <Legend iconType="circle" iconSize={10} wrapperStyle={{ fontSize: 12, color: LEGEND_COLOR }} />
          {types.map((type) => (
            <Area
              key={type}
              type="monotone"
              dataKey={type}
              stackId="1"
              stroke={TYPE_COLORS[type] ?? '#636e72'}
              fill={TYPE_COLORS[type] ?? '#636e72'}
              fillOpacity={0.65}
              strokeWidth={1}
              name={TYPE_LABELS[type] ?? type}
              dot={false}
              activeDot={false}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </>
  );
}

// ---------------------------------------------------------------------------
// Chart 3 — Gain/Loss vs Invested (Line)
// ---------------------------------------------------------------------------
function GainLossLine({ allPositions, portfolioTotals }) {
  const [range, setRange] = useState(null);
  const { yTick, fc } = useCurrencyFormatters();
  const { TICK_STYLE, GRID_COLOR, TOOLTIP_STYLE, LEGEND_COLOR } = useChartStyles();
  const allData = useMemo(
    () => buildGainLossData(allPositions, portfolioTotals),
    [allPositions, portfolioTotals],
  );
  const data = useMemo(() => sliceRange(allData, range), [allData, range]);

  if (allData.length === 0) return <p className="cs-no-data">Not enough data.</p>;

  const xTickFmt = data.length < 4
    ? (m) => m
    : (m) => m.endsWith('-01') ? m.slice(0, 4) : '';

  return (
    <>
      <div className="cs-chart-header">
        <h2 className="cs-title">Portfolio Value vs. Invested</h2>
        <RangeButtons range={range} setRange={setRange} />
      </div>
      <ResponsiveContainer width="100%" height={300}>
        <LineChart data={data} margin={{ top: 10, right: 20, left: 10, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={GRID_COLOR} />
          <XAxis dataKey="month" tick={TICK_STYLE} tickFormatter={xTickFmt} interval={0} />
          <YAxis tick={TICK_STYLE} tickFormatter={yTick} width={72} />
          <Tooltip
            {...TOOLTIP_STYLE}
            formatter={(value, name) => [fc(value), name]}
            labelFormatter={(m) => m}
          />
          <Legend iconType="circle" iconSize={10} wrapperStyle={{ fontSize: 12, color: LEGEND_COLOR }} />
          <Line
            type="monotone"
            dataKey="invested"
            name="Total Invested"
            stroke="#4a9eff"
            strokeWidth={2}
            dot={false}
            connectNulls={false}
          />
          <Line
            type="monotone"
            dataKey="value"
            name="Portfolio Value"
            stroke="#20bf6b"
            strokeWidth={2}
            dot={false}
            connectNulls={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </>
  );
}

// ---------------------------------------------------------------------------
// Chart 4 — Dividends per year (Bar + custom tooltip)
// ---------------------------------------------------------------------------
function DividendTooltip({ active, payload, fc }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  const sorted = [...d.breakdown].sort((a, b) => a.month - b.month);

  return (
    <div className="cs-dividend-tooltip">
      <p className="cs-dividend-tooltip__title">
        {d.year} — {fc(d.totalUSD)}
      </p>
      {sorted.map((item, i) => (
        <p key={i} className="cs-dividend-tooltip__row">
          <span className="cs-dividend-tooltip__month">{MONTH_NAMES[item.month - 1]}</span>
          <span className="cs-dividend-tooltip__ticker">{item.ticker}</span>
          <span>{fc(item.amountUSD)}</span>
        </p>
      ))}
    </div>
  );
}

function DividendsBar({ allPositions }) {
  const { yTick, fc } = useCurrencyFormatters();
  const { TICK_STYLE, GRID_COLOR, CURSOR_FILL } = useChartStyles();
  const { rates } = useCurrency();
  const data = useMemo(() => buildDividendData(allPositions, rates), [allPositions, rates]);

  if (data.length === 0) return <p className="cs-no-data">No dividends recorded.</p>;

  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} margin={{ top: 10, right: 20, left: 10, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={GRID_COLOR} />
        <XAxis dataKey="year" tick={TICK_STYLE} />
        <YAxis tick={TICK_STYLE} tickFormatter={yTick} width={72} />
        <Tooltip
          content={<DividendTooltip fc={fc} />}
          cursor={{ fill: CURSOR_FILL }}
        />
        <Bar dataKey="totalUSD" name="Dividends" fill="#f9ca24" radius={[3, 3, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

/**
 * ChartsSection — 4 charts stacked vertically, all sourced from enriched
 * portfolio positions. No independent data fetching.
 *
 * Props:
 *   allPositions   {EnrichedPosition[]} — flat array from PortfolioView
 *   portfolioTotals {PortfolioTotals}   — from calcPortfolioTotals()
 */
export default function ChartsSection({ allPositions, portfolioTotals }) {
  if (!allPositions || allPositions.length === 0) return null;

  return (
    <div className="cs-root">
      <section className="cs-card">
        <h2 className="cs-title">Current Allocation</h2>
        <AllocationPie allPositions={allPositions} />
      </section>

      <section className="cs-card">
        <AllocationArea allPositions={allPositions} />
      </section>

      <section className="cs-card">
        <GainLossLine allPositions={allPositions} portfolioTotals={portfolioTotals} />
      </section>

      <section className="cs-card">
        <h2 className="cs-title">Dividends</h2>
        <DividendsBar allPositions={allPositions} />
      </section>
    </div>
  );
}
