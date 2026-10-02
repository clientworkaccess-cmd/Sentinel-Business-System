import { Inter, Inter_Tight } from 'next/font/google';
import { BrainShell } from '@/components/brain';

// Self-hosted at build time: nothing is fetched from Google when the demo runs.
const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });
// Inter Tight stands in for Roobert, the display face in docs/context/design.md.
const display = Inter_Tight({ subsets: ['latin'], variable: '--font-display', weight: ['400', '500'], display: 'swap' });

export const metadata = {
  title: 'Sentinel — Ask your business out loud',
  description: 'A role-aware second brain for your whole company.',
};

export default function BrainLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`${inter.variable} ${display.variable}`}>
      <BrainShell>{children}</BrainShell>
    </div>
  );
}
