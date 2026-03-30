import type { AppMode } from '../types';

export interface ModeTheme {
  name: string;
  contextLabel: string;
  accent: string;
  accentLight: string;
  accentDark: string;
  accentBorder: string;
  bg: string;
  surface: string;
  logoGradient: string;
  currencySymbol: string;
  currencyCode: string;
  entityLabel: string;        // "Transaction" | "Listing"
  entityLabelPlural: string;  // "Transactions" | "Listings"
  impactLabel: string;        // "Total SGD at Risk" | "Recoverable GMV"
  clusterVerb: string;        // "Transaction Discovery" | "Market Discovery"
}

export const THEMES: Record<AppMode, ModeTheme> = {
  FINTECH: {
    name: 'Strategic Governance Hub',
    contextLabel: 'DBS FinTech · PayNow ⇄ DuitNow',
    accent:        '#00a86b',
    accentLight:   '#f0fdf4',
    accentDark:    '#166534',
    accentBorder:  '#bbf7d0',
    bg:            '#f6f5f3',
    surface:       '#ffffff',
    logoGradient:  'linear-gradient(135deg, #00a86b 0%, #005c3b 100%)',
    currencySymbol: 'SGD ',
    currencyCode:   'SGD',
    entityLabel:      'Transaction',
    entityLabelPlural: 'Transactions',
    impactLabel:    'Total SGD at Risk',
    clusterVerb:    'Transaction Discovery',
  },
  RECOMMERCE: {
    name: 'AI-Native Seller Special Projects',
    contextLabel: 'Carousell · Seller Friction Intelligence',
    accent:        '#e8002d',
    accentLight:   '#fff1f2',
    accentDark:    '#9f1239',
    accentBorder:  '#fecdd3',
    bg:            '#ffffff',
    surface:       '#fafafa',
    logoGradient:  'linear-gradient(135deg, #e8002d 0%, #9f1239 100%)',
    currencySymbol: '$',
    currencyCode:   'USD',
    entityLabel:      'Listing',
    entityLabelPlural: 'Listings',
    impactLabel:    'Recoverable GMV',
    clusterVerb:    'Market Discovery',
  },
};

export function applyTheme(mode: AppMode): void {
  const t = THEMES[mode];
  const root = document.documentElement;
  root.style.setProperty('--color-accent',        t.accent);
  root.style.setProperty('--color-accent-light',  t.accentLight);
  root.style.setProperty('--color-accent-dark',   t.accentDark);
  root.style.setProperty('--color-accent-border', t.accentBorder);
  root.style.setProperty('--color-bg',            t.bg);
  root.style.setProperty('--color-surface',       t.surface);
  root.setAttribute('data-mode', mode);
}
