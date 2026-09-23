import {
  Scene,
  Engine,
  ArcRotateCamera,
  Vector3,
  HemisphericLight,
  DirectionalLight,
  Color3,
  MeshBuilder,
  AbstractMesh,
  Tags,
} from '@babylonjs/core';

export type MoodPreset = 'morning' | 'afternoon' | 'evening' | 'night';

export interface PetNPC {
  mesh: AbstractMesh;
  state: 'idle' | 'walking';
  targetPos: Vector3 | null;
  stateTimer: number;
  update: (deltaMs: number) => void;
  dispose: () => void;
}

export interface RoomSceneOptions {
  fogDensity?: number;
  groundSize?: number;
}

export class HeadlessRoomScene {
  public scene: Scene;
  public camera: ArcRotateCamera;
  public ambientLight: HemisphericLight;
  public sunLight: DirectionalLight;
  public ground: AbstractMesh;
  public navMesh: AbstractMesh | null = null;
  public pet: PetNPC | null = null;

  constructor(engine: Engine, options: RoomSceneOptions = {}) {
    this.scene = new Scene(engine);

    // ── Fixed-Angle Isometric Camera (offset radius ~10-18, beta ~0.95 rad) ──
    this.camera = new ArcRotateCamera(
      'isometricCam',
      -Math.PI / 4,
      0.95, // ~54.4 degrees / 0.95 rad
      10,   // default distance / radius
      new Vector3(0, 0, 0),
      this.scene
    );

    // ── Lighting Setup ──────────────────────────────────────────────────────
    this.ambientLight = new HemisphericLight('ambientLight', new Vector3(0, 1, 0), this.scene);
    this.ambientLight.intensity = 0.75;
    this.ambientLight.groundColor = new Color3(0.2, 0.22, 0.35);

    this.sunLight = new DirectionalLight('sunLight', new Vector3(-1, -2, -1), this.scene);
    this.sunLight.position = new Vector3(15, 30, 15);
    this.sunLight.intensity = 1.1;

    // ── Fog Configuration ───────────────────────────────────────────────────
    this.scene.fogMode = Scene.FOGMODE_EXP2;
    this.scene.fogDensity = options.fogDensity ?? 0.02;
    this.scene.fogColor = new Color3(0.6, 0.7, 0.85);

    // ── Ground Plane with Collisions ────────────────────────────────────────
    const groundSize = options.groundSize ?? 30;
    this.ground = MeshBuilder.CreateGround('ground', { width: groundSize, height: groundSize }, this.scene);
    this.ground.checkCollisions = true;
    this.ground.isPickable = true;
    Tags.AddTagsTo(this.ground, 'walkable');
  }

  public setMood(mood: MoodPreset): void {
    switch (mood) {
      case 'morning':
        this.ambientLight.diffuse = new Color3(1.0, 0.9, 0.75); // warm yellow/golden
        this.sunLight.diffuse = new Color3(1.0, 0.85, 0.65);
        this.scene.fogColor = new Color3(0.9, 0.8, 0.7);
        break;
      case 'afternoon':
        this.ambientLight.diffuse = new Color3(1.0, 1.0, 1.0); // crisp bright white
        this.sunLight.diffuse = new Color3(1.0, 0.98, 0.9);
        this.scene.fogColor = new Color3(0.7, 0.85, 1.0);
        break;
      case 'evening':
        this.ambientLight.diffuse = new Color3(0.85, 0.55, 0.65); // dusk purple/pink
        this.sunLight.diffuse = new Color3(0.95, 0.45, 0.3);
        this.scene.fogColor = new Color3(0.6, 0.4, 0.55);
        break;
      case 'night':
        this.ambientLight.diffuse = new Color3(0.2, 0.25, 0.5); // cool deep navy
        this.sunLight.diffuse = new Color3(0.3, 0.35, 0.6);
        this.scene.fogColor = new Color3(0.08, 0.1, 0.18);
        break;
    }
  }

  public attachNavMesh(navMesh: AbstractMesh): void {
    this.navMesh = navMesh;
    Tags.AddTagsTo(navMesh, 'navmesh');
    navMesh.isVisible = false;
  }

  public spawnPet(initialPos: Vector3 = new Vector3(2, 0, 2)): PetNPC {
    const petMesh = MeshBuilder.CreateSphere('pet_npc', { diameter: 0.6 }, this.scene);
    petMesh.position = initialPos.clone();

    const pet: PetNPC = {
      mesh: petMesh,
      state: 'idle',
      targetPos: null,
      stateTimer: 0,
      update: (deltaMs: number) => {
        pet.stateTimer += deltaMs;
        if (pet.state === 'idle') {
          if (pet.stateTimer > 1000) {
            pet.state = 'walking';
            pet.targetPos = new Vector3(
              pet.mesh.position.x + (Math.random() * 4 - 2),
              0,
              pet.mesh.position.z + (Math.random() * 4 - 2)
            );
            pet.stateTimer = 0;
          }
        } else if (pet.state === 'walking') {
          if (pet.targetPos) {
            const diff = pet.targetPos.subtract(pet.mesh.position);
            diff.y = 0;
            if (diff.length() < 0.1 || pet.stateTimer > 2000) {
              pet.state = 'idle';
              pet.targetPos = null;
              pet.stateTimer = 0;
            } else {
              const step = diff.normalize().scale(0.002 * deltaMs);
              pet.mesh.position.addInPlace(step);
            }
          }
        }
      },
      dispose: () => {
        petMesh.dispose();
      },
    };

    this.pet = pet;
    return pet;
  }

  public render(): void {
    this.scene.render();
  }

  public dispose(): void {
    this.pet?.dispose();
    this.navMesh?.dispose();
    this.ground.dispose();
    this.ambientLight.dispose();
    this.sunLight.dispose();
    this.camera.dispose();
    this.scene.dispose();
  }
}
