import { fontVariables } from '@/lib/fonts';

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return <div className={fontVariables}>{children}</div>;
}
