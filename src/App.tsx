// Copyright (c) 2026 Randall Rosas (Slategray). All rights reserved.

import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  FolderOpen,
  Download,
  Image as ImageIcon,
  Loader2,
  X,
  Minus,
  Square,
  Cpu,
} from "lucide-react";
import { LoaderIcon } from "./components/LoaderIcon";
import "./App.css";

function App() {
  const appWindow = getCurrentWindow();
  const [gifLoaded, setGifLoaded] = useState(false);
  const [adjustedPreviewUrl, setAdjustedPreviewUrl] = useState("");
  const [asciiFrames, setAsciiFrames] = useState<string[]>([]);
  const [currentFrame, setCurrentFrame] = useState(0);

  const [width, setWidth] = useState(100);
  const [brightness, setBrightness] = useState(0);
  const [contrast, setContrast] = useState(1.0);

  const [loading, setLoading] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [error, setError] = useState("");

  // Use ref to prevent IPC congestion during rapid slider movement.
  const isUpdating = useRef(false);

  // ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
  // CORE OPERATIONS
  // ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

  const updatePreview = useCallback(async () => {
    if (!gifLoaded) return;
    setPreviewLoading(true);
    try {
      const b64 = await invoke<string>("apply_adjustments_to_preview", {
        brightness,
        contrast,
      });
      setAdjustedPreviewUrl(b64);
    } catch (e) {
      console.error("Preview error:", e);
    } finally {
      setPreviewLoading(false);
    }
  }, [brightness, contrast, gifLoaded]);

  const convert = useCallback(async () => {
    // Abort if a transformation is already saturating the IPC bridge.
    if (!gifLoaded || isUpdating.current) return;
    isUpdating.current = true;
    try {
      const frames = await invoke<string[]>("convert_gif_to_ascii", {
        width,
        brightness,
        contrast,
      });
      setAsciiFrames(frames);
    } catch (e) {
      setError(String(e));
    } finally {
      isUpdating.current = false;
    }
  }, [width, brightness, contrast, gifLoaded]);

  // ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
  // EVENT HANDLERS
  // ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

  const handleOpen = async () => {
    try {
      const selected = await open({
        multiple: false,
        filters: [{ name: "GIF Images", extensions: ["gif"] }],
      });

      if (selected) {
        const path = Array.isArray(selected) ? selected[0] : selected;
        if (!path) return;

        setLoading(true);
        setError("");

        // Push raw frames to Rust-side cache once.
        await invoke("load_gif", { path });
        setGifLoaded(true);
        setLoading(false);
      }
    } catch (e) {
      setError(String(e));
      setLoading(false);
    }
  };

  const handleDownload = async () => {
    if (asciiFrames.length === 0) return;
    try {
      const path = await save({
        filters: [{ name: "Text File", extensions: ["txt"] }],
        defaultPath: "ascii_art.txt",
      });
      if (path) {
        await invoke("save_ascii_to_file", { path, frames: asciiFrames });
      }
    } catch (e) {
      setError(String(e));
    }
  };

  // ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
  // REACTIVE PIPELINE
  // ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

  // Trigger instantaneous updates on parameter change.
  useEffect(() => {
    if (gifLoaded) {
      updatePreview();
      convert();
    }
  }, [width, brightness, contrast, gifLoaded, convert, updatePreview]);

  // Drive animation playback loop.
  useEffect(() => {
    if (asciiFrames.length > 1) {
      const interval = setInterval(() => {
        setCurrentFrame((prev) => (prev + 1) % asciiFrames.length);
      }, 100);
      return () => clearInterval(interval);
    }
  }, [asciiFrames]);

  return (
    <div className="app-shell">
      <div data-tauri-drag-region className="titlebar">
        <div className="titlebar-left">
          <img src="/logo.svg" className="titlebar-icon" alt="Logo" />
          <span className="titlebar-text">ASCII STUDIO</span>
        </div>
        <div className="titlebar-right">
          <div className="window-controls">
            <button
              className="window-button"
              onClick={() => appWindow.minimize()}
            >
              <Minus size={14} />
            </button>
            <button
              className="window-button"
              onClick={() => appWindow.toggleMaximize()}
            >
              <Square size={12} />
            </button>
            <button
              className="window-button close"
              onClick={() => appWindow.close()}
            >
              <X size={14} />
            </button>
          </div>
        </div>
      </div>

      <main className="content-area">
        <aside className="sidebar-flat">
          <div className="sidebar-inner">
            <section className="control-flat">
              <div className="label-flat">
                <ImageIcon size={12} /> INPUT SOURCE
              </div>
              <button
                onClick={handleOpen}
                disabled={loading}
                className="flat-button primary"
              >
                {loading ? (
                  <Loader2 className="spin" size={16} />
                ) : (
                  <FolderOpen size={16} />
                )}
                {loading ? "DECODING..." : "IMPORT GIF"}
              </button>

              <div className="preview-flat">
                {previewLoading && (
                  <div className="preview-loader">
                    <LoaderIcon />
                  </div>
                )}
                {adjustedPreviewUrl ? (
                  <img
                    src={adjustedPreviewUrl}
                    alt="Preview"
                    className="img-flat"
                  />
                ) : (
                  <div className="preview-placeholder">NO SOURCE</div>
                )}
              </div>
            </section>

            <section className="control-flat">
              <div className="label-flat">
                <Cpu size={12} /> TRANSFORMATION
              </div>
              <div className="slider-flat">
                <div className="slider-info">
                  <span>WIDTH</span> <span>{width}px</span>
                </div>
                <input
                  type="range"
                  min="20"
                  max="250"
                  value={width}
                  onChange={(e) => setWidth(Number(e.target.value))}
                />
              </div>
              <div className="slider-flat">
                <div className="slider-info">
                  <span>BRIGHTNESS</span> <span>{brightness}</span>
                </div>
                <input
                  type="range"
                  min="-100"
                  max="100"
                  value={brightness}
                  onChange={(e) => setBrightness(Number(e.target.value))}
                />
              </div>
              <div className="slider-flat">
                <div className="slider-info">
                  <span>CONTRAST</span> <span>{contrast.toFixed(1)}x</span>
                </div>
                <input
                  type="range"
                  min="0.1"
                  max="3.0"
                  step="0.1"
                  value={contrast}
                  onChange={(e) => setContrast(Number(e.target.value))}
                />
              </div>
            </section>

            <section className="control-flat">
              <div className="label-flat">
                <Download size={12} /> EXPORT
              </div>
              <button
                onClick={handleDownload}
                disabled={asciiFrames.length === 0}
                className="flat-button secondary"
              >
                <Download size={16} /> EXPORT ASCII.TXT
              </button>
            </section>
          </div>
        </aside>

        <section className="main-flat">
          <div className="viewport-flat">
            {loading && (
              <div className="loader-flat-overlay">
                <LoaderIcon />
                <div className="loader-status">DECODING CORE...</div>
              </div>
            )}
            <pre className="ascii-render">
              {asciiFrames.length > 0
                ? asciiFrames[currentFrame]
                : "WAITING FOR SOURCE DATA..."}
            </pre>
          </div>
          {asciiFrames.length > 1 && (
            <div className="status-bar-flat">
              <span className="status-item">
                FRAME_INDEX: {currentFrame + 1} / {asciiFrames.length}
              </span>
              <span className="status-item">BUFFER_STATE: LIVE</span>
            </div>
          )}
          {error && <div className="error-flat">{error}</div>}
        </section>
      </main>
    </div>
  );
}

export default App;
