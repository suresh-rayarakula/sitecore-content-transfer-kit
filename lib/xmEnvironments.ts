import type { ApplicationResourceContext } from "@sitecore-marketplace-sdk/core";

/** One XM Cloud environment this Marketplace app is allowed to use. */
export interface XmEnvironment {
  id: string;
  /** Project name, the part before " / " in the portal label. */
  app: string;
  /** Environment name, the part after " / ". */
  name: string;
  label: string;
  /** Preview context id. Authoring and content transfer run against the CM. */
  contextId: string;
}

export function toEnvironments(resources: ApplicationResourceContext[] | undefined): XmEnvironment[] {
  const list: XmEnvironment[] = [];
  for (const resource of resources ?? []) {
    const contextId = resource.context?.preview || resource.context?.live;
    if (!resource.tenantId || !contextId) continue;
    const label = (resource.tenantDisplayName || resource.tenantName || resource.tenantId).trim();
    const parts = label.split(/\s+\/\s+/);
    const app = parts.length > 1 ? parts[0] : "Sitecore";
    const name = parts.length > 1 ? parts.slice(1).join(" / ") : label;
    list.push({ id: resource.tenantId, app, name, label, contextId });
  }
  return list;
}
