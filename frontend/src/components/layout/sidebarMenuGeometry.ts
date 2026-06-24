export type PointerPoint = {
  x: number;
  y: number;
};

export type SubmenuGraceBounds = {
  left: number;
  top: number;
  bottom: number;
};

export function isPointerInsideSubmenuGraceArea({
  previous,
  current,
  submenu,
}: {
  previous: PointerPoint | null;
  current: PointerPoint;
  submenu: SubmenuGraceBounds | null;
}): boolean {
  if (!previous || !submenu) return false;
  if (current.x <= previous.x) return false;
  if (current.x > submenu.left) return false;

  const topTarget = { x: submenu.left, y: submenu.top };
  const bottomTarget = { x: submenu.left, y: submenu.bottom };
  return pointInTriangle(current, previous, topTarget, bottomTarget);
}

function pointInTriangle(
  point: PointerPoint,
  a: PointerPoint,
  b: PointerPoint,
  c: PointerPoint,
): boolean {
  const area = triangleArea(a, b, c);
  const area1 = triangleArea(point, b, c);
  const area2 = triangleArea(a, point, c);
  const area3 = triangleArea(a, b, point);
  return Math.abs(area - (area1 + area2 + area3)) < 0.5;
}

function triangleArea(a: PointerPoint, b: PointerPoint, c: PointerPoint): number {
  return Math.abs((a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y)) / 2);
}
