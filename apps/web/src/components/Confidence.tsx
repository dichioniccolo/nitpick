/** Five ticks read faster down a column than "3/5". */
export const Confidence = ({ value }: { value: number | null }) =>
  value === null ? null : (
    <span
      role="img"
      aria-label={`Confidence to merge: ${value} of 5`}
      className="inline-flex gap-0.5 align-middle"
    >
      {[1, 2, 3, 4, 5].map((tick) => (
        <span key={tick} className={`h-3.5 w-1.5 ${tick <= value ? "bg-ink" : "bg-rule"}`} />
      ))}
    </span>
  );
