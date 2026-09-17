/**
 * HavenWorld — 2.5D Isometric Grid Pathfinding (A* algorithm).
 * Client ES module.
 */

export function findPath(start, target, gridSize, obstacles = new Set()) {
  const startX = Math.round(start.x);
  const startY = Math.round(start.y);
  let targetX = Math.round(target.x);
  let targetY = Math.round(target.y);

  targetX = Math.max(0, Math.min(gridSize - 1, targetX));
  targetY = Math.max(0, Math.min(gridSize - 1, targetY));

  if (startX === targetX && startY === targetY) {
    return [{ x: targetX, y: targetY }];
  }

  if (obstacles.has(`${targetX},${targetY}`)) {
    const neighbors = [
      { x: targetX + 1, y: targetY },
      { x: targetX - 1, y: targetY },
      { x: targetX, y: targetY + 1 },
      { x: targetX, y: targetY - 1 },
    ].filter(n =>
      n.x >= 0 && n.x < gridSize &&
      n.y >= 0 && n.y < gridSize &&
      !obstacles.has(`${n.x},${n.y}`)
    );

    if (neighbors.length === 0) return [{ x: startX, y: startY }];
    neighbors.sort((a, b) => (Math.hypot(a.x - startX, a.y - startY) - Math.hypot(b.x - startX, b.y - startY)));
    targetX = neighbors[0].x;
    targetY = neighbors[0].y;
  }

  const openList = [];
  const closedSet = new Set();

  const startNode = {
    x: startX,
    y: startY,
    g: 0,
    h: Math.abs(targetX - startX) + Math.abs(targetY - startY),
    f: Math.abs(targetX - startX) + Math.abs(targetY - startY),
    parent: null
  };

  openList.push(startNode);

  while (openList.length > 0) {
    let lowestIdx = 0;
    for (let i = 1; i < openList.length; i++) {
      if (openList[i].f < openList[lowestIdx].f) {
        lowestIdx = i;
      }
    }

    const current = openList.splice(lowestIdx, 1)[0];
    const key = `${current.x},${current.y}`;

    if (current.x === targetX && current.y === targetY) {
      const path = [];
      let curr = current;
      while (curr) {
        path.unshift({ x: curr.x, y: curr.y });
        curr = curr.parent;
      }
      return path;
    }

    closedSet.add(key);

    const directions = [
      { dx: 1, dy: 0 },
      { dx: -1, dy: 0 },
      { dx: 0, dy: 1 },
      { dx: 0, dy: -1 },
    ];

    for (const d of directions) {
      const nx = current.x + d.dx;
      const ny = current.y + d.dy;
      const nKey = `${nx},${ny}`;

      if (nx < 0 || nx >= gridSize || ny < 0 || ny >= gridSize) continue;
      if (closedSet.has(nKey) || obstacles.has(nKey)) continue;

      const gScore = current.g + 1;
      const existingOpen = openList.find(n => n.x === nx && n.y === ny);

      if (!existingOpen) {
        const hScore = Math.abs(targetX - nx) + Math.abs(targetY - ny);
        openList.push({
          x: nx,
          y: ny,
          g: gScore,
          h: hScore,
          f: gScore + hScore,
          parent: current
        });
      } else if (gScore < existingOpen.g) {
        existingOpen.g = gScore;
        existingOpen.f = gScore + existingOpen.h;
        existingOpen.parent = current;
      }
    }
  }

  return [{ x: targetX, y: targetY }];
}
