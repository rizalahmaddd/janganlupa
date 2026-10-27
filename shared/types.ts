export type LinkStatus = "pending" | "ok" | "failed" | "broken";

export interface Link {
  id: string;
  userId: string;
  collectionId: string | null;
  url: string;
  domain: string;
  title: string | null;
  description: string | null;
  note: string | null;
  image: string | null;
  favicon: string | null;
  siteName: string | null;
  contentType: string | null;
  status: LinkStatus;
  httpStatus: number | null;
  pinned: boolean;
  readAt: number | null;
  archivedAt: number | null;
  deletedAt: number | null;
  remindAt: number | null;
  remindedAt: number | null;
  openCount: number;
  lastOpenedAt: number | null;
  createdAt: number;
  updatedAt: number;
  tags: string[];
  mine: boolean;
  canEdit: boolean;
  sharedBy: string | null;
  shareRole: "viewer" | "editor" | null;
  shareNew: boolean;
  shareCount: number;
}

export type Role = "owner" | "editor" | "viewer";

export interface Collection {
  id: string;
  name: string;
  color: string | null;
  publicSlug: string | null;
  role: Role;
  ownerEmail: string;
  linkCount: number;
  memberCount: number;
  isNew: boolean;
}

export interface Member {
  email: string;
  role: "viewer" | "editor";
  joined: boolean;
}

export interface Tag {
  id: string;
  name: string;
  count: number;
}

export interface Me {
  id: string;
  email: string;
  name: string | null;
  settings: { theme?: "system" | "light" | "dark"; view?: "grid" | "list" | "compact"; digest?: boolean };
}

export interface Stats {
  total: number;
  unread: number;
  pinned: number;
  reminders: number;
  broken: number;
  archived: number;
  trash: number;
  forgotten: number;
}

export interface LinkPage {
  items: Link[];
  next: string | null;
}
