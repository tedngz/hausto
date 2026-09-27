// ZaloClient over zca-js, the unofficial Zalo library.
//
// Written against zca-js.d.ts, checked against zca-js 2.2.0. The adapter is
// deliberately thin so a change in the library is a change here and nowhere
// else.

import { readFileSync } from 'node:fs';
import { Zalo, ThreadType, type API, type Credentials, type Message } from 'zca-js';
import type { ZaloClient, IncomingZalo } from './zalo.ts';
import { toLocalPhone, textOf } from './zalo-text.ts';

export class ZcaClient implements ZaloClient {
  private api: API | null = null;

  constructor(private readonly credentialsPath: string) {}

  async start(onMessage: (m: IncomingZalo) => void): Promise<void> {
    const credentials = JSON.parse(readFileSync(this.credentialsPath, 'utf8')) as Credentials;
    const zalo = new Zalo({ selfListen: false, checkUpdate: false, logging: false });
    this.api = await zalo.login(credentials);
    this.api.listener.on('message', (m: Message) => {
      // One-to-one only, and never our own messages: an agent answering us.
      if (m.isSelf || m.type !== ThreadType.User) return;
      const text = textOf(m.data.content);
      if (!text) return;
      onMessage({ fromUid: String(m.data.uidFrom ?? m.threadId), text, msgId: String(m.data.msgId) });
    });
    this.api.listener.on('error', (...args: unknown[]) => console.error('[zalo] listener error', ...args));
    // Reconnect by itself when Zalo drops the socket, rather than going deaf
    // until the next restart.
    this.api.listener.start({ retryOnClose: true });
  }

  private need(): API {
    if (!this.api) throw new Error('Zalo client not started');
    return this.api;
  }

  async resolvePhone(phoneE164: string): Promise<string | null> {
    const user = await this.need().findUser(toLocalPhone(phoneE164));
    return user?.uid ? String(user.uid) : null;
  }

  async send(uid: string, text: string): Promise<{ providerId?: string }> {
    const res = await this.need().sendMessage(text, uid, ThreadType.User) as { message?: { msgId?: string | number } | null };
    const id = res?.message?.msgId;
    return id != null ? { providerId: String(id) } : {};
  }

  async stop(): Promise<void> {
    this.api?.listener.stop();
  }
}
