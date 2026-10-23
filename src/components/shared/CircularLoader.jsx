export function CircularLoader({ className = "" }) {
  return (
    <div
      role="status"
      aria-label="Loading"
      className={`pointer-events-none absolute inset-0 flex items-center justify-center ${className}`}
    >
      <span className="h-8 w-8 animate-spin rounded-full border-2 border-current border-t-transparent opacity-40" />
    </div>
  );
}
