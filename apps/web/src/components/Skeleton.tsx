/** Grey rows matching a list's rhythm, so content does not shift when it streams in. */
export const RowsSkeleton = ({ rows = 3 }: { rows?: number }) => (
  <ul aria-hidden="true" className="rounded-2xl border border-rule bg-sheet p-2">
    {Array.from({ length: rows }, (_, index) => (
      <li key={index} className="flex h-[3.75rem] items-center p-3">
        <div className="h-4 w-2/3 rounded-sm bg-raised" />
      </li>
    ))}
  </ul>
);
