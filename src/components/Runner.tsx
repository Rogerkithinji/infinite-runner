"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { WORLD } from "@/game/config";
import { Game, type Snapshot } from "@/game/game";
import { Hud } from "./Hud";

const INITIAL: Snapshot = {
  status: "ready",
  score: 0,
  best: 0,
  speed: WORLD.startSpeed,
  topSpeed: WORLD.startSpeed,
  nearMisses: 0,
  elapsed: 0,
  muted: false,
};

/**
 * The React/three.js boundary.
 *
 * React owns the DOM overlay and nothing else. The game owns its canvas, its
 * loop, and its state, and pushes a throttled snapshot outward — so a 120Hz
 * simulation never turns into 120 renders a second up here.
 */
export function Runner() {
  const hostRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<Game | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot>(INITIAL);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const game = new Game(host, setSnapshot);
    gameRef.current = game;
    game.start();

    return () => {
      gameRef.current = null;
      game.dispose();
    };
  }, []);

  const onStart = useCallback(() => gameRef.current?.restart(), []);
  const onToggleMute = useCallback(() => gameRef.current?.toggleMute(), []);

  return (
    <main className="stage">
      <div className="viewport" ref={hostRef} />
      <Hud snapshot={snapshot} onStart={onStart} onToggleMute={onToggleMute} />
      <div className="scanlines" />
      <div className="grain" />
      <div className="vignette" />
    </main>
  );
}
