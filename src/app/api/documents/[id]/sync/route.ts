import { NextRequest, NextResponse } from 'next/server';
import { dbConnect } from '@/lib/db';
import { DocumentModel } from '@/lib/models';
import { verifyJWT } from '@/lib/auth';
import { base64ToUint8Array, uint8ArrayToBase64 } from '@/lib/binary';
import * as Y from 'yjs';

// Max payload limit of 2MB to prevent out-of-memory (OOM) attacks
const MAX_PAYLOAD_SIZE = 2 * 1024 * 1024; // 2MB

async function getAuthUser(req: NextRequest) {
  const token = req.cookies.get('token')?.value;
  if (!token) return null;
  return verifyJWT(token);
}

// GET: Fetch remote updates that client is missing (for polling/initial load)
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await dbConnect();
    const user = await getAuthUser(req);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { id } = await params;
    const document = await DocumentModel.findById(id);

    if (!document) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 });
    }

    // Role check: Must be a collaborator (Owner, Editor, or Viewer)
    const userCollab = document.collaborators.find(
      (c: any) => c.userId.toString() === user.userId
    );
    if (!userCollab) {
      return NextResponse.json({ error: 'Forbidden: Access denied' }, { status: 403 });
    }

    const stateVectorParam = req.nextUrl.searchParams.get('stateVector');

    if (stateVectorParam) {
      try {
        const clientStateVector = base64ToUint8Array(stateVectorParam);
        
        // Instantiate server Yjs doc and apply server state
        const serverYdoc = new Y.Doc();
        Y.applyUpdate(serverYdoc, new Uint8Array(document.contentState));

        // Generate updates that client is missing
        const missingUpdate = Y.encodeStateAsUpdate(serverYdoc, clientStateVector);
        
        return NextResponse.json({
          serverUpdate: uint8ArrayToBase64(missingUpdate)
        });
      } catch (err) {
        console.error('Yjs stateVector decoding/merge failed:', err);
        return NextResponse.json({ error: 'Malformed state vector' }, { status: 400 });
      }
    }

    // If no state vector is provided, return the full current state
    return NextResponse.json({
      serverUpdate: uint8ArrayToBase64(new Uint8Array(document.contentState))
    });
  } catch (error) {
    console.error('Fetch sync error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// POST: Push client update to server and merge (Deterministic Conflict Resolution)
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    // 1. Guard size to prevent OOM
    const contentLength = parseInt(req.headers.get('content-length') || '0', 10);
    if (contentLength > MAX_PAYLOAD_SIZE) {
      return NextResponse.json({ error: 'Payload too large' }, { status: 413 });
    }

    await dbConnect();
    const user = await getAuthUser(req);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { id } = await params;
    const body = await req.json().catch(() => null);
    if (!body || !body.updateData) {
      return NextResponse.json({ error: 'Missing sync payload' }, { status: 400 });
    }

    let document = await DocumentModel.findById(id);
    
    // 2. Authorization check or auto-create if document was created offline
    if (!document) {
      // If the document doesn't exist on the server, it was created offline by this client.
      // We will initialize it on the server with the user as OWNER.
      try {
        const clientUpdate = base64ToUint8Array(body.updateData);
        const serverYdoc = new Y.Doc();
        Y.applyUpdate(serverYdoc, clientUpdate);
        const initialBuffer = Buffer.from(Y.encodeStateAsUpdate(serverYdoc));

        document = await DocumentModel.create({
          _id: id,
          title: body.title || 'Offline Document',
          contentState: initialBuffer,
          collaborators: [{
            userId: user.userId,
            role: 'OWNER'
          }]
        });

        return NextResponse.json({
          success: true,
          message: 'Offline document synced and created on server'
        });
      } catch (err) {
        console.error('Failed to create offline document on server:', err);
        return NextResponse.json({ error: 'Failed to sync offline creation' }, { status: 400 });
      }
    }

    const userCollab = document.collaborators.find(
      (c: any) => c.userId.toString() === user.userId
    );
    if (!userCollab) {
      return NextResponse.json({ error: 'Forbidden: Access denied' }, { status: 403 });
    }
    if (userCollab.role === 'VIEWER') {
      return NextResponse.json({ error: 'Forbidden: Viewers cannot make edits' }, { status: 403 });
    }

    // 3. Perform CRDT merge (mathematically deterministic)
    try {
      const clientUpdate = base64ToUint8Array(body.updateData);
      
      const serverYdoc = new Y.Doc();
      // Apply current server state
      Y.applyUpdate(serverYdoc, new Uint8Array(document.contentState));
      // Apply incoming client update
      Y.applyUpdate(serverYdoc, clientUpdate);

      // Re-encode merged state to write back
      const mergedState = Y.encodeStateAsUpdate(serverYdoc);
      document.contentState = Buffer.from(mergedState);
      
      // Update timestamps
      document.updatedAt = new Date();
      await document.save();

      // If client requested updates they might have missed
      let serverUpdate = '';
      if (body.clientStateVector) {
        const clientVector = base64ToUint8Array(body.clientStateVector);
        const diff = Y.encodeStateAsUpdate(serverYdoc, clientVector);
        serverUpdate = uint8ArrayToBase64(diff);
      }

      return NextResponse.json({
        success: true,
        serverUpdate: serverUpdate || undefined
      });
    } catch (err) {
      console.error('CRDT Merge failed: possibly corrupted update data.', err);
      return NextResponse.json({ error: 'Corrupted update data' }, { status: 400 });
    }
  } catch (error) {
    console.error('Sync push error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
