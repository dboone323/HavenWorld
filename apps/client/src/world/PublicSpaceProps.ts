import {
  Scene,
  Mesh,
  MeshBuilder,
  StandardMaterial,
  Color3,
  DynamicTexture,
  Vector3,
  AbstractMesh,
} from '@babylonjs/core';
import { GATHERING_NODES, NPC_PLACEMENTS, PUBLIC_PROPS } from '@havenworld/shared';

/**
 * Interactive props for the public spaces (roadmap §3g/§3h/§3i/§3l/§3m).
 *
 * Spawns the arcade cabinet, bulletin corkboard, jukebox machine, NPC
 * billboards, and gathering nodes defined in the shared world-content
 * registry. Each prop's mesh name is the contract RoomScene's pointer
 * observable uses to dispatch the right panel:
 *   arcade-cabinet · bulletin-board · jukebox-machine · npc-<id> · gather-<nodeId>
 */

function makeMaterial(scene: Scene, name: string, hex: string): StandardMaterial {
  const mat = new StandardMaterial(name, scene);
  mat.diffuseColor = Color3.FromHexString(hex);
  mat.specularColor = new Color3(0.05, 0.05, 0.05);
  return mat;
}

/** Billboard plane with emoji + caption drawn to a dynamic canvas texture. */
function makeLabelPlane(scene: Scene, name: string, emoji: string, caption: string, position: Vector3): Mesh {
  const plane = MeshBuilder.CreatePlane(name, { width: 1.7, height: 0.7 }, scene);
  plane.position = position;
  plane.billboardMode = Mesh.BILLBOARDMODE_ALL;

  const texture = new DynamicTexture(`${name}-tex`, { width: 256, height: 104 }, scene, true);
  const ctx = texture.getContext() as CanvasRenderingContext2D;
  ctx.clearRect(0, 0, 256, 104);
  ctx.font = '42px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(emoji, 128, 46);

  // High-contrast dark pill background so label text is legible over light floors & grass
  ctx.fillStyle = 'rgba(15, 23, 42, 0.82)';
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(14, 62, 228, 34, 17);
  } else {
    ctx.rect(14, 62, 228, 34);
  }
  ctx.fill();

  ctx.font = 'bold 20px sans-serif';
  ctx.fillStyle = '#ffffff';
  ctx.fillText(caption.slice(0, 22), 128, 86);
  texture.update(true);
  texture.hasAlpha = true;

  const mat = new StandardMaterial(`${name}-mat`, scene);
  mat.diffuseTexture = texture;
  mat.emissiveColor = new Color3(1, 1, 1);
  mat.opacityTexture = texture;
  mat.diffuseColor = new Color3(1, 1, 1);
  mat.disableLighting = true;
  mat.backFaceCulling = false;
  plane.material = mat;
  plane.isPickable = false;
  return plane;
}

function addProp(
  scene: Scene,
  meshes: AbstractMesh[],
  name: string,
  body: Mesh,
  material: StandardMaterial,
  spot: { x: number; z: number },
  height: number,
  emoji: string,
  caption: string
): void {
  body.name = name;
  body.material = material;
  body.position.set(spot.x, height / 2, spot.z);
  body.isPickable = true;
  body.metadata = { interactive: name };
  meshes.push(body);
  meshes.push(makeLabelPlane(scene, `${name}-label`, emoji, caption, new Vector3(spot.x, height + 0.75, spot.z)));
}

export function buildPublicSpaceProps(scene: Scene, roomId: string): AbstractMesh[] {
  const meshes: AbstractMesh[] = [];
  const roomKey = roomId.replace(/^room-/, '');

  // Gathering nodes (trees, wells, herb patches, fissures)
  for (const node of Object.values(GATHERING_NODES)) {
    if (node.roomKey !== roomKey) continue;
    addProp(
      scene, meshes, `gather-${node.id}`,
      MeshBuilder.CreateCylinder(`gather-${node.id}`, { diameter: 1.1, height: 1.2 }, scene),
      makeMaterial(scene, `gather-${node.id}-mat`, '#5a8f4f'),
      node.spot, 1.2, node.icon, node.name
    );
  }

  // NPC billboards
  for (const npc of NPC_PLACEMENTS) {
    if (npc.roomKey !== roomKey) continue;
    addProp(
      scene, meshes, `npc-${npc.id}`,
      MeshBuilder.CreateCapsule(`npc-${npc.id}`, { radius: 0.35, height: 1.5 }, scene),
      makeMaterial(scene, `npc-${npc.id}-mat`, npc.color),
      npc.spot, 1.5, '🧑', npc.name
    );
  }

  // Arcade cabinet / bulletin corkboard / jukebox machine
  for (const prop of PUBLIC_PROPS[roomId] ?? []) {
    const spec = {
      arcade: { hex: '#6c3ba0', h: 1.7, emoji: '🕹️', caption: 'Arcade — Connect-4' },
      bulletin: { hex: '#8d6e4b', h: 1.5, emoji: '📌', caption: 'Plaza Corkboard' },
      jukebox: { hex: '#c9a227', h: 1.4, emoji: '🎹', caption: 'Jukebox' },
    }[prop.kind];
    const kindName = prop.kind === 'bulletin' ? 'bulletin-board' : prop.kind === 'arcade' ? 'arcade-cabinet' : 'jukebox-machine';
    addProp(
      scene, meshes, kindName,
      MeshBuilder.CreateBox(kindName, { width: 1.1, depth: 0.6, height: spec.h }, scene),
      makeMaterial(scene, `${kindName}-mat`, spec.hex),
      prop.spot, spec.h, spec.emoji, spec.caption
    );
  }

  return meshes;
}

/**
 * Personal-loft props: the cash register used by the loft shop (§3n).
 * The room owner sees a stocking form; guests see a browse-and-buy form.
 */
export function buildLoftProps(scene: Scene): AbstractMesh[] {
  const meshes: AbstractMesh[] = [];
  addProp(
    scene, meshes, 'loft-shop-register',
    MeshBuilder.CreateBox('loft-shop-register', { width: 0.9, depth: 0.6, height: 1.1 }, scene),
    makeMaterial(scene, 'loft-shop-register-mat', '#b8860b'),
    { x: 7, z: -7 }, 1.1, '🧾', 'Shop Register'
  );
  return meshes;
}

