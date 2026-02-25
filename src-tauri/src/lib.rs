// Copyright (c) 2026 Randall Rosas (Slategray). All rights reserved.

//! Perform real-time GIF to ASCII conversion with memory-cached frames.

use image::AnimationDecoder;
use image::codecs::gif::GifDecoder;
use image::DynamicImage;
use image::RgbaImage;
use std::fs::File;
use std::io::{BufReader, Write};
use std::sync::RwLock;
use rayon::prelude::*;
use tauri::State;

const ASCII_CHARS: &[u8] = b"$$@B%8&WM#*oahkbdpqwmZO0QLCJUYXzcvunxrjft/\\|()1{}[]?-_+~<>i!lI;:,\"^`'. ";

// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
// STATE MANAGEMENT
// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

pub struct AppState {
    // Cache original frames as RgbaImages to bypass re-decoding overhead.
    frames: RwLock<Option<Vec<RgbaImage>>>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            frames: RwLock::new(None),
        }
    }
}

// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
// CORE TRANSFORMATION LOGIC
// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

/// Map RGBA pixel to ASCII character using a pre-calculated LUT.
#[inline(always)]
fn get_ascii_char_lut(r: u8, g: u8, b: u8, a: u8, lut: &[u8; 256]) -> u8 {
    if a < 128 {
        return b' ';
    }
    // Integer-based Luminance (ITU-R BT.709) for high-performance grayscale.
    let gray = (218 * r as u32 + 732 * g as u32 + 74 * b as u32) >> 10;
    lut[gray as usize]
}

// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
// TAURI COMMANDS
// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

/// Decode and cache GIF frames into memory.
#[tauri::command]
async fn load_gif(state: State<'_, AppState>, path: String) -> Result<usize, String> {
    let file = File::open(&path).map_err(|e| e.to_string())?;
    let reader = BufReader::new(file);
    let decoder = GifDecoder::new(reader).map_err(|e| e.to_string())?;
    let frames = decoder.into_frames().collect_frames().map_err(|e| e.to_string())?;

    let rgba_frames: Vec<RgbaImage> = frames.into_iter().map(|f| f.into_buffer()).collect();
    let frame_count = rgba_frames.len();

    let mut cache = state.frames.write().map_err(|_| "Failed to lock state")?;
    *cache = Some(rgba_frames);

    Ok(frame_count)
}

/// Transform cached RGBA frames into ASCII string sequences.
#[tauri::command]
async fn convert_gif_to_ascii(
    state: State<'_, AppState>,
    width: u32,
    brightness: i32,
    contrast: f32
) -> Result<Vec<String>, String> {
    let frames_lock = state.frames.read().map_err(|_| "Failed to lock state")?;
    let frames = frames_lock.as_ref().ok_or("No GIF loaded")?;

    // Pre-calculate LUT to eliminate floating-point math in the hot loop.
    let mut lut = [0u8; 256];
    for i in 0..256 {
        let mut val = i as i32 + brightness;
        if (contrast - 1.0).abs() > 0.01 {
            val = (((val - 128) as f32 * contrast) as i32) + 128;
        }
        let final_gray = val.clamp(0, 255) as usize;
        let char_index = (final_gray * (ASCII_CHARS.len() - 1)) / 255;
        lut[i] = ASCII_CHARS[char_index];
    }

    let ascii_frames: Vec<String> = frames.par_iter().map(|rgba_frame| {
        let original_width = rgba_frame.width();
        let original_height = rgba_frame.height();

        if original_width == 0 || original_height == 0 {
            return String::new();
        }

        let aspect_ratio = original_height as f32 / original_width as f32;
        let height = (width as f32 * aspect_ratio * 0.5) as u32;
        let height = height.max(1);

        let dynamic_image = DynamicImage::ImageRgba8(rgba_frame.clone());
        let resized = dynamic_image.resize_exact(width, height, image::imageops::FilterType::Nearest);
        let rgba = resized.to_rgba8();
        let pixels = rgba.as_raw();

        let mut ascii_frame = Vec::with_capacity((width * height + height) as usize);

        for y in 0..height {
            let row_start = (y * width * 4) as usize;
            for x in 0..width {
                let offset = row_start + (x * 4) as usize;
                let r = pixels[offset];
                let g = pixels[offset + 1];
                let b = pixels[offset + 2];
                let a = pixels[offset + 3];

                ascii_frame.push(get_ascii_char_lut(r, g, b, a, &lut));
            }
            ascii_frame.push(b'\n');
        }

        unsafe { String::from_utf8_unchecked(ascii_frame) }
    }).collect();

    Ok(ascii_frames)
}

/// Generate a base64 PNG preview of the first frame with current adjustments.
#[tauri::command]
async fn apply_adjustments_to_preview(
    state: State<'_, AppState>,
    brightness: i32,
    contrast: f32
) -> Result<String, String> {
    let frames_lock = state.frames.read().map_err(|_| "Failed to lock state")?;
    let frames = frames_lock.as_ref().ok_or("No GIF loaded")?;
    let first_frame = frames.get(0).ok_or("No frames found")?;

    let mut dynamic_image = DynamicImage::ImageRgba8(first_frame.clone());

    if brightness != 0 {
        dynamic_image = dynamic_image.brighten(brightness);
    }
    if (contrast - 1.0).abs() > 0.01 {
        dynamic_image = dynamic_image.adjust_contrast(contrast);
    }

    let preview = dynamic_image.resize(400, 400, image::imageops::FilterType::Nearest);

    let mut buffer = Vec::new();
    let mut cursor = std::io::Cursor::new(&mut buffer);
    preview.write_to(&mut cursor, image::ImageFormat::Png).map_err(|e| e.to_string())?;

    use base64::{Engine as _, engine::general_purpose};
    let b64 = general_purpose::STANDARD.encode(buffer);
    Ok(format!("data:image/png;base64,{}", b64))
}

/// Persist ASCII frame sequence to a local text file.
#[tauri::command]
async fn save_ascii_to_file(path: String, frames: Vec<String>) -> Result<(), String> {
    let file = File::create(path).map_err(|e| e.to_string())?;
    let mut writer = std::io::BufWriter::new(file);

    for (i, frame) in frames.iter().enumerate() {
        writeln!(writer, "--- FRAME {} ---", i).map_err(|e| e.to_string())?;
        writer.write_all(frame.as_bytes()).map_err(|e| e.to_string())?;
        writeln!(writer).map_err(|e| e.to_string())?;
    }
    writer.flush().map_err(|e| e.to_string())?;
    Ok(())
}

// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
// RUNTIME ENTRY
// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

pub fn run() {
    tauri::Builder::default()
        .manage(AppState::default())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![
            load_gif,
            convert_gif_to_ascii,
            save_ascii_to_file,
            apply_adjustments_to_preview
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
