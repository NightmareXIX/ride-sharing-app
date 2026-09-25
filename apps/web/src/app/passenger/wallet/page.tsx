'use client';

import { AppShell } from '@/components/AppShell';
import { WalletScreen } from '@/components/WalletScreen';
import { useAccount } from '@/lib/useAccount';

export default function PassengerWalletPage() {
  const { state, retry } = useAccount('passenger');

  return (
    <AppShell state={state} retry={retry}>
      {state.status === 'ready' && (
        <div className="space-y-4">
          <h1 className="text-2xl font-semibold tracking-tight">Wallet</h1>
          <WalletScreen role="passenger" />
        </div>
      )}
    </AppShell>
  );
}
