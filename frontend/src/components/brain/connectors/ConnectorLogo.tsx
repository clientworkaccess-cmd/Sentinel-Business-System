import React from 'react';
import type { Connector } from '@/demo/connectors';
import { cn } from '@/lib/utils';

const SIZES = { sm: 'w-9 h-9 rounded-lg p-1.5', md: 'w-11 h-11 rounded-xl p-2', lg: 'w-14 h-14 rounded-2xl p-2.5' };

/**
 * The brand mark on an always-white tile, so dark logos (GitHub, Notion, Vercel)
 * stay legible in dark mode. Brands without a bundled logo get a monogram.
 */
export function ConnectorLogo({ connector, size = 'md' }: { connector: Pick<Connector, 'name' | 'logo' | 'color'>; size?: keyof typeof SIZES }) {
  if (connector.logo) {
    return (
      <span className={cn('shrink-0 flex items-center justify-center border border-stone-border', SIZES[size])} style={{ backgroundColor: '#fff' }}>
        {/* eslint-disable-next-line @next/next/no-img-element -- tiny local SVGs; next/image adds nothing here */}
        <img src={connector.logo} alt="" className="w-full h-full object-contain" draggable={false} />
      </span>
    );
  }
  const letters = connector.name.replace(/[^A-Za-z ]/g, '').split(' ').map((w) => w[0]).join('').slice(0, 2);
  return (
    <span
      className={cn('shrink-0 flex items-center justify-center text-white font-semibold', SIZES[size], size === 'lg' ? 'text-lg' : 'text-sm')}
      style={{ backgroundColor: connector.color }}
      aria-hidden="true"
    >
      {letters}
    </span>
  );
}
