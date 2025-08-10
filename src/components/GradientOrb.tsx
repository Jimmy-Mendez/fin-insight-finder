import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

interface GradientOrbProps {
  className?: string;
}

export const GradientOrb = ({ className }: GradientOrbProps) => {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (prefersReduced) return;

    const onMove = (e: MouseEvent) => {
      const { clientX, clientY } = e;
      el.style.transform = `translate3d(${clientX / 20}px, ${clientY / 20}px, 0)`;
    };
    window.addEventListener('mousemove', onMove);
    return () => window.removeEventListener('mousemove', onMove);
  }, []);

  return (
    <div
      ref={ref}
      aria-hidden
      className={cn(
        "pointer-events-none absolute inset-0 -z-10 [mask-image:radial-gradient(closest-side,black,transparent)]",
        className
      )}
      style={{
        backgroundImage:
          "radial-gradient(600px 300px at 20% 20%, hsl(var(--primary)/0.12), transparent), radial-gradient(600px 300px at 80% 60%, hsl(var(--primary-glow)/0.18), transparent)",
      }}
    />
  );
};
