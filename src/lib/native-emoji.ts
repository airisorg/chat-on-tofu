// Keep the existing short reaction budget. Tests verify that every native
// variant in the shared picker fits it, including flags, keycaps and tones.
export const MAX_REACTION_LENGTH = 20;

// Accept one complete emoji sequence: a regional flag, a keycap, a tagged
// subdivision flag, or pictographs joined with ZWJ and optional skin tones.
// A modifier must follow an actual modifier base, never arbitrary text.
const sequence =
  /^(?:\p{Regional_Indicator}{2}|[#*0-9]\uFE0F?\u20E3|\u{1F3F4}[\u{E0020}-\u{E007E}]+\u{E007F}|(?:\p{Emoji_Modifier_Base}\uFE0F?\p{Emoji_Modifier}|\p{Extended_Pictographic}\uFE0F?)(?:\u200D(?:\p{Emoji_Modifier_Base}\uFE0F?\p{Emoji_Modifier}|\p{Extended_Pictographic}\uFE0F?))*)$/u;

export function isNativeEmoji(value: unknown): value is string {
  if (typeof value !== 'string' || !value.length || value.length > MAX_REACTION_LENGTH)
    return false;
  // JavaScript's `$` also matches before a final newline. Comparing the full
  // match rejects that suffix as well as mixed text and multiple reactions.
  return sequence.exec(value)?.[0] === value;
}
