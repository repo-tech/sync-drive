'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useSync } from '@/components/SyncProvider';
import { localDb, LocalDocument } from '@/lib/localDb';
import { useLiveQuery } from 'dexie-react-hooks';
import { 
  FileText, Plus, LogOut, Cloud, CloudOff, RefreshCw, 
  Trash2, Share2, Shield, Calendar, User, Search, Settings 
} from 'lucide-react';

export default function DashboardPage() {
  const router = useRouter();
  const { isOnline, syncStatus, pendingCount, currentUser } = useSync();
  const [userProfile, setUserProfile] = useState<{ id: string; name: string; email: string } | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [newTitle, setNewTitle] = useState('');
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  // Reactively query Dexie local documents (Local-First rendering)
  const localDocuments = useLiveQuery(() => {
    if (!localDb.documents) return Promise.resolve([] as LocalDocument[]);
    return localDb.documents.toArray();
  });

  // Fetch user profile and synchronize document lists
  useEffect(() => {
    async function initDashboard() {
      try {
        const res = await fetch('/api/auth/me');
        if (res.ok) {
          const data = await res.json();
          setUserProfile(data.user);
        } else {
          router.push('/login');
        }
      } catch {
        // Offline or request failed
      }

      // If online, pull remote documents and refresh Dexie cache
      if (isOnline) {
        try {
          const res = await fetch('/api/documents');
          if (res.ok) {
            const data = await res.json();
            
            // Overwrite Dexie cache with fresh data
            await localDb.transaction('rw', localDb.documents, async () => {
              // Get current pending local documents to avoid deleting them before they sync
              const localPending = await localDb.documents
                .where('syncStatus')
                .equals('local-only')
                .toArray();
              
              await localDb.documents.clear();
              
              // Add fresh remote documents
              for (const doc of data.documents) {
                await localDb.documents.put({
                  id: doc.id,
                  title: doc.title,
                  updatedAt: doc.updatedAt,
                  role: doc.role,
                  syncStatus: 'synced'
                });
              }

              // Re-add local-only creations
              for (const doc of localPending) {
                await localDb.documents.put(doc);
              }
            });
          }
        } catch (err) {
          console.error('Failed to sync document list from server:', err);
        }
      }
    }

    initDashboard();
  }, [isOnline, router]);

  // Create a document
  const handleCreateDocument = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    const docId = crypto.randomUUID();
    const title = newTitle.trim() || 'Untitled Document';

    try {
      if (isOnline) {
        // Create on server
        const res = await fetch('/api/documents', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title })
        });

        if (res.ok) {
          const data = await res.json();
          
          // Put in local cache
          await localDb.documents.put({
            id: data.document.id,
            title: data.document.title,
            updatedAt: data.document.updatedAt,
            role: 'OWNER',
            syncStatus: 'synced'
          });
          
          router.push(`/documents/${data.document.id}`);
          return;
        }
      }

      // Offline creation: Save locally first, mark as local-only
      await localDb.documents.put({
        id: docId,
        title,
        updatedAt: new Date().toISOString(),
        role: 'OWNER',
        syncStatus: 'local-only'
      });

      // We initialize the Yjs local doc in the IndexedDB via editor load
      // The SyncManager will automatically sync it once we're online and open the document.
      // But to sync the creation even if we don't type, we can add it to the sync queue.
      // Yjs documents have empty states initially, which is a simple Uint8Array of size 0/1.
      const emptyUpdate = new Uint8Array([0]); 
      
      if (currentUser) {
        await localDb.pendingSyncs.add({
          documentId: docId,
          userId: currentUser.id,
          updateData: Buffer.from(emptyUpdate).toString('base64'),
          timestamp: Date.now()
        });
      }

      router.push(`/documents/${docId}`);
    } catch (err) {
      console.error('Failed to create document:', err);
    } finally {
      setLoading(false);
      setIsCreateOpen(false);
      setNewTitle('');
    }
  };

  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
      router.push('/login');
      router.refresh();
    } catch (err) {
      console.error(err);
    }
  };

  // Filter documents based on search query
  const filteredDocuments = localDocuments?.filter(doc => 
    doc.title.toLowerCase().includes(searchQuery.toLowerCase())
  ) || [];

  return (
    <div className="flex-1 bg-[#09090b] min-h-screen text-zinc-100 flex flex-col font-sans">
      {/* Header bar */}
      <header className="border-b border-zinc-800 bg-[#0d0d11]/80 backdrop-blur-md sticky top-0 z-40 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 bg-indigo-600/10 border border-indigo-500/20 rounded-xl flex items-center justify-center text-indigo-400 font-bold shadow-lg shadow-indigo-600/5">
            SD
          </div>
          <div>
            <h1 className="text-lg font-bold tracking-tight bg-gradient-to-r from-white to-zinc-400 bg-clip-text text-transparent">
              SyncDoc
            </h1>
            <p className="text-xs text-zinc-500">Local-First Collaborative Editor</p>
          </div>
        </div>

        {/* Middle Indicators */}
        <div className="hidden sm:flex items-center gap-4 bg-zinc-900/60 border border-zinc-800 px-4 py-1.5 rounded-full text-xs">
          <div className="flex items-center gap-2">
            <span className={`relative flex h-2 w-2`}>
              {syncStatus === 'syncing' ? (
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-yellow-400 opacity-75"></span>
              ) : null}
              <span className={`relative inline-flex rounded-full h-2 w-2 ${
                syncStatus === 'online' ? 'bg-emerald-500' :
                syncStatus === 'syncing' ? 'bg-yellow-500' :
                syncStatus === 'offline' ? 'bg-blue-500' : 'bg-red-500'
              }`}></span>
            </span>
            <span className="font-semibold text-zinc-400 capitalize">{syncStatus}</span>
          </div>

          {pendingCount > 0 && (
            <div className="flex items-center gap-1.5 text-yellow-400 bg-yellow-400/5 px-2 py-0.5 rounded-md border border-yellow-400/10 font-medium">
              <RefreshCw className="h-3 w-3 animate-spin" />
              <span>{pendingCount} unsynced changes</span>
            </div>
          )}
        </div>

        {/* End Actions */}
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 bg-zinc-900/40 border border-zinc-850 px-3 py-1.5 rounded-xl text-sm">
            <div className="h-6 w-6 rounded-full bg-indigo-600/20 border border-indigo-500/20 flex items-center justify-center text-xs font-semibold text-indigo-400 uppercase">
              {userProfile?.name?.slice(0, 2) || <User className="h-3.5 w-3.5" />}
            </div>
            <span className="font-medium text-zinc-300 hidden md:inline">{userProfile?.name || 'Loading...'}</span>
          </div>

          <button
            onClick={handleLogout}
            className="p-2.5 bg-zinc-900 border border-zinc-800 hover:bg-zinc-850 text-zinc-400 hover:text-white rounded-xl transition cursor-pointer"
            title="Log Out"
          >
            <LogOut className="h-4.5 w-4.5" />
          </button>
        </div>
      </header>

      {/* Main dashboard content */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-6 md:p-8 flex flex-col gap-8">
        {/* Offline Banner */}
        {!isOnline && (
          <div className="flex items-center gap-3 bg-blue-950/20 border border-blue-500/25 p-4 rounded-2xl text-blue-400 text-sm">
            <CloudOff className="h-5 w-5 shrink-0" />
            <div>
              <span className="font-semibold">Running in Offline Mode.</span> You can still open, edit, and create documents. Changes are saved in browser cache and will sync automatically when your internet connection is restored.
            </div>
          </div>
        )}

        {/* Dashboard Actions Row */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
          {/* Search bar */}
          <div className="relative w-full sm:max-w-md">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500" />
            <input
              type="text"
              placeholder="Search documents..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 bg-zinc-900/60 border border-zinc-800 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 rounded-xl text-sm transition"
            />
          </div>

          {/* Create Button */}
          <button
            onClick={() => setIsCreateOpen(true)}
            className="w-full sm:w-auto px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold rounded-xl flex items-center justify-center gap-2 cursor-pointer shadow-lg shadow-indigo-600/10 active:scale-[0.98] transition"
          >
            <Plus className="h-4.5 w-4.5" />
            Create Document
          </button>
        </div>

        {/* Document Grid */}
        <div className="flex flex-col gap-4">
          <h2 className="text-sm font-bold uppercase tracking-wider text-zinc-500">Your Documents</h2>
          
          {filteredDocuments.length === 0 ? (
            <div className="border border-dashed border-zinc-850 rounded-2xl p-12 text-center text-zinc-500">
              <FileText className="h-10 w-10 mx-auto text-zinc-600 mb-3" />
              <p className="text-sm font-medium">No documents found</p>
              <p className="text-xs text-zinc-600 mt-1">Create a new document to start collaborating.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredDocuments.map((doc) => (
                <div
                  key={doc.id}
                  onClick={() => router.push(`/documents/${doc.id}`)}
                  className="group relative cursor-pointer border border-zinc-850 hover:border-zinc-700 bg-zinc-900/40 hover:bg-zinc-900/60 p-5 rounded-2xl transition-all shadow-md hover:shadow-lg flex flex-col justify-between min-h-[160px]"
                >
                  {/* Sync Status Badge */}
                  <div className="absolute top-4 right-4">
                    {doc.syncStatus === 'local-only' ? (
                      <span className="text-[10px] font-semibold text-blue-400 bg-blue-500/10 px-2 py-0.5 rounded-full border border-blue-500/20">
                        Local Only
                      </span>
                    ) : doc.syncStatus === 'pending' ? (
                      <span className="text-[10px] font-semibold text-yellow-400 bg-yellow-500/10 px-2 py-0.5 rounded-full border border-yellow-500/20 flex items-center gap-1">
                        <RefreshCw className="h-2.5 w-2.5 animate-spin" /> Unsynced
                      </span>
                    ) : (
                      <span className="text-[10px] font-semibold text-zinc-500 bg-zinc-800/20 px-2 py-0.5 rounded-full border border-zinc-800">
                        Synced
                      </span>
                    )}
                  </div>

                  <div>
                    <div className="inline-flex p-2.5 bg-indigo-600/10 border border-indigo-500/10 rounded-xl text-indigo-400 mb-4">
                      <FileText className="h-5 w-5" />
                    </div>
                    <h3 className="font-bold text-zinc-200 group-hover:text-white transition leading-snug line-clamp-1">
                      {doc.title}
                    </h3>
                  </div>

                  <div className="mt-6 pt-4 border-t border-zinc-850/60 flex items-center justify-between text-xs text-zinc-500">
                    <div className="flex items-center gap-1.5">
                      <Calendar className="h-3.5 w-3.5" />
                      <span>{new Date(doc.updatedAt).toLocaleDateString()}</span>
                    </div>

                    <div className="flex items-center gap-1.5 bg-zinc-900 px-2 py-0.5 rounded-md border border-zinc-800">
                      <Shield className="h-3 w-3 text-indigo-400" />
                      <span className="capitalize text-[10px] font-semibold text-zinc-400">{doc.role.toLowerCase()}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>

      {/* Creation Popup Modal */}
      {isCreateOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-[#121214] border border-zinc-800 rounded-2xl p-6 shadow-2xl">
            <h3 className="text-lg font-bold text-zinc-100 mb-4">Create New Document</h3>
            <form onSubmit={handleCreateDocument} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-1.5">
                  Document Title
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Q3 Sales Projections"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  className="w-full px-4 py-2.5 bg-black/40 border border-zinc-800 rounded-xl focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition text-sm text-zinc-250"
                  autoFocus
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => setIsCreateOpen(false)}
                  className="px-4 py-2 bg-zinc-905 hover:bg-zinc-800 border border-zinc-800 text-zinc-400 hover:text-white rounded-xl text-sm font-semibold cursor-pointer transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-650/50 text-white rounded-xl text-sm font-semibold cursor-pointer flex items-center gap-1.5 transition"
                >
                  {loading && <RefreshCw className="h-4 w-4 animate-spin" />}
                  {isOnline ? 'Create' : 'Create Offline'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
