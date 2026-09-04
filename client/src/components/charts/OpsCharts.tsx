import { cn } from '@/lib/utils';

export type ChartSeries = {
  name: string;
  data: number[];
  color: string;
};

type DualLineChartProps = {
  categories: string[];
  series: ChartSeries[];
  className?: string;
};

export function DualLineChart({ categories, series, className }: DualLineChartProps) {
  const w = 520;
  const h = 200;
  const pad = { l: 8, r: 8, t: 12, b: 28 };
  const innerW = w - pad.l - pad.r;
  const innerH = h - pad.t - pad.b;
  const max = Math.max(1, ...series.flatMap((s) => s.data));
  const n = Math.max(1, categories.length - 1);

  const points = (data: number[]) =>
    data
      .map((v, i) => {
        const x = pad.l + (n === 0 ? innerW / 2 : (i / n) * innerW);
        const y = pad.t + innerH - (v / max) * innerH;
        return `${x},${y}`;
      })
      .join(' ');

  const area = (data: number[]) => {
    if (data.length === 0) return '';
    const pts = data.map((v, i) => {
      const x = pad.l + (n === 0 ? innerW / 2 : (i / n) * innerW);
      const y = pad.t + innerH - (v / max) * innerH;
      return [x, y] as const;
    });
    const first = pts[0];
    const last = pts[pts.length - 1];
    return `${first[0]},${pad.t + innerH} ${pts.map(([x, y]) => `${x},${y}`).join(' ')} ${last[0]},${pad.t + innerH}`;
  };

  return (
    <div className={cn('w-full', className)}>
      <svg viewBox={`0 0 ${w} ${h}`} className="h-[200px] w-full" role="img">
        <line
          x1={pad.l}
          y1={pad.t + innerH}
          x2={pad.l + innerW}
          y2={pad.t + innerH}
          className="stroke-border"
          strokeWidth={1}
        />
        {series[0] && (
          <polygon points={area(series[0].data)} fill={series[0].color} opacity={0.12} />
        )}
        {series.map((s) => (
          <polyline
            key={s.name}
            fill="none"
            points={points(s.data)}
            stroke={s.color}
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ))}
        {categories.map((label, i) => {
          const x = pad.l + (n === 0 ? innerW / 2 : (i / n) * innerW);
          return (
            <text
              key={`${label}-${i}`}
              x={x}
              y={h - 8}
              textAnchor="middle"
              className="fill-muted-foreground"
              fontSize={11}
            >
              {label}
            </text>
          );
        })}
      </svg>
      <div className="mt-1 flex flex-wrap gap-4 text-xs text-muted-foreground">
        {series.map((s) => (
          <span key={s.name} className="inline-flex items-center gap-1.5">
            <span className="h-0.5 w-4 rounded-full" style={{ background: s.color }} />
            {s.name}
          </span>
        ))}
      </div>
    </div>
  );
}

type DonutSlice = { key: string; label: string; value: number; color: string };

export function DonutChart({ slices, center }: { slices: DonutSlice[]; center: string }) {
  const total = slices.reduce((s, x) => s + x.value, 0);
  const r = 36;
  const c = 2 * Math.PI * r;
  let offset = 0;

  return (
    <div className="flex items-center gap-5">
      <svg viewBox="0 0 100 100" className="h-36 w-36 shrink-0" role="img">
        <circle cx="50" cy="50" r={r} fill="none" className="stroke-muted" strokeWidth={12} />
        {total > 0 &&
          slices
            .filter((s) => s.value > 0)
            .map((s) => {
              const len = (s.value / total) * c;
              const el = (
                <circle
                  key={s.key}
                  cx="50"
                  cy="50"
                  r={r}
                  fill="none"
                  stroke={s.color}
                  strokeWidth={12}
                  strokeDasharray={`${len} ${c - len}`}
                  strokeDashoffset={-offset}
                  transform="rotate(-90 50 50)"
                />
              );
              offset += len;
              return el;
            })}
        <text
          x="50"
          y="50"
          textAnchor="middle"
          dominantBaseline="middle"
          className="fill-foreground font-serif"
          fontSize={13}
          fontWeight={600}
        >
          {center}
        </text>
      </svg>
      <ul className="space-y-1.5 text-sm">
        {slices.map((s) => (
          <li key={s.key} className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: s.color }} />
            <span className="text-muted-foreground">{s.label}</span>
            <span className="ms-auto font-medium tabular-nums">{s.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
