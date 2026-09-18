import { prisma } from '../prisma';
import { roomManager } from './RoomManager';
import { getIO } from '../sockets';
import { SOCKET_EVENTS, PetType, PetState } from '@havenworld/shared';
import { QuestService } from './QuestService';
import { AchievementService } from './AchievementService';

interface ActivePetSession {
  id: string;
  ownerId: string;
  petType: PetType;
  name: string;
  state: PetState;
  stateTimer: number; // seconds remaining in current state
  x: number;
  y: number;
  z: number;
  targetX: number;
  targetY: number;
  targetZ: number;
}

export class PetManager {
  private static activePets = new Map<string, ActivePetSession>(); // petId -> session
  private static tickerInterval: NodeJS.Timeout | null = null;

  /**
   * Initializes the 2-second AI state machine ticker
   */
  static init() {
    if (this.tickerInterval) return;
    this.tickerInterval = setInterval(() => {
      this.tick();
    }, 2000);
  }

  /**
   * Adopts a new pet companion
   */
  static async adoptPet(userId: string, petType: PetType, name: string) {
    const cleanName = (name || petType).trim().slice(0, 16);

    const pet = await prisma.pet.create({
      data: {
        ownerId: userId,
        petType,
        name: cleanName,
        happiness: 100,
        hunger: 100,
      },
    });

    const session: ActivePetSession = {
      id: pet.id,
      ownerId: userId,
      petType,
      name: cleanName,
      state: 'IDLE',
      stateTimer: 4,
      x: 0,
      y: 0,
      z: 0,
      targetX: 0,
      targetY: 0,
      targetZ: 0,
    };

    this.activePets.set(pet.id, session);

    const io = getIO();
    if (io) {
      io.to(`user:${userId}`).emit(SOCKET_EVENTS.PET_ADOPTED, { pet });
    }

    await AchievementService.checkAndAward(userId, 'ADOPT_PET', { petType });
    return pet;
  }

  /**
   * Feeds a pet to restore hunger and happiness
   */
  static async feedPet(userId: string, petId: string) {
    const pet = await prisma.pet.findUnique({ where: { id: petId } });
    if (!pet || pet.ownerId !== userId) throw new Error('Pet not found');

    const updated = await prisma.pet.update({
      where: { id: petId },
      data: {
        hunger: Math.min(100, pet.hunger + 30),
        happiness: Math.min(100, pet.happiness + 15),
        lastFedAt: new Date(),
      },
    });

    // Trigger reaction
    this.triggerReaction(petId, '❤');

    await QuestService.incrementProgress(userId, 'FEED_PET', 1);
    return updated;
  }

  /**
   * Renames a pet
   */
  static async namePet(userId: string, petId: string, name: string) {
    const cleanName = name.trim().slice(0, 16);
    return await prisma.pet.update({
      where: { id: petId },
      data: { name: cleanName },
    });
  }

  /**
   * Triggers an emotional reaction emote for a pet
   */
  static triggerReaction(petId: string, emote: '❤' | '💤' | '♫' | '❕') {
    const session = this.activePets.get(petId);
    if (!session) return;

    const owner = roomManager.getPlayer(session.ownerId);
    if (!owner) return;

    const io = getIO();
    if (io) {
      io.to(`room:${owner.roomId}`).emit(SOCKET_EVENTS.PET_REACT, {
        petId,
        emote,
      });
    }
  }

  /**
   * 2-second AI state machine tick
   */
  private static tick() {
    const io = getIO();
    if (!io) return;

    for (const [petId, pet] of this.activePets) {
      const owner = roomManager.getPlayer(pet.ownerId);
      if (!owner) continue; // owner offline / not in room

      pet.stateTimer -= 2;

      // State transitions based on personality
      if (pet.stateTimer <= 0) {
        if (pet.petType === 'DOG') {
          // Dogs stay glued to owner
          pet.state = 'FOLLOW';
          pet.stateTimer = 4;
        } else if (pet.petType === 'CAT') {
          // Cats alternate wander, idle, and sit
          const roll = Math.random();
          if (roll < 0.45) pet.state = 'WANDER';
          else if (roll < 0.75) pet.state = 'IDLE';
          else pet.state = 'FOLLOW';
          pet.stateTimer = 6;
        } else if (pet.petType === 'BABY_DRAGON') {
          // Dragons react and follow frequently
          const roll = Math.random();
          if (roll < 0.3) {
            pet.state = 'REACT';
            this.triggerReaction(petId, '♫');
          } else {
            pet.state = 'FOLLOW';
          }
          pet.stateTimer = 4;
        }
      }

      // Compute target position based on state
      if (pet.state === 'FOLLOW') {
        // Position slightly behind owner
        pet.targetX = owner.x + (Math.random() - 0.5) * 1.5;
        pet.targetY = owner.y;
        pet.targetZ = (owner.z ?? 0) - 1.2;
      } else if (pet.state === 'WANDER') {
        pet.targetX = pet.x + (Math.random() - 0.5) * 4.0;
        pet.targetY = 0;
        pet.targetZ = pet.z + (Math.random() - 0.5) * 4.0;
      }

      // Smooth step towards target
      pet.x += (pet.targetX - pet.x) * 0.4;
      pet.z += (pet.targetZ - pet.z) * 0.4;

      io.to(`room:${owner.roomId}`).emit(SOCKET_EVENTS.PET_STATE_UPDATE, {
        petId,
        state: pet.state,
        position: { x: pet.x, y: pet.y, z: pet.z },
        targetPosition: { x: pet.targetX, y: pet.targetY, z: pet.targetZ },
      });
    }
  }
}
