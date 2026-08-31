/* -------------------------------------------------------------------------- */
/*  Weekly progress ring.                                                     */
/*                                                                            */
/*  Chrome-free (spec §4): the track is the only gridline. The centre ring is  */
/*  deliberately larger — sets are the metric that actually drives the week,   */
/*  and the size difference says so without a word of explanation.            */
/*                                                                            */
/*  Inside the ring is what is left to do rather than the target, because      */
/*  "21 left" is something you can act on and "/33" is arithmetic homework.    */
/*  The target still sits under the label for anyone who wants the denominator.*/
/* -------------------------------------------------------------------------- */

export function Ring({
  value,
  target,
  label,
  color,
  size = 78,
  /** Row height, so rings of different sizes still share a baseline. */
  slotHeight,
  emphasis = false,
}: {
  value: number;
  target: number;
  label: string;
  color: string;
  size?: number;
  slotHeight?: number;
  emphasis?: boolean;
}) {
  const stroke = emphasis ? 8 : 7;
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  const fraction = target > 0 ? Math.min(1, value / target) : 0;
  const remaining = Math.max(0, target - value);

  return (
    <div className="flex flex-1 flex-col items-center">
      <div className="flex items-center justify-center" style={{ height: slotHeight ?? size }}>
        <div className="relative" style={{ width: size, height: size }}>
          <svg width={size} height={size} className="-rotate-90" aria-hidden="true">
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
              strokeDasharray={circumference}
              strokeDashoffset={circumference * (1 - fraction)}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-1">
            <span
              className="leading-none font-bold tracking-tight"
              style={{ fontSize: emphasis ? 26 : 21 }}
            >
              {value}
            </span>
            <span className="text-[11px] leading-none font-medium text-text-dim">
              {remaining === 0 ? 'done' : `${remaining} left`}
            </span>
          </div>
        </div>
      </div>

      <span className="mt-3 text-[15px] font-medium">{label}</span>
      <span className="mt-0.5 text-[11.5px] font-medium text-text-dim">{target} target</span>
      <span className="sr-only">
        {value} of {target} {label}
      </span>
    </div>
  );
}
