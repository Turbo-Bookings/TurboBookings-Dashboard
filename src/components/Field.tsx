type Props = {
  label: string;
  name: string;
  defaultValue?: string;
  error?: string;
  hint?: string;
  placeholder?: string;
  optional?: boolean;
  autoFocus?: boolean;
};

// Form field primitive used by the New Location form (and later, every
// intake-form field). Renders the label, the input, an optional hint, and
// any server-side validation error. Server-action friendly — the input is
// uncontrolled with defaultValue so the form re-renders preserve typed data.
export function Field({
  label,
  name,
  defaultValue,
  error,
  hint,
  placeholder,
  optional,
  autoFocus,
}: Props) {
  const id = `field-${name}`;
  return (
    <div className="space-y-1.5">
      <label
        htmlFor={id}
        className="flex items-center gap-2 text-sm font-medium text-zinc-700 dark:text-zinc-300"
      >
        {label}
        {optional && (
          <span className="text-xs font-normal text-zinc-400">(optional)</span>
        )}
      </label>
      <input
        type="text"
        id={id}
        name={name}
        defaultValue={defaultValue}
        placeholder={placeholder}
        autoFocus={autoFocus}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
        className={`block w-full rounded-md border bg-white px-3 py-2 text-sm shadow-sm transition-colors placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-zinc-900 ${
          error
            ? "border-red-400 dark:border-red-500"
            : "border-zinc-300 dark:border-zinc-700"
        }`}
      />
      {error ? (
        <p
          id={`${id}-error`}
          className="text-xs font-medium text-red-600 dark:text-red-400"
        >
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-xs text-zinc-500">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
