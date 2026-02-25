# ASCII Studio
Copyright (c) 2026 Randall Rosas (Slategray). All rights reserved.

## The Headache
Converting media files like GIFs and videos into ASCII art is often a tedious process involving complex CLI tools and zero real-time feedback.

## The Fix
This tool provides a high-performance interface for transforming images, GIFs, and videos into ASCII representations using a parallelized Rust-powered pipeline.

## Quick Start
1. Ensure Node.js and Rust are installed.
2. Clone the repository and run:
```bash
npm install
npm run dev
```

## Why Use This?
* **Instant Feedback**: Adjust parameters like brightness, contrast, and width with real-time previews.
* **High Performance**: Rust-driven decoding handles frame transformations in parallel for maximum throughput.
* **Memory Efficient**: Frames are cached in-memory to allow rapid adjustments without redundant disk I/O.
* **Format Versatile**: Supports a wide range of formats including PNG, JPG, GIF, and MP4 sequences.

## Technical Details
* **Pipeline**: Frame transformation complexity is `O(F * P)` where `F` is frame count and `P` is pixel count.
* **Safety**: Built with Rust to ensure memory safety during heavy media processing.
* **Architecture**: Tauri-based frontend with a high-bandwidth Rust backend for processing.
