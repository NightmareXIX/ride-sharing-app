import type { InputHTMLAttributes, ReactNode } from 'react';

export const inputClass =
  'block w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-base text-slate-900 ' +
  'shadow-xs outline-none transition placeholder:text-slate-400 ' +
  'focus:border-slate-900 focus:ring-2 focus:ring-slate-900/15 ' +
  'aria-invalid:border-red-500 aria-invalid:focus:ring-red-500/20';

export function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} className="mt-1.5 text-sm text-red-600">
      {message}
    </p>
  );
}

interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  name: string;
  label: string;
  hint?: string;
  error?: string;
}

// A labelled input whose error is announced with it (NFR-22).
export function TextField({ name, label, hint, error, ...input }: TextFieldProps) {
  const id = `field-${name}`;
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-slate-700">
        {label}
      </label>
      <input
        id={id}
        name={name}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={inputClass}
        {...input}
      />
      {error ? (
        <FieldError id={`${id}-error`} message={`${label} ${error}.`} />
      ) : (
        hint && (
          <p id={`${id}-hint`} className="mt-1.5 text-sm text-slate-500">
            {hint}
          </p>
        )
      )}
    </div>
  );
}

export function FormAlert({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <div
      role="alert"
      className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700"
    >
      {children}
    </div>
  );
}

// Disabled while the request runs, so a double tap sends it once (NFR-37).
export function SubmitButton({ pending, children }: { pending: boolean; children: ReactNode }) {
  return (
    <button
      type="submit"
      disabled={pending}
      className="flex w-full items-center justify-center rounded-lg bg-slate-900 px-4 py-2.5 text-base font-medium text-white transition hover:bg-slate-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900 disabled:cursor-wait disabled:opacity-70"
    >
      {children}
    </button>
  );
}
