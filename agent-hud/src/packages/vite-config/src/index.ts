import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import type { UserConfig } from "vite";
import { devBridge } from "./dev-bridge.ts";
import { shaderLifecycle } from "./shader-lifecycle.ts";

export { devBridge, shaderLifecycle };

/** The Vite configuration every Agent HUD desktop front end shares: React,
 * Tailwind, the shader lifecycle patch and the browser dev bridge to the
 * engine. One React serves the app and every package it imports; a product
 * that links these packages from another checkout names its other shared
 * dependencies in `dedupe`, so they too resolve from its own root. */
export function agentHudVite(options: { dedupe?: string[] } = {}): UserConfig {
  return {
    plugins: [shaderLifecycle(), react(), tailwindcss(), devBridge()],
    resolve: { dedupe: ["react", "react-dom", ...(options.dedupe ?? [])] },
    // ai-one change: 1522, so the HUD dev server does not take ai-one's own 1420.
    server: { port: 1522, strictPort: true },
    // ai-one change: an inline (empty) PostCSS config stops Vite searching upward
    // into ai-one's own postcss.config.js. Tailwind runs as a Vite plugin.
    css: { postcss: { plugins: [] } },
    clearScreen: false,
  };
}
