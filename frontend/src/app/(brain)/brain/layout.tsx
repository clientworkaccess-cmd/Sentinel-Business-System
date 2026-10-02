import { BrainShell } from '@/components/brain';
import { fontVariables } from '@/lib/fonts';

export const metadata = {
  title: 'Sentinel — Ask your business out loud',
  description: 'A role-aware second brain for your whole company.',
};

export default function BrainLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={fontVariables}>
      <BrainShell>{children}</BrainShell>
    </div>
  );
}
