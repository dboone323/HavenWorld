import { Scene, AbstractMesh, SceneLoader, Tags } from '@babylonjs/core';
import '@babylonjs/loaders/glTF';

export interface RoomLoadResult {
  rootMesh: AbstractMesh;
  walkableMeshes: AbstractMesh[];
  navMeshes: AbstractMesh[];
  collisionMeshes: AbstractMesh[];
  allMeshes: AbstractMesh[];
}

export class RoomLoader {
  private _scene: Scene;

  constructor(scene: Scene) {
    this._scene = scene;
  }

  /**
   * Load a room GLB by ID from /assets/rooms/{roomId}.glb.
   * Meshes are categorized by name prefix convention:
   * - "NavMesh_*"   → navigation surface (invisible)
   * - "Walkable_*"  → floor / walkable area (visible, tagged "walkable")
   * - "Collision_*" → invisible collision geometry
   * - All others    → visible room geometry
   */
  public async load(
    roomId: string,
    onProgress?: (event: ProgressEvent) => void
  ): Promise<RoomLoadResult> {
    const url = `/assets/rooms/${roomId}.glb`;
    console.log(`[RoomLoader] Loading room: ${url}`);

    const result = await SceneLoader.ImportMeshAsync(
      '', // mesh names — empty string loads all
      '', // root URL — empty because we use full path url
      url,
      this._scene,
      onProgress
    );

    const allMeshes = result.meshes as AbstractMesh[];
    const rootMesh = allMeshes[0];
    const walkableMeshes: AbstractMesh[] = [];
    const navMeshes: AbstractMesh[] = [];
    const collisionMeshes: AbstractMesh[] = [];

    for (const mesh of allMeshes) {
      const name = mesh.name;
      if (name.startsWith('NavMesh_')) {
        mesh.isVisible = false;
        mesh.isPickable = false;
        Tags.AddTagsTo(mesh, 'navmesh');
        navMeshes.push(mesh);
      } else if (name.startsWith('Walkable_') || name === 'Floor') {
        Tags.AddTagsTo(mesh, 'walkable');
        mesh.isPickable = true;
        walkableMeshes.push(mesh);
      } else if (name.startsWith('Collision_')) {
        mesh.isVisible = false;
        mesh.isPickable = false;
        Tags.AddTagsTo(mesh, 'collision');
        collisionMeshes.push(mesh);
      } else {
        // Standard room geometry — visible but not directly pickable for movement
        mesh.isPickable = false;
      }
    }

    console.log(
      `[RoomLoader] Room "${roomId}" loaded. ` +
        `Meshes: ${allMeshes.length}, Walkable: ${walkableMeshes.length}, ` +
        `NavMesh: ${navMeshes.length}, Collision: ${collisionMeshes.length}`
    );

    return { rootMesh, walkableMeshes, navMeshes, collisionMeshes, allMeshes };
  }

  /**
   * Unload the current room by disposing all tagged meshes.
   * Called by SceneManager before loading a new room.
   */
  public unload(): void {
    const tagged = this._scene.getMeshesByTags('walkable navmesh collision');
    tagged.forEach((m) => m.dispose());
  }
}
