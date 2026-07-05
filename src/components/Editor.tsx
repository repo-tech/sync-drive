'use client';

import React, { useEffect, useState } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Collaboration from '@tiptap/extension-collaboration';
import * as Y from 'yjs';
import { IndexeddbPersistence } from 'y-indexeddb';
import { useSync } from '@/components/SyncProvider';
import { getYjsPersistenceName } from '@/lib/yjsPersistence';
import { 
  Bold, Italic, Strikethrough, Heading1, Heading2, 
  Type, List, ListOrdered, Sparkles, RefreshCw
} from 'lucide-react';

interface EditorProps {
  documentId: string;
  role: 'OWNER' | 'EDITOR' | 'VIEWER';
  onTextChange?: (text: string) => void;
}

export default function Editor({ documentId, role, onTextChange }: EditorProps) {
  const { queueUpdate, fetchRemoteUpdates, isOnline, currentUser } = useSync();
  const [ydoc, setYdoc] = useState<Y.Doc | null>(null);
  const [indexedDbSynced, setIndexedDbSynced] = useState(false);
  const persistenceName = currentUser ? getYjsPersistenceName(documentId, currentUser.id) : null;
  
  // AI Suggestion State
  const [aiSuggestion, setAiSuggestion] = useState('');
  const [aiLoading, setAiLoading] = useState(false);

  // Initialize Y.Doc and IndexedDB persistence (Local-First)
  useEffect(() => {
    if (!persistenceName) return;

    const doc = new Y.Doc();
    queueMicrotask(() => {
      setIndexedDbSynced(false);
      setYdoc(doc);
    });

    // Setup IndexeddbPersistence to cache Yjs doc state locally in IndexedDB
    const persistence = new IndexeddbPersistence(persistenceName, doc);
    
    persistence.on('synced', () => {
      console.log('IndexedDB loaded local state successfully');
      setIndexedDbSynced(true);
    });

    return () => {
      persistence.destroy();
      doc.destroy();
      setYdoc(null);
    };
  }, [persistenceName]);

  // Editor instance configuration
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        // Collaboration extension handles history natively; disable default undo/redo to prevent conflicts.
        undoRedo: false,
      }),
      ydoc
        ? Collaboration.configure({
            document: ydoc,
          })
        : null,
    ].filter((extension): extension is NonNullable<typeof extension> => Boolean(extension)),
    immediatelyRender: false,
    editable: role !== 'VIEWER',
    onUpdate({ editor }) {
      if (onTextChange) {
        onTextChange(editor?.getText() ?? '');
      }
    }

    
  }, [ydoc, role]);
  
  console.log('ydoc', ydoc);

  // Yjs update listener to feed local changes to Sync Queue
  useEffect(() => {
    if (!ydoc || !indexedDbSynced) return;

    const handleUpdate = (update: Uint8Array, origin: unknown) => {
      // Only queue updates that originated from the user (local edits)
      if (origin !== 'sync-engine') {
        queueUpdate(documentId, update);
      }
    };

    ydoc.on('update', handleUpdate);

    return () => {
      ydoc.off('update', handleUpdate);
    };
  }, [ydoc, indexedDbSynced, documentId, queueUpdate]);

  // Synchronize remote updates (Client polling for serverless compatibility)
  useEffect(() => {
    if (!ydoc || !indexedDbSynced || !isOnline) return;

    let isFetching = false;

    const syncRemote = async () => {
      if (isFetching) return;
      isFetching = true;

      try {
        const stateVector = Y.encodeStateVector(ydoc);
        const serverUpdate = await fetchRemoteUpdates(documentId, stateVector);

        if (serverUpdate && serverUpdate.byteLength > 0) {
          // Apply updates with 'sync-engine' origin to prevent re-queuing
          Y.applyUpdate(ydoc, serverUpdate, 'sync-engine');
          
          if (editor!==null) {
            // Force editor sync
            const currentText = editor?.getText() ?? '';
            if (onTextChange) onTextChange(currentText);
          }
          return;
        }
      } catch (err) {
        console.error('Remote polling sync failed:', err);
      } finally {
        isFetching = false;
      }
    };

    // Initial check
    syncRemote();

    // Poll every 3.5 seconds
    const interval = setInterval(syncRemote, 3500);

    return () => clearInterval(interval);
  }, [ydoc, indexedDbSynced, isOnline, documentId, fetchRemoteUpdates, editor, onTextChange]);

  // Capture document change initially
  useEffect(() => {
    if (editor && ydoc && indexedDbSynced) {
      if (onTextChange) {
        onTextChange(editor?.getText() ?? '');
      }
    }
  }, [editor, ydoc, indexedDbSynced, onTextChange]);

  // Trigger inline autocomplete
  const triggerAutocomplete = async () => {
    if (!editor || aiLoading || role === 'VIEWER') return;
    
    const textBeforeCursor = editor?.getText() ?? '';
    if (!textBeforeCursor.trim()) return;

    setAiLoading(true);
    setAiSuggestion('');

    try {
      const res = await fetch('/api/ai/copilot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'autocomplete',
          context: textBeforeCursor.slice(-150) // last 150 chars context
        })
      });

      if (res.ok) {
        const data = await res.json();
        if (data.completion) {
          setAiSuggestion(data.completion);
        }
      }
    } catch (err) {
      console.error('AI autocomplete request failed:', err);
    } finally {
      setAiLoading(false);
    }
  };

  // Keyboard interceptor: Tab key accepts autocomplete
  useEffect(() => {
    if (!editor) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Tab' && aiSuggestion) {
        e.preventDefault();
        
        // Insert suggestion at cursor
        editor.commands.insertContent(aiSuggestion);
        setAiSuggestion('');
      } else if (e.key !== 'Alt') {
        // Any keystroke clears autocomplete except modifiers
        setAiSuggestion('');
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [editor, aiSuggestion]);

  if (!currentUser || !ydoc || !indexedDbSynced) {
    return (
      <div className="h-64 border border-zinc-850 bg-zinc-900/10 rounded-2xl flex items-center justify-center text-zinc-500">
        <div className="flex items-center gap-2">
          <RefreshCw className="h-4.5 w-4.5 animate-spin text-indigo-400" />
          <span className="text-xs font-semibold">Opening local database persistence...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Editor rich formatting toolbar */}
      {editor && role !== 'VIEWER' && (
        <div className="flex flex-wrap items-center gap-1.5 p-2 bg-[#121214]/90 border border-zinc-800 rounded-xl sticky top-[72px] z-30 shadow-md">
          <button
            onClick={() => editor.chain().focus().toggleBold().run()}
            className={`p-2 rounded-lg cursor-pointer hover:bg-zinc-800 transition pointer-events-auto ${editor.isActive('bold') ? 'bg-indigo-600/20 text-indigo-400' : 'text-zinc-400'}`}
            title="Bold"
          >
            <Bold className="h-4 w-4" />
          </button>
          <button
            onClick={() => editor.chain().focus().toggleItalic().run()}
            className={`p-2 rounded-lg cursor-pointer hover:bg-zinc-800 transition pointer-events-auto ${editor.isActive('italic') ? 'bg-indigo-600/20 text-indigo-400' : 'text-zinc-400'}`}
            title="Italic"
          >
            <Italic className="h-4 w-4" />
          </button>
          <button
            onClick={() => editor.chain().focus().toggleStrike().run()}
            className={`p-2 rounded-lg cursor-pointer hover:bg-zinc-800 transition pointer-events-auto ${editor.isActive('strike') ? 'bg-indigo-600/20 text-indigo-400' : 'text-zinc-400'}`}
            title="Strike"
          >
            <Strikethrough className="h-4 w-4" />
          </button>

          <span className="h-4 w-px bg-zinc-800 mx-1" />

          <button
            onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
            className={`p-2 rounded-lg cursor-pointer hover:bg-zinc-800 transition pointer-events-auto ${editor.isActive('heading', { level: 1 }) ? 'bg-indigo-600/20 text-indigo-400' : 'text-zinc-400'}`}
            title="Heading 1"
          >
            <Heading1 className="h-4 w-4" />
          </button>
          <button
            onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
            className={`p-2 rounded-lg cursor-pointer hover:bg-zinc-800 transition pointer-events-auto ${editor.isActive('heading', { level: 2 }) ? 'bg-indigo-600/20 text-indigo-400' : 'text-zinc-400'}`}
            title="Heading 2"
          >
            <Heading2 className="h-4 w-4" />
          </button>
          <button
            onClick={() => editor.chain().focus().setParagraph().run()}
            className={`p-2 rounded-lg cursor-pointer hover:bg-zinc-800 transition pointer-events-auto ${editor.isActive('paragraph') ? 'bg-indigo-600/20 text-indigo-400' : 'text-zinc-400'}`}
            title="Paragraph"
          >
            <Type className="h-4 w-4" />
          </button>

          <span className="h-4 w-px bg-zinc-800 mx-1" />

          <button
            onClick={() => editor.chain().focus().toggleBulletList().run()}
            className={`p-2 rounded-lg cursor-pointer hover:bg-zinc-800 transition pointer-events-auto ${editor.isActive('bulletList') ? 'bg-indigo-600/20 text-indigo-400' : 'text-zinc-400'}`}
            title="Bullet List"
          >
            <List className="h-4 w-4" />
          </button>
          <button
            onClick={() => editor.chain().focus().toggleOrderedList().run()}
            className={`p-2 rounded-lg cursor-pointer hover:bg-zinc-800 transition pointer-events-auto ${editor.isActive('orderedList') ? 'bg-indigo-600/20 text-indigo-400' : 'text-zinc-400'}`}
            title="Ordered List"
          >
            <ListOrdered className="h-4 w-4" />
          </button>

          <span className="h-4 w-px bg-zinc-800 mx-1 ml-auto" />

          <button
            onClick={triggerAutocomplete}
            disabled={aiLoading}
            className="px-3 py-1.5 bg-indigo-600/10 border border-indigo-500/20 text-indigo-400 rounded-lg text-xs font-semibold flex items-center gap-1 hover:bg-indigo-600 hover:text-white transition cursor-pointer disabled:opacity-50 pointer-events-auto"
            title="AI inline autocomplete. Keyboard shortcut: Alt+A"
          >
            {aiLoading ? <RefreshCw className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
            <span>AI Complete</span>
          </button>
        </div>
      )}

      {/* Editor Content Area */}
      <div
        className="relative border border-zinc-850 bg-[#0c0c0e]/30 rounded-2xl shadow-xl min-h-[500px] cursor-text"
        onClick={() => {
          if (role !== 'VIEWER') {
            editor?.chain().focus().run();
          }
        }}
      >
        {role === 'VIEWER' && (
          <div className="absolute top-4 right-4 bg-zinc-850 text-zinc-400 border border-zinc-800 rounded-lg px-2.5 py-1 text-xs font-semibold z-10 pointer-events-none">
            Read Only (Viewer)
          </div>
        )}

        <EditorContent 
          editor={editor} 
          className="editor-content prose prose-invert prose-indigo max-w-none p-6 md:p-8 min-h-[480px] focus:outline-none pointer-events-auto relative z-10"
        />

        {/* AI Autocomplete suggestion overlay */}
        {aiSuggestion && (
          <div className="absolute bottom-4 left-4 right-4 p-3 bg-zinc-900 border border-indigo-500/20 rounded-xl flex items-center justify-between text-xs animate-in fade-in slide-in-from-bottom-2 pointer-events-none">
            <span className="text-zinc-300 font-medium">
              <span className="text-indigo-400 font-bold">AI Suggestion:</span> {aiSuggestion}
            </span>
            <span className="text-[10px] font-semibold text-zinc-500 border border-zinc-800 px-2 py-0.5 rounded-md bg-zinc-950">
              Press <kbd className="font-bold text-zinc-400">Tab</kbd> to insert
            </span>
          </div>
        )}
      </div>

      {/* Shortcuts / Hint line */}
      {role !== 'VIEWER' && (
        <div className="flex items-center justify-between text-[11px] text-zinc-650 px-2">
          <span>Collaboration changes are committed instantly to browser disk.</span>
          <span className="hidden sm:inline">Press <kbd className="px-1.5 py-0.5 bg-zinc-900 border border-zinc-800 rounded">Alt + A</kbd> anywhere to trigger AI autocomplete.</span>
        </div>
      )}
    </div>
  );
}
