'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '../stores/useAuthStore';
import { useSessionStore } from '../stores/useSessionStore';
import { AUTH_MODE } from '../lib/authMode';

export default function Home() {
  const router = useRouter();
  const { fetchCurrentUser } = useAuthStore();

  useEffect(() => {
    // Demo mode (#25): no backend to ask — the demo session decides.
    if (AUTH_MODE === 'demo') {
      useSessionStore
        .getState()
        .hydrate()
        .then(() => router.replace(useSessionStore.getState().session ? '/brain' : '/login'));
      return;
    }
    fetchCurrentUser().then(() => {
      if (useAuthStore.getState().isAuthenticated) {
        if (useAuthStore.getState().user?.role === 'employee') {
          router.replace('/me');
        } else {
          router.replace('/approvals');
        }
      } else {
        router.replace('/login');
      }
    });
  }, [router, fetchCurrentUser]);

  return (
    <div className="h-screen w-screen flex items-center justify-center bg-stone-canvas text-warm-gray text-sm">
      Connecting to Sentinel Business Engine...
    </div>
  );
}
