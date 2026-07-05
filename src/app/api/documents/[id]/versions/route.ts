import { NextRequest, NextResponse } from 'next/server';
import { dbConnect } from '@/lib/db';
import { DocumentModel, Version } from '@/lib/models';
import { verifyJWT } from '@/lib/auth';

async function getAuthUser(req: NextRequest) {
  const token = req.cookies.get('token')?.value;
  if (!token) return null;
  return verifyJWT(token);
}

// GET: List all versions/snapshots for a document
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await dbConnect();
    const user = await getAuthUser(req);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { id } = await params;
    const document = await DocumentModel.findById(id);
    if (!document) return NextResponse.json({ error: 'Document not found' }, { status: 404 });

    // Strict Scope check
    const userCollab = document.collaborators.find(
      (c: any) => c.userId.toString() === user.userId
    );
    if (!userCollab) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const versions = await Version.find({ documentId: id })
      .populate('createdById', 'name')
      .sort({ createdAt: -1 });

    const formattedVersions = versions.map(v => ({
      id: v._id,
      name: v.name,
      description: v.description,
      createdAt: v.createdAt,
      createdBy: (v.createdById as any)?.name || 'Unknown User'
    }));

    return NextResponse.json({ versions: formattedVersions });
  } catch (error) {
    console.error('List versions error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// POST: Capture a new version snapshot
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await dbConnect();
    const user = await getAuthUser(req);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { id } = await params;
    const { name, description } = await req.json();

    if (!name) {
      return NextResponse.json({ error: 'Version name is required' }, { status: 400 });
    }

    const document = await DocumentModel.findById(id);
    if (!document) return NextResponse.json({ error: 'Document not found' }, { status: 404 });

    // Authorization check: Only OWNER or EDITOR can capture snapshots
    const userCollab = document.collaborators.find(
      (c: any) => c.userId.toString() === user.userId
    );
    if (!userCollab) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    if (userCollab.role === 'VIEWER') {
      return NextResponse.json({ error: 'Forbidden: Viewers cannot create snapshots' }, { status: 403 });
    }

    // Capture the current contentState binary buffer
    const newVersion = await Version.create({
      documentId: id,
      name,
      description,
      stateData: document.contentState,
      createdById: user.userId
    });

    return NextResponse.json({
      version: {
        id: newVersion._id,
        name: newVersion.name,
        description: newVersion.description,
        createdAt: newVersion.createdAt
      }
    });
  } catch (error) {
    console.error('Create version error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
