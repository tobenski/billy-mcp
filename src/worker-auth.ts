/** Identity supplied by Cloudflare Access, not by client-controlled headers. */
export interface AccessContext {
  access?: {
    getIdentity(): Promise<{ email?: string } | null | undefined>;
  };
}

export async function isAllowed(context: AccessContext, emailList: string | undefined): Promise<boolean> {
  if (!context.access || !emailList) return false;
  const allowed = new Set(emailList.split(',').map(email => email.trim().toLowerCase()).filter(Boolean));
  if (allowed.size === 0) return false;
  try {
    const identity = await context.access.getIdentity();
    const email = identity?.email?.trim().toLowerCase();
    return Boolean(email && allowed.has(email));
  } catch {
    return false;
  }
}

/** MCP HTTP requests with a browser Origin must come from this same origin. */
export function hasAllowedOrigin(request: Request): boolean {
  const origin = request.headers.get('Origin');
  if (origin === null) return true;
  try {
    const parsed = new URL(origin);
    return (parsed.protocol === 'https:' || parsed.protocol === 'http:') &&
      origin === parsed.origin && origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}
