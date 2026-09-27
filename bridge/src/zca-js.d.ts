// The slice of zca-js the bridge uses, typed by hand.
//
// zca-js is an unofficial, reverse-engineered Zalo client, and its API moves.
// These declarations are what zalo-zca.ts is written against, written from
// the library's documentation rather than from an installed copy - nothing in
// this repo installs it. When `npm install` runs on the device, check these
// against node_modules/zca-js (its own .d.ts files take precedence) and fix
// zalo-zca.ts where they differ. See README.md, "First run".

declare module 'zca-js' {
  export enum ThreadType {
    User = 0,
    Group = 1,
  }

  export interface Credentials {
    cookie: unknown;
    imei: string;
    userAgent: string;
  }

  export interface Message {
    type: ThreadType;
    threadId: string;
    isSelf: boolean;
    data: {
      msgId: string | number;
      uidFrom: string;
      content: unknown;
    };
  }

  export interface API {
    listener: {
      on(event: 'message', cb: (message: Message) => void): void;
      on(event: 'error' | 'closed', cb: (...args: unknown[]) => void): void;
      start(): void;
      stop(): void;
    };
    sendMessage(
      message: string | { msg: string },
      threadId: string,
      type?: ThreadType,
    ): Promise<{ message?: { msgId?: string | number } | null } | unknown>;
    findUser(phone: string): Promise<{ uid?: string } | null | undefined>;
  }

  export class Zalo {
    constructor(options?: { selfListen?: boolean; checkUpdate?: boolean; logging?: boolean });
    login(credentials: Credentials): Promise<API>;
    loginQR(options?: unknown, callback?: (event: unknown) => unknown): Promise<API>;
  }
}
