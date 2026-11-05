'use client';
import {
  Award,
  CalendarCheck,
  CheckCircle2,
  Clock,
  Crown,
  Flag,
  Gem,
  Heart,
  Repeat,
  Rocket,
  ShieldCheck,
  Smile,
  Sparkles,
  Star,
  Target,
  Trophy,
  Users,
  Zap,
  type LucideIcon,
} from 'lucide-react';

/**
 * The achievement icons (ACHIEVEMENT_ICONS in @tallywork/domain). Loaded with the first badge on a
 * page rather than with the page (the 250 KB first-load budget); see `HexBadge` in ./ui.
 */
const ICONS: Record<string, LucideIcon> = {
  award: Award,
  'check-circle': CheckCircle2,
  'calendar-check': CalendarCheck,
  flag: Flag,
  repeat: Repeat,
  clock: Clock,
  crown: Crown,
  heart: Heart,
  star: Star,
  gem: Gem,
  smile: Smile,
  trophy: Trophy,
  target: Target,
  zap: Zap,
  rocket: Rocket,
  'shield-check': ShieldCheck,
  users: Users,
  sparkles: Sparkles,
};

export const achievementIcon = (name: string): LucideIcon => ICONS[name] ?? Award;

export default function AchievementGlyph({ name }: { name: string }) {
  const Icon = achievementIcon(name);
  return <Icon className="size-[45%]" strokeWidth={2.2} />;
}
