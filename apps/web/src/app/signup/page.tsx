'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { AuthShell } from '@/components/AuthShell';
import { RedirectIfSignedIn } from '@/components/RedirectIfSignedIn';
import {
  ChoiceGroup,
  FieldError,
  FormAlert,
  inputClass,
  SubmitButton,
  TextField,
} from '@/components/forms';
import { homePath, type Account, type Role } from '@/lib/account';
import { api, ApiError, fieldErrors } from '@/lib/api';

// Mirrors the API's limit: the largest Tesla seats 6 besides the driver.
const SEAT_OPTIONS = [1, 2, 3, 4, 5, 6];

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
      <RedirectIfSignedIn />
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
