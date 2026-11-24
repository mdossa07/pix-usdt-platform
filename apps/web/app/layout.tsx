import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'PixSplit — Pagamentos e liquidação', template: '%s | PixSplit' },
  description: 'Plataforma de pagamentos PIX com acompanhamento de conversão e liquidações em USDT.',
  applicationName: 'PixSplit',
  icons: { icon: '/icon.svg' },
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return <html lang="pt-BR"><body>{children}</body></html>;
}
