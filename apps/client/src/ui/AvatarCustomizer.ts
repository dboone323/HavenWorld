import type { AvatarData } from '@havenworld/shared';
import {
  SOCKET_EVENTS,
  WARDROBE_TABS,
  normalizeGender,
  type WardrobeItem,
} from '@havenworld/shared';
import { authService } from '../services/auth';
import { socketService } from '../services/socket';
import { showToast } from './ToastNotification';
import { SERVER_URL, assetUrl } from '../config';

interface CatalogItem {
  id: string;
  name: string;
  category: string;
  slot: 'outfitHead' | 'outfitFace' | 'outfitBody' | 'outfitLegs' | 'outfitFeet' | 'outfitBack' | 'eyes' | 'hairStyle';
  asset: string;
  frontAsset?: string;
  backAsset?: string;
  icon: string;
}

const MI_PLANET_CATALOG: CatalogItem[] = [
  // Tops
  {
    id: 'pink-llama-sweater',
    name: 'Pink Llama Sweater',
    category: 'tops',
    slot: 'outfitBody',
    asset: '/assets/sprites/avatar/wearables/MiPlanet Pink Llama Sweater.png',
    icon: '🌸',
  },
  {
    id: 'underwear-top',
    name: 'No Shirt (Underwear)',
    category: 'tops',
    slot: 'outfitBody',
    asset: '',
    icon: '🩱',
  },
  // Pants
  {
    id: 'olive-shorts',
    name: 'Olive Green Shorts',
    category: 'bottoms',
    slot: 'outfitLegs',
    asset: '/assets/sprites/avatar/wearables/MiPlanet Olive Green Shorts.png',
    icon: '🩳',
  },
  {
    id: 'denim-jeans',
    name: 'Denim Jeans',
    category: 'bottoms',
    slot: 'outfitLegs',
    asset: '/assets/sprites/avatar/wearables/MiPlanet Denim Jeans.png',
    icon: '👖',
  },
  {
    id: 'underwear-bottom',
    name: 'White Briefs (Underwear)',
    category: 'bottoms',
    slot: 'outfitLegs',
    asset: '',
    icon: '🩲',
  },
  // Eyes
  {
    id: 'basic-blue-eyes',
    name: 'Basic Blue Eyes',
    category: 'eyes',
    slot: 'eyes',
    asset: '/assets/sprites/avatar/wearables/MiPlanet Basic Blue Eyes.png',
    icon: '👁️',
  },
  {
    id: 'basic-brown-eyes',
    name: 'Basic Brown Eyes',
    category: 'eyes',
    slot: 'eyes',
    asset: '/assets/sprites/avatar/wearables/MiPlanet Basic Brown Eyes.png',
    icon: '👀',
  },
  // Headwear
  {
    id: 'trapper-hat',
    name: 'Trapper Hat',
    category: 'headwear',
    slot: 'outfitHead',
    asset: '/assets/sprites/avatar/wearables/MiPlanet Trapper Hat.png',
    icon: '💂',
  },
  // Facewear
  {
    id: 'skull-balaclava',
    name: 'Skull Balaclava',
    category: 'face',
    slot: 'outfitFace',
    asset: '/assets/sprites/avatar/wearables/MiPlanet Skull Balaclava.png',
    icon: '💀',
  },
  // Backwear / Wings
  {
    id: 'black-wings',
    name: 'Black Wings',
    category: 'back',
    slot: 'outfitBack',
    asset: '/assets/sprites/avatar/wearables/MiPlanet Black Wings Front.png',
    frontAsset: '/assets/sprites/avatar/wearables/MiPlanet Black Wings Front.png',
    backAsset: '/assets/sprites/avatar/wearables/MiPlanet Black Wings Back.png',
    icon: '🪽',
  },
  {
    id: 'white-wings',
    name: 'White Wings',
    category: 'back',
    slot: 'outfitBack',
    asset: '/assets/sprites/avatar/wearables/MiPlanet White Wings Front.png',
    frontAsset: '/assets/sprites/avatar/wearables/MiPlanet White Wings Front.png',
    backAsset: '/assets/sprites/avatar/wearables/MiPlanet White Wings Back.png',
    icon: '🕊️',
  },
  // Shoes
  {
    id: 'purple-sneakers',
    name: 'Purple Sneakers',
    category: 'shoes',
    slot: 'outfitFeet',
    asset: '/assets/sprites/avatar/wearables/MiPlanet Purple Sneakers.png',
    icon: '👟',
  },
  {
    id: 'barefoot',
    name: 'Barefoot',
    category: 'shoes',
    slot: 'outfitFeet',
    asset: '',
    icon: '🦶',
  },
  // Hair
  {
    id: 'wavy-hair',
    name: 'Wavy Golden Hair',
    category: 'hair',
    slot: 'hairStyle',
    asset: '/assets/sprites/avatar/wearables/MiPlanet Wavy Golden Hair.png',
    icon: '💇',
  },
  {
    id: 'bald',
    name: 'Bald / Clean Shaved',
    category: 'hair',
    slot: 'hairStyle',
    asset: '',
    icon: '🧑‍🦲',
  },
];

const UI_CATEGORIES = [
  { id: 'all', label: 'All Items', icon: '✨' },
  { id: 'tops', label: 'Tops', icon: '👕' },
  { id: 'bottoms', label: 'Pants', icon: '👖' },
  { id: 'eyes', label: 'Eyes', icon: '👁️' },
  { id: 'headwear', label: 'Headwear', icon: '🎩' },
  { id: 'face', label: 'Face Wear', icon: '👓' },
  { id: 'back', label: 'Backwear', icon: '🪽' },
  { id: 'shoes', label: 'Shoes', icon: '👟' },
  { id: 'hair', label: 'Hair', icon: '💇' },
];

export class AvatarCustomizer {
  private overlay: HTMLElement | null = null;
  private currentData: AvatarData;
  private savedData: AvatarData;
  private onSaveCallback: (data: AvatarData) => void;
  private activeCategory: string = 'all';
  private activeAngle: 'front' | 'back' | 'sit' = 'front';
  private previewLayers: Record<string, HTMLElement> = {};

  constructor(savedData?: AvatarData, onSave?: (data: AvatarData) => void) {
    const userAvatar = authService.user?.avatar || {};
    const initial: AvatarData = {
      gender: 'unspecified',
      outfitHead: 'trapper-hat',
      outfitFace: null,
      outfitBody: 'pink-llama-sweater',
      outfitLegs: 'olive-shorts',
      outfitFeet: 'purple-sneakers',
      outfitBack: null,
      eyes: 'basic-blue-eyes',
      hairStyle: 'wavy-hair',
      ...userAvatar,
      ...savedData,
    };

    this.savedData = { ...initial };
    this.currentData = { ...initial };
    this.onSaveCallback = onSave || (() => {});
  }

  open(): void {
    if (this.overlay) return;
    const userAvatar = authService.user?.avatar || {};
    this.currentData = { ...this.currentData, ...userAvatar };
    this.savedData = { ...this.currentData };
    this.overlay = this.buildOverlay();
    document.body.appendChild(this.overlay);
    this.updatePreview();
  }

  close(): void {
    this.overlay?.remove();
    this.overlay = null;
  }

  private buildOverlay(): HTMLElement {
    const el = document.createElement('div');
    el.id = 'avatar-customizer';
    el.setAttribute('data-testid', 'avatar-customizer');
    el.style.cssText = `
      position: fixed;
      inset: 0;
      background: rgba(14, 20, 28, 0.88);
      backdrop-filter: blur(8px);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 9999;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    `;

    el.addEventListener('click', (e) => {
      if (e.target === el) this.close();
    });

    const modal = document.createElement('div');
    modal.className = 'catalog-modal visible';
    modal.style.cssText = `
      position: relative;
      width: min(1080px, calc(100vw - 32px));
      height: min(640px, calc(100vh - 80px));
      background: #f8f8f7;
      border: 1px solid rgba(40, 48, 56, 0.24);
      border-radius: 16px;
      box-shadow: 0 24px 64px rgba(0, 0, 0, 0.6);
      overflow: hidden;
      display: grid;
      grid-template-columns: minmax(0, 1fr) 300px;
      gap: 0;
    `;

    modal.appendChild(this.buildCatalogCard());
    modal.appendChild(this.buildPreviewCard());

    el.appendChild(modal);
    return el;
  }

  private buildCatalogCard(): HTMLElement {
    const card = document.createElement('div');
    card.className = 'catalog-main-card';
    card.style.cssText = `
      display: grid;
      grid-template-columns: 88px minmax(0, 1fr);
      height: 100%;
      border-right: 1px solid #d7dadc;
      overflow: hidden;
    `;

    // Category Rail
    const rail = document.createElement('div');
    rail.className = 'catalog-category-rail';
    rail.style.cssText = `
      background: #f0f2f3;
      padding: 14px 6px;
      display: flex;
      flex-direction: column;
      gap: 6px;
      overflow-y: auto;
      border-right: 1px solid #d7dadc;
    `;

    UI_CATEGORIES.forEach((cat) => {
      const btn = document.createElement('button');
      btn.className = `catalog-category-button ${this.activeCategory === cat.id ? 'active' : ''}`;
      btn.dataset.catId = cat.id;
      btn.style.cssText = `
        width: 100%;
        min-height: 52px;
        padding: 6px 2px;
        border: 1px solid ${this.activeCategory === cat.id ? '#c7ccd0' : 'transparent'};
        border-radius: 9px;
        background: ${this.activeCategory === cat.id ? '#ffffff' : 'transparent'};
        color: #505960;
        cursor: pointer;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 2px;
        font-size: 18px;
        transition: all 0.15s ease;
      `;
      btn.innerHTML = `<span>${cat.icon}</span><small style="font-size: 8.5pt; font-weight: 700; color: ${this.activeCategory === cat.id ? '#252a2f' : '#667078'};">${cat.label}</small>`;
      btn.addEventListener('click', () => {
        this.activeCategory = cat.id;
        Array.from(rail.children).forEach((b) => {
          (b as HTMLElement).style.background = 'transparent';
          (b as HTMLElement).style.borderColor = 'transparent';
        });
        btn.style.background = '#ffffff';
        btn.style.borderColor = '#c7ccd0';
        this.renderItemGrid();
      });
      rail.appendChild(btn);
    });

    card.appendChild(rail);

    // Items Column
    const col = document.createElement('div');
    col.className = 'catalog-content-column';
    col.style.cssText = 'display: flex; flex-direction: column; padding: 18px 22px; overflow: hidden;';

    const header = document.createElement('div');
    header.style.cssText = 'margin-bottom: 14px;';
    header.innerHTML = `
      <div style="font-size: 16pt; font-weight: 900; color: #24292e;">Wardrobe &amp; Style</div>
      <div style="font-size: 9.5pt; color: #707980; margin-top: 3px;">Equip apparel, headwear, eyes, and styles onto your multi-sided avatar.</div>
    `;
    col.appendChild(header);

    const grid = document.createElement('div');
    grid.id = 'wardrobe-item-grid';
    grid.className = 'catalog-item-grid';
    grid.style.cssText = `
      flex: 1;
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(115px, 1fr));
      grid-auto-rows: 105px;
      gap: 10px;
      overflow-y: auto;
      padding-right: 4px;
    `;
    col.appendChild(grid);

    card.appendChild(col);
    setTimeout(() => this.renderItemGrid(), 0);
    return card;
  }

  private renderItemGrid(): void {
    const grid = document.getElementById('wardrobe-item-grid');
    if (!grid) return;
    grid.innerHTML = '';

    const items = MI_PLANET_CATALOG.filter(
      (it) => this.activeCategory === 'all' || it.category === this.activeCategory
    );

    items.forEach((item) => {
      const isEquipped =
        this.currentData[item.slot] === item.id ||
        (item.id === 'underwear-top' && (!this.currentData.outfitBody || this.currentData.outfitBody === 'none')) ||
        (item.id === 'underwear-bottom' && (!this.currentData.outfitLegs || this.currentData.outfitLegs === 'none')) ||
        (item.id === 'barefoot' && (!this.currentData.outfitFeet || this.currentData.outfitFeet === 'none')) ||
        (item.id === 'bald' && (!this.currentData.hairStyle || this.currentData.hairStyle === 'none'));

      const card = document.createElement('div');
      card.className = `clothes-card ${isEquipped ? 'equipped' : ''}`;
      card.style.cssText = `
        background: #ffffff;
        border: 2px solid ${isEquipped ? '#4ecdc4' : '#e2e6e8'};
        border-radius: 12px;
        padding: 8px;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        transition: all 0.15s ease;
        position: relative;
        box-shadow: ${isEquipped ? '0 4px 12px rgba(78, 205, 196, 0.25)' : 'none'};
      `;

      card.innerHTML = `
        <div style="font-size: 26pt; margin-bottom: 4px;">${item.icon}</div>
        <div style="font-size: 8.5pt; font-weight: 700; text-align: center; color: #2c3237; line-height: 1.15; max-width: 100px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${item.name}</div>
        ${isEquipped ? '<div style="position: absolute; top: 6px; right: 6px; background: #4ecdc4; color: #fff; width: 16px; height: 16px; border-radius: 50%; font-size: 9pt; display: flex; align-items: center; justify-content: center; font-weight: 900;">✓</div>' : ''}
      `;

      card.addEventListener('click', () => {
        this.toggleItem(item);
      });

      grid.appendChild(card);
    });
  }

  private toggleItem(item: CatalogItem): void {
    if (item.id === 'underwear-top') {
      this.currentData.outfitBody = 'none';
    } else if (item.id === 'underwear-bottom') {
      this.currentData.outfitLegs = 'none';
    } else if (item.id === 'barefoot') {
      this.currentData.outfitFeet = 'none';
    } else if (item.id === 'bald') {
      this.currentData.hairStyle = 'none';
    } else {
      const current = this.currentData[item.slot];
      if (current === item.id) {
        delete (this.currentData as Record<string, unknown>)[item.slot];
      } else {
        (this.currentData as Record<string, unknown>)[item.slot] = item.id;
      }
    }
    this.renderItemGrid();
    this.updatePreview();
  }

  private buildPreviewCard(): HTMLElement {
    const card = document.createElement('div');
    card.className = 'catalog-detail-card';
    card.style.cssText = `
      background: #fdfdfd;
      padding: 16px;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: space-between;
    `;

    const title = document.createElement('div');
    title.style.cssText = 'font-size: 12pt; font-weight: 900; color: #363c41; margin-bottom: 8px;';
    title.textContent = 'Avatar Preview';
    card.appendChild(title);

    // Preview Stage
    const stage = document.createElement('div');
    stage.className = 'wardrobe-preview-stage';
    stage.style.cssText = `
      position: relative;
      width: 100%;
      height: 330px;
      border-radius: 14px;
      border: 1px solid #d6dade;
      background: radial-gradient(circle at 50% 40%, rgba(255,255,255,0.98) 0, rgba(239,242,243,0.95) 50%, rgba(220,226,229,0.95) 100%);
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: hidden;
    `;

    // #wardrobe-avatar container (170px x 290px)
    const avatarBox = document.createElement('div');
    avatarBox.id = 'wardrobe-avatar';
    avatarBox.style.cssText = 'position: relative; width: 170px; height: 290px;';

    // Stacked layers
    const layerNames = ['wings', 'base', 'bottom', 'top', 'shoes', 'eyes', 'mask', 'hair', 'hat'];
    layerNames.forEach((layer) => {
      const div = document.createElement('div');
      div.id = `wardrobe-preview-${layer}`;
      div.className = 'wardrobe-preview-layer';
      div.style.cssText = 'position: absolute; inset: 0; width: 100%; height: 100%; background-repeat: no-repeat; pointer-events: none;';
      avatarBox.appendChild(div);
      this.previewLayers[layer] = div;
    });

    stage.appendChild(avatarBox);
    card.appendChild(stage);

    // Angle Selector Buttons
    const angleRow = document.createElement('div');
    angleRow.style.cssText = 'display: flex; gap: 6px; margin: 10px 0 6px; width: 100%;';

    const angles: Array<{ id: 'front' | 'back' | 'sit'; label: string }> = [
      { id: 'front', label: 'Front' },
      { id: 'back', label: 'Back' },
      { id: 'sit', label: 'Sit' },
    ];

    angles.forEach((a) => {
      const abtn = document.createElement('button');
      abtn.textContent = a.label;
      abtn.style.cssText = `
        flex: 1;
        padding: 6px 0;
        font-size: 8.5pt;
        font-weight: 700;
        border: 1px solid ${this.activeAngle === a.id ? '#4ecdc4' : '#ccd1d5'};
        background: ${this.activeAngle === a.id ? '#4ecdc4' : '#ffffff'};
        color: ${this.activeAngle === a.id ? '#ffffff' : '#454f57'};
        border-radius: 8px;
        cursor: pointer;
        transition: all 0.15s ease;
      `;
      abtn.addEventListener('click', () => {
        this.activeAngle = a.id;
        Array.from(angleRow.children).forEach((ch) => {
          (ch as HTMLElement).style.background = '#ffffff';
          (ch as HTMLElement).style.color = '#454f57';
          (ch as HTMLElement).style.borderColor = '#ccd1d5';
        });
        abtn.style.background = '#4ecdc4';
        abtn.style.color = '#ffffff';
        abtn.style.borderColor = '#4ecdc4';
        this.updatePreview();
      });
      angleRow.appendChild(abtn);
    });

    card.appendChild(angleRow);

    // Action buttons row
    const btnBox = document.createElement('div');
    btnBox.style.cssText = 'display: flex; flex-direction: column; gap: 6px; width: 100%;';

    const saveBtn = document.createElement('button');
    saveBtn.textContent = 'Save Look';
    saveBtn.style.cssText = 'width: 100%; padding: 10px; background: #4ecdc4; border: 0; border-radius: 8px; color: #0a2523; font-weight: 800; font-size: 10pt; cursor: pointer; transition: background 0.15s ease;';
    saveBtn.addEventListener('click', () => this.handleSave());
    btnBox.appendChild(saveBtn);

    const stripBtn = document.createElement('button');
    stripBtn.textContent = 'Strip to Underwear';
    stripBtn.style.cssText = 'width: 100%; padding: 7px; background: transparent; border: 1px solid #d0d5d8; border-radius: 8px; color: #606870; font-weight: 700; font-size: 8.5pt; cursor: pointer;';
    stripBtn.addEventListener('click', () => {
      this.currentData.outfitBody = 'none';
      this.currentData.outfitLegs = 'none';
      this.currentData.outfitHead = null;
      this.currentData.outfitFace = null;
      this.currentData.outfitFeet = 'none';
      this.currentData.outfitBack = null;
      this.renderItemGrid();
      this.updatePreview();
      showToast({ icon: '🩲', title: 'Underwear base', subtitle: 'Removed all layered clothes.' });
    });
    btnBox.appendChild(stripBtn);

    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'Cancel';
    cancelBtn.style.cssText = 'width: 100%; padding: 7px; background: transparent; border: 0; color: #889096; font-size: 8.5pt; cursor: pointer;';
    cancelBtn.addEventListener('click', () => {
      this.currentData = { ...this.savedData };
      this.close();
    });
    btnBox.appendChild(cancelBtn);

    card.appendChild(btnBox);
    return card;
  }

  private updatePreview(): void {
    // MiPlanet 1774 x 887 dimensions (6 cols x 3 rows)
    const sheetW = 1774;
    const sheetH = 887;
    const cols = 6;
    const rows = 3;

    // Angle cell mapping:
    let cellRow = 0;
    let cellCol = 0;
    if (this.activeAngle === 'front') {
      cellRow = 0; cellCol = 0; // Front idle
    } else if (this.activeAngle === 'back') {
      cellRow = 1; cellCol = 3; // Back idle
    } else if (this.activeAngle === 'sit') {
      cellRow = 1; cellCol = 1; // Front sit left
    }

    const sourceX0 = Math.round(cellCol * sheetW / cols);
    const sourceX1 = Math.round((cellCol + 1) * sheetW / cols);
    const sourceY0 = Math.round(cellRow * sheetH / rows);
    const sourceY1 = Math.round((cellRow + 1) * sheetH / rows);
    const sourceCellHeight = sourceY1 - sourceY0;

    const displayW = 170;
    const displayH = 290;
    const scale = displayH / sourceCellHeight;
    const sourceCellCenterX = (sourceX0 + sourceX1) / 2;
    const bgX = (displayW / 2) - (sourceCellCenterX * scale);
    const bgY = -(sourceY0 * scale);

    const bgSize = `${sheetW * scale}px ${sheetH * scale}px`;
    const bgPos = `${bgX}px ${bgY}px`;

    const setLayerStyle = (el: HTMLElement | undefined, url: string | null) => {
      if (!el) return;
      el.style.backgroundSize = bgSize;
      el.style.backgroundPosition = bgPos;
      el.style.backgroundImage = url ? `url("${assetUrl(url)}")` : 'none';
    };

    // 1. Base body in underwear
    setLayerStyle(
      this.previewLayers.base,
      '/assets/sprites/avatar/wearables/MiPlanet Character Base Sprite.png'
    );

    // 2. Wings (backwear)
    const wingItem = MI_PLANET_CATALOG.find((it) => it.slot === 'outfitBack' && it.id === this.currentData.outfitBack);
    if (wingItem) {
      const wingUrl = this.activeAngle === 'back' ? wingItem.backAsset : wingItem.frontAsset;
      setLayerStyle(this.previewLayers.wings, wingUrl || null);
    } else {
      setLayerStyle(this.previewLayers.wings, null);
    }

    // 3. Bottoms (pants)
    const hasShorts = this.currentData.outfitLegs && this.currentData.outfitLegs !== 'none' && this.currentData.outfitLegs !== 'underwear';
    setLayerStyle(
      this.previewLayers.bottom,
      hasShorts ? '/assets/sprites/avatar/wearables/MiPlanet Olive Green Shorts.png' : null
    );

    // 4. Tops (shirt)
    const hasTop = this.currentData.outfitBody && this.currentData.outfitBody !== 'none' && this.currentData.outfitBody !== 'underwear';
    setLayerStyle(
      this.previewLayers.top,
      hasTop ? '/assets/sprites/avatar/wearables/MiPlanet Pink Llama Sweater.png' : null
    );

    // 5. Shoes
    const hasShoes = this.currentData.outfitFeet && this.currentData.outfitFeet !== 'none';
    setLayerStyle(
      this.previewLayers.shoes,
      hasShoes ? '/assets/sprites/avatar/wearables/MiPlanet Purple Sneakers.png' : null
    );

    // 6. Eyes
    const eyeItem = MI_PLANET_CATALOG.find((it) => it.slot === 'eyes' && it.id === this.currentData.eyes);
    setLayerStyle(
      this.previewLayers.eyes,
      this.activeAngle !== 'back' ? (eyeItem?.asset || '/assets/sprites/avatar/wearables/MiPlanet Basic Blue Eyes.png') : null
    );

    // 7. Mask
    const hasMask = this.currentData.outfitFace && this.currentData.outfitFace !== 'none';
    setLayerStyle(
      this.previewLayers.mask,
      hasMask ? '/assets/sprites/avatar/wearables/MiPlanet Skull Balaclava.png' : null
    );

    // 8. Hair
    const hasHair = this.currentData.hairStyle && this.currentData.hairStyle !== 'none' && this.currentData.hairStyle !== 'bald';
    setLayerStyle(
      this.previewLayers.hair,
      hasHair ? '/assets/sprites/avatar/wearables/MiPlanet Wavy Golden Hair.png' : null
    );

    // 9. Hat
    const hasHat = this.currentData.outfitHead && this.currentData.outfitHead !== 'none';
    setLayerStyle(
      this.previewLayers.hat,
      hasHat ? '/assets/sprites/avatar/wearables/MiPlanet Trapper Hat.png' : null
    );
  }

  private async handleSave(): Promise<void> {
    try {
      await this.persistToServer();
      this.savedData = { ...this.currentData };
      this.onSaveCallback(this.currentData);

      const liveAvatar = (
        window as unknown as Record<string, unknown>
      ).__havenAvatarController as
        | { applyCustomization: (d: AvatarData) => void }
        | undefined;
      liveAvatar?.applyCustomization(this.currentData);

      this.close();
      showToast({ icon: '👗', title: 'Look saved!', subtitle: 'Your new style is live.' });
    } catch (err) {
      console.error('[AvatarCustomizer] Save failed:', err);
      showToast({
        icon: '⚠️',
        title: 'Save failed',
        subtitle: 'Could not save your customization. Try again.',
      });
    }
  }

  private async persistToServer(): Promise<void> {
    const token = authService.token || (await authService.getToken()) || '';

    const res = await fetch(`${SERVER_URL}/api/users/me/avatar`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      credentials: 'include',
      body: JSON.stringify(this.currentData),
    });

    if (!res.ok) {
      throw new Error(`Failed to save avatar: ${res.status} ${res.statusText}`);
    }

    authService.updateAvatar({ ...this.currentData });

    socketService.emit(SOCKET_EVENTS.AVATAR_UPDATE, {
      ...this.currentData,
      gender: normalizeGender(this.currentData.gender),
    });
  }
}
