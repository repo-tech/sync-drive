import mongoose, { Schema, Document as MongooseDocument } from 'mongoose';

// User Interface
export interface IUser extends MongooseDocument {
  email: string;
  name: string;
  passwordHash: string;
  createdAt: Date;
}

// User Schema
const UserSchema = new Schema<IUser>({
  email: { type: String, required: true, unique: true, index: true },
  name: { type: String, required: true },
  passwordHash: { type: String, required: true },
  createdAt: { type: Date, default: Date.now }
});

// Collaborator interface
export interface ICollaborator {
  userId: mongoose.Types.ObjectId;
  role: 'OWNER' | 'EDITOR' | 'VIEWER';
}

// Document Interface
export interface IDocument extends MongooseDocument {
  title: string;
  contentState: Buffer;
  collaborators: ICollaborator[];
  createdAt: Date;
  updatedAt: Date;
}

// Document Schema
const DocumentSchema = new Schema<IDocument>({
  title: { type: String, required: true, default: 'Untitled Document' },
  contentState: { type: Buffer, required: true }, // Store Yjs updates binary
  collaborators: [{
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    role: { type: String, enum: ['OWNER', 'EDITOR', 'VIEWER'], required: true }
  }],
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
}, {
  timestamps: true
});

// Version Interface
export interface IVersion extends MongooseDocument {
  documentId: mongoose.Types.ObjectId;
  name: string;
  description?: string;
  stateData: Buffer; // Yjs binary snapshot
  createdById: mongoose.Types.ObjectId;
  createdAt: Date;
}

// Version Schema
const VersionSchema = new Schema<IVersion>({
  documentId: { type: Schema.Types.ObjectId, ref: 'Document', required: true, index: true },
  name: { type: String, required: true },
  description: { type: String },
  stateData: { type: Buffer, required: true },
  createdById: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  createdAt: { type: Date, default: Date.now }
});

// Prevent multi-model compilation errors in Next.js HMR
export const User = mongoose.models.User || mongoose.model<IUser>('User', UserSchema);
export const DocumentModel = mongoose.models.Document || mongoose.model<IDocument>('Document', DocumentSchema);
export const Version = mongoose.models.Version || mongoose.model<IVersion>('Version', VersionSchema);
