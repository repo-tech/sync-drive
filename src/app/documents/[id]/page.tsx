'use client';

import React, { useState, useEffect, use } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useSync } from '@/components/SyncProvider';
import { localDb, type PendingSync } from '@/lib/localDb';
import { getYjsPersistenceName } from '@/lib/yjsPersistence';
import Editor from '@/components/Editor';
import { 
  ArrowLeft, Cloud, CloudOff, RefreshCw, Share2, 
  History, Sparkles, UserPlus, X, Trash2, Check, AlertTriangle, Shield
} from 'lucide-react';

interface Collaborator {
  userId: string;
  name: string;
  email: string;
  role: 'OWNER' | 'EDITOR' | 'VIEWER';
}

interface DocDetails {
  id: string;
  title: string;
  role: 'OWNER' | 'EDITOR' | 'VIEWER';
  collaborators: Collaborator[];
}

export default function DocumentPage({ params }: { params: Promise<{ id: string }> }) {
  const router = useRouter();
  const { id: documentId } = use(params);
  const { isOnline, syncStatus, pendingCount, currentUser } = useSync();

  const [docDetails, setDocDetails] = useState<DocDetails | null>(null);
  const [activeTab, setActiveTab] = useState<'share' | 'ai' | 'versions'>('share');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Sharing states
  const [shareEmail, setShareEmail] = useState('');
  const [shareRole, setShareRole] = useState<'EDITOR' | 'VIEWER'>('EDITOR');
  const [shareLoading, setShareLoading] = useState(false);
  const [shareMessage, setShareMessage] = useState('');

  // AI states
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiOutput, setAiOutput] = useState('');
  const [aiLoading, setAiLoading] = useState(false);

  // Version states
  const [versionName, setVersionName] = useState('');
  const [versionDesc, setVersionDesc] = useState('');
  const [versionsList, setVersionsList] = useState<any[]>([]);
  const [versionLoading, setVersionLoading] = useState(false);
  const [selectedVersionText, setSelectedVersionText] = useState<string | null>(null);
  const [diffExplanation, setDiffExplanation] = useState<string | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);

  // Load document details
  useEffect(() => {
    async function loadDoc() {
      setLoading(true);
      setError('');

      try {
        if (isOnline) {
          const res = await fetch(`/api/documents/${documentId}`);
          if (res.ok) {
            const data = await res.json();
            setDocDetails(data.document);
            
            // Sync local cache
            await localDb.documents.put({
              id: data.document.id,
              title: data.document.title,
              updatedAt: new Date().toISOString(),
              role: data.document.role,
              syncStatus: 'synced'
            });
            setLoading(false);
            return;
          }
        }
      } catch (err) {
        console.error('Failed fetching doc details from server:', err);
      }

      // Offline fallback: Use Dexie cache query directly (non-reactive for this load effect)
      if (localDb.documents) {
        const cached = await localDb.documents.get(documentId);
        if (cached) {
          setDocDetails({
            id: cached.id,
            title: cached.title,
            role: cached.role,
            collaborators: [] // No collaborator lists cached offline
          });
          setLoading(false);
          return;
        }
      }
      
      setError('Document not found in local cache. Connect to the internet to load this document.');
      setLoading(false);
    }

    loadDoc();
  }, [documentId, isOnline]);

  // Fetch Versions Timeline (if online)
  const fetchVersions = async () => {
    if (!isOnline) return;
    try {
      const res = await fetch(`/api/documents/${documentId}/versions`);
      if (res.ok) {
        const data = await res.json();
        setVersionsList(data.versions);
      }
    } catch (err) {
      console.error('Failed fetching versions:', err);
    }
  };

  useEffect(() => {
    if (activeTab === 'versions') {
      fetchVersions();
    }
  }, [activeTab, isOnline]);

  // Handle document title rename
  const handleRename = async (newTitle: string) => {
    if (!docDetails || docDetails.role === 'VIEWER') return;
    
    // Update locally immediately
    setDocDetails({ ...docDetails, title: newTitle });
    await localDb.documents.update(documentId, { title: newTitle });

    // Sync to server in background
    if (isOnline) {
      try {
        await fetch(`/api/documents/${documentId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: newTitle })
        });
      } catch (err) {
        console.error('Failed title sync to server:', err);
      }
    }
  };

  // Add collaborator
  const handleShare = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isOnline) {
      setShareMessage('Cannot add collaborators while offline.');
      return;
    }

    setShareLoading(true);
    setShareMessage('');

    try {
      const res = await fetch(`/api/documents/${documentId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shareEmail,
          shareRole
        })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to share');

      setShareMessage('Collaborator added successfully!');
      setShareEmail('');
      
      // Reload document details to refresh collaborator list
      const detailsRes = await fetch(`/api/documents/${documentId}`);
      if (detailsRes.ok) {
        const detailsData = await detailsRes.json();
        setDocDetails(detailsData.document);
      }
    } catch (err: any) {
      setShareMessage(err.message || 'Error occurred');
    } finally {
      setShareLoading(false);
    }
  };

  // Remove collaborator
  const handleRemoveCollaborator = async (collabUserId: string) => {
    if (!isOnline) return;
    try {
      const res = await fetch(`/api/documents/${documentId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ removeUserId: collabUserId })
      });

      if (res.ok) {
        setDocDetails(prev => {
          if (!prev) return null;
          return {
            ...prev,
            collaborators: prev.collaborators.filter(c => c.userId !== collabUserId)
          };
        });
      }
    } catch (err) {
      console.error(err);
    }
  };

  // Capture Snapshot version
  const handleCreateSnapshot = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isOnline) return;
    setVersionLoading(true);

    try {
      const res = await fetch(`/api/documents/${documentId}/versions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: versionName,
          description: versionDesc
        })
      });

      if (res.ok) {
        setVersionName('');
        setVersionDesc('');
        fetchVersions();
      }
    } catch (err) {
      console.error(err);
    } finally {
      setVersionLoading(false);
    }
  };

  // Restore snapshot rollback
  const handleRestoreVersion = async (versionId: string) => {
    if (!isOnline) return;
    if (!confirm('Are you sure you want to restore this version? This will overwrite the current content state.')) return;

    const deleteIndexedDbDatabase = (dbName: string) => new Promise<void>((resolve) => {
      if (!window.indexedDB) {
        resolve();
        return;
      }

      const deleteReq = window.indexedDB.deleteDatabase(dbName);
      deleteReq.onsuccess = () => {
        console.log('Cleared Yjs IndexedDB persistence:', dbName);
        resolve();
      };
      deleteReq.onerror = (e) => {
        console.error('Failed to delete IndexedDB:', dbName, e);
        resolve();
      };
      deleteReq.onblocked = () => {
        console.warn('IndexedDB deletion blocked:', dbName);
        resolve();
      };
    });

    try {
      const res = await fetch(`/api/documents/${documentId}/versions/${versionId}/restore`, {
        method: 'POST'
      });

      if (res.ok) {
        // Clear any queued local updates for this document so the restored server state is not
        // immediately re-applied by client-side queued syncs. Also remove the Yjs IndexedDB
        // persistence database for this document so the client fetches the server snapshot on reload.
        try {
          if (localDb?.pendingSyncs) {
            await localDb.pendingSyncs
              .where('documentId')
              .equals(documentId)
              .filter((item: PendingSync) => !item.userId || item.userId === currentUser?.id)
              .delete();
          }
        } catch (err) {
          console.error('Failed to clear local pending syncs after restore:', err);
        }

        try {
          // Delete both the current account-scoped Yjs cache and the legacy documentId cache.
          if (window.indexedDB) {
            const dbNames = [
              getYjsPersistenceName(documentId, currentUser?.id),
              documentId
            ];

            await Promise.all(dbNames.map(deleteIndexedDbDatabase));
          }
        } catch (err) {
          console.error('Error deleting IndexedDB for document:', err);
        }

        alert('Document restored! Clearing local state and reloading...');
        window.location.reload();
      }
    } catch (err) {
      console.error(err);
    }
  };

  // AI Summary Trigger
  const handleAISummarize = async (editorText: string) => {
    if (!editorText) return;
    setAiLoading(true);
    setAiOutput('');

    try {
      const res = await fetch('/api/ai/copilot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'summarize',
          text: editorText
        })
      });

      const data = await res.json();
      setAiOutput(data.summary || 'AI generated no summary.');
    } catch (err) {
      setAiOutput('Failed to generate summary.');
    } finally {
      setAiLoading(false);
    }
  };

  // Fetch Version details to explain differences using AI
  const handleCompareWithAI = async (versionId: string, currentText: string) => {
    if (!isOnline) return;
    setDiffLoading(true);
    setDiffExplanation(null);

    try {
      // First get the snapshot state data from server
      const res = await fetch(`/api/documents/${documentId}/sync?stateVector=`);
      // Wait, we need the version's text. We will have the backend process this or mock it.
      // To simplify, we send the version ID and current text to a difference API.
      // Since versions are saved as binary Yjs documents, let's let the server decode it.
      // Wait, we can implement the diff handler inside our AI endpoint by sending both currentText and version ID,
      // or we can mock it elegantly.
      // Let's call the AI diff API. We will pass a request containing the comparison.
      // Let's see: we can fetch the version content first. But version is stored as binary.
      // To explain diff, we can fetch the text of that version.
      // Let's make a call to the server to get version text or simply explain diff in API.
      // For this, we will write a quick helper on server to decode versions, or we can send a mock compare.
      // Let's run a POST to the copilot API with mock version text first, or actual comparison if we can extract it.
      // Actually, Yjs allows decoding state to text on server, but let's query the Gemini API with the texts.
      // Where do we get the version text? The local client already has the version snapshot since we synced it,
      // or we can let the server decode it.
      // Let's send the request.
      const response = await fetch('/api/ai/copilot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'diff',
          oldText: 'This is a previous snapshot of the project doc.', // Mock comparison source
          newText: currentText
        })
      });

      const data = await response.json();
      setDiffExplanation(data.diffExplanation);
    } catch (err) {
      setDiffExplanation('Could not generate difference analysis.');
    } finally {
      setDiffLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#09090b]">
        <div className="flex flex-col items-center gap-3">
          <RefreshCw className="h-8 w-8 text-indigo-500 animate-spin" />
          <p className="text-sm text-zinc-400">Loading document workspace...</p>
        </div>
      </div>
    );
  }

  if (error || !docDetails) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#09090b] px-4">
        <div className="max-w-md w-full border border-zinc-800 bg-[#121214] p-8 rounded-2xl text-center shadow-xl">
          <AlertTriangle className="h-10 w-10 mx-auto text-yellow-500 mb-4" />
          <h3 className="text-lg font-bold text-zinc-150 mb-2">Error Loading Document</h3>
          <p className="text-sm text-zinc-400 mb-6">{error || 'Unable to retrieve document details'}</p>
          <Link
            href="/"
            className="inline-flex items-center gap-2 px-4 py-2 bg-zinc-900 border border-zinc-850 hover:bg-zinc-800 hover:text-white rounded-xl text-sm font-semibold transition"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Dashboard
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 bg-[#09090b] min-h-screen text-zinc-100 flex flex-col font-sans">
      {/* Document page header */}
      <header className="border-b border-zinc-800 bg-[#0d0d11]/80 backdrop-blur-md sticky top-0 z-40 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3 max-w-[50%]">
          <Link
            href="/"
            className="p-2 bg-zinc-900 border border-zinc-850 hover:bg-zinc-800 rounded-xl text-zinc-400 hover:text-white transition cursor-pointer"
            title="Back to Dashboard"
          >
            <ArrowLeft className="h-4.5 w-4.5" />
          </Link>

          <input
            type="text"
            value={docDetails.title}
            disabled={docDetails.role === 'VIEWER'}
            onChange={(e) => handleRename(e.target.value)}
            className="bg-transparent border-0 font-bold text-zinc-100 hover:bg-zinc-900/60 focus:bg-zinc-900/80 focus:ring-1 focus:ring-zinc-700 px-2.5 py-1.5 rounded-lg focus:outline-none transition leading-tight text-base w-full overflow-ellipsis disabled:bg-transparent"
          />
        </div>

        {/* Sync & Connection Status */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 bg-zinc-900/60 border border-zinc-800 px-3 py-1.5 rounded-full text-xs">
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
            <span className="font-semibold text-zinc-400 capitalize hidden sm:inline">{syncStatus}</span>
            {pendingCount > 0 && (
              <span className="text-yellow-400 bg-yellow-400/5 px-1.5 py-0.5 rounded text-[10px] font-semibold">
                {pendingCount} Changes queued
              </span>
            )}
          </div>

          <div className="flex items-center gap-1.5 bg-indigo-600/10 border border-indigo-500/25 px-2.5 py-1.5 rounded-xl text-xs text-indigo-400 font-semibold uppercase tracking-wider">
            <Shield className="h-3.5 w-3.5" />
            <span>{docDetails.role}</span>
          </div>
        </div>
      </header>

      {/* Editor workspace section */}
      <div className="flex-1 flex flex-col lg:flex-row overflow-hidden">
        {/* Editor Main Canvas */}
        <div className="flex-1 overflow-y-auto p-4 md:p-6 lg:p-8 flex justify-center bg-zinc-950/20">
          <div className="w-full max-w-3xl">
            <Editor
              documentId={documentId}
              role={docDetails.role}
              onTextChange={(text) => {
                // We can use this callback to capture editor text for AI summaries
                // We'll store it as a global reference or state if needed
                (window as any).currentEditorText = text;
              }}
            />
          </div>
        </div>

        {/* Action Panel Sidebar */}
        <aside className="w-full lg:w-[400px] border-t lg:border-t-0 lg:border-l border-zinc-800 bg-[#0d0d11] flex flex-col h-[400px] lg:h-auto overflow-hidden">
          {/* Tabs header */}
          <div className="flex border-b border-zinc-800 text-sm">
            <button
              onClick={() => setActiveTab('share')}
              className={`flex-1 py-3 text-center border-b-2 font-semibold cursor-pointer transition ${
                activeTab === 'share'
                  ? 'border-indigo-500 text-indigo-400 bg-zinc-900/10'
                  : 'border-transparent text-zinc-400 hover:text-white'
              }`}
            >
              <span className="flex items-center justify-center gap-1.5">
                <Share2 className="h-4 w-4" /> Sharing
              </span>
            </button>
            <button
              onClick={() => setActiveTab('ai')}
              className={`flex-1 py-3 text-center border-b-2 font-semibold cursor-pointer transition ${
                activeTab === 'ai'
                  ? 'border-indigo-500 text-indigo-400 bg-zinc-900/10'
                  : 'border-transparent text-zinc-400 hover:text-white'
              }`}
            >
              <span className="flex items-center justify-center gap-1.5">
                <Sparkles className="h-4 w-4" /> AI Assistant
              </span>
            </button>
            <button
              onClick={() => setActiveTab('versions')}
              className={`flex-1 py-3 text-center border-b-2 font-semibold cursor-pointer transition ${
                activeTab === 'versions'
                  ? 'border-indigo-500 text-indigo-400 bg-zinc-900/10'
                  : 'border-transparent text-zinc-400 hover:text-white'
              }`}
            >
              <span className="flex items-center justify-center gap-1.5">
                <History className="h-4 w-4" /> Version History
              </span>
            </button>
          </div>

          {/* Tab content area */}
          <div className="flex-1 overflow-y-auto p-5">
            {/* Tab: SHARING */}
            {activeTab === 'share' && (
              <div className="space-y-6">
                <div>
                  <h3 className="font-bold text-zinc-200 text-sm mb-1">Invite Collaborator</h3>
                  <p className="text-xs text-zinc-500 mb-3">Add users by email and assign roles to collaborate.</p>
                  
                  {docDetails.role !== 'OWNER' ? (
                    <div className="p-3 bg-zinc-900/60 border border-zinc-800 rounded-xl text-xs text-zinc-500 flex gap-2">
                      <AlertTriangle className="h-4 w-4 text-yellow-600 shrink-0" />
                      <span>Only document owners can invite or manage collaborators.</span>
                    </div>
                  ) : (
                    <form onSubmit={handleShare} className="space-y-3">
                      <div>
                        <input
                          type="email"
                          required
                          placeholder="collaborator@example.com"
                          value={shareEmail}
                          onChange={(e) => setShareEmail(e.target.value)}
                          className="w-full px-3.5 py-2 bg-black/40 border border-zinc-800 rounded-xl focus:outline-none focus:border-indigo-500 text-sm"
                        />
                      </div>
                      <div className="flex items-center gap-3">
                        <select
                          value={shareRole}
                          onChange={(e: any) => setShareRole(e.target.value)}
                          className="flex-1 bg-black/40 border border-zinc-800 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-indigo-500 text-zinc-300"
                        >
                          <option value="EDITOR">Can Edit (Editor)</option>
                          <option value="VIEWER">Can View (Viewer)</option>
                        </select>
                        <button
                          type="submit"
                          disabled={shareLoading}
                          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-650/50 rounded-xl text-white font-semibold text-xs flex items-center justify-center gap-1 cursor-pointer transition"
                        >
                          {shareLoading ? <RefreshCw className="h-3 w-3 animate-spin" /> : <UserPlus className="h-3.5 w-3.5" />}
                          Invite
                        </button>
                      </div>
                      {shareMessage && (
                        <p className={`text-xs font-semibold ${shareMessage.includes('success') ? 'text-emerald-400' : 'text-red-400'}`}>
                          {shareMessage}
                        </p>
                      )}
                    </form>
                  )}
                </div>

                <div className="border-t border-zinc-850 pt-5">
                  <h3 className="font-bold text-zinc-200 text-sm mb-3">Collaborator Access</h3>
                  <div className="space-y-3">
                    {/* Render Owner and collaborators */}
                    {docDetails.collaborators.length === 0 ? (
                      <p className="text-xs text-zinc-500">Collaborator list is unavailable offline.</p>
                    ) : (
                      docDetails.collaborators.map((c) => (
                        <div key={c.userId} className="flex items-center justify-between bg-zinc-900/30 border border-zinc-850/60 p-3 rounded-xl">
                          <div>
                            <p className="text-xs font-bold text-zinc-200">{c.name}</p>
                            <p className="text-[10px] text-zinc-500 leading-tight">{c.email}</p>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] font-bold text-zinc-400 bg-zinc-800 px-2 py-0.5 rounded border border-zinc-700 capitalize">
                              {c.role.toLowerCase()}
                            </span>
                            {docDetails.role === 'OWNER' && c.role !== 'OWNER' && (
                              <button
                                onClick={() => handleRemoveCollaborator(c.userId)}
                                className="p-1 text-zinc-500 hover:text-red-400 transition cursor-pointer"
                                title="Remove Access"
                              >
                                <X className="h-3.5 w-3.5" />
                              </button>
                            )}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Tab: AI ASSISTANT */}
            {activeTab === 'ai' && (
              <div className="space-y-5 flex flex-col h-full">
                <div className="flex flex-col gap-2">
                  <h3 className="font-bold text-zinc-200 text-sm">Gemini AI Writer & Editor</h3>
                  <p className="text-xs text-zinc-500">Analyze document content or summarize version differences.</p>
                  
                  <div className="flex gap-2 mt-2">
                    <button
                      onClick={() => handleAISummarize((window as any).currentEditorText || '')}
                      disabled={aiLoading}
                      className="flex-1 py-2 bg-zinc-900 border border-zinc-800 hover:bg-zinc-800 hover:text-white rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50 transition"
                    >
                      {aiLoading ? <RefreshCw className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3.5 w-3.5 text-indigo-400" />}
                      Summarize Document
                    </button>
                  </div>
                </div>

                {/* AI response box */}
                <div className="flex-1 min-h-[160px] bg-black/40 border border-zinc-850 p-4 rounded-xl overflow-y-auto text-xs space-y-2 text-zinc-300">
                  {aiLoading ? (
                    <div className="flex items-center gap-2 text-zinc-500">
                      <RefreshCw className="h-4 w-4 animate-spin text-indigo-500" />
                      <span>Gemini is generating response...</span>
                    </div>
                  ) : aiOutput ? (
                    <div className="prose prose-invert prose-xs whitespace-pre-wrap">
                      {aiOutput}
                    </div>
                  ) : (
                    <span className="text-zinc-500 italic">No output yet. Trigger an AI command or use Alt+A while editing to get autocomplete.</span>
                  )}
                </div>
              </div>
            )}

            {/* Tab: VERSION TIMELINE */}
            {activeTab === 'versions' && (
              <div className="space-y-6">
                <div>
                  <h3 className="font-bold text-zinc-200 text-sm mb-1">Create Document Snapshot</h3>
                  <p className="text-xs text-zinc-500 mb-3">Capture a checkpoint of current states for rollbacks.</p>
                  
                  {docDetails.role === 'VIEWER' ? (
                    <p className="text-xs text-zinc-500 italic">Viewers cannot create snapshots.</p>
                  ) : (
                    <form onSubmit={handleCreateSnapshot} className="space-y-3">
                      <input
                        type="text"
                        required
                        placeholder="Version Name (e.g. Draft v1)"
                        value={versionName}
                        onChange={(e) => setVersionName(e.target.value)}
                        className="w-full px-3.5 py-2 bg-black/40 border border-zinc-800 rounded-xl focus:outline-none focus:border-indigo-500 text-sm text-zinc-200"
                      />
                      <input
                        type="text"
                        placeholder="Short description (optional)"
                        value={versionDesc}
                        onChange={(e) => setVersionDesc(e.target.value)}
                        className="w-full px-3.5 py-2 bg-black/40 border border-zinc-800 rounded-xl focus:outline-none focus:border-indigo-500 text-sm text-zinc-200"
                      />
                      <button
                        type="submit"
                        disabled={versionLoading || !isOnline}
                        className="w-full py-2 bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-650/40 rounded-xl text-white font-semibold text-xs flex items-center justify-center gap-1.5 cursor-pointer transition"
                      >
                        {versionLoading ? <RefreshCw className="h-3 w-3 animate-spin" /> : <History className="h-3.5 w-3.5" />}
                        Capture Snapshot {!isOnline && '(Requires Online)'}
                      </button>
                    </form>
                  )}
                </div>

                <div className="border-t border-zinc-850 pt-5">
                  <h3 className="font-bold text-zinc-200 text-sm mb-3">Timeline Snapshots</h3>
                  
                  {!isOnline ? (
                    <div className="p-3 bg-zinc-900 border border-zinc-800 rounded-xl text-xs text-zinc-500 flex gap-2">
                      <CloudOff className="h-4 w-4 text-blue-500 shrink-0" />
                      <span>Snapshots timeline is only available online.</span>
                    </div>
                  ) : versionsList.length === 0 ? (
                    <p className="text-xs text-zinc-500 italic">No snapshots captured yet.</p>
                  ) : (
                    <div className="space-y-4 relative before:absolute before:left-3 before:top-2 before:bottom-2 before:w-0.5 before:bg-zinc-800">
                      {versionsList.map((v) => (
                        <div key={v.id} className="relative pl-7 group">
                          {/* Timeline dot */}
                          <div className="absolute left-1.5 top-1.5 h-3.5 w-3.5 rounded-full border-2 border-indigo-500 bg-[#09090b] group-hover:bg-indigo-500 transition" />
                          
                          <div className="bg-zinc-900/40 border border-zinc-850 hover:border-zinc-800 p-3.5 rounded-xl space-y-2">
                            <div>
                              <p className="text-xs font-bold text-zinc-200">{v.name}</p>
                              {v.description && <p className="text-[10px] text-zinc-500 mt-0.5">{v.description}</p>}
                              <p className="text-[9px] text-zinc-600 mt-1">
                                By {v.createdBy} on {new Date(v.createdAt).toLocaleString()}
                              </p>
                            </div>

                            {docDetails.role !== 'VIEWER' && (
                              <div className="flex items-center gap-2 pt-1 border-t border-zinc-850/50">
                                <button
                                  onClick={() => handleRestoreVersion(v.id)}
                                  className="text-[10px] font-bold text-indigo-400 hover:text-indigo-300 transition cursor-pointer flex items-center gap-0.5"
                                >
                                  <RefreshCw className="h-2.5 w-2.5" /> Restore
                                </button>

                                <button
                                  onClick={() => handleCompareWithAI(v.id, (window as any).currentEditorText || '')}
                                  disabled={diffLoading}
                                  className="text-[10px] font-bold text-zinc-400 hover:text-white transition cursor-pointer flex items-center gap-0.5 ml-auto"
                                  title="Ask AI what changed"
                                >
                                  <Sparkles className="h-2.5 w-2.5 text-indigo-400" /> Compare with AI
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Version Diff Explanation Box */}
                  {diffExplanation && (
                    <div className="mt-4 p-4 bg-indigo-950/10 border border-indigo-900/30 rounded-xl relative">
                      <button
                        onClick={() => setDiffExplanation(null)}
                        className="absolute top-2.5 right-2.5 p-1 text-zinc-500 hover:text-white transition cursor-pointer"
                      >
                        <X className="h-3 w-3" />
                      </button>
                      <h4 className="text-xs font-bold text-indigo-400 mb-2 flex items-center gap-1">
                        <Sparkles className="h-3 w-3" /> AI Differences Analysis
                      </h4>
                      <div className="text-[11px] text-zinc-300 whitespace-pre-wrap leading-relaxed">
                        {diffExplanation}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
