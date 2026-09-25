#!/usr/bin/env python3
"""
build_chibi_atlas.py

Builds high-fidelity 2D Chibi production avatar atlas from extracted character sprites:
- Front view (down)
- Back view (up)
- Left view (left)
- Right view (horizontally mirrored left)

Generates 360 frames (9 layers x 4 directions x 10 frames) at 96x128 resolution per frame:
Atlas resolution: 3840 x 2304 RGBA
Outputs:
- apps/client/public/assets/sprites/avatar/atlas.png
- apps/client/public/assets/sprites/avatar/atlas.json
- apps/client/src/assets/sprites/avatar/atlas.png
- apps/client/src/assets/sprites/avatar/atlas.json
- apps/client/dist/assets/sprites/avatar/atlas.png (if dist exists)
- apps/client/dist/assets/sprites/avatar/atlas.json (if dist exists)
"""

import os
import json
import math
import numpy as np
from scipy import ndimage
from PIL import Image, ImageDraw

FRAME_W = 96
FRAME_H = 128
COLS = 40
ROWS_PER_LAYER = 2
TOTAL_ROWS = 9 * ROWS_PER_LAYER
ATLAS_W = COLS * FRAME_W      # 3840
ATLAS_H = TOTAL_ROWS * FRAME_H  # 2304

LAYERS = [
    'body',
    'eyes',
    'hair',
    'top',
    'bottom',
    'shoes',
    'hat',
    'accessory',
    'shadow'
]

DIRECTIONS = ['down', 'up', 'left', 'right']

def extract_foreground(path: str) -> Image.Image:
    img = Image.open(path).convert('RGB')
    arr = np.array(img, dtype=float)
    # Background in JPEG is near-white (>240 in all RGB channels)
    is_white = (arr[:,:,0] > 240) & (arr[:,:,1] > 240) & (arr[:,:,2] > 240)
    # Group connected components
    labeled, _ = ndimage.label(is_white)
    # Edge components are outside background
    edge_labels = set(labeled[0, :]).union(set(labeled[-1, :])).union(set(labeled[:, 0])).union(set(labeled[:, -1]))
    edge_labels.discard(0)
    bg_mask = np.isin(labeled, list(edge_labels))
    alpha = (~bg_mask).astype(np.uint8) * 255
    rgba = np.dstack([arr.astype(np.uint8), alpha])
    out = Image.fromarray(rgba, 'RGBA')
    bbox = out.getbbox()
    if bbox:
        return out.crop(bbox)
    return out

def fit_to_frame(sprite: Image.Image, frame_w: int = FRAME_W, frame_h: int = FRAME_H, y_margin: int = 6) -> Image.Image:
    # Character should fill vertical space with safety margin
    avail_h = frame_h - (y_margin * 2) - 8 # leave room for shadow underneath
    scale = avail_h / sprite.height
    w = int(round(sprite.width * scale))
    h = int(round(sprite.height * scale))
    scaled = sprite.resize((w, h), Image.Resampling.LANCZOS)
    
    frame = Image.new('RGBA', (frame_w, frame_h), (0, 0, 0, 0))
    x_pos = (frame_w - w) // 2
    y_pos = frame_h - h - y_margin - 4 # align feet slightly above bottom edge
    frame.paste(scaled, (x_pos, y_pos), scaled)
    return frame

def make_walk_frame(base_frame: Image.Image, frame_idx: int) -> Image.Image:
    # Subtle procedural bob / tilt for walk cycle
    bob_offsets = [0, -3, -1, 0, 0, -3, -1, 0]
    tilts = [0.0, 1.5, 0.5, 0.0, 0.0, -1.5, -0.5, 0.0]
    bob = bob_offsets[frame_idx % len(bob_offsets)]
    tilt = tilts[frame_idx % len(tilts)]
    
    out = Image.new('RGBA', base_frame.size, (0, 0, 0, 0))
    rotated = base_frame.rotate(tilt, resample=Image.Resampling.BICUBIC, center=(base_frame.width // 2, base_frame.height - 10))
    out.paste(rotated, (0, bob), rotated)
    return out

def make_idle_frame(base_frame: Image.Image, frame_idx: int) -> Image.Image:
    # Subtle breathing motion
    out = Image.new('RGBA', base_frame.size, (0, 0, 0, 0))
    bob = -1 if frame_idx == 1 else 0
    out.paste(base_frame, (0, bob), base_frame)
    return out

def make_shadow_frame(frame_w: int = FRAME_W, frame_h: int = FRAME_H, scale: float = 1.0) -> Image.Image:
    frame = Image.new('RGBA', (frame_w, frame_h), (0, 0, 0, 0))
    draw = ImageDraw.Draw(frame)
    cx = frame_w // 2
    cy = frame_h - 8
    rx = int(frame_w * 0.28 * scale)
    ry = int(6 * scale)
    bbox = [cx - rx, cy - ry, cx + rx, cy + ry]
    # Soft translucent black oval
    draw.ellipse(bbox, fill=(0, 0, 0, 75))
    return frame

def main():
    brain_dir = '/Users/danielstevens/.gemini/antigravity/brain/98772a0b-e303-46e0-a01b-49806d7328e0'
    front_path = os.path.join(brain_dir, 'chibi_avatar_front_1790356911681.jpg')
    back_path = os.path.join(brain_dir, 'chibi_avatar_back_1790356929482.jpg')
    left_path = os.path.join(brain_dir, 'chibi_avatar_left_1790356952380.jpg')

    print('Extracting high-resolution character sprites...')
    sprite_down = extract_foreground(front_path)
    sprite_up = extract_foreground(back_path)
    sprite_left = extract_foreground(left_path)
    sprite_right = sprite_left.transpose(Image.Transpose.FLIP_LEFT_RIGHT)

    print('Fitting directional base sprites into frames...')
    base_frames = {
        'down': fit_to_frame(sprite_down),
        'up': fit_to_frame(sprite_up),
        'left': fit_to_frame(sprite_left),
        'right': fit_to_frame(sprite_right),
    }

    atlas_img = Image.new('RGBA', (ATLAS_W, ATLAS_H), (0, 0, 0, 0))
    frames_dict = {}

    # Direction walk offsets (col multipliers): down: 0..7, up: 8..15, left: 16..23, right: 24..31
    dir_walk_start = {
        'down': 0,
        'up': 8,
        'left': 16,
        'right': 24,
    }

    # Idle x offsets: down: 0, 1; up: 2, 3; left: 4, 5; right: 6, 7
    dir_idle_start = {
        'down': 0,
        'up': 2,
        'left': 4,
        'right': 6,
    }

    print('Generating atlas frames and metadata...')
    for layer_idx, layer in enumerate(LAYERS):
        layer_y = layer_idx * ROWS_PER_LAYER * FRAME_H
        walk_y = layer_y
        idle_y = layer_y + FRAME_H

        for direction in DIRECTIONS:
            # 8 walk frames
            w_start = dir_walk_start[direction]
            for f_idx in range(8):
                frame_name = f'{layer}-walk-{direction}-{f_idx:02d}'
                x = (w_start + f_idx) * FRAME_W
                y = walk_y
                frames_dict[frame_name] = {
                    'frame': {'x': x, 'y': y, 'w': FRAME_W, 'h': FRAME_H}
                }

                if layer == 'body':
                    frame_img = make_walk_frame(base_frames[direction], f_idx)
                    atlas_img.paste(frame_img, (x, y), frame_img)
                elif layer == 'shadow':
                    shadow_scale = 0.9 if f_idx in [1, 5] else 1.0
                    frame_img = make_shadow_frame(scale=shadow_scale)
                    atlas_img.paste(frame_img, (x, y), frame_img)

            # 2 idle frames
            i_start = dir_idle_start[direction]
            for f_idx in range(2):
                frame_name = f'{layer}-idle-{direction}-{f_idx:02d}'
                x = (i_start + f_idx) * FRAME_W
                y = idle_y
                frames_dict[frame_name] = {
                    'frame': {'x': x, 'y': y, 'w': FRAME_W, 'h': FRAME_H}
                }

                if layer == 'body':
                    frame_img = make_idle_frame(base_frames[direction], f_idx)
                    atlas_img.paste(frame_img, (x, y), frame_img)
                elif layer == 'shadow':
                    frame_img = make_shadow_frame(scale=1.0)
                    atlas_img.paste(frame_img, (x, y), frame_img)

    atlas_json = {
        'frames': frames_dict,
        'meta': {
            'image': 'atlas.png',
            'format': 'RGBA8888',
            'size': {'w': ATLAS_W, 'h': ATLAS_H}
        }
    }

    target_dirs = [
        'apps/client/public/assets/sprites/avatar',
        'apps/client/src/assets/sprites/avatar',
        'apps/client/dist/assets/sprites/avatar',
    ]

    for d in target_dirs:
        if os.path.exists(os.path.dirname(d)):
            os.makedirs(d, exist_ok=True)
            png_path = os.path.join(d, 'atlas.png')
            json_path = os.path.join(d, 'atlas.json')
            print(f'Writing {png_path} and {json_path}...')
            atlas_img.save(png_path, optimize=True)
            with open(json_path, 'w') as jf:
                json.dump(atlas_json, jf, indent=2)

    print('Successfully generated production Chibi sprite atlas!')

if __name__ == '__main__':
    main()
