import { NextRequest, NextResponse } from 'next/server';
import { dbConnect } from '@/lib/db';
import { DocumentModel } from '@/lib/models';
import { verifyJWT } from '@/lib/auth';
import * as Y from 'yjs';

// Helper to get current authenticated user
async function getAuthUser(req: NextRequest) {
  const token = req.cookies.get('token')?.value;
  if (!token) return null;
  return verifyJWT(token);
}

export async function GET(req: NextRequest) {
  try {
    await dbConnect();
    const user = await getAuthUser(req);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Scoped query: Only return documents where this user is a collaborator
    const documents = await DocumentModel.find({
      'collaborators.userId': user.userId
    }).sort({ updatedAt: -1 });

    const formattedDocs = documents.map(doc => {
      const userCollab = doc.collaborators.find(
        (c: { userId: { toString: () => string; }; }) => c.userId.toString() === user.userId
      );
      return {
        id: doc._id,
        title: doc.title,
        updatedAt: doc.updatedAt,
        createdAt: doc.createdAt,
        role: userCollab ? userCollab.role : 'VIEWER'
      };
    });

    return NextResponse.json({ documents: formattedDocs });
  } catch (error) {
    console.error('List documents error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    await dbConnect();
    const user = await getAuthUser(req);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { title } = await req.json().catch(() => ({ title: 'Untitled Document' }));
    
    // Initialize an empty Yjs document state
    const ydoc = new Y.Doc();
    const initialStateUpdate = Y.encodeStateAsUpdate(ydoc);
    const contentBuffer = Buffer.from(initialStateUpdate);

    const newDoc = await DocumentModel.create({
      title: title || 'Untitled Document',
      contentState: contentBuffer,
      collaborators: [{
        userId: user.userId,
        role: 'OWNER'
      }]
    });

    return NextResponse.json({
      document: {
        id: newDoc._id,
        title: newDoc.title,
        role: 'OWNER',
        updatedAt: newDoc.updatedAt
      }
    });
  } catch (error) {
    console.error('Create document error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
