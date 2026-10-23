import {
  Activity,
  BarChart3,
  Briefcase,
  CircleCheck,
  Clock,
  FileSignature,
  Gauge,
  LayoutDashboard,
  Mail,
  MessageSquare,
  Package,
  Search,
  Sparkles,
  TrendingUp,
  Users,
  Workflow,
  type LucideIcon,
} from 'lucide-react';

/** Icons a workflow may name in its blocks (`icon: "package"`); unknown names fall back to the caller's default. */
const ICONS: Record<string, LucideIcon> = {
  activity: Activity,
  analytics: BarChart3,
  briefcase: Briefcase,
  chat: MessageSquare,
  check: CircleCheck,
  clock: Clock,
  dashboard: LayoutDashboard,
  gauge: Gauge,
  mail: Mail,
  package: Package,
  search: Search,
  signature: FileSignature,
  sparkles: Sparkles,
  trending: TrendingUp,
  users: Users,
  workflow: Workflow,
};

export function blockIcon(name: unknown, fallback: LucideIcon = Sparkles): LucideIcon {
  return (typeof name === 'string' && ICONS[name.toLowerCase()]) || fallback;
}
