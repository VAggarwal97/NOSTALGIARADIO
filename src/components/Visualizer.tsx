import { useEffect, useRef, useState } from 'react';

interface VisualizerProps {
  analyser: AnalyserNode | null;
  active: boolean;
  bars?: number;
}

/**
 * 20 restrained bars driven by rAF while playing. Falls back to a slow idle
 * animation when there is no analyser (external stations, blocked context).
 * Only height changes — no layout thrash, transform/opacity friendly.
 */
export function Visualizer({ analyser, active, bars = 20 }: VisualizerProps) {
  const [levels, setLevels] = useState<number[]>(() => Array.from({ length: bars }, () => 0.12));
  const frameRef = useRef<number | null>(null);
  const dataRef = useRef<Uint8Array<ArrayBuffer> | null>(null);

  useEffect(() => {
    if (!active || !analyser) {
      setLevels(Array.from({ length: bars }, () => 0.12));
      return;
    }

    if (!dataRef.current || dataRef.current.length !== analyser.frequencyBinCount) {
      dataRef.current = new Uint8Array(analyser.frequencyBinCount);
    }
    const data = dataRef.current;

    const tick = () => {
      analyser.getByteFrequencyData(data);
      setLevels(
        Array.from({ length: bars }, (_, index) => {
          const sample = data[Math.floor((index / bars) * data.length)] ?? 0;
          return Math.max(0.1, sample / 255);
        }),
      );
      frameRef.current = requestAnimationFrame(tick);
    };

    frameRef.current = requestAnimationFrame(tick);
    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    };
  }, [active, analyser, bars]);

  return (
    <div className="visualizer" data-idle={!active} aria-hidden="true">
      {levels.map((level, index) => (
        <span
          key={index}
          style={active ? { height: `${Math.round(level * 100)}%` } : undefined}
        />
      ))}
    </div>
  );
}
