'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent, type ReactNode } from 'react';
import { AuthShell } from '@/components/AuthShell';
import { FieldError, FormAlert, inputClass, SubmitButton, TextField } from '@/components/forms';
import { homePath, type Account, type Role } from '@/lib/account';
import { api, ApiError, fieldErrors } from '@/lib/api';

// Mirrors the API's limit: the largest Tesla seats 6 besides the driver.
const SEAT_OPTIONS = [1, 2, 3, 4, 5, 6];

function ChoiceGroup<T extends string>({
  name,
  legend,
  options,
  value,
  onChange,
  error,
  hint,
}: {
  name: string;
  legend: string;
  options: ReadonlyArray<{ value: T; label: ReactNode }>;
  value?: T;
  onChange?: (value: T) => void;
  error?: string;
  hint?: string;
}) {
  const errorId = `field-${name}-error`;
  return (
    <fieldset aria-describedby={error ? errorId : undefined}>
      <legend className="mb-1.5 block text-sm font-medium text-slate-700">{legend}</legend>
      <div className="grid grid-cols-2 gap-2">
        {options.map((option) => (
          <label
            key={option.value}
            className="flex cursor-pointer items-center justify-center rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-center text-sm font-medium text-slate-700 transition has-checked:border-slate-900 has-checked:bg-slate-900 has-checked:text-white has-focus-visible:ring-2 has-focus-visible:ring-slate-900/30"
          >
            <input
              type="radio"
              name={name}
              value={option.value}
              className="sr-only"
              checked={value === undefined ? undefined : value === option.value}
              onChange={() => onChange?.(option.value)}
            />
            {option.label}
          </label>
        ))}
      </div>
      {error ? (
        <FieldError id={errorId} message={error} />
      ) : (
        hint && <p className="mt-1.5 text-sm text-slate-500">{hint}</p>
      )}
    </fieldset>
  );
}

export default function SignUpPage() {
  const router = useRouter();
  const [role, setRole] = useState<Role>('passenger');
  const [pending, setPending] = useState(false);
  const [alert, setAlert] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const body = {
      role,
      name: form.get('name'),
      email: form.get('email'),
      password: form.get('password'),
      gender: form.get('gender') ?? undefined,
      ...(role === 'driver' && {
        vehicle: { name: form.get('vehicleName'), capacity: Number(form.get('vehicleCapacity')) },
      }),
    };

    setPending(true);
    setAlert('');
    setErrors({});
    try {
      const account = await api<Account>('/auth/signup', { method: 'POST', body });
      router.replace(homePath(account.user.role));
    } catch (err) {
      if (!(err instanceof ApiError)) throw err;
      const fields = fieldErrors(err);
      setErrors(fields);
      if (Object.keys(fields).length === 0) setAlert(err.message);
      setPending(false);
    }
  }

  return (
    <AuthShell
      title="Create your account"
      subtitle="Share a seat. Split the fare. Survive Dhaka traffic."
      footer={
        <>
          Already have an account?{' '}
          <Link href="/login" className="font-medium text-slate-900 underline">
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} noValidate className="space-y-5">
        <FormAlert>{alert}</FormAlert>
        <ChoiceGroup
          name="role"
          legend="I want to"
          value={role}
          onChange={setRole}
          options={[
            { value: 'passenger', label: 'Ride' },
            { value: 'driver', label: 'Drive my Tesla' },
          ]}
        />
        <TextField name="name" label="Name" autoComplete="name" error={errors.name} />
        <TextField
          name="email"
          label="Email"
          type="email"
          autoComplete="email"
          inputMode="email"
          error={errors.email}
        />
        <TextField
          name="password"
          label="Password"
          type="password"
          autoComplete="new-password"
          hint="At least 8 characters."
          error={errors.password}
        />
        <ChoiceGroup
          name="gender"
          legend="Gender"
          hint="Used to match same-gender pools."
          error={errors.gender && 'Choose your gender.'}
          options={[
            { value: 'female', label: 'Female' },
            { value: 'male', label: 'Male' },
          ]}
        />

        {role === 'driver' && (
          <fieldset className="space-y-4 rounded-xl bg-slate-50 p-4 ring-1 ring-slate-200">
            <legend className="float-left mb-1 text-sm font-semibold text-slate-900">
              Your Tesla
            </legend>
            <div className="clear-left space-y-4">
              <TextField
                name="vehicleName"
                label="Tesla name"
                placeholder="e.g. Bullet"
                error={errors['vehicle.name']}
              />
              <div>
                <label
                  htmlFor="field-vehicleCapacity"
                  className="mb-1.5 block text-sm font-medium text-slate-700"
                >
                  Passenger seats
                </label>
                <select
                  id="field-vehicleCapacity"
                  name="vehicleCapacity"
                  defaultValue={4}
                  className={inputClass}
                >
                  {SEAT_OPTIONS.map((seats) => (
                    <option key={seats} value={seats}>
                      {seats}
                    </option>
                  ))}
                </select>
                <FieldError
                  id="field-vehicleCapacity-error"
                  message={
                    errors['vehicle.capacity'] && `Passenger seats ${errors['vehicle.capacity']}.`
                  }
                />
              </div>
            </div>
          </fieldset>
        )}

        <SubmitButton pending={pending}>
          {pending ? 'Creating your account…' : 'Create account'}
        </SubmitButton>
      </form>
    </AuthShell>
  );
}
