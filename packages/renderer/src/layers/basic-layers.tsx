import React, { useContext } from "react";
import type { IconLayer, ImageLayer, ShapeLayer, VideoLayer } from "@crewcut/composition";
import {
  ArrowRight,
  ArrowUpRight,
  Bug,
  ChartColumn,
  Check,
  CircleCheck,
  Clock,
  Cloud,
  Code,
  Cpu,
  Database,
  Eye,
  File,
  GitBranch,
  Globe,
  Heart,
  Key,
  Layers,
  Lightbulb,
  Lock,
  type LucideIcon,
  MessageSquare,
  Mic,
  Play,
  Plug,
  Rocket,
  Search,
  Server,
  Settings,
  Shield,
  Sparkles,
  Star,
  Target,
  Terminal,
  TrendingUp,
  Users,
  Video,
  WandSparkles,
  X,
  Zap,
} from "lucide-react";
import { Img, OffthreadVideo, Sequence, useVideoConfig } from "remotion";

import { TrackMutedContext, useFrameContext } from "../context";
import { fillToCss } from "../styles";

export function ShapeLayerView({ layer }: { layer: ShapeLayer }) {
  const { scale, brief } = useFrameContext();
  const fill = fillToCss(layer.fill) ?? (layer.shape === "ring" ? "transparent" : layer.shape === "line" ? layer.stroke ?? brief.palette.ink : undefined);
  const radius = layer.shape === "ellipse" || layer.shape === "ring" ? "50%" : layer.radius * scale;
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        minWidth: 1,
        minHeight: 1,
        background: fill,
        borderRadius: radius,
        ...(layer.stroke && layer.strokeWidth > 0 && layer.shape !== "line"
          ? { boxShadow: `inset 0 0 0 ${layer.strokeWidth * scale}px ${layer.stroke}` }
          : {}),
        ...(layer.shape === "triangle" ? { clipPath: "polygon(50% 0, 100% 100%, 0 100%)" } : {}),
        ...(layer.shadow ? { filter: `drop-shadow(${layer.shadow.x * scale}px ${layer.shadow.y * scale}px ${layer.shadow.blur * scale}px ${layer.shadow.color})` } : {}),
      }}
    />
  );
}

function MissingMedia({ label }: { label: string }) {
  const { brief, scale } = useFrameContext();
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "grid",
        placeItems: "center",
        background: brief.palette.surface,
        color: brief.palette.muted,
        fontSize: 24 * scale,
        fontFamily: "ui-sans-serif, system-ui",
        border: `${2 * scale}px dashed ${brief.palette.muted}55`,
      }}
    >
      {label}
    </div>
  );
}

export function ImageLayerView({ layer }: { layer: ImageLayer }) {
  const { resolveSrc, scale } = useFrameContext();
  const src = resolveSrc(layer.src);
  if (!src) return <MissingMedia label={layer.alt ?? "Image"} />;
  return (
    <Img
      src={src}
      alt={layer.alt ?? ""}
      style={{ width: "100%", height: "100%", objectFit: layer.fit, borderRadius: layer.radius * scale, display: "block" }}
    />
  );
}

export function VideoLayerView({ layer, layerStartFrame }: { layer: VideoLayer; layerStartFrame: number }) {
  const { resolveSrc, scale } = useFrameContext();
  const trackMuted = useContext(TrackMutedContext);
  const { fps } = useVideoConfig();
  const src = resolveSrc(layer.src);
  if (!src) return <MissingMedia label="Video" />;
  return (
    <Sequence from={layerStartFrame} layout="none">
      <OffthreadVideo
        src={src}
        trimBefore={Math.round((layer.trimStartMs / 1000) * fps)}
        playbackRate={layer.playbackRate}
        volume={trackMuted ? 0 : layer.volume}
        muted={trackMuted || layer.volume === 0}
        style={{ width: "100%", height: "100%", objectFit: layer.fit, borderRadius: layer.radius * scale }}
      />
    </Sequence>
  );
}

const ICONS: Record<IconLayer["icon"], LucideIcon> = {
  "arrow-right": ArrowRight,
  "arrow-up-right": ArrowUpRight,
  bolt: Zap,
  bug: Bug,
  chart: ChartColumn,
  check: Check,
  "circle-check": CircleCheck,
  clock: Clock,
  cloud: Cloud,
  code: Code,
  cpu: Cpu,
  database: Database,
  eye: Eye,
  file: File,
  "git-branch": GitBranch,
  globe: Globe,
  heart: Heart,
  key: Key,
  layers: Layers,
  lightbulb: Lightbulb,
  lock: Lock,
  message: MessageSquare,
  mic: Mic,
  play: Play,
  plug: Plug,
  rocket: Rocket,
  search: Search,
  server: Server,
  settings: Settings,
  shield: Shield,
  sparkle: Sparkles,
  star: Star,
  target: Target,
  terminal: Terminal,
  "trending-up": TrendingUp,
  users: Users,
  video: Video,
  wand: WandSparkles,
  x: X,
  zap: Zap,
};

export function IconLayerView({ layer }: { layer: IconLayer }) {
  const { brief } = useFrameContext();
  const Icon = ICONS[layer.icon];
  return <Icon width="100%" height="100%" color={layer.color ?? brief.palette.accent} strokeWidth={layer.strokeWidth} absoluteStrokeWidth={false} />;
}
