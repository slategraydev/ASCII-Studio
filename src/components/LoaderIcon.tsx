// Copyright (c) 2026 Randall Rosas (Slategray). All rights reserved.

import React from "react";

/**
 * Perform SVG-based loading animation.
 */
export const LoaderIcon = () => (
  <svg
    className="loader-svg"
    viewBox="0 0 100 100"
    xmlns="http://www.w3.org/2000/svg"
  >
    <circle
      cx="50"
      cy="50"
      r="40"
      stroke="#475059"
      strokeWidth="8"
      fill="none"
      strokeDasharray="180 80"
    />
    <text
      x="50"
      y="60"
      fontFamily="'Press Start 2P'"
      fontSize="20"
      fontWeight="bold"
      fill="#aa0808"
      textAnchor="middle"
    >
      <animate
        attributeName="opacity"
        values="0;1;0"
        dur="1s"
        repeatCount="indefinite"
      />
      @
    </text>
    <style>{`
      .loader-svg circle {
        animation: spin 1.5s linear infinite;
        transform-origin: center;
      }
      @keyframes spin {
        0% { transform: rotate(0deg); }
        100% { transform: rotate(360deg); }
      }
    `}</style>
  </svg>
);
