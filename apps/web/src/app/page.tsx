import Link from 'next/link';
import { DemoAccounts } from '@/components/DemoAccounts';
import { RedirectIfSignedIn } from '@/components/RedirectIfSignedIn';
import { Wordmark } from '@/components/Wordmark';

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col px-4 py-8">
      <RedirectIfSignedIn />
      <Wordmark />
      <div className="flex flex-1 flex-col justify-center gap-6 py-12">
        <div className="space-y-3">
          <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
            Share a seat. Split the fare.
          </h1>
          <p className="text-lg text-slate-600">
            Pool a Tesla across Dhaka with people heading your way, and pay only for your part of
            the trip.
          </p>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row">
          <Link
            href="/signup"
            className="rounded-lg bg-slate-900 px-5 py-3 text-center font-medium text-white transition hover:bg-slate-700"
          >
            Create an account
          </Link>
          <Link
            href="/login"
            className="rounded-lg px-5 py-3 text-center font-medium text-slate-900 ring-1 ring-slate-300 transition hover:bg-slate-100"
          >
            Sign in
          </Link>
        </div>
        <section
          aria-labelledby="demo-heading"
          className="space-y-3 border-t border-slate-200 pt-6"
        >
          <div>
            <h2 id="demo-heading" className="text-lg font-semibold tracking-tight">
              Try the demo
            </h2>
            <p className="text-slate-600">Sign in as one of the story cast, no sign-up needed.</p>
          </div>
          <DemoAccounts />
        </section>
      </div>
    </main>
  );
}
