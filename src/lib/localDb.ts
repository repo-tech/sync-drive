import Dexie, { type Table } from 'dexie';

export interface LocalDocument {
  id: string;
  title: string;
  updatedAt: string;
  role: 'OWNER' | 'EDITOR' | 'VIEWER';
  syncStatus: 'synced' | 'pending' | 'local-only';
}

export interface PendingSync {
  id?: number;
  documentId: string;
  userId?: string;
  updateData: string; // Base64 string of the Yjs update Uint8Array
  timestamp: number;
}

export interface LocalVersion {
  id: string;
  documentId: string;
  name: string;
  description?: string;
  stateData: string; // Base64 string of the Yjs snapshot Uint8Array
  createdByName: string;
  createdAt: string;
}

class CollabEditorDb extends Dexie {
  documents!: Table<LocalDocument>;
  pendingSyncs!: Table<PendingSync>;
  versions!: Table<LocalVersion>;

  constructor() {
    super('CollabEditorDb');
    this.version(1).stores({
      documents: 'id, title, updatedAt, syncStatus',
      pendingSyncs: '++id, documentId, timestamp',
      versions: 'id, documentId, createdAt'
    });

    this.version(2).stores({
      documents: 'id, title, updatedAt, syncStatus',
      pendingSyncs: '++id, documentId, userId, [userId+documentId], timestamp',
      versions: 'id, documentId, createdAt'
    });
  }
}

// Ensure localDb is client-side only
export const localDb = typeof window !== 'undefined' ? new CollabEditorDb() : {} as CollabEditorDb;
export type { CollabEditorDb };
