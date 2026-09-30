// The slice of zca-js the bridge uses, typed by hand.
//
// zca-js is an unofficial, reverse-engineered Zalo client, and its API moves.
// These declarations are what zalo-zca.ts is written against. Checked against
// the installed zca-js 2.2.0 (dist/zalo.d.ts, apis/findUser, apis/sendMessage,
// apis/listen, models/Message) on 2026-09-27; the version is pinned to ~2.2.0
// in package.json and locked in package-lock.json. Before moving to a new
// version, check these again.

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
      /** 'webchat' for text, 'chat.photo' for a picture, and others. */
      msgType?: string;
      content: unknown;
    };
  }

  export interface API {
    listener: {
      on(event: 'message', cb: (message: Message) => void): void;
      on(event: 'error' | 'closed', cb: (...args: unknown[]) => void): void;
      start(options?: { retryOnClose?: boolean }): void;
      stop(): void;
    };
    sendMessage(
      message: string | { msg: string },
      threadId: string,
      type?: ThreadType,
    ): Promise<{ message?: { msgId?: string | number } | null } | unknown>;
    findUser(phone: string): Promise<{ uid?: string } | null | undefined>;
  }

  export enum LoginQRCallbackEventType {
    QRCodeGenerated = 0,
    QRCodeExpired = 1,
    QRCodeScanned = 2,
    QRCodeDeclined = 3,
    GotLoginInfo = 4,
  }

  type QRActions = { retry: () => unknown; abort: () => unknown };
  export type LoginQRCallbackEvent =
    | { type: LoginQRCallbackEventType.QRCodeGenerated; data: { code: string; image: string };
        actions: QRActions & { saveToFile: (qrPath?: string) => Promise<unknown> } }
    | { type: LoginQRCallbackEventType.QRCodeExpired; data: null; actions: QRActions }
    | { type: LoginQRCallbackEventType.QRCodeScanned; data: { avatar: string; display_name: string }; actions: QRActions }
    | { type: LoginQRCallbackEventType.QRCodeDeclined; data: { code: string }; actions: QRActions }
    | { type: LoginQRCallbackEventType.GotLoginInfo; data: { cookie: unknown[]; imei: string; userAgent: string }; actions: null };

  export class Zalo {
    constructor(options?: { selfListen?: boolean; checkUpdate?: boolean; logging?: boolean });
    login(credentials: Credentials): Promise<API>;
    loginQR(
      options?: { userAgent?: string; language?: string; qrPath?: string },
      callback?: (event: LoginQRCallbackEvent) => unknown,
    ): Promise<API>;
  }
}
