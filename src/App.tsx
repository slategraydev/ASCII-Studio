// Copyright (c) 2026 Randall Rosas (Slategray). All rights reserved.

import {
  useState,
  useEffect,
  useCallback,
  useRef,
  useLayoutEffect,
} from "react";
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

  const [width, setWidth] = useState(100);
  const [brightness, setBrightness] = useState(0);
  const [contrast, setContrast] = useState(1.0);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const viewportRef = useRef<HTMLDivElement>(null);
  const asciiRef = useRef<HTMLPreElement>(null);

  // High-performance state management
  const isUpdating = useRef(false);
  const pendingUpdate = useRef(false);
  const paramsRef = useRef({ width, brightness, contrast });
  const asciiBuffer = useRef<Uint8Array | null>(null);
  const frameMetadata = useRef({ count: 0, size: 0, rawW: 0, rawH: 0 });
  const decoder = useRef(new TextDecoder());
  const animationFrameId = useRef<number | null>(null);
  const lastFrameTime = useRef<number>(0);
  const currentFrameIdx = useRef<number>(0);

  const isInteractive = useRef(false);
  const debounceTimer = useRef<number | null>(null);

  useEffect(() => {
    paramsRef.current = { width, brightness, contrast };
  }, [width, brightness, contrast]);

  // ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
  // CORE OPERATIONS
  // ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

  const calculateAndApplyScale = useCallback(() => {
    if (
      !asciiRef.current ||
      !viewportRef.current ||
      frameMetadata.current.rawW === 0
    )
      return;

    const viewportWidth = viewportRef.current.clientWidth;
    const viewportHeight = viewportRef.current.clientHeight;
    const margin = 40;

    const { rawW, rawH } = frameMetadata.current;
    const scale = Math.min(
      (viewportWidth - margin) / rawW,
      (viewportHeight - margin) / rawH,
    );

    asciiRef.current.style.transform = `translate(-50%, -50%) scale(${scale})`;
  }, []);

  const updatePreview = useCallback(
    async (frameIdx: number) => {
      if (!gifLoaded) return;
      try {
        const b64 = await invoke<string>("apply_adjustments_to_preview", {
          brightness: paramsRef.current.brightness,
          contrast: paramsRef.current.contrast,
          frameIndex: frameIdx,
        });
        setAdjustedPreviewUrl(b64);
      } catch (e) {
        console.error("Preview error:", e);
      }
    },
    [gifLoaded],
  );

  const renderFrame = useCallback(
    (idx: number, bufferOverride?: Uint8Array) => {
      const buffer = bufferOverride || asciiBuffer.current;
      if (!buffer || !asciiRef.current || frameMetadata.current.count === 0)
        return;

      const { count, size } = frameMetadata.current;
      const safeIdx = idx % count;
      const isSingleFrameBuffer = buffer.length === size;
      const start = isSingleFrameBuffer ? 0 : safeIdx * size;
      const end = start + size;

      const slice = buffer.subarray(start, end);
      asciiRef.current.textContent = decoder.current.decode(slice);
      currentFrameIdx.current = safeIdx;

      calculateAndApplyScale();
      updatePreview(safeIdx);
    },
    [calculateAndApplyScale, updatePreview],
  );

  const convert = useCallback(
    async (onlyFrame?: number) => {
      if (!gifLoaded) return;
      if (isUpdating.current) {
        pendingUpdate.current = true;
        return;
      }
      isUpdating.current = true;

      try {
        while (true) {
          pendingUpdate.current = false;
          const { width: w, brightness: b, contrast: c } = paramsRef.current;

          const response = await invoke<[number, number[]]>(
            "convert_gif_to_ascii",
            {
              width: w,
              brightness: b,
              contrast: c,
              onlyFrame: onlyFrame !== undefined ? onlyFrame : null,
            },
          );

          const rawData = response[1];
          const data = new Uint8Array(rawData);

          if (data.length > 0) {
            // Perform ONE measurement to get true character dimensions
            if (asciiRef.current) {
              const originalTransform = asciiRef.current.style.transform;
              const originalText = asciiRef.current.textContent;

              asciiRef.current.style.transform = "none";
              asciiRef.current.textContent = decoder.current.decode(
                data.subarray(
                  0,
                  data.length /
                    (onlyFrame !== undefined ? 1 : frameMetadata.current.count),
                ),
              );

              frameMetadata.current.rawW = asciiRef.current.scrollWidth;
              frameMetadata.current.rawH = asciiRef.current.scrollHeight;

              asciiRef.current.style.transform = originalTransform;
              asciiRef.current.textContent = originalText;
            }

            if (onlyFrame !== undefined) {
              frameMetadata.current.size = data.length;
              renderFrame(onlyFrame, data);
            } else {
              asciiBuffer.current = data;
              frameMetadata.current.size =
                data.length / frameMetadata.current.count;
              renderFrame(currentFrameIdx.current);
            }
          }
          if (!pendingUpdate.current) break;
        }
      } catch (e) {
        setError(String(e));
      } finally {
        isUpdating.current = false;
      }
    },
    [gifLoaded, renderFrame],
  );

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
        const path = Array.isArray(selected)
          ? selected[0]
          : typeof selected === "string"
            ? selected
            : null;
        if (!path) return;
        setLoading(true);
        setError("");
        const count = await invoke<number>("load_gif", { path });
        frameMetadata.current.count = count;
        setGifLoaded(true);
        setLoading(false);
      }
    } catch (e) {
      setError(String(e));
      setLoading(false);
    }
  };

  const handleDownload = async () => {
    if (!asciiBuffer.current) return;
    try {
      const path = await save({
        filters: [{ name: "Text File", extensions: ["txt"] }],
        defaultPath: "ascii_art.txt",
      });
      if (path) {
        const { count, size } = frameMetadata.current;
        const frames: string[] = [];
        for (let i = 0; i < count; i++) {
          frames.push(
            decoder.current.decode(
              asciiBuffer.current.subarray(i * size, (i + 1) * size),
            ),
          );
        }
        await invoke("save_ascii_to_file", { path, frames });
      }
    } catch (e) {
      setError(String(e));
    }
  };

  const handleParamChange = (updater: () => void) => {
    isInteractive.current = true;
    updater();
    convert(currentFrameIdx.current);
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = window.setTimeout(() => {
      isInteractive.current = false;
      convert();
    }, 150);
  };

  useEffect(() => {
    if (gifLoaded) convert();
  }, [gifLoaded, convert]);

  useEffect(() => {
    if (!gifLoaded || frameMetadata.current.count <= 1) return;
    const animate = (time: number) => {
      if (!isInteractive.current && time - lastFrameTime.current > 100) {
        lastFrameTime.current = time;
        renderFrame(currentFrameIdx.current + 1);
      }
      animationFrameId.current = requestAnimationFrame(animate);
    };
    animationFrameId.current = requestAnimationFrame(animate);
    return () => {
      if (animationFrameId.current)
        cancelAnimationFrame(animationFrameId.current);
    };
  }, [gifLoaded, renderFrame]);

  useLayoutEffect(() => {
    if (!viewportRef.current) return;
    const observer = new ResizeObserver(() => calculateAndApplyScale());
    observer.observe(viewportRef.current);
    return () => observer.disconnect();
  }, [calculateAndApplyScale]);

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
                  onChange={(e) =>
                    handleParamChange(() => setWidth(Number(e.target.value)))
                  }
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
                  onChange={(e) =>
                    handleParamChange(() =>
                      setBrightness(Number(e.target.value)),
                    )
                  }
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
                  onChange={(e) =>
                    handleParamChange(() => setContrast(Number(e.target.value)))
                  }
                />
              </div>
            </section>

            <section className="control-flat">
              <div className="label-flat">
                <Download size={12} /> EXPORT
              </div>
              <button
                onClick={handleDownload}
                disabled={!gifLoaded}
                className="flat-button secondary"
              >
                <Download size={16} /> EXPORT ASCII.TXT
              </button>
            </section>
          </div>
        </aside>

        <section className="main-flat">
          <div className="viewport-flat" ref={viewportRef}>
            {loading && (
              <div className="loader-flat-overlay">
                <LoaderIcon />
                <div className="loader-status">DECODING CORE...</div>
              </div>
            )}
            <pre className="ascii-render" ref={asciiRef} />
          </div>
          {error && <div className="error-flat">{error}</div>}
        </section>
      </main>
    </div>
  );
}

export default App;
