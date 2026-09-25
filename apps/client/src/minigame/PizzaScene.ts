import { socketService } from '../services/socket';
import { SOCKET_EVENTS } from '@havenworld/shared';
import { audioEngine } from '../audio/AudioEngine';
import { showToast } from '../ui/ToastNotification';

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

interface IngredientMeta {
  name: string;
  icon: string;
}

const INGREDIENTS: Record<string, IngredientMeta> = {
  dough: { name: 'Dough', icon: '🍞' },
  sauce: { name: 'Tomato Sauce', icon: '🥫' },
  mozzarella: { name: 'Mozzarella', icon: '🧀' },
  mushrooms: { name: 'Mushrooms', icon: '🍄' },
  basil_pesto: { name: 'Basil Pesto', icon: '🌿' },
  zucchini: { name: 'Zucchini', icon: '🥒' },
  spinach: { name: 'Spinach', icon: '🥬' },
};

const TRAY_ORDER = ['dough', 'sauce', 'mozzarella', 'mushrooms', 'basil_pesto', 'zucchini', 'spinach'];

interface PizzaOrderResult {
  tier: 'PERFECT' | 'GOOD' | 'FAIL';
  coinsEarned: number;
  combo: number;
  weeklyRemaining?: number;
}

interface PizzaSocketError {
  code?: string;
  message?: string;
}

export class PizzaScene {
  private overlay: HTMLElement | null = null;
  private currentRecipe: RecipeDef = RECIPES[0];
  private selectedIngredients: string[] = [];
  private startTime = 0;
  private timerInterval: NodeJS.Timeout | null = null;
  private submitInFlight = false;
  private unsubscribeResult: (() => void) | null = null;
  private unsubscribeError: (() => void) | null = null;

  /**
   * Overlay-scoped element refs, cached at render time.
   * All DOM access goes through these — never document.getElementById /
   * document.querySelector — so we can't grab wrong or stale nodes.
   */
  private els: {
    ticketName: HTMLElement | null;
    ticketRecipe: HTMLElement | null;
    stepChips: HTMLElement | null;
    timerFill: HTMLElement | null;
    timerLabel: HTMLElement | null;
    assembly: HTMLElement | null;
    tray: HTMLElement | null;
    submitBtn: HTMLButtonElement | null;
    clearBtn: HTMLButtonElement | null;
  } = {
    ticketName: null,
    ticketRecipe: null,
    stepChips: null,
    timerFill: null,
    timerLabel: null,
    assembly: null,
    tray: null,
    submitBtn: null,
    clearBtn: null,
  };

  open(): void {
    if (this.overlay) return;
    this.subscribeToResults();
    this.startNewOrder();
    this.render();
    this.startTimer();
  }

  close(): void {
    this.stopTimer();
    // Tear down the panel's socket subscriptions so late results can't
    // mutate a removed overlay or leak into the next order.
    if (this.unsubscribeResult) {
      this.unsubscribeResult();
      this.unsubscribeResult = null;
    }
    if (this.unsubscribeError) {
      this.unsubscribeError();
      this.unsubscribeError = null;
    }
    this.submitInFlight = false;
    this.overlay?.remove();
    this.overlay = null;
    this.clearElementRefs();
  }

  /**
   * ONE persistent subscription for the panel's lifetime — registered once
   * per open(), removed in close(). Never per-submit.
   */
  private subscribeToResults(): void {
    if (this.unsubscribeResult) return;
    this.unsubscribeResult = socketService.on<PizzaOrderResult>(
      SOCKET_EVENTS.PIZZA_ORDER_RESULT,
      (res) => this.handleResult(res)
    );
    this.unsubscribeError = socketService.on<PizzaSocketError>(
      SOCKET_EVENTS.ERROR,
      (err) => this.handleSubmitError(err)
    );
  }

  private startNewOrder(): void {
    this.currentRecipe = RECIPES[Math.floor(Math.random() * RECIPES.length)];
    this.selectedIngredients = [];
    this.submitInFlight = false;
    this.startTime = Date.now();
  }

  private addIngredient(ing: string): void {
    if (!this.overlay || this.submitInFlight) return;

    const stepIndex = this.selectedIngredients.length;
    const expected = this.currentRecipe.ingredients[stepIndex];
    this.selectedIngredients.push(ing);
    audioEngine.playClick();

    // Immediate incorrect-step feedback. The pick still counts — the server
    // grades the full sequence — but the player knows right away.
    if (expected !== undefined && ing !== expected) {
      audioEngine.playError();
      const wantName = INGREDIENTS[expected]?.name ?? expected;
      const gotName = INGREDIENTS[ing]?.name ?? ing;
      showToast({
        icon: '⚠️',
        title: `Step ${stepIndex + 1} is out of order`,
        subtitle: `This pizza needs ${wantName} here, not ${gotName}. Restart the crust to fix it.`,
        durationMs: 4500,
      });
    }

    this.refreshAssemblyUI();

    // Auto-serve once the crust holds the full recipe.
    if (this.selectedIngredients.length >= this.currentRecipe.ingredients.length) {
      this.submitOrder();
    }
  }

  private submitOrder(): void {
    // Submit lock: ignore duplicate submits while an order is in flight.
    if (!this.overlay || this.submitInFlight) return;
    if (this.selectedIngredients.length === 0) {
      audioEngine.playError();
      showToast({
        icon: '🍕',
        title: 'Empty crust',
        subtitle: 'Add at least one ingredient before serving.',
      });
      return;
    }

    this.submitInFlight = true;
    this.setWaitingState(true);

    const durationMs = Date.now() - this.startTime;
    socketService.emit(SOCKET_EVENTS.PIZZA_ORDER_SUBMIT, {
      recipe: this.currentRecipe.id,
      ingredients: [...this.selectedIngredients],
      durationMs,
    });
  }

  private handleResult(res: PizzaOrderResult): void {
    // Ignore results for a closed panel or a superseded order.
    if (!this.overlay || !this.submitInFlight) return;
    this.submitInFlight = false;
    this.stopTimer();
    this.setWaitingState(false);

    const coins = res.coinsEarned ?? 0;
    const combo = res.combo ?? 0;

    if (res.tier === 'PERFECT') {
      audioEngine.playFishingCatch();
      showToast({
        icon: '🍕',
        title: 'PERFECT PIZZA!',
        subtitle: `+${coins} HavenCoins · Combo x${combo}`,
        durationMs: 5000,
      });
    } else if (res.tier === 'GOOD') {
      audioEngine.playCoinPickup();
      showToast({
        icon: '🍕',
        title: 'GOOD PIZZA!',
        subtitle: `+${coins} HavenCoins — beat the clock for a Perfect!`,
        durationMs: 5000,
      });
    } else {
      audioEngine.playError();
      showToast({
        icon: '❌',
        title: 'Order failed',
        subtitle: this.describeFailure(),
        durationMs: 6000,
      });
    }

    // New order — and this time the ticket UI is re-rendered too. It used to
    // keep showing the OLD recipe while a NEW one was validated server-side,
    // making every order after the first unwinnable.
    this.startNewOrder();
    this.refreshOrderUI();
    this.startTimer();
  }

  /** Server-side rejections (bad payload, hourly cap, …) release the lock. */
  private handleSubmitError(err: PizzaSocketError): void {
    if (!this.overlay || !this.submitInFlight) return;
    const message = err?.message ?? '';
    // Only react to errors plausibly tied to our pizza submit.
    if (!/pizza/i.test(message) && err?.code !== 'INVALID_PAYLOAD') return;
    this.submitInFlight = false;
    this.stopTimer();
    this.setWaitingState(false);
    showToast({
      icon: '⚠️',
      title: 'Order could not be sent',
      subtitle: message || 'The kitchen is unreachable — check your connection and retry.',
      durationMs: 6000,
    });
  }

  /** Pinpoint which step failed, for the FAIL toast. */
  private describeFailure(): string {
    const expected = this.currentRecipe.ingredients;
    const steps = Math.max(expected.length, this.selectedIngredients.length);
    for (let i = 0; i < steps; i++) {
      const want = expected[i];
      const got = this.selectedIngredients[i];
      if (want !== got) {
        const wantName = want ? INGREDIENTS[want]?.name ?? want : 'nothing';
        const gotName = got ? INGREDIENTS[got]?.name ?? got : 'nothing';
        return `Step ${i + 1} was wrong — needed ${wantName}, got ${gotName}. Try again!`;
      }
    }
    return 'Recipe mismatch or time ran out — try again!';
  }

  private render(): void {
    this.overlay?.remove();

    const overlay = document.createElement('div');
    overlay.id = 'pizza-scene-overlay';
    overlay.style.cssText = `
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

      <!-- Countdown to Perfect -->
      <div style="margin-bottom: 12px;">
        <div id="pizza-timer-label" style="font-size: 0.8rem; color: #cbd5e1; margin-bottom: 4px;">⏱ --</div>
        <div style="height: 8px; background: #0f172a; border-radius: 999px; overflow: hidden;">
          <div id="pizza-timer-fill" style="height: 100%; width: 100%; background: #22c55e;"></div>
        </div>
      </div>

      <!-- Step progress -->
      <div id="pizza-steps" style="display: flex; flex-wrap: wrap; gap: 6px; justify-content: center; margin-bottom: 12px;"></div>

      <!-- Pizza Crust (Working Area) -->
      <div style="width: 180px; height: 180px; border-radius: 50%; background: #fdba74; margin: 0 auto 20px auto; border: 6px solid #ea580c; display: flex; align-items: center; justify-content: center; flex-direction: column; box-shadow: inset 0 0 12px rgba(0,0,0,0.3);">
        <div id="pizza-assembly-display" style="font-size: 0.85rem; color: #431407; font-weight: bold;">
          Empty Crust
        </div>
      </div>

      <!-- Ingredient Trays -->
      <div id="pizza-tray" style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-bottom: 12px;">
        ${TRAY_ORDER.map((id) => {
          const meta = INGREDIENTS[id];
          return `
          <button class="btn-ingredient" data-ing="${id}" style="background: #334155; border: 1px solid #475569; border-radius: 6px; padding: 8px 4px; color: #fff; cursor: pointer; display: flex; flex-direction: column; align-items: center; gap: 4px;">
            <span style="font-size: 1.3rem;">${meta.icon}</span>
            <span style="font-size: 0.75rem;">${meta.name}</span>
          </button>
        `;
        }).join('')}
      </div>

      <div style="display: flex; gap: 8px; justify-content: center;">
        <button id="btn-serve-pizza" style="background: #f97316; border: none; color: #fff; border-radius: 6px; padding: 8px 18px; cursor: pointer; font-size: 0.9rem; font-weight: bold;">🍕 Serve Pizza</button>
        <button id="btn-clear-pizza" style="background: transparent; border: 1px solid #64748b; color: #cbd5e1; border-radius: 6px; padding: 8px 14px; cursor: pointer; font-size: 0.85rem;">Restart Crust</button>
      </div>
    `;

    this.overlay = overlay;
    overlay.appendChild(panel);
    document.body.appendChild(overlay);

    // Cache overlay-scoped refs — the only DOM handles this class keeps.
    const q = <T extends HTMLElement>(sel: string): T | null => overlay.querySelector<T>(sel);
    this.els.ticketName = q('#pizza-ticket-name');
    this.els.ticketRecipe = q('#pizza-ticket-recipe');
    this.els.stepChips = q('#pizza-steps');
    this.els.timerFill = q('#pizza-timer-fill');
    this.els.timerLabel = q('#pizza-timer-label');
    this.els.assembly = q('#pizza-assembly-display');
    this.els.tray = q('#pizza-tray');
    this.els.submitBtn = q<HTMLButtonElement>('#btn-serve-pizza');
    this.els.clearBtn = q<HTMLButtonElement>('#btn-clear-pizza');

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        this.close();
      }
    });

    q('#btn-close-pizza')?.addEventListener('click', () => this.close());
    this.els.clearBtn?.addEventListener('click', () => {
      if (this.submitInFlight) return;
      this.selectedIngredients = [];
      this.refreshAssemblyUI();
    });
    this.els.submitBtn?.addEventListener('click', () => this.submitOrder());

    this.els.tray?.querySelectorAll<HTMLButtonElement>('.btn-ingredient').forEach((b) => {
      b.addEventListener('click', () => {
        const ing = b.getAttribute('data-ing');
        if (ing) this.addIngredient(ing);
      });
    });

    this.refreshOrderUI();
  }

  /** Re-render ticket, step chips, crust and button states for a new order. */
  private refreshOrderUI(): void {
    if (!this.overlay) return;
    if (this.els.ticketName) {
      this.els.ticketName.textContent = `Order: ${this.currentRecipe.name}`;
    }
    if (this.els.ticketRecipe) {
      const names = this.currentRecipe.ingredients.map((id) => INGREDIENTS[id]?.name ?? id);
      this.els.ticketRecipe.textContent = `Required: ${names.join(' ➔ ')}`;
    }
    this.refreshAssemblyUI();
    this.tickTimer();
  }

  /** Scoped crust redraw — replaces the old global document.getElementById lookup. */
  private refreshAssemblyUI(): void {
    const display = this.els.assembly;
    if (display) {
      display.innerHTML = '';
      if (this.selectedIngredients.length === 0) {
        display.textContent = 'Empty Crust';
      } else {
        this.selectedIngredients.forEach((id) => {
          const meta = INGREDIENTS[id] ?? { name: id, icon: '❔' };
          const line = document.createElement('div');
          line.textContent = `${meta.icon} ${meta.name}`;
          display.appendChild(line);
        });
      }
    }
    this.renderStepChips();
    this.setWaitingState(this.submitInFlight);
  }

  /** Step-progress chips: done ✅, current 👉, upcoming ▫️. */
  private renderStepChips(): void {
    const host = this.els.stepChips;
    if (!host) return;
    host.innerHTML = '';
    this.currentRecipe.ingredients.forEach((id, idx) => {
      const meta = INGREDIENTS[id] ?? { name: id, icon: '❔' };
      const done = idx < this.selectedIngredients.length;
      const current = idx === this.selectedIngredients.length;
      const chip = document.createElement('div');
      chip.style.cssText = `
        font-size: 0.75rem;
        padding: 4px 8px;
        border-radius: 999px;
        border: 1px solid ${done ? '#22c55e' : current ? '#f97316' : '#475569'};
        background: ${done ? 'rgba(34,197,94,0.15)' : current ? 'rgba(249,115,22,0.15)' : '#0f172a'};
        color: ${done || current ? '#fff' : '#94a3b8'};
      `;
      chip.textContent = `${done ? '✅' : current ? '👉' : '▫️'} ${meta.icon} ${meta.name}`;
      host.appendChild(chip);
    });
  }

  /** Submit lock visuals: disable Serve / Restart / tray + waiting label. */
  private setWaitingState(waiting: boolean): void {
    const canServe = !waiting && this.selectedIngredients.length > 0;
    if (this.els.submitBtn) {
      this.els.submitBtn.disabled = !canServe;
      this.els.submitBtn.textContent = waiting ? '⏳ Sending order…' : '🍕 Serve Pizza';
      this.els.submitBtn.style.opacity = canServe ? '1' : '0.55';
      this.els.submitBtn.style.cursor = canServe ? 'pointer' : 'not-allowed';
    }
    if (this.els.clearBtn) {
      this.els.clearBtn.disabled = waiting;
      this.els.clearBtn.style.opacity = waiting ? '0.55' : '1';
      this.els.clearBtn.style.cursor = waiting ? 'not-allowed' : 'pointer';
    }
    this.els.tray?.querySelectorAll<HTMLButtonElement>('.btn-ingredient').forEach((b) => {
      b.disabled = waiting;
      b.style.opacity = waiting ? '0.55' : '1';
    });
  }

  private startTimer(): void {
    this.stopTimer();
    this.startTime = Date.now();
    this.tickTimer();
    this.timerInterval = setInterval(() => this.tickTimer(), 100);
  }

  private stopTimer(): void {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
  }

  /** Visible countdown: green → amber → red overtime. */
  private tickTimer(): void {
    const fill = this.els.timerFill;
    const label = this.els.timerLabel;
    if (!fill || !label) return;
    const elapsed = Date.now() - this.startTime;
    const remaining = this.currentRecipe.maxMs - elapsed;
    const pct = Math.max(0, Math.min(100, (remaining / this.currentRecipe.maxMs) * 100));
    fill.style.width = `${pct}%`;
    if (remaining < 0) {
      fill.style.background = '#ef4444';
      label.textContent = '⏱ Overtime — Perfect bonus lost, finish for Good!';
    } else {
      fill.style.background = remaining < 4000 ? '#f59e0b' : '#22c55e';
      label.textContent = `⏱ ${(remaining / 1000).toFixed(1)}s left for Perfect`;
    }
  }

  private clearElementRefs(): void {
    this.els.ticketName = null;
    this.els.ticketRecipe = null;
    this.els.stepChips = null;
    this.els.timerFill = null;
    this.els.timerLabel = null;
    this.els.assembly = null;
    this.els.tray = null;
    this.els.submitBtn = null;
    this.els.clearBtn = null;
  }
}
