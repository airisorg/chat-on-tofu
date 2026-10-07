export const SAMPLE_MESSAGE = 'The first look is ready ✨';
export const PREVIEW_TEXT_LIMIT = 160;
export const PREVIEW_MESSAGE_LIMIT = 8;

export type PreviewMessage = {
  id: number;
  author: 'Maya' | 'You';
  text: string;
  reply?: boolean;
};
export type PreviewState = {
  messages: PreviewMessage[];
  draft: string;
  reacted: boolean;
  nextId: number;
  status: string;
};
export type PreviewAction =
  { type: 'draft'; text: string } | { type: 'send' } | { type: 'react' } | { type: 'reset' };

export function createPreviewState(): PreviewState {
  return {
    messages: [
      { id: 1, author: 'Maya', text: 'Ready to share the first look? ✨' },
      { id: 2, author: 'You', text: 'A fresh start for all of us.' },
    ],
    draft: '',
    reacted: false,
    nextId: 3,
    status: '',
  };
}

/** An ephemeral illustration: no account, storage, timers or transport. */
export function reducePreview(state: PreviewState, action: PreviewAction): PreviewState {
  switch (action.type) {
    case 'draft':
      return { ...state, draft: action.text.slice(0, PREVIEW_TEXT_LIMIT) };
    case 'send': {
      const text = state.draft.trim();
      if (!text) return state;
      const exchange: PreviewMessage[] = [
        { id: state.nextId, author: 'You', text },
        {
          id: state.nextId + 1,
          author: 'Maya',
          text: 'Perfect. One place for the next steps.',
          reply: true,
        },
      ];
      // Keep the sample with its reaction available; bound the remaining history.
      const recent = [...state.messages.slice(2), ...exchange].slice(-(PREVIEW_MESSAGE_LIMIT - 2));
      return {
        ...state,
        messages: [...state.messages.slice(0, 2), ...recent],
        draft: '',
        nextId: state.nextId + 2,
        status: 'Sample message added. An illustrative reply is shown below.',
      };
    }
    case 'react':
      return {
        ...state,
        reacted: !state.reacted,
        status: state.reacted
          ? 'Raised-hands reaction removed from the sample.'
          : 'Raised-hands reaction added to the sample.',
      };
    case 'reset':
      return { ...createPreviewState(), status: 'Sample conversation reset.' };
  }
}
