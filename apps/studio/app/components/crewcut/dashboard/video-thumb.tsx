import type { Composition } from "@crewcut/composition";
import { IconMovie } from "@tabler/icons-react";
import { Suspense, lazy, memo, useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

const VideoThumbFrame = lazy(() => import("./video-thumb-frame"));

function Placeholder({ ratio }: { ratio: string }) {
  return (
    <div className="flex flex-col items-center gap-1.5 text-ds-text-3">
      <IconMovie className="size-6" strokeWidth={1.6} />
      <span className="font-mono text-[11px] tabular">{ratio}</span>
    </div>
  );
}

/**
 * Renders the real composition at its poster frame (the same component the
 * editor and render worker draw), letterboxed into the card. The renderer
 * loads lazily and only once the card scrolls into view.
 */
export const VideoThumb = memo(function VideoThumb({
  composition,
  assetUrls,
  ratio,
  className,
}: {
  composition: Composition | undefined;
  assetUrls: Record<string, string>;
  ratio: string;
  className?: string;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [box, setBox] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const element = boxRef.current;
    if (!element) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setVisible(true);
          io.disconnect();
        }
      },
      { rootMargin: "200px" },
    );
    io.observe(element);
    const ro = new ResizeObserver(([entry]) => entry && setBox({ width: entry.contentRect.width, height: entry.contentRect.height }));
    ro.observe(element);
    return () => {
      io.disconnect();
      ro.disconnect();
    };
  }, []);

  const aspect = composition ? composition.width / composition.height : 16 / 9;
  const fitted = box.width / Math.max(1, box.height) > aspect ? { width: box.height * aspect, height: box.height } : { width: box.width, height: box.width / aspect };

  return (
    <div ref={boxRef} className={cn("relative flex items-center justify-center overflow-hidden bg-ds-stage", className)}>
      {composition && visible && fitted.width > 0 ? (
        <Suspense fallback={<Placeholder ratio={ratio} />}>
          <div style={{ width: fitted.width, height: fitted.height }} className="overflow-hidden">
            <VideoThumbFrame composition={composition} assetUrls={assetUrls} />
          </div>
        </Suspense>
      ) : (
        <Placeholder ratio={ratio} />
      )}
    </div>
  );
});
