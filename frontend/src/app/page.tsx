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
    // Backend mode: /brain is the app for every role; it reads the real API.
    fetchCurrentUser().then(() => {
      router.replace(useAuthStore.getState().isAuthenticated ? '/brain' : '/login');
    });
  }, [router, fetchCurrentUser]);

  return (
    <div className="h-screen w-screen flex items-center justify-center bg-stone-canvas text-warm-gray text-sm">
      Connecting to Sentinel Business Engine...
    </div>
  );
}
