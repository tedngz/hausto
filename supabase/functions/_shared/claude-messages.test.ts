import { describe, it, expect } from 'vitest';
import { toClaude, parseJsonReply, MAX_IMAGE_BYTES } from './claude-messages.ts';

const png = (chars: number) => `data:image/png;base64,${'A'.repeat(chars)}`;

describe('toClaude', () => {
  it('lifts system turns out of the conversation', () => {
    const r = toClaude([
      { role: 'system', content: 'Rules.' },
      { role: 'user', content: 'Hello' },
    ]);
    expect(r.system).toBe('Rules.');
    expect(r.messages).toEqual([{ role: 'user', content: 'Hello' }]);
  });

  it('starts on a user turn when a cut history begins with the assistant', () => {
    const r = toClaude([
      { role: 'system', content: 'Rules.' },
      { role: 'assistant', content: '{"blocks":[]}' },
      { role: 'user', content: '1BR in Thao Dien' },
    ]);
    expect(r.messages.map(m => m.role)).toEqual(['user']);
  });

  it('drops empty turns, which Claude rejects', () => {
    const r = toClaude([
      { role: 'user', content: 'a' },
      { role: 'assistant', content: '   ' },
      { role: 'user', content: 'b' },
    ]);
    expect(r.messages).toHaveLength(2);
  });

  it('turns data URLs into base64 image blocks and http URLs into url blocks', () => {
    const r = toClaude([{
      role: 'user',
      content: [
        { type: 'text', text: 'Look' },
        { type: 'image_url', image_url: { url: 'data:image/jpg;base64,AAAA', detail: 'low' } },
        { type: 'image_url', image_url: { url: 'https://cdn.example/x.jpg' } },
      ],
    }]);
    expect(r.messages[0].content).toEqual([
      { type: 'text', text: 'Look' },
      { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'AAAA' } },
      { type: 'image', source: { type: 'url', url: 'https://cdn.example/x.jpg' } },
    ]);
  });

  it('keeps image positions when an image cannot be sent', () => {
    const r = toClaude([{
      role: 'user',
      content: [
        { type: 'image_url', image_url: { url: 'data:image/heic;base64,AAAA' } },
        { type: 'image_url', image_url: { url: png(Math.ceil((MAX_IMAGE_BYTES * 4) / 3) + 4) } },
        { type: 'image_url', image_url: { url: png(8) } },
      ],
    }]);
    const blocks = r.messages[0].content as Array<{ type: string; text?: string }>;
    expect(blocks.map(b => b.type)).toEqual(['text', 'text', 'image']);
    expect(blocks[0].text).toContain('image/heic');
    expect(blocks[1].text).toContain('over 5 MB');
  });

  it('stops attaching images before the request size limit', () => {
    const big = png(4 * 1024 * 1024);
    const r = toClaude([{
      role: 'user',
      content: Array.from({ length: 8 }, () => ({ type: 'image_url' as const, image_url: { url: big } })),
    }]);
    const types = (r.messages[0].content as Array<{ type: string }>).map(b => b.type);
    expect(types.filter(t => t === 'image')).toHaveLength(6);
    expect(types.slice(6)).toEqual(['text', 'text']);
  });
});

describe('parseJsonReply', () => {
  it('reads bare JSON', () => {
    expect(parseJsonReply('{"a":1}')).toEqual({ a: 1 });
  });

  it('salvages a fenced or prefaced reply', () => {
    expect(parseJsonReply('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(parseJsonReply('Here it is: {"a":{"b":2}} hope that helps')).toEqual({ a: { b: 2 } });
  });

  it('throws when there is no object', () => {
    expect(() => parseJsonReply('sorry')).toThrow();
  });
});
