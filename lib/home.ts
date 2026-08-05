/**
 * 自宅（気になる場所）の登録。
 *
 * 距離順は既定で現在地からだが、**発災時に自宅にいるとは限らない**。
 * 職場から自宅周辺の状況を見たい、家族のいる地域を確認したい、
 * という使い方が現実的で、むしろそちらが多い。
 *
 * 端末内にのみ持つ。ログインを作らない方針は変えない。
 * 端末を変えると消えるが、それでよい（お気に入りと同じ扱い）。
 */
const KEY = 'bousai.home';

export interface HomeLocation {
  lat: number;
  lng: number;
  /** 「山形市」など。座標だけだと何を登録したか分からなくなる */
  label: string;
}

export function readHome(): HomeLocation | null {
  if (typeof window === 'undefined') return null;
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    return v && typeof v.lat === 'number' && typeof v.lng === 'number' ? v : null;
  } catch {
    return null;
  }
}

export function saveHome(h: HomeLocation): void {
  localStorage.setItem(KEY, JSON.stringify(h));
}

export function clearHome(): void {
  localStorage.removeItem(KEY);
}
