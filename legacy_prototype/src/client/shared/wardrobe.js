import { AVATAR_OPTIONS, COLOR_KEYS, TITLES, AURAS, canEquip, normalizeAvatar } from './identity-model.js';

/** DOM controls share the same allowlisted catalog as the server. */
export function mountWardrobe(container, getAvatar, setAvatar, getIdentity, send, preview) {
  const controls = document.createElement('section');
  controls.id = 'wardrobe-controls';
  const selectors = new Map();
  const colors = new Map();
  const labelFor = key => key.replace(/([A-Z])/g, ' $1');
  for (const [key, options] of Object.entries(AVATAR_OPTIONS)) {
    const label = document.createElement('label');
    label.textContent = labelFor(key) + ' ';
    const select = document.createElement('select');
    select.id = `wardrobe-${key}`;
    for (const value of options) select.add(new Option(AURAS[value]?.label || value, value));
    select.addEventListener('change', () => { setAvatar(normalizeAvatar({ [key]: select.value }, getAvatar())); preview(); });
    label.append(select); controls.append(label, document.createElement('br'));
    selectors.set(key, select);
  }
  for (const key of COLOR_KEYS) {
    const label = document.createElement('label');
    label.textContent = labelFor(key) + ' ';
    const input = document.createElement('input');
    input.id = `wardrobe-${key}`;
    input.type = 'text'; input.maxLength = 7; input.size = 8;
    input.pattern = '#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?';
    input.addEventListener('input', () => {
      if (!input.checkValidity()) return;
      setAvatar(normalizeAvatar({ [key]: input.value }, getAvatar())); preview();
    });
    input.addEventListener('change', () => {
      if (!input.checkValidity()) input.reportValidity();
    });
    label.append(input); controls.append(label, document.createElement('br')); colors.set(key, input);
  }
  const pose = document.createElement('select');
  pose.id = 'wardrobe-pose'; pose.setAttribute('aria-label', 'Preview animation');
  for (const name of ['idle', 'walk', 'run', 'sit', 'lie', 'dance']) pose.add(new Option(name, name));
  pose.addEventListener('change', preview); controls.append(pose);
  for (let slot = 0; slot < 3; slot++) {
    const save = document.createElement('button');
    save.id = `preset-save-${slot}`; save.type = 'button'; save.textContent = `Save ${slot + 1}`;
    save.addEventListener('click', () => send({ type: 'SAVE_PRESET', payload: { slot, avatar: getAvatar() } }));
    const apply = document.createElement('button');
    apply.id = `preset-apply-${slot}`; apply.type = 'button'; apply.textContent = `Wear ${slot + 1}`;
    apply.addEventListener('click', () => send({ type: 'APPLY_PRESET', payload: { slot } }));
    controls.append(save, apply);
  }
  container.append(controls);
  return () => {
    const avatar = normalizeAvatar(getAvatar());
    for (const [key, select] of selectors) {
      select.value = avatar[key];
      if (key === 'aura') for (const option of select.options) option.disabled = !canEquip(AURAS, option.value, getIdentity().passport);
    }
    for (const [key, input] of colors) if (document.activeElement !== input) input.value = avatar[key];
    for (let slot = 0; slot < 3; slot++) controls.querySelector(`#preset-apply-${slot}`).disabled = !getIdentity().presets[slot];
  };
}

export function renderIdentityControls(container, identity, send) {
  container.replaceChildren();
  const title = document.createElement('select');
  title.id = 'identity-title'; title.setAttribute('aria-label', 'Earned title');
  title.add(new Option('No title', ''));
  for (const [key, item] of Object.entries(TITLES)) {
    const option = new Option(item.label, key);
    option.disabled = !canEquip(TITLES, key, identity.passport); title.add(option);
  }
  title.value = identity.title;
  title.addEventListener('change', () => send({ type: 'UPDATE_IDENTITY', payload: { title: title.value } }));
  const status = document.createElement('input');
  status.id = 'identity-status'; status.maxLength = 80; status.value = identity.statusMessage;
  status.placeholder = 'Currently doing…'; status.setAttribute('aria-label', 'Status message');
  const save = document.createElement('button'); save.type = 'button'; save.id = 'identity-save-status'; save.textContent = 'Save status';
  save.addEventListener('click', () => send({ type: 'UPDATE_IDENTITY', payload: { statusMessage: status.value } }));
  container.append(title, status, save);
}
