import { Inter, Inter_Tight } from 'next/font/google';

// Self-hosted at build time: nothing is fetched from Google when the demo runs.
export const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });
// Inter Tight stands in for Roobert, the display face in docs/context/design.md.
export const display = Inter_Tight({ subsets: ['latin'], variable: '--font-display', weight: ['400', '500'], display: 'swap' });

/** Put on a wrapper to give its subtree the demo typography (with `.brain-root`). */
export const fontVariables = `${inter.variable} ${display.variable}`;
