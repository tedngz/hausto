import { describe, expect, it } from 'vitest';
import { splitEmbeddedBlocks } from './chat-reply-blocks.ts';

describe('splitEmbeddedBlocks', () => {
  it('lifts a followups array written after the prose', () => {
    const text = 'The listing does not mention utilities, so those are worth asking the agent about if you tap "Request viewing".\n' +
      '[{"type":"followups","suggestions":["[Ask] What should I check at a viewing of this apartment?","[Ask] Is District 4 a good area for families?","[Search] Two-bedroom apartments in District 4 under 22M"]}]';
    const { prose, blocks } = splitEmbeddedBlocks(text);
    expect(prose).toBe('The listing does not mention utilities, so those are worth asking the agent about if you tap "Request viewing".');
    expect(blocks).toEqual([{
      type: 'followups',
      suggestions: [
        '[Ask] What should I check at a viewing of this apartment?',
        '[Ask] Is District 4 a good area for families?',
        '[Search] Two-bedroom apartments in District 4 under 22M',
      ],
    }]);
  });

  it('lifts a fenced blocks object and a bare block', () => {
    const text = 'Answer.\n```json\n{"blocks":[{"type":"followups","suggestions":["[Ask] a"]}]}\n```\nMore. {"type":"district","district":"D4"}';
    const { prose, blocks } = splitEmbeddedBlocks(text);
    expect(prose).toBe('Answer.\n\nMore.');
    expect(blocks.map((b) => b.type)).toEqual(['followups', 'district']);
  });

  it('copes with brackets and quotes inside strings', () => {
    const text = 'Hi [there].\n[{"type":"followups","suggestions":["[Ask] Is \\"]}\\" ok?"]}]';
    const { prose, blocks } = splitEmbeddedBlocks(text);
    expect(prose).toBe('Hi [there].');
    expect(blocks[0].suggestions).toEqual(['[Ask] Is "]}" ok?']);
  });

  it('leaves prose, unknown types and broken JSON alone', () => {
    for (const text of [
      'Just an answer with [brackets] and {braces}.',
      'See [{"type":"listing","id":1}]',
      'Cut off [{"type":"followups","suggestions":["[Ask] a"',
    ]) {
      expect(splitEmbeddedBlocks(text)).toEqual({ prose: text, blocks: [] });
    }
  });
});
