'use client';

import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { uint8ArrayToBase64, base64ToUint8Array } from '@/lib/binary';
import { localDb as db } from '@/lib/localDb';

export type SyncStatus = 'online' | 'offline' | 'syncing' | 'error';

interface AuthUser {
  id: string;
  email: string;
  name: string;
}

interface SyncContextType {
  isOnline: boolean;
  syncStatus: SyncStatus;
  pendingCount: number;
  currentUser: AuthUser | null;
  queueUpdate: (documentId: string, update: Uint8Array) => Promise<void>;
  triggerSync: (documentId: string) => Promise<void>;
  fetchRemoteUpdates: (documentId: string, stateVector: Uint8Array) => Promise<Uint8Array | null>;
}

const SyncContext = createContext<SyncContextType | undefined>(undefined);

function readCachedUser(): AuthUser | null {
  if (typeof window === 'undefined') return null;

  try {
    const cachedUser = window.localStorage.getItem('collab-editor:last-user');
    return cachedUser ? JSON.parse(cachedUser) : null;
  } catch {
    return null;
  }
}

export function SyncProvider({ children }: { children: React.ReactNode }) {
  const [isOnline, setIsOnline] = useState<boolean>(true);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('online');
  const [pendingCount, setPendingCount] = useState<number>(0);
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(() => readCachedUser());
  const currentUserRef = useRef<AuthUser | null>(currentUser);
  const isSyncingRef = useRef<boolean>(false);

  const setActiveUser = useCallback((user: AuthUser | null) => {
    currentUserRef.current = user;
    setCurrentUser(user);

    try {
      if (typeof window !== 'undefined') {
        if (user) {
          window.localStorage.setItem('collab-editor:last-user', JSON.stringify(user));
        } else {
          window.localStorage.removeItem('collab-editor:last-user');
        }
      }
    } catch {
      // Local storage may be unavailable in private or restricted browsing modes.
    }
  }, []);

  // Update the pending count from Dexie
  const updatePendingCount = useCallback(async () => {
    if (typeof window === 'undefined' || !db.pendingSyncs) return;
    try {
      const user = currentUserRef.current;
      const count = user
        ? await db.pendingSyncs.where('userId').equals(user.id).count()
        : 0;
      setPendingCount(count);
    } catch (err) {
      console.error('Error counting pending syncs:', err);
    }
  }, []);

  // Ping API to verify actual internet connectivity
  const checkInternet = useCallback(async () => {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      setIsOnline(false);
      setSyncStatus('offline');
      return false;
    }
    try {
      const controller = new AbortController();
      const id = setTimeout(() => controller.abort(), 3000);
      const res = await fetch('/api/auth/me', { signal: controller.signal });
      clearTimeout(id);
      const reachable = res.status !== 502 && res.status !== 503 && res.status !== 504;
      setIsOnline(reachable);

      if (res.ok) {
        const data = await res.json();
        setActiveUser(data.user);
      } else if (res.status === 401) {
        setActiveUser(null);
      }

      return reachable;
    } catch {
      setIsOnline(false);
      setSyncStatus('offline');
      return false;
    }
  }, [setActiveUser]);

  // Flush the queue for a specific document
  const triggerSync = useCallback(async (documentId: string) => {
    if (isSyncingRef.current) return;
    const online = await checkInternet();
    if (!online) {
      setSyncStatus('offline');
      return;
    }

    const user = currentUserRef.current;
    if (!user) {
      setSyncStatus('online');
      await updatePendingCount();
      return;
    }

    isSyncingRef.current = true;
    setSyncStatus('syncing');

    try {
      while (true) {
        // Get oldest pending sync for this document
        const pending = await db.pendingSyncs
          .where('[userId+documentId]')
          .equals([user.id, documentId])
          .first();

        if (!pending || !pending.id) {
          break; // Queue is empty
        }

        // Send this update to the server
        const response = await fetch(`/api/documents/${documentId}/sync`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            updateData: pending.updateData,
            clientStateVector: '' // We will let the editor page handle bidirectional sync
          })
        });

        if (!response.ok) {
          if (response.status === 401 || response.status === 403) {
            // Unauthenticated or Viewer role tries to sync -> clear update to prevent blocking
            await db.pendingSyncs.delete(pending.id);
            continue;
          }
          throw new Error('Sync failed with server status ' + response.status);
        }

        // Successfully synced, remove from queue
        await db.pendingSyncs.delete(pending.id);
        await updatePendingCount();
      }
      setSyncStatus('online');
    } catch (err) {
      console.error('Queue flush failed:', err);
      setSyncStatus('error');
    } finally {
      isSyncingRef.current = false;
      await updatePendingCount();
    }
  }, [checkInternet, updatePendingCount]);

  // Queue a local update
  const queueUpdate = useCallback(async (documentId: string, update: Uint8Array) => {
    if (typeof window === 'undefined' || !db.pendingSyncs) return;
    const user = currentUserRef.current;
    if (!user) return;

    const base64 = uint8ArrayToBase64(update);
    
    await db.pendingSyncs.add({
      documentId,
      userId: user.id,
      updateData: base64,
      timestamp: Date.now()
    });

    await updatePendingCount();
    
    // Attempt to sync immediately
    triggerSync(documentId);
  }, [triggerSync, updatePendingCount]);

  // Fetch remote updates directly (used for polling or page load)
  const fetchRemoteUpdates = useCallback(async (documentId: string, stateVector: Uint8Array): Promise<Uint8Array | null> => {
    try {
      const base64State = uint8ArrayToBase64(stateVector);
      const response = await fetch(`/api/documents/${documentId}/sync?stateVector=${encodeURIComponent(base64State)}`);
      
      if (!response.ok) return null;

      const data = await response.json();
      if (data.serverUpdate) {
        return base64ToUint8Array(data.serverUpdate);
      }
    } catch (err) {
      console.error('Failed to fetch remote updates:', err);
    }
    return null;
  }, []);

  // Monitor network status events
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleOnline = () => {
      checkInternet().then((online) => {
        if (online) {
          // Sync any documents that have pending items
          db.pendingSyncs.toArray().then((items) => {
            const activeUser = currentUserRef.current;
            const uniqueDocIds = Array.from(new Set(
              items
                .filter(item => activeUser && item.userId === activeUser.id)
                .map(item => item.documentId)
            ));
            uniqueDocIds.forEach(id => triggerSync(id));
          });
        }
      });
    };

    const handleOffline = () => {
      setIsOnline(false);
      setSyncStatus('offline');
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    
    // Initial run
    handleOnline();

    // Periodic ping and status check (every 10 seconds)
    const interval = setInterval(handleOnline, 10000);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      clearInterval(interval);
    };
  }, [checkInternet, triggerSync]);

  return (
    <SyncContext.Provider value={{
      isOnline,
      syncStatus,
      pendingCount,
      currentUser,
      queueUpdate,
      triggerSync,
      fetchRemoteUpdates
    }}>
      {children}
    </SyncContext.Provider>
  );
}

export function useSync() {
  const context = useContext(SyncContext);
  if (context === undefined) {
    throw new Error('useSync must be used within a SyncProvider');
  }
  return context;
}
