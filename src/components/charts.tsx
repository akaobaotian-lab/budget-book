import {
  ArcElement,
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  Legend,
  LinearScale,
  LineElement,
  PointElement,
  Tooltip,
  type ChartOptions,
} from 'chart.js';
import { Bar, Doughnut } from 'react-chartjs-2';
import { yen } from '../lib/format';

ChartJS.register(ArcElement, BarElement, CategoryScale, LinearScale, LineElement, PointElement, Tooltip, Legend);
ChartJS.defaults.font.family = getComputedStyle(document.documentElement).getPropertyValue('--font') || 'sans-serif';

export const COLORS = {
  personal: '#3b82c4',
  living: '#2f9d7e',
  lend: '#e0a030',
  keiba: '#c0504d',
  income: '#2f9d7e',
  out: '#d06a5a',
};

const PALETTE = ['#3b82c4', '#2f9d7e', '#e0a030', '#c0504d', '#8a6bc4', '#4fb3c9', '#d07fa8', '#7a9a3a', '#b5835a', '#6c7a89', '#e57a3c', '#5a6fd0', '#a0a050', '#c94f7c', '#999999'];

function cssVar(name: string, fallback: string) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

function baseOptions(stacked: boolean): ChartOptions<'bar'> {
  const grid = cssVar('--line', '#e5e7eb');
  const text = cssVar('--muted', '#6b7280');
  return {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { position: 'bottom', labels: { color: text, boxWidth: 12, boxHeight: 12 } },
      tooltip: {
        callbacks: { label: (c) => `${c.dataset.label}: ${yen(Number(c.raw))}` },
        filter: (c) => Number(c.raw) !== 0,
      },
    },
    scales: {
      x: { stacked, grid: { display: false }, ticks: { color: text, maxRotation: 0, autoSkip: true } },
      y: {
        stacked,
        grid: { color: grid },
        border: { display: false },
        ticks: { color: text, callback: (v) => (Number(v) >= 10000 ? `${Number(v) / 10000}万` : Number(v).toLocaleString()) },
      },
    },
  };
}

export interface Series {
  label: string;
  data: number[];
  color: string;
}

export function BarChart({ labels, series, stacked = false, height = 240 }: { labels: string[]; series: Series[]; stacked?: boolean; height?: number }) {
  return (
    <div style={{ height }}>
      <Bar
        options={baseOptions(stacked)}
        data={{
          labels,
          datasets: series.map((s) => ({
            label: s.label,
            data: s.data,
            backgroundColor: s.color,
            borderRadius: 3,
            maxBarThickness: 28,
          })),
        }}
      />
    </div>
  );
}

export function CategoryDoughnut({ items }: { items: { category: string; amount: number }[] }) {
  if (items.length === 0) return <p className="empty">データがありません</p>;
  const total = items.reduce((a, b) => a + b.amount, 0);
  return (
    <div className="doughnut-wrap">
      <div style={{ height: 220, position: 'relative' }}>
        <Doughnut
          options={{
            responsive: true,
            maintainAspectRatio: false,
            cutout: '62%',
            plugins: {
              legend: { display: false },
              tooltip: { callbacks: { label: (c) => `${c.label}: ${yen(Number(c.raw))}` } },
            },
          }}
          data={{
            labels: items.map((i) => i.category),
            datasets: [{ data: items.map((i) => i.amount), backgroundColor: items.map((_, i) => PALETTE[i % PALETTE.length]), borderWidth: 0 }],
          }}
        />
        <div className="doughnut-center">
          <small>合計</small>
          <strong>{yen(total)}</strong>
        </div>
      </div>
      <ul className="legend-list">
        {items.map((i, idx) => (
          <li key={i.category}>
            <span className="swatch" style={{ background: PALETTE[idx % PALETTE.length] }} />
            <span className="grow">{i.category}</span>
            <span className="num">{yen(i.amount)}</span>
            <span className="pct">{((i.amount / total) * 100).toFixed(1)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
