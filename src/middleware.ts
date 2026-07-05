import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { jwtVerify } from 'jose';

const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-key-that-should-be-at-least-32-chars-long-in-prod';
const secret = new TextEncoder().encode(JWT_SECRET);

export async function middleware(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const token = request.cookies.get('token')?.value;

  const isPublicPage = path === '/login' || path === '/register';
  const isPublicApi = path.startsWith('/api/auth/login') || path.startsWith('/api/auth/register');

  if (isPublicPage || isPublicApi) {
    if (token) {
      try {
        await jwtVerify(token, secret);
        return NextResponse.redirect(new URL('/', request.url));
      } catch {
        // Token is invalid, let request proceed but clear token
        const res = NextResponse.next();
        res.cookies.delete('token');
        return res;
      }
    }
    return NextResponse.next();
  }

  const isProtectedPage = path === '/' || path.startsWith('/documents');
  const isProtectedApi = path.startsWith('/api/documents') || path.startsWith('/api/ai');

  if (isProtectedPage || isProtectedApi) {
    if (!token) {
      if (isProtectedApi) {
        return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
      }
      return NextResponse.redirect(new URL('/login', request.url));
    }

    try {
      await jwtVerify(token, secret);
      return NextResponse.next();
    } catch {
      if (isProtectedApi) {
        return NextResponse.json({ error: 'Invalid session' }, { status: 401 });
      }
      const response = NextResponse.redirect(new URL('/login', request.url));
      response.cookies.delete('token');
      return response;
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
