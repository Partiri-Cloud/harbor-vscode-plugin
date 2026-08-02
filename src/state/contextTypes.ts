/**
 * Shapes returned by `partiri -j llm context` (docs/cli-contract.md §9),
 * used to populate pickers (workspace/project/region/pod/secret trees) and
 * to feed the tree views and the "New service" wizard.
 */

export interface ContextProject {
  id: string;
  name: string;
  environment: string;
}

export interface ContextRegion {
  id: string;
  name: string;
  label: string;
  country_code: string;
}

export interface ContextPod {
  id: string;
  name: string;
  label: string;
  cpu: string;
  ram: string;
  price_eur_month: number;
}

export interface ContextSecret {
  id: string;
  name: string;
  provider: string;
}

export interface ContextService {
  id: string;
  name: string;
  fk_project: string;
  fk_region: string;
  fk_pod: string;
  deploy_type: string;
  runtime: string;
}

export interface ContextWorkspace {
  id: string;
  name: string;
  email: string;
  projects: ContextProject[];
  regions: ContextRegion[];
  pods: ContextPod[];
  volume_price_per_gb: number;
  balance_eur: number;
  registry_secrets: ContextSecret[];
  repository_secrets: ContextSecret[];
  services: ContextService[];
}

export interface ContextData {
  user: { email: string };
  workspaces: ContextWorkspace[];
}
