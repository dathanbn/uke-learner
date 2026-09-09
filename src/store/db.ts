import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import { DEFAULT_SETTINGS, type Card, type ReviewLog, type SessionSettings } from '../srs/types';

/**
 * Local-first storage. IndexedDB is the source of truth; no network call is ever in the
 * path of a practice session (CLAUDE.md invariant 7).
 *
 * Not localStorage: review logs grow without bound, localStorage caps around 5MB, and it
 * is synchronous — a write during a strum would jank the audio loop.
 */

interface UkeDB extends DBSchema {
  cards: { key: string; value: Card };
  reviews: { key: number; value: ReviewLog; indexes: { 'by-card': string; 'by-ts': number } };
  meta: { key: string; value: unknown };
}

const DB_NAME = 'uke-learner';
const DB_VERSION = 1;

export const openDatabase = (): Promise<IDBPDatabase<UkeDB>> =>
  openDB<UkeDB>(DB_NAME, DB_VERSION, {
    upgrade(db) {
      db.createObjectStore('cards', { keyPath: 'id' });
      const reviews = db.createObjectStore('reviews', { autoIncrement: true });
      reviews.createIndex('by-card', 'cardId');
      reviews.createIndex('by-ts', 'ts');
      db.createObjectStore('meta');
    },
  });

export class Store {
  constructor(private readonly db: IDBPDatabase<UkeDB>) {}

  static async open(): Promise<Store> {
    return new Store(await openDatabase());
  }

  async allCards(): Promise<Card[]> {
    return this.db.getAll('cards');
  }

  async putCards(cards: readonly Card[]): Promise<void> {
    const tx = this.db.transaction('cards', 'readwrite');
    await Promise.all([...cards.map((c) => tx.store.put(c)), tx.done]);
  }

  /** Append-only: reviews are added, never updated or deleted. */
  async appendReviews(logs: readonly ReviewLog[]): Promise<void> {
    const tx = this.db.transaction('reviews', 'readwrite');
    await Promise.all([...logs.map((l) => tx.store.add(l)), tx.done]);
  }

  async reviewsSince(ts: number): Promise<ReviewLog[]> {
    return this.db.getAllFromIndex('reviews', 'by-ts', IDBKeyRange.lowerBound(ts));
  }

  /** How many distinct cards were first seen today, for the daily new-card cap. */
  async newIntroducedToday(now = new Date()): Promise<number> {
    const midnight = new Date(now);
    midnight.setHours(0, 0, 0, 0);
    const logs = await this.reviewsSince(midnight.getTime());
    return new Set(logs.map((l) => l.cardId)).size;
  }

  async settings(): Promise<SessionSettings> {
    const stored = (await this.db.get('meta', 'settings')) as Partial<SessionSettings> | undefined;
    return { ...DEFAULT_SETTINGS, ...stored };
  }

  async saveSettings(s: SessionSettings): Promise<void> {
    await this.db.put('meta', s, 'settings');
  }

  async getMeta<T>(key: string): Promise<T | undefined> {
    return (await this.db.get('meta', key)) as T | undefined;
  }

  async setMeta(key: string, value: unknown): Promise<void> {
    await this.db.put('meta', value, key);
  }

  /**
   * Full export. This doubles as the backup mechanism and the deck-sharing format, so it
   * is a stable versioned schema rather than a dump of internal state — shared decks were
   * Anki's real moat, and the format is cheap now and expensive to retrofit.
   */
  async exportAll(): Promise<string> {
    const [cards, reviews, settings] = await Promise.all([
      this.allCards(),
      this.reviewsSince(0),
      this.settings(),
    ]);
    return JSON.stringify({ version: 1, exportedAt: Date.now(), settings, cards, reviews }, null, 2);
  }
}
