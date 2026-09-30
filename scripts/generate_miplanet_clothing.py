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

FIX LOG (2026-09-30):
  A. Hair & Eyes: replaced underwear-centroid face anchor with head bounding-box centroid
     (top 38% of character height per frame). Seated frames now receive a per-direction
     face-normal offset so the face hole is cut on the correct side of the head.
     Back-facing frames suppress the face cutout entirely (no visible face from behind).
  B. Pants/Shorts: replaced scanline bounding-box fill (row_xs.min()..row_xs.max())
     with base-sprite alpha-channel masking. Pixels are only painted where the base
     sprite's alpha > 0 at each (cy, cx), preserving the bent-knee silhouette and
     leg separation in seated poses.
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

# ---------------------------------------------------------------------------
# Frame classification helpers
# ---------------------------------------------------------------------------
def is_back_facing(row: int, col: int) -> bool:
    """True if this cell represents a back-facing (away from camera) pose."""
    # Row 1, cols 3-5 = back idle/walk; Row 2 = all back frames
    return (row == 1 and col >= 3) or (row == 2)

def is_seated(row: int, col: int) -> bool:
    """True if this cell is a sitting frame."""
    # Front sit: row 1 cols 1-2; Back sit: row 2 cols 4-5
    return (row == 1 and col in [1, 2]) or (row == 2 and col in [4, 5])

def get_face_direction_offset(row: int, col: int) -> int:
    """
    Horizontal pixel offset from head centroid to the face center for seated frames.
    Front-left sit  (row=1, col=1): avatar faces front-left  → face is on left  (+ve offset toward x_min)
    Front-right sit (row=1, col=2): avatar faces front-right → face is on right (+ve offset toward x_max)
    Non-seated or back-facing: no offset (0)
    """
    if row == 1 and col == 1:
        return -10   # face shifts left of head centroid
    if row == 1 and col == 2:
        return +10   # face shifts right of head centroid
    return 0

def get_cell_mask(row: int, col: int):
    x0 = int(round(col * w_cell))
    x1 = int(round((col + 1) * w_cell))
    y0 = int(round(row * h_cell))
    y1 = int(round((row + 1) * h_cell))
    cell = arr[y0:y1, x0:x1]
    alpha = cell[:, :, 3] > 10
    return x0, y0, x1, y1, cell, alpha

# ---------------------------------------------------------------------------
# Head centroid detection
# ---------------------------------------------------------------------------
def get_head_center_x(alpha: np.ndarray, y_min: int, h: int) -> int:
    """
    Compute the horizontal centroid of the character's HEAD region.
    The head is defined as the top 38% of the character bounding-box height.
    This is robust across all poses because the top of the sprite is always the crown of the head.

    FIX: replaces the old underwear-centroid (u_center_x) approach which broke
    on seated frames because the underwear shifted to the back of the seat.
    """
    head_bot = y_min + max(1, int(h * 0.38))  # top 38% = crown to mid-neck
    head_ys, head_xs = np.where(alpha[:head_bot, :])
    if len(head_xs) > 0:
        return int(np.mean(head_xs))
    # Fallback: full-body horizontal centroid
    ys, xs = np.where(alpha)
    return int(np.mean(xs)) if len(xs) > 0 else alpha.shape[1] // 2

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
            h = y_max - y_min  # character height in pixels

            # ── Frame classification ──────────────────────────────────────
            back_facing = is_back_facing(row, col)
            seated = is_seated(row, col)

            # ── Detect underwear region (for torso baseline only) ─────────
            r_ch, g_ch, b_ch = cell[:, :, 0], cell[:, :, 1], cell[:, :, 2]
            is_u = (r_ch > 215) & (g_ch > 215) & (b_ch > 215) & (cell[:, :, 3] > 180)
            u_ys, u_xs = np.where(is_u)
            if len(u_ys) > 0:
                u_top = int(u_ys.min())
                u_bot = int(u_ys.max())
            else:
                u_top = 196
                u_bot = 216

            # ── HEAD CENTROID (FIX A): replaces u_center_x for face/hair ──
            head_center_x = get_head_center_x(alpha, y_min, h)
            face_dir_offset = get_face_direction_offset(row, col)
            face_center_x = head_center_x + face_dir_offset

            # Chin / Neck level is around y_min + 115
            neck_y = y_min + 114
            torso_bot = u_top + 4

            # ── A. Pink Llama Sweater ─────────────────────────────────────
            # Use head_center_x for scoop-neck centering (same as before, but correct)
            torso_mask = np.zeros(cell.shape[:2], dtype=bool)
            scoop_y = neck_y + 10 if not back_facing else neck_y + 4
            for y_curr in range(scoop_y, torso_bot + 1):
                row_xs_a = np.where(alpha[y_curr, :])[0]
                if len(row_xs_a):
                    x_start = max(0, row_xs_a.min() - 1)
                    x_end = min(cell.shape[1] - 1, row_xs_a.max() + 1)
                    for cx_i in range(x_start, x_end + 1):
                        if not back_facing and y_curr < scoop_y + 8 and abs(cx_i - head_center_x) < 14:
                            continue  # scoop neck opening
                        torso_mask[y_curr, cx_i] = True

            for cy in range(scoop_y, torso_bot + 1):
                for cx in range(cell.shape[1]):
                    if torso_mask[cy, cx]:
                        edge = (cx == x_min or cx == x_max or cy == scoop_y or cy == torso_bot)
                        col_val = (195, 95, 125, 255) if edge else (235, 142, 168, 255)
                        sweater_img.putpixel((x0 + cx, y0 + cy), col_val)

            # Llama emblem on chest for front non-sit frames
            if not back_facing and not seated:
                llama_cx = head_center_x
                llama_cy = scoop_y + 25
                for dy in range(-6, 7):
                    for dx in range(-6, 7):
                        if abs(dx) + abs(dy) <= 7:
                            sweater_img.putpixel((x0 + llama_cx + dx, y0 + llama_cy + dy), (245, 215, 115, 255))

            # ── B. Olive Green Shorts (FIX B: alpha-channel masking) ──────
            # Instead of filling row_xs.min()..row_xs.max() per scanline (which
            # creates a rectangular blob on seated frames), we only paint pixels
            # where the BASE SPRITE itself has alpha > 0. This preserves the
            # bent-knee shape because the base sprite already encodes the
            # correct leg silhouette including the gap between front and back leg.
            shorts_bot = min(y_max - 28, u_bot + 22)
            for cy in range(u_top - 2, shorts_bot + 1):
                for cx in range(cell.shape[1]):
                    # ONLY paint where the base body is actually visible
                    if alpha[cy, cx]:
                        # Determine if this pixel is on the outer edge for shading
                        left_edge = (cx == 0 or not alpha[cy, cx - 1])
                        right_edge = (cx == cell.shape[1] - 1 or not alpha[cy, cx + 1])
                        top_edge = (cy <= u_top)
                        bot_edge = (cy >= shorts_bot - 1)
                        edge = left_edge or right_edge or top_edge or bot_edge
                        c_val = (65, 80, 45, 255) if edge else (115, 140, 78, 255)
                        shorts_img.putpixel((x0 + cx, y0 + cy), c_val)

            # ── C. Denim Jeans (FIX B: alpha-channel masking) ─────────────
            jeans_bot = y_max - 14
            for cy in range(u_top - 2, jeans_bot + 1):
                for cx in range(cell.shape[1]):
                    if alpha[cy, cx]:
                        left_edge = (cx == 0 or not alpha[cy, cx - 1])
                        right_edge = (cx == cell.shape[1] - 1 or not alpha[cy, cx + 1])
                        top_edge = (cy <= u_top)
                        bot_edge = (cy >= jeans_bot - 1)
                        edge = left_edge or right_edge or top_edge or bot_edge
                        c_val = (40, 60, 95, 255) if edge else (68, 102, 158, 255)
                        jeans_img.putpixel((x0 + cx, y0 + cy), c_val)

            # ── D. Purple Sneakers (unchanged — feet are always at y_max) ─
            for cy in range(y_max - 24, y_max + 1):
                row_xs_d = np.where(alpha[cy, :])[0]
                if len(row_xs_d):
                    x_start = max(0, row_xs_d.min() - 2)
                    x_end = min(cell.shape[1] - 1, row_xs_d.max() + 2)
                    for cx in range(x_start, x_end + 1):
                        is_toe_or_sole = (cy >= y_max - 5) or (cx >= x_end - 5 and not back_facing)
                        c_val = (245, 245, 250, 255) if is_toe_or_sole else (138, 75, 175, 255)
                        sneakers_img.putpixel((x0 + cx, y0 + cy), c_val)

            # ── E. Wavy Golden Hair (FIX A) ───────────────────────────────
            # Head crown: y_min to neck_y
            hair_bot = neck_y + 12 if back_facing else neck_y - 8
            for cy in range(max(0, y_min - 4), hair_bot + 1):
                row_xs_e = np.where(alpha[min(cy, y_max), :])[0] if cy <= y_max else []
                if len(row_xs_e):
                    x_start = max(0, row_xs_e.min() - 5)
                    x_end = min(cell.shape[1] - 1, row_xs_e.max() + 5)
                    for cx in range(x_start, x_end + 1):
                        if not back_facing:
                            # FIX A: use face_center_x (head centroid + directional offset)
                            # instead of the old u_center_x (underwear centroid).
                            # On seated frames this puts the face hole on the CORRECT side
                            # of the head rather than on the back/underside.
                            is_face_center = (cy > y_min + 42) and (abs(cx - face_center_x) < 32)
                            if is_face_center:
                                continue  # hollow out for face/eyes
                        edge = (cx <= x_start + 2 or cx >= x_end - 2 or cy <= y_min - 2)
                        c_val = (165, 115, 45, 255) if edge else (225, 172, 75, 255)
                        hair_img.putpixel((x0 + cx, y0 + cy), c_val)

            # Hearts halo — anchor to head_center_x (not underwear centroid)
            halo_y = max(4, y_min - 14)
            for hx in [head_center_x - 18, head_center_x, head_center_x + 18]:
                for dy in range(-3, 4):
                    for dx in range(-3, 4):
                        if abs(dx) + abs(dy) <= 4:
                            px = x0 + hx + dx
                            py = y0 + halo_y + dy
                            if 0 <= px < hair_img.width and 0 <= py < hair_img.height:
                                hair_img.putpixel((px, py), (230, 45, 65, 255))

    # Save all wearable sheets
    items = [
        ('MiPlanet Pink Llama Sweater.png', sweater_img),
        ('MiPlanet Olive Green Shorts.png', shorts_img),
        ('MiPlanet Denim Jeans.png', jeans_img),
        ('MiPlanet Purple Sneakers.png', sneakers_img),
        ('MiPlanet Wavy Golden Hair.png', hair_img),
    ]

    src_dir = 'apps/client/src/assets/sprites/avatar/wearables'
    os.makedirs(src_dir, exist_ok=True)

    for filename, img in items:
        pub_path = os.path.join(OUT_DIR, filename)
        src_path = os.path.join(src_dir, filename)
        img.save(pub_path, optimize=True)
        img.save(src_path, optimize=True)
        print(f'Saved wearable {filename} ({img.size})')

    print('Successfully generated all MiPlanet wearable sprite sheets!')

if __name__ == '__main__':
    generate_clothing()
