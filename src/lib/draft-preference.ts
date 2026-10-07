type DraftStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export const draftSavingKey = (owner: string) => `relay-draft-saving:${encodeURIComponent(owner)}`;
export const savedDraftsKey = (owner: string) => `relay-drafts:${owner}`;

// Existing accounts keep their current default. An explicit opt-out never
// restores saved drafts; active composer state is managed separately in memory.
export function readDraftSaving(owner: string, storage: Pick<Storage, 'getItem'>): boolean {
  try {
    return storage.getItem(draftSavingKey(owner)) !== 'off';
  } catch {
    return true;
  }
}

export function writeDraftSaving(owner: string, enabled: boolean, storage: DraftStorage) {
  let preferenceSaved = false,
    savedDraftsRemoved = false;
  const value = enabled ? 'on' : 'off';
  try {
    storage.setItem(draftSavingKey(owner), value);
    preferenceSaved = storage.getItem(draftSavingKey(owner)) === value;
  } catch {
    /* The current visit still honors the chosen preference. */
  }
  if (!enabled) {
    // Try removing private copies even if saving the preference failed.
    try {
      storage.removeItem(savedDraftsKey(owner));
      savedDraftsRemoved = storage.getItem(savedDraftsKey(owner)) === null;
    } catch {
      /* The UI must disclose that saved copies could not be cleared. */
    }
  }
  return { preferenceSaved, savedDraftsRemoved };
}
