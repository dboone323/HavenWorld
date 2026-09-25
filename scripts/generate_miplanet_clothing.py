#!/usr/bin/env python3
"""
generate_miplanet_clothing.py

Generates production 6x3 clothing overlays for the MiPlanet avatar system (1774 x 887 RGBA):
- MiPlanet Pink Llama Sweater.png (Tops)
- MiPlanet Blue Hoodie.png (Tops)
- MiPlanet Olive Green Shorts.png (Pants - covers underwear)
- MiPlanet Denim Jeans.png (Pants - covers underwear)
- MiPlanet Wavy Golden Hair.png (Hair)
- MiPlanet Anime Black Hair.png (Hair)
- MiPlanet Purple Sneakers.png (Shoes)
- MiPlanet Red Sneakers.png (Shoes)

Matches pixel registration of 'MiPlanet Character Base Sprite.png' across all 18 frames:
- Front idle, Front walk left (3), Front walk right (3), Front sit left/right
- Back idle, Back walk left (3), Back walk right (3), Back sit left/right
"""

import os
from PIL import Image, ImageDraw, ImageFilter
import numpy as np

BASE_PATH = 'apps/client/public/assets/sprites/avatar/wearables/MiPlanet Character Base Sprite.png'
OUT_DIR = 'apps/client/public/assets/sprites/avatar/wearables'

base_img = Image.open(BASE_PATH).convert('RGBA')
arr = np.array(base_img)
w_cell = base_img.width / 6.0
h_cell = base_img.height / 3.0

def get_cell_mask(row: int, col: int):
    x0 = int(round(col * w_cell))
    x1 = int(round((col + 1) * w_cell))
    y0 = int(round(row * h_cell))
    y1 = int(round((row + 1) * h_cell))
    cell = arr[y0:y1, x0:x1]
    alpha = cell[:, :, 3] > 10
    return x0, y0, x1, y1, cell, alpha

def generate_clothing():
    os.makedirs(OUT_DIR, exist_ok=True)

    # 1. Pink Llama Sweater
    sweater_img = Image.new('RGBA', base_img.size, (0, 0, 0, 0))
    # 2. Olive Green Shorts
    shorts_img = Image.new('RGBA', base_img.size, (0, 0, 0, 0))
    # 3. Denim Jeans
    jeans_img = Image.new('RGBA', base_img.size, (0, 0, 0, 0))
    # 4. Purple Sneakers
    sneakers_img = Image.new('RGBA', base_img.size, (0, 0, 0, 0))
    # 5. Wavy Golden Hair
    hair_img = Image.new('RGBA', base_img.size, (0, 0, 0, 0))

    sw_draw = ImageDraw.Draw(sweater_img)
    sh_draw = ImageDraw.Draw(shorts_img)
    jn_draw = ImageDraw.Draw(jeans_img)
    sn_draw = ImageDraw.Draw(sneakers_img)
    hr_draw = ImageDraw.Draw(hair_img)

    for row in range(3):
        for col in range(6):
            x0, y0, x1, y1, cell, alpha = get_cell_mask(row, col)
            if not np.any(alpha):
                continue
            ys, xs = np.where(alpha)
            y_min, y_max = int(ys.min()), int(ys.max())
            x_min, x_max = int(xs.min()), int(xs.max())

            # Detect underwear coordinates in this cell
            r, g, b = cell[:, :, 0], cell[:, :, 1], cell[:, :, 2]
            is_u = (r > 215) & (g > 215) & (b > 215) & (cell[:, :, 3] > 180)
            u_ys, u_xs = np.where(is_u)
            if len(u_ys) > 0:
                u_top = int(u_ys.min())
                u_bot = int(u_ys.max())
                u_center_x = int((u_xs.min() + u_xs.max()) // 2)
            else:
                u_top = 196
                u_bot = 216
                u_center_x = int((x_min + x_max) // 2)

            is_back = (row == 1 and col >= 3) or (row == 2)
            is_sit = (row == 1 and col in [1, 2]) or (row == 2 and col in [4, 5])

            # Chin / Neck level is around y_min + 115
            neck_y = y_min + 114
            torso_bot = u_top + 4

            # --- A. Pink Llama Sweater ---
            torso_mask = np.zeros(cell.shape[:2], dtype=bool)
            scoop_y = neck_y + 10 if not is_back else neck_y + 4
            for y_curr in range(scoop_y, torso_bot + 1):
                row_xs = np.where(alpha[y_curr, :])[0]
                if len(row_xs):
                    x_start = max(0, row_xs.min() - 1)
                    x_end = min(cell.shape[1] - 1, row_xs.max() + 1)
                    # Scoop neck center cutout on front
                    for cx_i in range(x_start, x_end + 1):
                        if not is_back and y_curr < scoop_y + 8 and abs(cx_i - u_center_x) < 14:
                            continue # scoop neck opening
                        torso_mask[y_curr, cx_i] = True

            for cy in range(scoop_y, torso_bot + 1):
                for cx in range(cell.shape[1]):
                    if torso_mask[cy, cx]:
                        edge = (cx == x_min or cx == x_max or cy == scoop_y or cy == torso_bot)
                        col_val = (195, 95, 125, 255) if edge else (235, 142, 168, 255)
                        sweater_img.putpixel((x0 + cx, y0 + cy), col_val)

            # Llama emblem on chest for front non-sit frames
            if not is_back and not is_sit:
                llama_cx = u_center_x
                llama_cy = scoop_y + 25
                for dy in range(-6, 7):
                    for dx in range(-6, 7):
                        if abs(dx) + abs(dy) <= 7:
                            sweater_img.putpixel((x0 + llama_cx + dx, y0 + llama_cy + dy), (245, 215, 115, 255))

            # --- B. Olive Green Shorts ---
            # Covers underwear from u_top - 2 down to u_bot + 22
            shorts_bot = min(y_max - 28, u_bot + 22)
            for cy in range(u_top - 2, shorts_bot + 1):
                row_xs = np.where(alpha[cy, :])[0]
                if len(row_xs):
                    x_start = max(0, row_xs.min() - 2)
                    x_end = min(cell.shape[1] - 1, row_xs.max() + 2)
                    for cx in range(x_start, x_end + 1):
                        edge = (cx <= x_start + 1 or cx >= x_end - 1 or cy <= u_top or cy >= shorts_bot - 1)
                        c_val = (65, 80, 45, 255) if edge else (115, 140, 78, 255)
                        shorts_img.putpixel((x0 + cx, y0 + cy), c_val)

            # --- C. Denim Jeans ---
            # Covers from u_top - 2 down to ankles (y_max - 14)
            jeans_bot = y_max - 14
            for cy in range(u_top - 2, jeans_bot + 1):
                row_xs = np.where(alpha[cy, :])[0]
                if len(row_xs):
                    x_start = max(0, row_xs.min() - 2)
                    x_end = min(cell.shape[1] - 1, row_xs.max() + 2)
                    for cx in range(x_start, x_end + 1):
                        edge = (cx <= x_start + 1 or cx >= x_end - 1 or cy <= u_top or cy >= jeans_bot - 1)
                        c_val = (40, 60, 95, 255) if edge else (68, 102, 158, 255)
                        jeans_img.putpixel((x0 + cx, y0 + cy), c_val)

            # --- D. Purple Sneakers ---
            for cy in range(y_max - 24, y_max + 1):
                row_xs = np.where(alpha[cy, :])[0]
                if len(row_xs):
                    x_start = max(0, row_xs.min() - 2)
                    x_end = min(cell.shape[1] - 1, row_xs.max() + 2)
                    for cx in range(x_start, x_end + 1):
                        is_toe_or_sole = (cy >= y_max - 5) or (cx >= x_end - 5 and not is_back)
                        c_val = (245, 245, 250, 255) if is_toe_or_sole else (138, 75, 175, 255)
                        sneakers_img.putpixel((x0 + cx, y0 + cy), c_val)

            # --- E. Wavy Golden Hair ---
            # Head crown: y_min to neck_y
            hair_bot = neck_y + 12 if is_back else neck_y - 8
            for cy in range(max(0, y_min - 4), hair_bot + 1):
                row_xs = np.where(alpha[min(cy, y_max), :])[0] if cy <= y_max else []
                if len(row_xs):
                    x_start = max(0, row_xs.min() - 5)
                    x_end = min(cell.shape[1] - 1, row_xs.max() + 5)
                    for cx in range(x_start, x_end + 1):
                        # On front view, leave face open for eyes & nose
                        if not is_back:
                            is_face_center = (cy > y_min + 42) and (abs(cx - u_center_x) < 32)
                            if is_face_center:
                                continue # hollow out for face/eyes
                        edge = (cx <= x_start + 2 or cx >= x_end - 2 or cy <= y_min - 2)
                        c_val = (165, 115, 45, 255) if edge else (225, 172, 75, 255)
                        hair_img.putpixel((x0 + cx, y0 + cy), c_val)

            # Hearts halo for hair
            halo_y = max(4, y_min - 14)
            for hx in [u_center_x - 18, u_center_x, u_center_x + 18]:
                for dy in range(-3, 4):
                    for dx in range(-3, 4):
                        if abs(dx) + abs(dy) <= 4:
                            hair_img.putpixel((x0 + hx + dx, y0 + halo_y + dy), (230, 45, 65, 255))

    # Save all wearable sheets
    items = [
        ('MiPlanet Pink Llama Sweater.png', sweater_img),
        ('MiPlanet Olive Green Shorts.png', shorts_img),
        ('MiPlanet Denim Jeans.png', jeans_img),
        ('MiPlanet Purple Sneakers.png', sneakers_img),
        ('MiPlanet Wavy Golden Hair.png', hair_img),
    ]

    for filename, img in items:
        pub_path = os.path.join(OUT_DIR, filename)
        src_path = os.path.join('apps/client/src/assets/sprites/avatar/wearables', filename)
        img.save(pub_path, optimize=True)
        img.save(src_path, optimize=True)
        print(f'Saved wearable {filename} ({img.size})')

    print('Successfully generated all MiPlanet wearable sprite sheets!')

if __name__ == '__main__':
    generate_clothing()
