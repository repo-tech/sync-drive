import { NextRequest, NextResponse } from 'next/server';
import { dbConnect } from '@/lib/db';
import { DocumentModel, User } from '@/lib/models';
import { verifyJWT } from '@/lib/auth';

async function getAuthUser(req: NextRequest) {
  const token = req.cookies.get('token')?.value;
  if (!token) return null;
  return verifyJWT(token);
}

// GET: Retrieve document details and collaborators (Scoped access)
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await dbConnect();
    const user = await getAuthUser(req);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { id } = await params;
    const document = await DocumentModel.findById(id).populate('collaborators.userId', 'name email');

    if (!document) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 });
    }

    // Strict ORM Scope Check
    const userCollab = document.collaborators.find(
      (c: any) => c.userId && c.userId._id.toString() === user.userId
    );

    if (!userCollab) {
      return NextResponse.json({ error: 'Forbidden: Access denied' }, { status: 403 });
    }

    return NextResponse.json({
      document: {
        id: document._id,
        title: document.title,
        updatedAt: document.updatedAt,
        role: userCollab.role,
        collaborators: document.collaborators.map((c: any) => ({
          userId: c.userId._id,
          name: c.userId.name,
          email: c.userId.email,
          role: c.role
        }))
      }
    });
  } catch (error) {
    console.error('Fetch document error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// PATCH: Update title or manage collaborators
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await dbConnect();
    const user = await getAuthUser(req);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { id } = await params;
    const body = await req.json();
    const document = await DocumentModel.findById(id);

    if (!document) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 });
    }

    // Role check
    const userCollab = document.collaborators.find(
      (c: any) => c.userId.toString() === user.userId
    );

    if (!userCollab) {
      return NextResponse.json({ error: 'Forbidden: Access denied' }, { status: 403 });
    }

    // Renaming Title: Requires OWNER or EDITOR
    if (body.title !== undefined) {
      if (userCollab.role === 'VIEWER') {
        return NextResponse.json({ error: 'Forbidden: Viewers cannot rename documents' }, { status: 403 });
      }
      document.title = body.title || 'Untitled Document';
    }

    // Sharing / Managing Collaborators: Requires OWNER
    if (body.shareEmail !== undefined && body.shareRole !== undefined) {
      if (userCollab.role !== 'OWNER') {
        return NextResponse.json({ error: 'Forbidden: Only owners can manage sharing' }, { status: 403 });
      }

      const targetUser = await User.findOne({ email: body.shareEmail.toLowerCase() });
      if (!targetUser) {
        return NextResponse.json({ error: 'User not found' }, { status: 404 });
      }

      // Check if already a collaborator
      const existingCollabIndex = document.collaborators.findIndex(
        (c: any) => c.userId.toString() === targetUser._id.toString()
      );

      if (existingCollabIndex > -1) {
        // Update role
        document.collaborators[existingCollabIndex].role = body.shareRole;
      } else {
        // Add new
        document.collaborators.push({
          userId: targetUser._id as any,
          role: body.shareRole
        });
      }
    }

    // Removing Collaborator: Requires OWNER
    if (body.removeUserId !== undefined) {
      if (userCollab.role !== 'OWNER') {
        return NextResponse.json({ error: 'Forbidden: Only owners can manage sharing' }, { status: 403 });
      }

      if (body.removeUserId === user.userId) {
        return NextResponse.json({ error: 'Cannot remove yourself as owner' }, { status: 400 });
      }

      document.collaborators = document.collaborators.filter(
        (c: any) => c.userId.toString() !== body.removeUserId
      );
    }

    await document.save();
    return NextResponse.json({ success: true, message: 'Document updated successfully' });
  } catch (error) {
    console.error('Update document error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// DELETE: Delete document
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await dbConnect();
    const user = await getAuthUser(req);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { id } = await params;
    const document = await DocumentModel.findById(id);

    if (!document) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 });
    }

    // Role check: Only OWNER can delete
    const userCollab = document.collaborators.find(
      (c: any) => c.userId.toString() === user.userId
    );

    if (!userCollab || userCollab.role !== 'OWNER') {
      return NextResponse.json({ error: 'Forbidden: Only owners can delete documents' }, { status: 403 });
    }

    await DocumentModel.findByIdAndDelete(id);
    return NextResponse.json({ success: true, message: 'Document deleted successfully' });
  } catch (error) {
    console.error('Delete document error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
