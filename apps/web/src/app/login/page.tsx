'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { AuthShell } from '@/components/AuthShell';
import { DemoAccounts } from '@/components/DemoAccounts';
import { RedirectIfSignedIn } from '@/components/RedirectIfSignedIn';
import { FormAlert, SubmitButton, TextField } from '@/components/forms';
import { homePath, type Account } from '@/lib/account';
import { api, ApiError, fieldErrors } from '@/lib/api';

export default function LoginPage() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [alert, setAlert] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending(true);
    setAlert('');
    setErrors({});
    try {
      const account = await api<Account>('/auth/login', {
        method: 'POST',
        body: { email: form.get('email'), password: form.get('password') },
      });
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
      title="Sign in"
      subtitle="Welcome back. Your seat is waiting."
      footer={
        <>
          New here?{' '}
          <Link href="/signup" className="font-medium text-slate-900 underline">
            Create an account
          </Link>
        </>
      }
    >
      <RedirectIfSignedIn />
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        <FormAlert>{alert}</FormAlert>
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
          autoComplete="current-password"
          error={errors.password}
        />
        <SubmitButton pending={pending}>{pending ? 'Signing in…' : 'Sign in'}</SubmitButton>
      </form>
      <div className="my-6 flex items-center gap-3 text-sm text-slate-500">
        <span aria-hidden className="h-px flex-1 bg-slate-200" />
        or try a demo account
        <span aria-hidden className="h-px flex-1 bg-slate-200" />
      </div>
      <DemoAccounts compact />
    </AuthShell>
  );
}
