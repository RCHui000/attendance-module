export interface AppCenterItem {
  id: number;
  app_key: string;
  name: string;
  description: string;
  url: string;
  icon_key: string;
  tags: string[];
  is_internal: boolean;
  is_active: boolean;
  sort_order: number;
  created_at?: string;
  updated_at?: string;
}

export interface SaveAppCenterItemInput {
  id?: number;
  app_key?: string;
  name: string;
  description?: string;
  url: string;
  icon_key?: string;
  tags?: string[];
  is_internal?: boolean;
  is_active?: boolean;
  sort_order?: number;
}
