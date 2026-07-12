/**
 * Placeholder design tokens shared by mobile and web pitch surfaces.
 * Will be replaced by the real brand system before public launch.
 */
export const colors = {
  background: '#0E0C10',
  surface: '#1A171F',
  textPrimary: '#F7F5FA',
  textSecondary: '#B7B0C0',
  accent: '#FF5A7A',
  accentSoft: '#FFD3DC',
  success: '#3ECF8E',
  danger: '#E5484D',
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 40,
} as const;

export const radii = {
  sm: 8,
  md: 16,
  pill: 999,
} as const;
