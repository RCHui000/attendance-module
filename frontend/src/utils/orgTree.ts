import type { Organization } from "@/types/employee";

export type OrgTreeItem = Organization & {
  depth: number;
  path: string;
};

export function flattenOrgTree(orgs: Organization[]): OrgTreeItem[] {
  const byParent = new Map<number | null, Organization[]>();
  const byId = new Map<number, Organization>();
  orgs.forEach((org) => {
    byId.set(org.id, org);
    const parentId = org.parent_id ?? null;
    const siblings = byParent.get(parentId) || [];
    siblings.push(org);
    byParent.set(parentId, siblings);
  });
  byParent.forEach((siblings) => {
    siblings.sort((a, b) => a.org_name.localeCompare(b.org_name, "zh-CN"));
  });

  const result: OrgTreeItem[] = [];
  const seen = new Set<number>();

  const visit = (org: Organization, depth: number, parentPath: string) => {
    if (seen.has(org.id)) return;
    seen.add(org.id);
    const path = parentPath ? `${parentPath} / ${org.org_name}` : org.org_name;
    result.push({ ...org, depth, path });
    (byParent.get(org.id) || []).forEach((child) => visit(child, depth + 1, path));
  };

  (byParent.get(null) || []).forEach((org) => visit(org, 0, ""));
  orgs
    .filter((org) => !seen.has(org.id) && (!org.parent_id || !byId.has(org.parent_id)))
    .forEach((org) => visit(org, 0, ""));

  return result;
}

export function orgOptionLabel(item: OrgTreeItem): string {
  return `${"  ".repeat(item.depth)}${item.depth > 0 ? "- " : ""}${item.org_name}`;
}

export function orgPath(orgs: Organization[], orgId: number | null | undefined): string {
  if (!orgId) return "";
  return flattenOrgTree(orgs).find((org) => org.id === orgId)?.path || "";
}

export function effectiveOrgColorToken(orgs: Organization[], orgId: number | null | undefined): string {
  if (!orgId) return "";
  const byId = new Map(orgs.map((org) => [org.id, org]));
  const seen = new Set<number>();
  let current = byId.get(orgId);

  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    if (current.color_token) return current.color_token;
    current = current.parent_id ? byId.get(current.parent_id) : undefined;
  }

  return "";
}

export function descendantOrgIds(orgs: Organization[], orgId: number): Set<number> {
  const byParent = new Map<number, number[]>();
  orgs.forEach((org) => {
    if (!org.parent_id) return;
    const children = byParent.get(org.parent_id) || [];
    children.push(org.id);
    byParent.set(org.parent_id, children);
  });

  const ids = new Set<number>();
  const queue = [...(byParent.get(orgId) || [])];
  while (queue.length > 0) {
    const id = queue.shift();
    if (!id || ids.has(id)) continue;
    ids.add(id);
    queue.push(...(byParent.get(id) || []));
  }
  return ids;
}

export function isCostOrganization(orgs: Organization[], orgId: number | null | undefined): boolean {
  if (!orgId) return false;
  const byId = new Map(orgs.map((org) => [org.id, org]));
  const seen = new Set<number>();
  let current = byId.get(orgId);

  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    if (current.org_code === "CC") return true;
    if (current.org_name.includes("造价")) return true;
    current = current.parent_id ? byId.get(current.parent_id) : undefined;
  }

  return false;
}
