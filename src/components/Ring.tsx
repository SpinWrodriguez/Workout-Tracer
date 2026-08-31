/**
 * Weekly progress ring. Chrome-free by design (spec §4: charts get a single
 * dashed gridline and endpoint labels at most) — the track is the gridline.
 */
export function Ring({
  value,
  target,
  label,
  color,
  size = 76,
}: {
  value: number;
  target: number;
  label: string;
  color: string;
  size?: number;
}) {
  const stroke = 7;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const fraction = target > 0 ? Math.min(1, value / target) : 0;

  return (
    <div className="flex flex-col items-center gap-1.5">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke="var(--color-surface-2)"
            strokeWidth={stroke}
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={color}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={c}
            strokeDashoffset={c * (1 - fraction)}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-[19px] leading-none font-bold tracking-tight">{value}</span>
          <span className="text-[10px] leading-none font-medium text-text-dim">/{target}</span>
        </div>
      </div>
      <span className="label">{label}</span>
    </div>
  );
}
