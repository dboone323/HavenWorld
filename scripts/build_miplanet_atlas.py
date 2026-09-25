#!/usr/bin/env python3
"""
build_miplanet_atlas.py

Builds the official MiPlanet-standard multi-directional character sprite atlas
from authentic 1774 x 887 (6 cols x 3 rows) wearables:
- Body: MiPlanet Character Base Sprite.png (in white underwear)
- Eyes: MiPlanet Basic Blue Eyes.png
- Hat: MiPlanet Trapper Hat.png
- Accessory: MiPlanet Skull Balaclava.png
- Top: MiPlanet Pink Llama Sweater.png
- Bottom: MiPlanet Olive Green Shorts.png
- Shoes: MiPlanet Purple Sneakers.png
- Hair: MiPlanet Wavy Golden Hair.png
- Shadow: Soft drop shadow ellipse

Each frame is 96 x 128 RGBA.
Total atlas size: 3840 x 2304 RGBA (40 columns x 18 rows).
Maps all 18 authentic MiPlanet animation states across directions and actions:
- down: front idle, front walk left/right, front sit left/right
- up: back idle, back walk left/right, back sit left/right
- left: side left idle, side left walk, side sit
- right: side right idle, side right walk, side sit
"""

import os
import json
from PIL import Image, ImageDraw

FRAME_W = 96
FRAME_H = 128
COLS = 40
ROWS_PER_LAYER = 2
TOTAL_ROWS = 9 * ROWS_PER_LAYER
ATLAS_W = COLS * FRAME_W      # 3840
ATLAS_H = TOTAL_ROWS * FRAME_H  # 2304

WEARABLES_DIR = 'apps/client/public/assets/sprites/avatar/wearables'

LAYERS = [
    ('body', 'MiPlanet Character Base Sprite.png'),
    ('eyes', 'MiPlanet Basic Blue Eyes.png'),
    ('hair', 'MiPlanet Wavy Golden Hair.png'),
    ('top', 'MiPlanet Pink Llama Sweater.png'),
    ('bottom', 'MiPlanet Olive Green Shorts.png'),
    ('shoes', 'MiPlanet Purple Sneakers.png'),
    ('hat', 'MiPlanet Trapper Hat.png'),
    ('accessory', 'MiPlanet Skull Balaclava.png'),
    ('shadow', None),
]

DIRECTIONS = ['down', 'up', 'left', 'right']

# Exact cell mapping for 18 MiPlanet frames:
# (row, col) in 1774x887 sheet
CELL_MAP = {
    'down': {
        'idle': [(0, 0), (0, 0)],
        'walk': [(0, 1), (0, 2), (0, 3), (0, 2), (0, 4), (0, 5), (1, 0), (0, 5)],
        'sit':  [(1, 1), (1, 2)],
    },
    'up': {
        'idle': [(1, 3), (1, 3)],
        'walk': [(1, 4), (1, 5), (2, 0), (1, 5), (2, 1), (2, 2), (2, 3), (2, 2)],
        'sit':  [(2, 4), (2, 5)],
    },
    'left': {
        'idle': [(0, 2), (0, 2)],
        'walk': [(0, 1), (0, 2), (0, 3), (0, 2), (0, 1), (0, 2), (0, 3), (0, 2)],
        'sit':  [(1, 1), (1, 1)],
    },
    'right': {
        'idle': [(0, 5), (0, 5)],
        'walk': [(0, 4), (0, 5), (1, 0), (0, 5), (0, 4), (0, 5), (1, 0), (0, 5)],
        'sit':  [(1, 2), (1, 2)],
    },
}

def extract_cell_frame(sheet: Image.Image, row: int, col: int) -> Image.Image:
    w_cell = sheet.width / 6.0
    h_cell = sheet.height / 3.0
    x0 = int(round(col * w_cell))
    x1 = int(round((col + 1) * w_cell))
    y0 = int(round(row * h_cell))
    y1 = int(round((row + 1) * h_cell))
    cell = sheet.crop((x0, y0, x1, y1))

    # Standard scale & positioning
    target_char_h = 114
    scale = target_char_h / 265.0
    scaled_w = int(round(cell.width * scale))
    scaled_h = int(round(cell.height * scale))
    scaled = cell.resize((scaled_w, scaled_h), Image.Resampling.LANCZOS)

    frame = Image.new('RGBA', (FRAME_W, FRAME_H), (0, 0, 0, 0))
    char_cx_scaled = int(round(148 * scale))
    paste_x = (FRAME_W // 2) - char_cx_scaled
    feet_y_scaled = int(round(291 * scale))
    paste_y = 122 - feet_y_scaled
    frame.paste(scaled, (paste_x, paste_y), scaled)
    return frame

def make_shadow_frame(scale: float = 1.0) -> Image.Image:
    frame = Image.new('RGBA', (FRAME_W, FRAME_H), (0, 0, 0, 0))
    draw = ImageDraw.Draw(frame)
    cx = FRAME_W // 2
    cy = FRAME_H - 8
    rx = int(FRAME_W * 0.28 * scale)
    ry = int(6 * scale)
    bbox = [cx - rx, cy - ry, cx + rx, cy + ry]
    draw.ellipse(bbox, fill=(0, 0, 0, 75))
    return frame

def main():
    print('Loading MiPlanet wearable source sheets...')
    loaded_sheets = {}
    for layer_name, filename in LAYERS:
        if filename:
            path = os.path.join(WEARABLES_DIR, filename)
            if os.path.exists(path):
                loaded_sheets[layer_name] = Image.open(path).convert('RGBA')
                print(f'Loaded {layer_name}: {filename} ({loaded_sheets[layer_name].size})')
            else:
                print(f'Warning: {filename} not found at {path}')

    atlas_img = Image.new('RGBA', (ATLAS_W, ATLAS_H), (0, 0, 0, 0))
    frames_dict = {}

    dir_walk_start = {'down': 0, 'up': 8, 'left': 16, 'right': 24}
    dir_idle_start = {'down': 0, 'up': 2, 'left': 4, 'right': 6}
    dir_sit_start  = {'down': 8, 'up': 10, 'left': 12, 'right': 14}

    print('Building multi-directional frames for all layers...')
    for layer_idx, (layer, _) in enumerate(LAYERS):
        layer_y = layer_idx * ROWS_PER_LAYER * FRAME_H
        walk_y = layer_y
        idle_y = layer_y + FRAME_H

        sheet = loaded_sheets.get(layer)

        for direction in DIRECTIONS:
            # 1. Walk frames (8 frames)
            w_start = dir_walk_start[direction]
            walk_cells = CELL_MAP[direction]['walk']
            for f_idx in range(8):
                frame_name = f'{layer}-walk-{direction}-{f_idx:02d}'
                x = (w_start + f_idx) * FRAME_W
                y = walk_y
                frames_dict[frame_name] = {
                    'frame': {'x': x, 'y': y, 'w': FRAME_W, 'h': FRAME_H}
                }

                if sheet:
                    row, col = walk_cells[f_idx]
                    cell_frame = extract_cell_frame(sheet, row, col)
                    atlas_img.paste(cell_frame, (x, y), cell_frame)
                elif layer == 'shadow':
                    shadow_scale = 0.9 if f_idx in [1, 3, 5, 7] else 1.0
                    sf = make_shadow_frame(scale=shadow_scale)
                    atlas_img.paste(sf, (x, y), sf)

            # 2. Idle frames (2 frames)
            i_start = dir_idle_start[direction]
            idle_cells = CELL_MAP[direction]['idle']
            for f_idx in range(2):
                frame_name = f'{layer}-idle-{direction}-{f_idx:02d}'
                x = (i_start + f_idx) * FRAME_W
                y = idle_y
                frames_dict[frame_name] = {
                    'frame': {'x': x, 'y': y, 'w': FRAME_W, 'h': FRAME_H}
                }

                if sheet:
                    row, col = idle_cells[f_idx]
                    cell_frame = extract_cell_frame(sheet, row, col)
                    atlas_img.paste(cell_frame, (x, y), cell_frame)
                elif layer == 'shadow':
                    sf = make_shadow_frame(scale=1.0)
                    atlas_img.paste(sf, (x, y), sf)

            # 3. Sit frames (2 frames) - placed in idle row at sit offsets
            s_start = dir_sit_start[direction]
            sit_cells = CELL_MAP[direction]['sit']
            for f_idx in range(2):
                frame_name = f'{layer}-sit-{direction}-{f_idx:02d}'
                x = (s_start + f_idx) * FRAME_W
                y = idle_y
                frames_dict[frame_name] = {
                    'frame': {'x': x, 'y': y, 'w': FRAME_W, 'h': FRAME_H}
                }

                if sheet:
                    row, col = sit_cells[f_idx]
                    cell_frame = extract_cell_frame(sheet, row, col)
                    atlas_img.paste(cell_frame, (x, y), cell_frame)
                elif layer == 'shadow':
                    sf = make_shadow_frame(scale=0.85)
                    atlas_img.paste(sf, (x, y), sf)

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

    print('Successfully compiled MiPlanet-standard production sprite atlas!')

if __name__ == '__main__':
    main()
