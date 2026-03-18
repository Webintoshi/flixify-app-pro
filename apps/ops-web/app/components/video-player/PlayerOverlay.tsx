"use client";

import { useCallback, useRef, useState, useEffect } from "react";

// ============================================
// 🎬 FLIXIFY PRO - Player Overlay Component
// Big play button, buffering indicator, error display
// ============================================

type PlayerOverlayProps = {
  isPlaying: boolean;
  isBuffering: boolean;
  isLoading: boolean;
  error: string | null;
  onPlayClick: () => void;
  onDoubleTapLeft: () => void;
  onDoubleTapRight: () => void;
};

export function PlayerOverlay({
  isPlaying,
  isBuffering,
  isLoading,
  error,
  onPlayClick,
  onDoubleTapLeft,
  onDoubleTapRight,
}: PlayerOverlayProps) {
  const [showLeftRipple, setShowLeftRipple] = useState(false);
  const [showRightRipple, setShowRightRipple] = useState(false);
  const lastTap = useRef<{ time: number; side: "left" | "right" } | null>(null);
  const tapTimeout = useRef<NodeJS.Timeout>();

  // Handle double tap for seek
  const handleTap = useCallback(
    (side: "left" | "right") => {
      const now = Date.now();
      
      if (
        lastTap.current &&
        lastTap.current.side === side &&
        now - lastTap.current.time < 300
      ) {
        // Double tap detected
        if (side === "left") {
          setShowLeftRipple(true);
          onDoubleTapLeft();
        } else {
          setShowRightRipple(true);
          onDoubleTapRight();
        }
        
        // Hide ripple after animation
        setTimeout(() => {
          setShowLeftRipple(false);
          setShowRightRipple(false);
        }, 600);
        
        lastTap.current = null;
        if (tapTimeout.current) clearTimeout(tapTimeout.current);
      } else {
        lastTap.current = { time: now, side };
        tapTimeout.current = setTimeout(() => {
          lastTap.current = null;
        }, 300);
      }
    },
    [onDoubleTapLeft, onDoubleTapRight]
  );

  // Error display
  if (error) {
    return (
      <div className="flixify-player__overlay flixify-player__overlay--error">
        <div className="flixify-player__error">
          <svg
            className="flixify-player__error-icon"
            viewBox="0 0 24 24"
            fill="currentColor"
          >
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z" />
          </svg>
          <p className="flixify-player__error-text">{error}</p>
          <button
            className="flixify-player__error-retry"
            onClick={() => window.location.reload()}
          >
            Yeniden Dene
          </button>
        </div>
      </div>
    );
  }

  // Loading spinner
  if (isLoading) {
    return (
      <div className="flixify-player__overlay flixify-player__overlay--loading">
        <div className="flixify-player__spinner">
          <svg viewBox="0 0 50 50">
            <circle
              cx="25"
              cy="25"
              r="20"
              fill="none"
              strokeWidth="4"
              strokeLinecap="round"
            />
          </svg>
        </div>
      </div>
    );
  }

  return (
    <div className="flixify-player__overlay">
      {/* Double tap areas (mobile) */}
      <div
        className="flixify-player__tap-area flixify-player__tap-area--left"
        onClick={() => handleTap("left")}
      >
        {showLeftRipple && (
          <div className="flixify-player__ripple flixify-player__ripple--left">
            <svg viewBox="0 0 24 24" fill="currentColor">
              <path d="M11 18V6l-8.5 6 8.5 6zm.5-6l8.5 6V6l-8.5 6z" />
            </svg>
            <span>-10s</span>
          </div>
        )}
      </div>

      <div
        className="flixify-player__tap-area flixify-player__tap-area--right"
        onClick={() => handleTap("right")}
      >
        {showRightRipple && (
          <div className="flixify-player__ripple flixify-player__ripple--right">
            <svg viewBox="0 0 24 24" fill="currentColor">
              <path d="M4 18l8.5-6L4 6v12zm9-12v12l8.5-6L13 6z" />
            </svg>
            <span>+10s</span>
          </div>
        )}
      </div>

      {/* Big play button (when paused) */}
      {!isPlaying && !isBuffering && (
        <button
          className="flixify-player__big-play"
          onClick={onPlayClick}
          aria-label="Oynat"
        >
          <svg viewBox="0 0 24 24" fill="currentColor">
            <path d="M8 5v14l11-7z" />
          </svg>
        </button>
      )}

      {/* Buffering indicator */}
      {isBuffering && (
        <div className="flixify-player__buffering">
          <div className="flixify-player__spinner flixify-player__spinner--small">
            <svg viewBox="0 0 50 50">
              <circle
                cx="25"
                cy="25"
                r="20"
                fill="none"
                strokeWidth="4"
                strokeLinecap="round"
              />
            </svg>
          </div>
        </div>
      )}
    </div>
  );
}
