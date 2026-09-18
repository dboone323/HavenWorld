import { normalizeAvatar, AURAS } from './identity-model.js';

export const AVATAR_LAYERS = ['shadow', 'body', 'pants', 'shoes', 'shirt', 'head', 'eyes', 'hair', 'hat', 'accessory'];
const STRIDE = [0, 2, 3, 2, 0, -2, -3, -2];
export function avatarFrame(pose, time) {
  const frame = Math.floor(Math.max(0, time) / (pose === 'run' ? 65 : 110)) % 8;
  return { frame, stride: ['walk', 'run', 'dance'].includes(pose) ? STRIDE[frame] : 0,
    bob: ['walk', 'run', 'dance'].includes(pose) ? -Math.abs(STRIDE[frame]) : 0 };
}

/** One layered pixel renderer used by both world and wardrobe preview. */
export function drawModularAvatar(ctx, input, x, y, { pose = 'idle', facing = 'SE', time = 0, wave = 0 } = {}) {
  const av = normalizeAvatar(input);
  const frame = avatarFrame(pose, time);
  const back = facing === 'NE' || facing === 'NW';
  const sit = pose === 'sit';
  const rect = (color, x, y, w, h) => { ctx.fillStyle = color; ctx.fillRect(x, y, w, h); };
  ctx.save();
  ctx.translate(Math.round(x), Math.round(y));
  ctx.fillStyle = '#00000044';
  ctx.beginPath(); ctx.ellipse(0, 4, 14, 5, 0, 0, Math.PI * 2); ctx.fill();
  if (pose === 'lie') { ctx.translate(-18, 0); ctx.rotate(Math.PI / 2); }
  ctx.translate(0, frame.bob);
  rect(av.skin, -9, -27, 18, 19);
  const legY = sit ? -7 : -13;
  const legH = sit ? 5 : av.pantsStyle === 'shorts' ? 7 : 14;
  rect(av.pantsColor, -7, legY + frame.stride, sit ? 12 : 5, legH);
  rect(av.pantsColor, 2, legY - frame.stride, sit ? 12 : 5, legH);
  const shoeH = av.shoesStyle === 'boots' ? 7 : 4;
  rect(av.shoesColor, sit ? 3 : -8, (sit ? -2 : 1) + frame.stride - shoeH, 7, shoeH);
  rect(av.shoesColor, sit ? 12 : 1, (sit ? -2 : 1) - frame.stride - shoeH, 7, shoeH);
  rect(av.shirtColor, -10, -28, 20, 17);
  if (av.shirtStyle === 'hoodie') {
    rect(av.shirtColor, -12, -31, 24, 8);
    rect('#ffffff99', -3, -27, 1, 7); rect('#ffffff99', 3, -27, 1, 7);
    rect('#00000033', -5, -17, 10, 3);
  }
  if (av.shirtStyle === 'trench') {
    rect(av.shirtColor, -11, -15, 22, 15); rect('#00000066', -1, -26, 2, 24);
    rect('#00000066', -10, -15, 20, 2);
  }
  if (av.shirtStyle === 'dress') {
    for (let i = 0; i < 5; i++) rect(av.shirtColor, -9 - i, -15 + i * 3, 18 + i * 2, 3);
  }
  ctx.save(); ctx.translate(11, -24); ctx.rotate(wave ? -1.4 + wave : frame.stride / 12);
  rect(av.shirtColor, -2, -1, 5, 12); rect(av.skin, -2, 11, 5, 4); ctx.restore();
  rect(av.skin, -9, -45, 18, 18); rect(av.skin, -11, -41, 22, 10);
  if (!back) {
    const shift = facing === 'SW' ? -2 : 2;
    rect(av.eyeColor, -5 + shift, -38, 2, av.eyeStyle === 'sleepy' ? 1 : 3);
    rect(av.eyeColor, 3 + shift, -38, 2, av.eyeStyle === 'sleepy' ? 1 : 3);
    rect(av.eyeColor, -2 + shift, -31, 4, 1);
  }
  if (av.hairStyle !== 'bald') {
    rect(av.hairColor, -10, -47, 20, back ? 19 : 6);
    if (av.hairStyle === 'cozy_messy') { rect(av.hairColor, -7, -50, 7, 5); rect(av.hairColor, 4, -49, 5, 5); }
    if (av.hairStyle === 'long') { rect(av.hairColor, -12, -43, 4, 22); rect(av.hairColor, 8, -43, 4, 22); }
  }
  if (av.hat === 'beanie') { rect(av.shirtColor, -10, -51, 20, 9); rect(av.pantsColor, -11, -44, 22, 4); }
  if (av.accessory === 'glasses' && !back) {
    ctx.strokeStyle = av.eyeColor; ctx.lineWidth = 1;
    ctx.strokeRect(-8, -40, 7, 6); ctx.strokeRect(1, -40, 7, 6); rect(av.eyeColor, -1, -38, 2, 1);
  }
  ctx.restore();
  return AVATAR_LAYERS;
}

/** Bounded emitters: elapsed time, not frame count; dead particles are removed. */
export function advanceAura(state, kind, dt) {
  dt = Math.max(0, Math.min(0.1, dt || 0));
  if (state.kind !== kind) { state.kind = kind; state.particles = []; state.clock = 0; }
  state.particles = (state.particles || []).filter(p => (p.life -= dt) > 0);
  if (!kind || kind === 'none' || !Object.hasOwn(AURAS, kind)) return state.particles;
  state.clock = (state.clock || 0) + dt;
  if (state.clock >= 0.08 && state.particles.length < 24) {
    state.clock %= 0.08;
    state.sequence = (state.sequence || 0) + 1;
    state.particles.push({ angle: state.sequence * 2.4, life: 1.2, maxLife: 1.2 });
  }
  return state.particles;
}
export function drawAura(ctx, state, kind, x, y, dt) {
  const particles = advanceAura(state, kind, dt);
  ctx.save();
  ctx.fillStyle = AURAS[kind]?.color || '#ffffff';
  for (const p of particles) {
    ctx.globalAlpha = p.life / p.maxLife;
    const a = p.angle + (p.maxLife - p.life);
    const py = kind === 'crown' ? -57 : kind === 'halo' ? -49 : -25;
    ctx.fillRect(x + Math.cos(a) * 17, y + py + Math.sin(a) * 5 - (1 - p.life / p.maxLife) * 8, 2, kind === 'crown' ? 5 : 2);
  }
  ctx.restore();
}
