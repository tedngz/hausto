import { describe, it, expect } from 'vitest';
import { classifyIntent, needsOperator, fold, INTENTS, looksLikeRefinement } from './intent.ts';

const intentOf = (s: string) => classifyIntent(s).intent;

describe('folding', () => {
  it('folds Vietnamese to base letters rather than deleting them', () => {
    // SPEC §0 records what deleting them costs: `Bình Thạnh` became `bnh thnh`
    // and could not be matched against anything.
    expect(fold('Đồng ý')).toBe('dong y');
    expect(fold('Được không?')).toBe('duoc khong?');
    expect(fold('  HỦY  ')).toBe('huy');
  });
});

describe('confirmation', () => {
  it('reads the ways a renter says yes', () => {
    for (const s of ['yes', 'Y', 'ok', 'OK', 'Oke', 'confirmed', 'đồng ý', 'Được', 'vâng', 'chốt']) {
      expect(intentOf(s), s).toBe('CONFIRM');
    }
  });

  it('reads a yes with something after it', () => {
    expect(intentOf('yes please, see you then')).toBe('CONFIRM');
    expect(intentOf('Được ạ, em sẽ đến')).toBe('CONFIRM');
  });

  it('treats "yes, what time?" as a confirmation, not a question', () => {
    // Routing this as a question would leave the viewings unheld while someone
    // answers a detail the itinerary already covered.
    expect(intentOf('yes, what time again?')).toBe('CONFIRM');
  });
});

describe('decline', () => {
  it('reads the ways a renter says no', () => {
    for (const s of ['no', 'No', 'nope', 'cancel', 'Không', 'ko', 'thôi']) {
      expect(intentOf(s), s).toBe('DECLINE');
    }
  });

  it('reads a renter who has already found somewhere', () => {
    expect(intentOf('thanks but I found a place')).toBe('DECLINE');
    expect(intentOf('em thuê rồi ạ')).toBe('DECLINE');
  });
});

describe('reschedule', () => {
  it('beats a bare yes in the same message', () => {
    // "ok but can we move it" is not a confirmation, and treating it as one
    // sends the renter to a viewing they said they could not make.
    expect(intentOf('ok but can we move it to Saturday')).toBe('RESCHEDULE');
    expect(intentOf('Được nhưng đổi giờ khác được không')).toBe('RESCHEDULE');
  });

  it('reads the common phrasings', () => {
    for (const s of ['can we reschedule', 'another time please', 'a bit later?', 'đổi lịch nhé']) {
      expect(intentOf(s), s).toBe('RESCHEDULE');
    }
  });
});

describe('opt-out', () => {
  it('wins over everything, because it is an instruction not a preference', () => {
    expect(intentOf('STOP')).toBe('OPT_OUT');
    expect(intentOf('huỷ')).toBe('OPT_OUT');
    expect(intentOf('Dừng')).toBe('OPT_OUT');
    expect(intentOf('không nhận tin nữa')).toBe('OPT_OUT');
  });

  it('tells "dừng" from "đúng", which folding cannot', () => {
    // Both fold to "dung". `dừng` is stop, `đúng` is "that's right" - so
    // opt-out is matched on the RAW text, before any folding happens. Getting
    // this wrong means either ignoring a legal instruction or opting out a
    // renter who just agreed.
    expect(intentOf('dừng')).toBe('OPT_OUT');
    expect(intentOf('đúng')).not.toBe('OPT_OUT');
    expect(intentOf('đúng rồi ạ')).not.toBe('OPT_OUT');
  });

  it('does not fire on a message that merely contains the word', () => {
    expect(intentOf('stop by at 3?')).not.toBe('OPT_OUT');
  });
});

describe('questions and the unknown', () => {
  it('reads an interrogative', () => {
    for (const s of ['how far is it from the centre', 'bao nhiêu tiền cọc?', 'can I bring my dog?']) {
      expect(intentOf(s), s).toBe('QUESTION');
    }
  });

  it('falls through to UNKNOWN rather than guessing', () => {
    // The escape hatch is the point. A wrong automated reply inside a billed
    // window costs more than an operator reading one line.
    //
    // ("the third one" used to be asserted here. It now classifies as
    // SELECTION, which is the whole point of adding that intent - the old
    // assertion documented the absence of a feature, not a rule.)
    expect(intentOf('👍')).toBe('UNKNOWN');
    expect(intentOf('sounds about right i suppose')).toBe('UNKNOWN');
    expect(intentOf('')).toBe('UNKNOWN');
  });
});

describe('routing', () => {
  it('finishes on its own only for a confirmation or an opt-out', () => {
    expect(needsOperator('CONFIRM')).toBe(false);
    expect(needsOperator('OPT_OUT')).toBe(false);
    for (const i of ['DECLINE', 'RESCHEDULE', 'QUESTION', 'UNKNOWN'] as const) {
      expect(needsOperator(i), i).toBe(true);
    }
  });

  it('classifies every message into the closed set', () => {
    for (const s of ['yes', 'no', 'reschedule', 'STOP', 'why?', 'asdfgh']) {
      expect(INTENTS).toContain(intentOf(s));
    }
  });
});

describe('picking from a list', () => {
  it('reads a numbered reply as a selection', () => {
    for (const s of ['2', '1 and 3', 'the second one', 'number 2 please']) {
      expect(intentOf(s), s).toBe('SELECTION');
    }
  });

  it('does not turn a time into a listing number', () => {
    // "can we move it to 3pm" is a reschedule. Reading the 3 as a pick would
    // arrange a viewing instead of moving one.
    expect(intentOf('can we move it to 3pm')).toBe('RESCHEDULE');
    expect(intentOf('another time please')).toBe('RESCHEDULE');
  });

  it('leaves a yes a confirmation, not a pick', () => {
    expect(intentOf('yes')).toBe('CONFIRM');
    expect(intentOf('ok')).toBe('CONFIRM');
  });

  it('sends a question about a listing to a person', () => {
    expect(intentOf('is 2 still available and what floor')).toBe('QUESTION');
  });
});

describe('searching, which must not swallow every question', () => {
  it('reads a described want as a search', () => {
    for (const s of [
      'do you have anything in district 2 under 15tr',
      'looking for a 2 bedroom in thao dien',
      'show me something cheaper',
      'tìm căn 2 phòng ngủ',
      'what else do you have',
    ]) {
      expect(intentOf(s), s).toBe('SEARCH');
    }
  });

  it('does NOT turn a question about a listing into a search', () => {
    // The whole reason this intent is narrow. Answering "what floor is it on"
    // with three unrelated flats is worse than not answering.
    expect(intentOf('what floor is it on')).toBe('QUESTION');
    expect(intentOf('is there parking')).toBe('QUESTION');
    expect(intentOf('can I bring my dog?')).toBe('QUESTION');
  });

  it('does not read a budget mentioned in passing as a search', () => {
    // A long message about a price we already agreed is not a request to go
    // looking.
    const passing = 'we agreed 15tr last week for the thao dien place, has that changed at all since then';
    expect(passing.length).toBeGreaterThan(60);
    expect(intentOf(passing)).not.toBe('SEARCH');
  });

  it('still lets the earlier intents win', () => {
    expect(intentOf('yes')).toBe('CONFIRM');
    expect(intentOf('2')).toBe('SELECTION');
    expect(intentOf('can we move it to another time')).toBe('RESCHEDULE');
    expect(intentOf('STOP')).toBe('OPT_OUT');
  });
});

describe('refining a search (looksLikeRefinement)', () => {
  it('reads an area, a size, a budget or a comparison', () => {
    for (const s of [
      'what about district 7?', 'any in Quận 2?', 'q7', 'D2 instead', 'Thảo Điền?', 'binh thanh',
      '3 bedrooms', '2br', '2 phòng ngủ', 'a studio', 'under 15tr', 'something cheaper', 'rẻ hơn',
    ]) {
      expect(looksLikeRefinement(s), s).toBe(true);
    }
  });

  it('does not read a question about a place', () => {
    for (const s of ['is there parking?', 'can I bring my dog', 'what floor is it on', 'thanks!', 'when can I see it']) {
      expect(looksLikeRefinement(s), s).toBe(false);
    }
  });
});
