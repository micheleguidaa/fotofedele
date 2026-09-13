import { cx } from "../ui";

export function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <label className={cx("inline-flex cursor-pointer items-center gap-2 text-sm", disabled && "cursor-not-allowed opacity-50")}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cx(
          "relative inline-flex h-6 w-10 shrink-0 items-center rounded-full border transition-colors",
          checked ? "border-accent bg-accent" : "border-line-strong bg-subtle",
        )}
      >
        <span className={cx("inline-block size-4 rounded-full bg-surface shadow transition-transform", checked ? "translate-x-5" : "translate-x-1")} />
      </button>
      <span>{label}</span>
    </label>
  );
}
