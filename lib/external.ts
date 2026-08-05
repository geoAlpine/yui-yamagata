/**
 * 外部サービスへのリンク。
 *
 * ── なぜ Google API を使わないか ──
 * 営業時間や混雑状況を取ってくる案は3つの理由で採らない。
 *
 *  1. Places API はリクエスト単位の課金。災害時に7万人/日が来たらそのまま請求になる。
 *     VPSを選んだ理由（従量課金を持ち込まない）が崩れる。
 *  2. 規約上、取得したデータの保存が原則できない。取り込んで自前で持てないので、
 *     毎回APIを叩くしかなく、1に戻る。
 *  3. Googleのデータを表示するなら利用者はGoogleを直接開く。うちの価値は
 *     「Googleが間違っているときに正しい」ことだけなので、混ぜると強みがぼやける。
 *
 * 代わりにリンクを出す。コストゼロ、規約リスクなし、そして正直。
 * 平時は「Googleを見てください」と言い切り、災害時にGoogleと食い違う実態を出す。
 *
 * 座標で渡すので、店名の表記ゆれで別の場所が開く事故が起きない。
 */

const coords = (lat: number, lng: number) => encodeURIComponent(`${lat},${lng}`);

/** 地図で開く */
export function googleMapsUrl(lat: number, lng: number): string {
  return `https://www.google.com/maps/search/?api=1&query=${coords(lat, lng)}`;
}

/** 経路案内。被災地では「どう行くか」が要る */
export function googleDirectionsUrl(lat: number, lng: number): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${coords(lat, lng)}`;
}
