// Copyright (c) 2026 Randall Rosas (Slategray). All rights reserved.

//! Perform hyper-performance GIF to ASCII conversion using a pre-calculated Tensor Cache.

use image::AnimationDecoder;
use image::codecs::gif::GifDecoder;
use image::RgbaImage;
use ndarray::{Array3, s};
use std::collections::HashMap;
use std::fs::File;
use std::io::{BufReader, Write};
use std::sync::RwLock;
use rayon::prelude::*;
use tauri::State;

const ASCII_CHARS: &[u8] = b"$$@B%8&WM#*oahkbdpqwmZO0QLCJUYXzcvunxrjft/\\|()1{}[]?-_+~<>i!lI;:,\"^`'. ";

pub struct AppState {
    width_cache: RwLock<HashMap<u32, Array3<u8>>>,
    frame_count: RwLock<usize>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            width_cache: RwLock::new(HashMap::new()),
            frame_count: RwLock::new(0),
        }
    }
}

#[tauri::command]
async fn load_gif(state: State<'_, AppState>, path: String) -> Result<usize, String> {
    let file = File::open(&path).map_err(|e| e.to_string())?;
    let reader = BufReader::new(file);
    let decoder = GifDecoder::new(reader).map_err(|e| e.to_string())?;
    let frames = decoder.into_frames().collect_frames().map_err(|e| e.to_string())?;

    if frames.is_empty() { return Ok(0); }

    let frame_count = frames.len();
    let rgba_frames: Vec<RgbaImage> = frames.into_iter().map(|f| f.into_buffer()).collect();
    let (orig_w, orig_h) = (rgba_frames[0].width(), rgba_frames[0].height());
    let aspect_ratio = orig_h as f32 / orig_w as f32;

    {
        let mut cache = state.width_cache.write().map_err(|_| "Lock failed")?;
        cache.clear();
        *state.frame_count.write().map_err(|_| "Lock failed")? = frame_count;
    }

    let widths: Vec<u32> = (20..=250).collect();
    let results: Vec<(u32, Array3<u8>)> = widths.par_iter().map(|&w| {
        let h = (w as f32 * aspect_ratio * 0.5) as u32;
        let h = h.max(1);
        let mut tensor = Array3::<u8>::zeros((frame_count, h as usize, w as usize));
        for (f_idx, rgba) in rgba_frames.iter().enumerate() {
            let pixels = rgba.as_raw();
            for y in 0..h {
                let src_y = (y * orig_h / h) * orig_w * 4;
                for x in 0..w {
                    let src_x = (x * orig_w / w) * 4;
                    let offset = (src_y + src_x) as usize;
                    let r = pixels[offset];
                    let g = pixels[offset + 1];
                    let b = pixels[offset + 2];
                    let a = pixels[offset + 3];
                    let val = if a < 128 { 255 } else {
                        ((r as u32 * 19595 + g as u32 * 38470 + b as u32 * 7471) >> 16) as u8
                    };
                    tensor[[f_idx, y as usize, x as usize]] = val;
                }
            }
        }
        (w, tensor)
    }).collect();

    let mut cache = state.width_cache.write().map_err(|_| "Lock failed")?;
    for (w, tensor) in results { cache.insert(w, tensor); }
    Ok(frame_count)
}

/// Optimized conversion returning (Height, Data) for zero-measure scaling.
#[tauri::command]
async fn convert_gif_to_ascii(
    state: State<'_, AppState>,
    width: u32,
    brightness: i32,
    contrast: f32,
    only_frame: Option<usize>
) -> Result<(u32, Vec<u8>), String> {
    let cache = state.width_cache.read().map_err(|_| "Lock failed")?;
    let tensor = cache.get(&width).ok_or("Width not cached")?;
    let (frame_count, height, w_usize) = tensor.dim();
    let height_u32 = height as u32;

    let mut lut = [0u8; 256];
    let ascii_len = (ASCII_CHARS.len() - 1) as f32;
    for i in 0..256 {
        let mut val = i as f32 + brightness as f32;
        if (contrast - 1.0).abs() > 0.01 { val = (val - 128.0) * contrast + 128.0; }
        let char_index = (val.clamp(0.0, 255.0) as f32 * ascii_len / 255.0) as usize;
        lut[i] = ASCII_CHARS[char_index];
    }

    let frame_size = (w_usize * height + height) as usize;

    if let Some(target_idx) = only_frame {
        let mut output = vec![0u8; frame_size];
        let mut write_ptr = 0;
        let f_idx = target_idx % frame_count;
        for y in 0..height {
            for x in 0..w_usize {
                unsafe {
                    let gray = *tensor.uget((f_idx, y, x));
                    *output.get_unchecked_mut(write_ptr) = *lut.get_unchecked(gray as usize);
                }
                write_ptr += 1;
            }
            output[write_ptr] = b'\n';
            write_ptr += 1;
        }
        Ok((height_u32, output))
    } else {
        let mut output = vec![0u8; frame_size * frame_count];
        output.par_chunks_exact_mut(frame_size).enumerate().for_each(|(f_idx, out_frame)| {
            let mut write_ptr = 0;
            for y in 0..height {
                for x in 0..w_usize {
                    unsafe {
                        let gray = *tensor.uget((f_idx, y, x));
                        *out_frame.get_unchecked_mut(write_ptr) = *lut.get_unchecked(gray as usize);
                    }
                    write_ptr += 1;
                }
                out_frame[write_ptr] = b'\n';
                write_ptr += 1;
            }
        });
        Ok((height_u32, output))
    }
}

#[tauri::command]
async fn apply_adjustments_to_preview(
    state: State<'_, AppState>,
    brightness: i32,
    contrast: f32,
    frame_index: usize
) -> Result<String, String> {
    let cache = state.width_cache.read().map_err(|_| "Lock failed")?;
    let tensor = cache.get(&250).or_else(|| cache.values().next()).ok_or("No media loaded")?;
    let frame_count = *state.frame_count.read().map_err(|_| "Lock failed")?;
    if frame_count == 0 { return Err("Empty".into()); }
    let f_idx = frame_index % frame_count;
    let frame = tensor.slice(s![f_idx, .., ..]);
    let (h, w) = frame.dim();
    let mut rgba_image = RgbaImage::new(w as u32, h as u32);
    for y in 0..h {
        for x in 0..w {
            let gray = frame[[y, x]];
            let mut val = gray as f32 + brightness as f32;
            if (contrast - 1.0).abs() > 0.01 { val = (val - 128.0) * contrast + 128.0; }
            let g_out = val.clamp(0.0, 255.0) as u8;
            rgba_image.put_pixel(x as u32, y as u32, image::Rgba([g_out, g_out, g_out, 255]));
        }
    }
    let mut buffer = Vec::new();
    let mut cursor = std::io::Cursor::new(&mut buffer);
    rgba_image.write_to(&mut cursor, image::ImageFormat::Png).map_err(|e| e.to_string())?;
    use base64::{Engine as _, engine::general_purpose};
    Ok(format!("data:image/png;base64,{}", general_purpose::STANDARD.encode(buffer)))
}

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
