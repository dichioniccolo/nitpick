/** Grey rows matching a list's rhythm, so content does not shift when it streams in. */
export const RowsSkeleton = ({ rows = 3 }: { rows?: number }) => (
  <ul aria-hidden="true" className="mt-2 divide-y divide-rule">
    {Array.from({ length: rows }, (_, index) => (
      <li key={index} className="py-3">
        <div className="h-5 w-2/3 rounded-sm bg-rule" />
      </li>
    ))}
  </ul>
);
