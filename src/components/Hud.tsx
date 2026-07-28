"use client";

import { useEffect, useRef, useState } from "react";
import { WORLD } from "@/game/config";
import type { Snapshot } from "@/game/game";

const SEGMENTS = 20;

/** Telemetry convention: fixed-width numbers, leading zeros held back visually. */
function Padded({ value, width }: { value: number; width: number }) {
  const text = String(Math.max(0, Math.floor(value))).padStart(width, "0");
  const firstSignificant = text.search(/[1-9]/);
  const lead = firstSignificant === -1 ? text.slice(0, width - 1) : text.slice(0, firstSignificant);
  const rest = text.slice(lead.length);
  return (
    <>
      {lead && <span style={{ color: "var(--bone-12)" }}>{lead}</span>}
      {rest}
    </>
  );
}

function clock(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function Hud({
  snapshot,
  onStart,
  onToggleMute,
}: {
  snapshot: Snapshot;
  onStart: () => void;
  onToggleMute: () => void;
}) {
  const { status, score, best, speed, topSpeed, nearMisses, elapsed, muted } = snapshot;

  // Flash the near-miss readout for a moment whenever it climbs.
  const [hot, setHot] = useState(false);
  const previous = useRef(nearMisses);
  useEffect(() => {
    if (nearMisses > previous.current) {
      setHot(true);
      const timer = window.setTimeout(() => setHot(false), 90);
      previous.current = nearMisses;
      return () => window.clearTimeout(timer);
    }
    previous.current = nearMisses;
  }, [nearMisses]);

  const ratio = (speed - WORLD.startSpeed) / (WORLD.maxSpeed - WORLD.startSpeed);
  const lit = Math.round(Math.max(0, Math.min(1, ratio)) * SEGMENTS);
  const isRecord = status === "over" && score > 0 && score >= best;

  return (
    <div className="overlay">
      <div className="frame" />

      <header className="telemetry">
        <div className="readout readout--primary hud-in">
          <span className="label">Distance</span>
          <span className="readout__value">
            <Padded value={score} width={6} />
            <span className="readout__unit">M</span>
          </span>
        </div>

        <div className="readout readout--secondary readout--near hud-in" data-hot={hot}>
          <span className="label">Threaded</span>
          <span className="readout__value">
            <Padded value={nearMisses} width={3} />
            <span className="readout__unit">×</span>
          </span>
        </div>
      </header>

      <div />

      <footer className="telemetry telemetry--bottom">
        <div className="velocity">
          <span className="label">Velocity</span>
          <div className="velocity__bar" aria-hidden>
            {Array.from({ length: SEGMENTS }, (_, i) => (
              <span key={i} className="velocity__seg" data-on={i < lit} />
            ))}
          </div>
          <span className="velocity__value">
            {speed.toFixed(1)} M/S · T+{clock(elapsed)} · BEST {String(best).padStart(6, "0")}
          </span>
        </div>

        <div className="legend">
          <span className="legend__item">
            <span className="legend__keys">
              <kbd>A</kbd>
              <kbd>D</kbd>
            </span>
            <span className="legend__what">Lane</span>
          </span>
          <span className="legend__item">
            <span className="legend__keys">
              <kbd>Space</kbd>
            </span>
            <span className="legend__what">Vault</span>
          </span>
          <span className="legend__item">
            <span className="legend__keys">
              <kbd>R</kbd>
            </span>
            <span className="legend__what">Redeploy</span>
          </span>
        </div>
      </footer>

      {status === "ready" && (
        <div className="curtain">
          <div className="stagger" style={{ display: "grid", justifyItems: "center" }}>
            <span className="eyebrow">Endless corridor · unit 07</span>
            <h1 className="wordmark">Runner</h1>
            <div className="rule" />
            <p className="tagline">
              Orange slabs you <b>vault</b>. Red pylons you <b>evade</b>.
              <br />
              The corridor only gets faster.
            </p>
            <button className="prompt" onClick={onStart} type="button">
              Press Space to launch
            </button>
            <span
              className="velocity__value"
              style={{ marginTop: "1.6rem", letterSpacing: "0.24em" }}
            >
              Fixed-step sim · pooled geometry · AABB collision
            </span>
          </div>
        </div>
      )}

      {status === "over" && (
        <div className="curtain">
          <div className="stagger" style={{ display: "grid", justifyItems: "center" }}>
            {isRecord ? (
              <span className="badge">New record</span>
            ) : (
              <span className="eyebrow">Corridor breach</span>
            )}
            <h2 className="wordmark wordmark--dead">Wrecked</h2>
            <div className="rule" />
            <div className="sheet">
              <div className="sheet__cell sheet__cell--hero">
                <span className="label">Distance</span>
                <span className="sheet__value">{String(score).padStart(6, "0")}</span>
              </div>
              <div className="sheet__cell">
                <span className="label">Personal best</span>
                <span className="sheet__value">{String(best).padStart(6, "0")}</span>
              </div>
              <div className="sheet__cell">
                <span className="label">Threaded</span>
                <span className="sheet__value">{nearMisses}</span>
              </div>
              <div className="sheet__cell">
                <span className="label">Top velocity</span>
                <span className="sheet__value">{topSpeed.toFixed(1)}</span>
              </div>
            </div>
            <button className="prompt" onClick={onStart} type="button">
              Press R to redeploy
            </button>
          </div>
        </div>
      )}

      <button
        className="mute"
        type="button"
        onClick={onToggleMute}
        onPointerDown={(e) => e.stopPropagation()}
        onPointerUp={(e) => e.stopPropagation()}
        aria-label={muted ? "Unmute" : "Mute"}
        title={muted ? "Unmute" : "Mute"}
      >
        {muted ? "OFF" : "ON"}
      </button>
    </div>
  );
}
