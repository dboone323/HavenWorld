import { socketService } from '../services/socket';
import { SOCKET_EVENTS } from '@havenworld/shared';
import { audioEngine } from '../audio/AudioEngine';

interface RecipeDef {
  id: string;
  name: string;
  ingredients: string[];
  maxMs: number;
}

const RECIPES: RecipeDef[] = [
  { id: 'margherita', name: 'Margherita', ingredients: ['dough', 'sauce', 'mozzarella'], maxMs: 15_000 },
  { id: 'funghi_rustica', name: 'Funghi Rustica', ingredients: ['dough', 'sauce', 'mushrooms', 'mozzarella'], maxMs: 20_000 },
  { id: 'green_garden', name: 'Green Garden', ingredients: ['dough', 'basil_pesto', 'zucchini', 'spinach'], maxMs: 22_000 },
];

export class PizzaScene {
  private overlay: HTMLElement | null = null;
  private currentRecipe: RecipeDef = RECIPES[0];
  private selectedIngredients: string[] = [];
  private startTime = 0;
  private timerInterval: NodeJS.Timeout | null = null;

  open(): void {
    if (this.overlay) return;
    this.startNewOrder();
    this.render();
  }

  close(): void {
    if (this.timerInterval) clearInterval(this.timerInterval);
    this.overlay?.remove();
    this.overlay = null;
  }

  private startNewOrder(): void {
    this.currentRecipe = RECIPES[Math.floor(Math.random() * RECIPES.length)];
    this.selectedIngredients = [];
    this.startTime = Date.now();
  }

  private addIngredient(ing: string): void {
    this.selectedIngredients.push(ing);
    audioEngine.playFurniturePlace();
    this.updateAssemblyUI();

    if (this.selectedIngredients.length === this.currentRecipe.ingredients.length) {
      this.submitOrder();
    }
  }

  private submitOrder(): void {
    const durationMs = Date.now() - this.startTime;
    socketService.emit(SOCKET_EVENTS.PIZZA_ORDER_SUBMIT, {
      recipe: this.currentRecipe.id,
      ingredients: this.selectedIngredients,
      durationMs,
    });

    socketService.on(
      SOCKET_EVENTS.PIZZA_ORDER_RESULT,
      (res: { tier: string; coinsEarned: number; combo: number }) => {
        if (res.tier === 'PERFECT') {
          audioEngine.playFishingCatch();
          alert(`🍕 PERFECT PIZZA! (+${res.coinsEarned} HavenCoins) · Combo x${res.combo}`);
        } else if (res.tier === 'GOOD') {
          audioEngine.playCoinPickup();
          alert(`🍕 GOOD PIZZA! (+${res.coinsEarned} HavenCoins)`);
        } else {
          alert('❌ Recipe mismatch or time ran out! Try again.');
        }
        this.startNewOrder();
        this.updateAssemblyUI();
      }
    );
  }

  private render(): void {
    this.overlay?.remove();

    this.overlay = document.createElement('div');
    this.overlay.id = 'pizza-scene-overlay';
    this.overlay.style.cssText = `
      position: fixed;
      inset: 0;
      background: rgba(15, 23, 42, 0.9);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 9999;
      font-family: Calibri, sans-serif;
    `;

    const panel = document.createElement('div');
    panel.style.cssText = `
      background: #1e293b;
      border: 2px solid #f97316;
      border-radius: 12px;
      width: min(540px, 94vw);
      padding: 24px;
      color: #fff;
      box-shadow: 0 8px 32px rgba(249, 115, 22, 0.3);
      text-align: center;
    `;

    const allIngredients = [
      { id: 'dough', name: 'Dough', icon: '🍞' },
      { id: 'sauce', name: 'Tomato Sauce', icon: '🥫' },
      { id: 'mozzarella', name: 'Mozzarella', icon: '🧀' },
      { id: 'mushrooms', name: 'Mushrooms', icon: '🍄' },
      { id: 'basil_pesto', name: 'Basil Pesto', icon: '🌿' },
      { id: 'zucchini', name: 'Zucchini', icon: '🥒' },
      { id: 'spinach', name: 'Spinach', icon: '🥬' },
    ];

    panel.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
        <h2 style="margin: 0; color: #f97316;">👨‍🍳 Pizza Chef</h2>
        <button id="btn-close-pizza" style="background: transparent; border: none; color: #94a3b8; font-size: 1.4rem; cursor: pointer;">✕</button>
      </div>

      <!-- Current Order Ticket -->
      <div style="background: #0f172a; border: 1px dashed #f97316; border-radius: 8px; padding: 12px; margin-bottom: 16px;">
        <div style="font-weight: bold; color: #f97316; font-size: 1.1rem;" id="pizza-ticket-name">Order: ${this.currentRecipe.name}</div>
        <div style="font-size: 0.85rem; color: #94a3b8; margin-top: 4px;" id="pizza-ticket-recipe">
          Required: ${this.currentRecipe.ingredients.join(' ➔ ')}
        </div>
      </div>

      <!-- Pizza Crust (Working Area) -->
      <div style="width: 180px; height: 180px; border-radius: 50%; background: #fdba74; margin: 0 auto 20px auto; border: 6px solid #ea580c; display: flex; align-items: center; justify-content: center; flex-direction: column; box-shadow: inset 0 0 12px rgba(0,0,0,0.3);">
        <div id="pizza-assembly-display" style="font-size: 0.85rem; color: #431407; font-weight: bold;">
          Empty Crust
        </div>
      </div>

      <!-- Ingredient Trays -->
      <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-bottom: 12px;">
        ${allIngredients
          .map(
            (ing) => `
          <button class="btn-ingredient" data-ing="${ing.id}" style="background: #334155; border: 1px solid #475569; border-radius: 6px; padding: 8px 4px; color: #fff; cursor: pointer; display: flex; flex-direction: column; align-items: center; gap: 4px;">
            <span style="font-size: 1.3rem;">${ing.icon}</span>
            <span style="font-size: 0.75rem;">${ing.name}</span>
          </button>
        `
          )
          .join('')}
      </div>

      <button id="btn-clear-pizza" style="background: transparent; border: 1px solid #64748b; color: #cbd5e1; border-radius: 4px; padding: 6px 14px; cursor: pointer; font-size: 0.8rem;">Restart Crust</button>
    `;

    this.overlay.appendChild(panel);
    document.body.appendChild(this.overlay);

    this.overlay.addEventListener('click', (e) => {
      if (e.target === this.overlay) {
        this.close();
      }
    });

    panel.querySelector('#btn-close-pizza')?.addEventListener('click', () => this.close());
    panel.querySelector('#btn-clear-pizza')?.addEventListener('click', () => {
      this.selectedIngredients = [];
      this.updateAssemblyUI();
    });

    panel.querySelectorAll('.btn-ingredient').forEach((b) => {
      b.addEventListener('click', () => {
        const ing = b.getAttribute('data-ing')!;
        this.addIngredient(ing);
      });
    });
  }

  private updateAssemblyUI(): void {
    const display = document.getElementById('pizza-assembly-display');
    if (!display) return;
    if (this.selectedIngredients.length === 0) {
      display.textContent = 'Empty Crust';
    } else {
      display.innerHTML = this.selectedIngredients.join('<br>➔ ');
    }
  }
}
