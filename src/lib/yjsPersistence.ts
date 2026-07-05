export function getYjsPersistenceName(documentId: string, userId?: string | null) {
  return userId ? `yjs:${userId}:${documentId}` : `yjs:anonymous:${documentId}`;
}
