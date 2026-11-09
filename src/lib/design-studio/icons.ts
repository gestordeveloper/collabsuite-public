import {
  Star, Heart, Check, X, ArrowRight, ArrowLeft, ArrowUp, ArrowDown,
  ThumbsUp, Award, Flag, Bell, Bookmark, Gift, Zap, Target, Rocket,
  Lightbulb, Smile, ShieldCheck, TrendingUp, TrendingDown, DollarSign,
  Calendar, Clock, MapPin, Phone, Mail, Users, User, Building2,
  Briefcase, Handshake, CheckCircle2, AlertCircle, Info, Sparkles,
  type LucideIcon,
} from "lucide-react";

/** Curated icon set for the Design Studio (keeps bundle size predictable — no wildcard lucide-react import). */
export const DESIGN_ICONS: Record<string, LucideIcon> = {
  Star, Heart, Check, X, ArrowRight, ArrowLeft, ArrowUp, ArrowDown,
  ThumbsUp, Award, Flag, Bell, Bookmark, Gift, Zap, Target, Rocket,
  Lightbulb, Smile, ShieldCheck, TrendingUp, TrendingDown, DollarSign,
  Calendar, Clock, MapPin, Phone, Mail, Users, User, Building2,
  Briefcase, Handshake, CheckCircle2, AlertCircle, Info, Sparkles,
};

export const DESIGN_ICON_NAMES = Object.keys(DESIGN_ICONS);
