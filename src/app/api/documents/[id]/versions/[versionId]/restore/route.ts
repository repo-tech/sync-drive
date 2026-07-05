import { NextRequest, NextResponse } from 'next/server';
import { dbConnect } from '@/lib/db';
import { DocumentModel, Version } from '@/lib/models';
import { verifyJWT } from '@/lib/auth';
import * as Y from 'yjs';

async function getAuthUser(req: NextRequest) {
  const token = req.cookies.get('token')?.value;
  if (!token) return null;
  return verifyJWT(token);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; versionId: string }> }
) {
  try {
    await dbConnect();
    const user = await getAuthUser(req);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { id, versionId } = await params;
    const document = await DocumentModel.findById(id);
    if (!document) return NextResponse.json({ error: 'Document not found' }, { status: 404 });

    // Authorization: Only OWNER and EDITOR can restore rollbacks
    const userCollab = document.collaborators.find(
      (c: any) => c.userId.toString() === user.userId
    );
    if (!userCollab) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    if (userCollab.role === 'VIEWER') {
      return NextResponse.json({ error: 'Forbidden: Viewers cannot restore versions' }, { status: 403 });
    }

    const version = await Version.findOne({ _id: versionId, documentId: id });
    if (!version) {
      return NextResponse.json({ error: 'Version snapshot not found' }, { status: 404 });
    }

    const currentYdoc = new Y.Doc();
    const snapshotYdoc = new Y.Doc();

    Y.applyUpdate(currentYdoc, new Uint8Array(document.contentState));
    Y.applyUpdate(snapshotYdoc, new Uint8Array(version.stateData));

    const currentFragment = currentYdoc.getXmlFragment('default');
    const snapshotFragment = snapshotYdoc.getXmlFragment('default');

    currentYdoc.transact(() => {
      if (currentFragment.length > 0) {
        currentFragment.delete(0, currentFragment.length);
      }

      const restoredNodes = snapshotFragment
        .toArray()
        .map((node) => node.clone())
        .filter((node): node is Y.XmlElement | Y.XmlText => (
          node instanceof Y.XmlElement || node instanceof Y.XmlText
        ));

      if (restoredNodes.length > 0) {
        currentFragment.insert(0, restoredNodes);
      }
    }, 'version-restore');

    document.contentState = Buffer.from(Y.encodeStateAsUpdate(currentYdoc));
    document.updatedAt = new Date();
    await document.save();

    return NextResponse.json({
      success: true,
      message: `Document restored successfully to version: ${version.name}`
    });
  } catch (error) {
    console.error('Restore version error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
