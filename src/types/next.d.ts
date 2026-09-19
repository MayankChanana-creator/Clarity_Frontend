declare module 'next/server' {
  export class NextRequest extends Request {
    nextUrl: URL;
    cookies: {
      get(name: string): { value: string; name: string } | undefined;
      getAll(): { value: string; name: string }[];
      has(name: string): boolean;
      set(name: string, value: string, options?: any): void;
      delete(name: string): void;
    };
  }

  export class NextResponse extends Response {
    cookies: {
      get(name: string): { value: string; name: string } | undefined;
      set(name: string, value: string, options?: any): void;
      delete(name: string): void;
    };
    static json(data: any, init?: ResponseInit): NextResponse;
    static redirect(url: string | URL, init?: number | ResponseInit): NextResponse;
    static next(): NextResponse;
  }
}
