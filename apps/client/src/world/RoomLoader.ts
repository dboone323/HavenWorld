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
   * Categorize an array of room meshes according to name prefixes:
   * - "NavMesh_*"   → navigation surface (invisible, not pickable, tagged 'navmesh')
   * - "Walkable_*" or "Floor" → walkable area (pickable, tagged 'walkable')
   * - "Collision_*" → invisible collision geometry (not pickable, tagged 'collision')
   * - All others    → visible geometry (not pickable)
   */
  public processMeshes(allMeshes: AbstractMesh[]): RoomLoadResult {
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
        mesh.isPickable = false;
      }
    }

    return { rootMesh, walkableMeshes, navMeshes, collisionMeshes, allMeshes };
  }

  /**
   * Load a room GLB by ID from /assets/rooms/{roomId}.glb.
   */
  public async load(
    roomId: string,
    onProgress?: (event: ProgressEvent) => void
  ): Promise<RoomLoadResult> {
    const url = `/assets/rooms/${roomId}.glb`;
    console.log(`[RoomLoader] Loading room: ${url}`);

    const result = await SceneLoader.ImportMeshAsync(
      '',
      '',
      url,
      this._scene,
      onProgress
    );

    return this.processMeshes(result.meshes as AbstractMesh[]);
  }

  /**
   * Unload the current room by disposing all tagged meshes.
   * Called by SceneManager before loading a new room.
   */
  public unload(): void {
    const tags = ['walkable', 'navmesh', 'collision'];
    for (const tag of tags) {
      const meshes = this._scene.getMeshesByTags(tag);
      meshes.forEach((m) => m.dispose());
    }
  }
}
