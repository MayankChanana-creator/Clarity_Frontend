export class NextRequest {
  nextUrl: URL;
  url: string;
  cookies: {
    get(name: string): { value: string; name: string } | undefined;
  };

  constructor(input: string | URL, _init?: any) {
    this.url = typeof input === 'string' ? input : input.toString();
    this.nextUrl = new URL(this.url);
    const cookieMap = new Map<string, string>();
    this.cookies = {
      get: (name: string) => {
        const val = cookieMap.get(name);
        return val !== undefined ? { name, value: val } : undefined;
      },
    };
  }
}

export class NextResponse extends Response {
  static json(data: any, init?: ResponseInit) {
    return new NextResponse(JSON.stringify(data), {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
    });
  }

  static redirect(url: string | URL, init?: number | ResponseInit) {
    const status = typeof init === 'number' ? init : (init?.status || 307);
    const headers = new Headers(typeof init === 'object' ? init?.headers : undefined);
    headers.set('location', url.toString());
    return new NextResponse(null, { status, headers });
  }

  static next() {
    return new NextResponse(null, { status: 200 });
  }
}
