/**
 * HavenWorld — 8-Directional A* Grid Pathfinding with Obstacle Footprints
 *
 * Converts Babylon.js 3D world coordinates (x, z) into a discrete 0.5m pathfinding
 * grid, routes around static and dynamic furniture footprints using 8-directional
 * A* with Euclidean heuristic, and returns world-space Vector3 waypoints.
 */

export interface GridPoint {
  x: number;
  y: number;
}

export interface WorldPoint {
  x: number;
  z: number;
}

interface AStarNode {
  x: number;
  y: number;
  g: number;
  h: number;
  f: number;
  parent: AStarNode | null;
}

/**
 * 8-directional A* pathfinder on a `[0..gridSize-1, 0..gridSize-1]` integer grid.
 * Preserves full backward compatibility with `findPath(start, target, gridSize, obstacles)`
 * while supporting diagonal movement (`Math.SQRT2` cost) with corner-cutting prevention.
 */
export function findPath(
  start: GridPoint,
  target: GridPoint,
  gridSize: number,
  obstacles: Set<string> = new Set()
): GridPoint[] {
  const startX = Math.max(0, Math.min(gridSize - 1, Math.round(start.x)));
  const startY = Math.max(0, Math.min(gridSize - 1, Math.round(start.y)));
  let targetX = Math.max(0, Math.min(gridSize - 1, Math.round(target.x)));
  let targetY = Math.max(0, Math.min(gridSize - 1, Math.round(target.y)));

  if (startX === targetX && startY === targetY) {
    return [{ x: targetX, y: targetY }];
  }

  // If target cell is blocked, pick the nearest free neighbor around the target
  if (obstacles.has(`${targetX},${targetY}`)) {
    const candidates: GridPoint[] = [];
    for (let r = 1; r <= 3 && candidates.length === 0; r++) {
      for (let dx = -r; dx <= r; dx++) {
        for (let dy = -r; dy <= r; dy++) {
          if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
          const nx = targetX + dx;
          const ny = targetY + dy;
          if (
            nx >= 0 &&
            nx < gridSize &&
            ny >= 0 &&
            ny < gridSize &&
            !obstacles.has(`${nx},${ny}`)
          ) {
            candidates.push({ x: nx, y: ny });
          }
        }
      }
    }
    if (candidates.length === 0) {
      return [{ x: startX, y: startY }];
    }
    candidates.sort(
      (a, b) =>
        Math.hypot(a.x - startX, a.y - startY) - Math.hypot(b.x - startX, b.y - startY)
    );
    targetX = candidates[0].x;
    targetY = candidates[0].y;
  }

  const openList: AStarNode[] = [];
  const openMap = new Map<string, AStarNode>();
  const closedSet = new Set<string>();

  const heuristic = (x: number, y: number) => Math.hypot(targetX - x, targetY - y);

  const startNode: AStarNode = {
    x: startX,
    y: startY,
    g: 0,
    h: heuristic(startX, startY),
    f: heuristic(startX, startY),
    parent: null,
  };

  openList.push(startNode);
  openMap.set(`${startX},${startY}`, startNode);

  const directions = [
    { dx: 1, dy: 0, cost: 1.0 },
    { dx: -1, dy: 0, cost: 1.0 },
    { dx: 0, dy: 1, cost: 1.0 },
    { dx: 0, dy: -1, cost: 1.0 },
    { dx: 1, dy: 1, cost: Math.SQRT2 },
    { dx: 1, dy: -1, cost: Math.SQRT2 },
    { dx: -1, dy: 1, cost: Math.SQRT2 },
    { dx: -1, dy: -1, cost: Math.SQRT2 },
  ];

  while (openList.length > 0) {
    let lowestIdx = 0;
    for (let i = 1; i < openList.length; i++) {
      if (openList[i].f < openList[lowestIdx].f) {
        lowestIdx = i;
      }
    }

    const current = openList.splice(lowestIdx, 1)[0];
    const key = `${current.x},${current.y}`;
    openMap.delete(key);

    if (current.x === targetX && current.y === targetY) {
      const path: GridPoint[] = [];
      let curr: AStarNode | null = current;
      while (curr) {
        path.unshift({ x: curr.x, y: curr.y });
        curr = curr.parent;
      }
      return path;
    }

    closedSet.add(key);

    for (const d of directions) {
      const nx = current.x + d.dx;
      const ny = current.y + d.dy;
      const nKey = `${nx},${ny}`;

      if (nx < 0 || nx >= gridSize || ny < 0 || ny >= gridSize) continue;
      if (closedSet.has(nKey) || obstacles.has(nKey)) continue;

      // Prevent diagonal corner cutting around solid obstacles
      if (d.dx !== 0 && d.dy !== 0) {
        if (
          obstacles.has(`${current.x + d.dx},${current.y}`) ||
          obstacles.has(`${current.x},${current.y + d.dy}`)
        ) {
          continue;
        }
      }

      const gScore = current.g + d.cost;
      const existingOpen = openMap.get(nKey);

      if (!existingOpen) {
        const hScore = heuristic(nx, ny);
        const newNode: AStarNode = {
          x: nx,
          y: ny,
          g: gScore,
          h: hScore,
          f: gScore + hScore,
          parent: current,
        };
        openList.push(newNode);
        openMap.set(nKey, newNode);
      } else if (gScore < existingOpen.g) {
        existingOpen.g = gScore;
        existingOpen.f = gScore + existingOpen.h;
        existingOpen.parent = current;
      }
    }
  }

  return [{ x: targetX, y: targetY }];
}

/**
 * Converts world coordinates `[-halfSpan..+halfSpan]` into grid coordinates `[0..gridSize-1]`
 * and computes smoothed world-space waypoints avoiding obstacle bounding boxes.
 */
export function findWorldPath(
  start: WorldPoint,
  target: WorldPoint,
  obstacles: Set<string>,
  halfSpan: number = 15,
  cellSize: number = 0.5
): WorldPoint[] {
  if (obstacles.size === 0) {
    return [{ x: target.x, z: target.z }];
  }

  const gridSize = Math.round((halfSpan * 2) / cellSize);
  const toGrid = (val: number) =>
    Math.max(0, Math.min(gridSize - 1, Math.round((val + halfSpan) / cellSize)));
  const toWorld = (gridVal: number) => gridVal * cellSize - halfSpan;

  const startGrid = { x: toGrid(start.x), y: toGrid(start.z) };
  const targetGrid = { x: toGrid(target.x), y: toGrid(target.z) };

  // Ensure start cell itself is never considered blocked so player isn't trapped
  const safeObstacles = new Set(obstacles);
  safeObstacles.delete(`${startGrid.x},${startGrid.y}`);

  const gridPath = findPath(startGrid, targetGrid, gridSize, safeObstacles);
  if (gridPath.length <= 1) {
    return [{ x: target.x, z: target.z }];
  }

  // Collapse collinear intermediate grid nodes into turn waypoints
  const waypoints: WorldPoint[] = [];
  for (let i = 1; i < gridPath.length; i++) {
    if (i === gridPath.length - 1) {
      waypoints.push({ x: target.x, z: target.z });
    } else {
      const prev = gridPath[i - 1];
      const curr = gridPath[i];
      const next = gridPath[i + 1];
      const dx1 = curr.x - prev.x;
      const dy1 = curr.y - prev.y;
      const dx2 = next.x - curr.x;
      const dy2 = next.y - curr.y;
      if (dx1 !== dx2 || dy1 !== dy2) {
        waypoints.push({ x: toWorld(curr.x), z: toWorld(curr.y) });
      }
    }
  }

  return waypoints.length > 0 ? waypoints : [{ x: target.x, z: target.z }];
}
