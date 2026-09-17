import { createIdentity, normalizeAvatar, canEquip, TITLES, AURAS } from '../client/shared/identity-model.js';
import { recordPassportAction } from '../client/shared/passport.js';
import { moderateChat } from './moderation.ts';
import { serializePlayer } from './rooms.ts';
import type { Player } from './rooms.ts';
import type { DispatchContext } from './protocol.ts';
import type { IdentityState, Avatar } from '../shared/types.ts';

export function identityFor(player: Player): IdentityState {
  return player.identity || (player.identity = createIdentity(player.id, player.name) as IdentityState);
}

export async function publishIdentity(player: Player, ctx: DispatchContext, next: IdentityState, broadcast = true): Promise<void> {
  if (ctx.db.saveIdentity) await ctx.db.saveIdentity(player.id, next);
  player.identity = next;
  if (next.outfit) player.avatar = next.outfit;
  ctx.rooms.send(player.ws, { type: 'IDENTITY_UPDATED', payload: next });
  if (!broadcast) return;
  const message = { type: 'PLAYER_PROFILE_UPDATED', payload: { playerId: player.id, player: serializePlayer(player) } };
  ctx.rooms.broadcast(player.room, message);
  const friends = await ctx.db.getFriends(player.id);
  for (const friend of friends) {
    const peer = ctx.globalPlayers?.get(friend.friendId);
    if (peer && peer.room !== player.room) ctx.rooms.send(peer.ws, message);
  }
}

export async function awardIdentity(player: Player, ctx: DispatchContext, action: string, metadata = {}): Promise<void> {
  const next = structuredClone(identityFor(player));
  const unlocked = recordPassportAction(next.passport, action, metadata);
  if (unlocked.length || JSON.stringify(next.passport.visitedRooms) !== JSON.stringify(identityFor(player).passport.visitedRooms)) await publishIdentity(player, ctx, next);
}

export async function handleIdentity(type: string, payload: Record<string, unknown>, player: Player, ctx: DispatchContext): Promise<boolean> {
  if (!['UPDATE_IDENTITY', 'SAVE_PRESET', 'APPLY_PRESET', 'UPDATE_AVATAR'].includes(type)) return false;
  const next = structuredClone(identityFor(player));
  try {
    if (type === 'UPDATE_IDENTITY') {
      if (payload.statusMessage !== undefined) {
        if (typeof payload.statusMessage !== 'string') throw new Error('Status must be text.');
        const clean = payload.statusMessage.replace(/<[^>]*>/g, '').replace(/[\u0000-\u001f\u007f]/g, ' ');
        const moderated = moderateChat(clean, 80);
        if (moderated.flagged) throw new Error('Please choose a different status.');
        next.statusMessage = moderated.text.slice(0, 80);
      }
      if (payload.title !== undefined) {
        if (typeof payload.title !== 'string' || (payload.title !== '' && (!Object.hasOwn(TITLES, payload.title) || !canEquip(TITLES, payload.title, next.passport)))) throw new Error('Title is not unlocked.');
        next.title = payload.title;
      }
      if (payload.pinnedBadges !== undefined) {
        if (!Array.isArray(payload.pinnedBadges) || payload.pinnedBadges.length > 3 || payload.pinnedBadges.some(id => typeof id !== 'string' || !Object.hasOwn(next.passport.unlockedStamps, id))) throw new Error('Pin up to three unlocked badges.');
        next.pinnedBadges = [...new Set(payload.pinnedBadges)] as string[];
      }
    } else {
      let outfit: Avatar;
      if (type === 'APPLY_PRESET' || type === 'SAVE_PRESET') {
        const slot = payload.slot;
        if (typeof slot !== 'number' || !Number.isInteger(slot) || slot < 0 || slot >= 3) throw new Error('Invalid preset slot.');
        if (type === 'APPLY_PRESET' && !next.presets[slot]) throw new Error('Preset is empty.');
        outfit = normalizeAvatar(type === 'APPLY_PRESET' ? next.presets[slot] : payload.avatar || player.avatar) as Avatar;
        if (type === 'SAVE_PRESET') next.presets[slot] = outfit;
      } else {
        outfit = normalizeAvatar(payload.avatar, normalizeAvatar(player.avatar)) as Avatar;
      }
      if (!canEquip(AURAS, outfit.aura, next.passport)) throw new Error('Aura is not unlocked.');
      if (type !== 'SAVE_PRESET') next.outfit = outfit;
    }
    await publishIdentity(player, ctx, next, type !== 'SAVE_PRESET');
    if (type === 'UPDATE_AVATAR' && typeof payload.name === 'string' && payload.name.trim()) {
      const name = moderateChat(payload.name, 18).text;
      await ctx.db.savePlayerName(player.id, name);
      player.name = name;
      ctx.rooms.broadcast(player.room, { type: 'PLAYER_PROFILE_UPDATED', payload: { playerId: player.id, player: serializePlayer(player) } });
    }
  } catch (error) {
    ctx.rooms.send(player.ws, { type: 'IDENTITY_ERROR', payload: { message: error instanceof Error ? error.message : 'Unable to save identity.' } });
  }
  return true;
}
