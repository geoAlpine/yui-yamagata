/**
 * お気に入り。
 *
 * ログインを作らないので端末内にだけ持つ。端末を変えると消える。
 * それでよい。アカウントを要求して投稿・閲覧の速度を落とすほうが害が大きい。
 * ただし「同期されない」ことは画面上で明示する。
 */
const KEY = 'bousai.favorites';

export function readFavorites(): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    return new Set(JSON.parse(localStorage.getItem(KEY) ?? '[]') as string[]);
  } catch {
    return new Set();
  }
}

export function toggleFavorite(id: string): Set<string> {
  const s = readFavorites();
  if (s.has(id)) s.delete(id);
  else s.add(id);
  localStorage.setItem(KEY, JSON.stringify([...s]));
  return s;
}
