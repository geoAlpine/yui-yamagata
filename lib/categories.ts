/**
 * カテゴリ・状態・TTL の定義。
 *
 * このファイルが本サイトのドメインの中心。DESIGN.md 3.3 / 3.4 に対応する。
 * TTL（情報の賞味期限）はカテゴリごとに違う。ガソリンの待ち時間は2時間で腐るが、
 * 断水情報は24時間もつ。ここを一律にすると災害時に嘘をつくサイトになる。
 *
 * ── 雪モードを廃止した理由（2026-08-05） ──
 * 当初は「平時＝雪 / 有事＝災害」の二段構えにしていた。平時から動かさないと
 * 発災時に誰も知らない、という読みだった。しかし:
 *
 *   1. 平時の「今どこが開いてるか」はGoogleのほうが圧倒的に上。営業時間も
 *      混雑状況もライブで出る。そこに勝負を挑む理由がない。
 *   2. 除雪は道路の「区間」であり、点しか持てない現行モデルでは表現できない。
 *   3. 吹雪の最中に人は雪かきをしていて投稿しない。報告の動機が弱い。
 *   4. イマココナビは認知ゼロから1日7万人に届いた。災害時の発見はSNSで足りる。
 *      sinsai.info を殺したのは事前認知の不足ではなく、発災後に作り始めて
 *      収束後に捨てられたことだった。
 *
 * よって災害専用にする。うちが勝てるのは「公式情報が実態と食い違うとき」だけで、
 * それは災害時に限られる。
 *
 * 平時は「そなえ」として、給水拠点や自家発電付き給油所の位置を確認する場になる。
 * これらはGoogleにはない情報で、平時に確認しておく価値がある。
 */

export type Mode = 'standby' | 'disaster';

/**
 * 指定緊急避難場所が対応する災害種別。
 *
 * 地震向けに指定された場所が洪水では使えないことがある。
 * 「避難場所だから安全」ではなく「この災害に対して安全」が正しい。
 * 混同は命に関わるので、必ず種別を出す。
 */
export const HAZARDS = [
  { id: 'flood',        label: '洪水' },
  { id: 'landslide',    label: '土砂災害' },
  { id: 'storm_surge',  label: '高潮' },
  { id: 'earthquake',   label: '地震' },
  { id: 'tsunami',      label: '津波' },
  { id: 'fire',         label: '大規模火事' },
  { id: 'inland_flood', label: '内水氾濫' },
  { id: 'volcano',      label: '火山' },
] as const;

export type HazardId = (typeof HAZARDS)[number]['id'];

export function hazardLabel(id: string): string {
  return HAZARDS.find((h) => h.id === id)?.label ?? id;
}

/** 状態の深刻度。表示色と並び順に使う */
export type Severity = 'good' | 'warn' | 'bad' | 'unknown';

export interface StatusDef {
  id: string;
  label: string;
  severity: Severity;
}

export interface AttrDef {
  id: string;
  label: string;
  type: 'select' | 'number' | 'text';
  options?: { value: string; label: string }[];
  unit?: string;
  /** この属性を表示・入力させる状態。未指定なら常時 */
  onlyForStatus?: string[];
}

export interface CategoryDef {
  id: string;
  label: string;
  /**
   * カードなど狭い場所に出す短い呼び名。
   * 絵文字は使わない。端末ごとに描画が変わり、色もサイズも揃わないうえ、
   * 災害情報の画面では軽く見える。短い日本語のほうが確実に読める。
   */
  short: string;
  /** 情報の賞味期限（分）。経過するとステータスを「不明」に戻す */
  ttlMinutes: number;
  /**
   * 件数が0のときに何を伝えるか。
   *
   * 「空」には2種類あり、混同すると利用者に嘘をつく。
   *   disasterOnly … 平時には存在しないもの（給水所・物資配布・災害ごみ等）。
   *                  発災時に自治体が設置して初めて生まれる。空で正常。
   *   needsReport  … 場所は実在するのに誰も登録していないもの（除雪・路面等）。
   *                  こちらは投稿を促すべきで、「空で正常」と言ってはいけない。
   */
  emptyReason: 'disasterOnly' | 'needsReport';
  statuses: StatusDef[];
  attrs?: AttrDef[];
  /** 一覧での既定の並び順（小さいほど上） */
  order: number;
}

const WAIT_MINUTES: AttrDef = {
  id: 'waitMinutes',
  label: '待ち時間',
  type: 'select',
  options: [
    { value: '0', label: '待ちなし' },
    { value: '10', label: '10分ほど' },
    { value: '30', label: '30分ほど' },
    { value: '60', label: '1時間以上' },
    { value: '120', label: '2時間以上' },
  ],
};

export const CATEGORIES: CategoryDef[] = [
  {
    // 発災時に緊急で逃げる場所。災害種別ごとに指定される。
    // 公式は「指定されている」ことしか言えない。「今開いているか」は住民の目撃が先行する。
    id: 'evacuation',
    label: '緊急避難場所',
    short: '避難場所',
    emptyReason: 'needsReport',
    ttlMinutes: 720,
    order: 0,
    statuses: [
      { id: 'open', label: '開設されている', severity: 'good' },
      { id: 'crowded', label: '開設・混雑', severity: 'warn' },
      { id: 'closed', label: '開設されていない', severity: 'bad' },
      { id: 'unusable', label: '被災して使えない', severity: 'bad' },
    ],
    attrs: [{ id: 'detail', label: '状況', type: 'text' }],
  },
  {
    // 災害後に滞在する場所。緊急避難場所とは別物。
    id: 'shelter',
    label: '避難所（滞在）',
    short: '避難所',
    emptyReason: 'needsReport',
    ttlMinutes: 720,
    order: 1,
    statuses: [
      { id: 'open', label: '開設されている', severity: 'good' },
      { id: 'crowded', label: '開設・混雑', severity: 'warn' },
      { id: 'closed', label: '開設されていない', severity: 'bad' },
      { id: 'unusable', label: '被災して使えない', severity: 'bad' },
    ],
    attrs: [{ id: 'detail', label: '状況', type: 'text' }],
  },
  {
    id: 'gas',
    label: 'ガソリンスタンド',
    short: 'ガソリン',
    emptyReason: 'needsReport',
    // 最も腐りやすい。行列は30分で変わるが、2時間を上限とする
    ttlMinutes: 120,
    order: 3,
    statuses: [
      { id: 'available', label: '給油できる', severity: 'good' },
      { id: 'limited', label: '数量制限あり', severity: 'warn' },
      { id: 'empty', label: '在庫なし', severity: 'bad' },
      { id: 'closed', label: '閉まっている', severity: 'bad' },
    ],
    attrs: [
      { ...WAIT_MINUTES, onlyForStatus: ['available', 'limited'] },
      {
        id: 'limitLiters',
        label: '給油上限',
        type: 'select',
        unit: 'L',
        onlyForStatus: ['limited'],
        options: [
          { value: '10', label: '10Lまで' },
          { value: '20', label: '20Lまで' },
          { value: '30', label: '30Lまで' },
        ],
      },
    ],
  },
  {
    id: 'store',
    label: 'スーパー・コンビニ',
    short: '買い物',
    emptyReason: 'needsReport',
    ttlMinutes: 360, // 6時間
    order: 4,
    statuses: [
      { id: 'open', label: '営業中', severity: 'good' },
      { id: 'limited', label: '一部営業・品薄', severity: 'warn' },
      { id: 'closed', label: '休業', severity: 'bad' },
    ],
    attrs: [{ ...WAIT_MINUTES, onlyForStatus: ['open', 'limited'] }],
  },
  {
    id: 'water',
    label: '給水所',
    short: '給水',
    // 当初 disasterOnly に分類したが誤り。応急給水拠点は自治体が平時から
    // 指定・公表している（耐震性貯水槽・学校の災害用貯水槽など）。
    // 未取り込みの市町村では空になるので、住民が足せることを伝える。
    emptyReason: 'needsReport',
    ttlMinutes: 720, // 12時間
    order: 2,
    statuses: [
      { id: 'active', label: '実施中', severity: 'good' },
      { id: 'scheduled', label: '予定あり', severity: 'warn' },
      { id: 'ended', label: '終了', severity: 'bad' },
    ],
    attrs: [
      {
        id: 'container',
        label: '容器',
        type: 'select',
        options: [
          { value: 'required', label: '容器を持参' },
          { value: 'provided', label: '容器の配布あり' },
        ],
      },
      // イマココナビは「給水場・井戸水」を1カテゴリにしていた。
      // 井戸水は飲用可否が不明なことがあり、健康被害に直結する。
      // 種別を必ず区別し、井戸水にはカード上で注意書きを出す（SpotCard 側）。
      {
        id: 'waterType',
        label: '水の種類',
        type: 'select',
        options: [
          { value: 'tank', label: '給水車・給水タンク' },
          { value: 'tap', label: '水道（仮設含む）' },
          { value: 'well', label: '井戸水（飲用可否は要確認）' },
        ],
      },
    ],
  },
  {
    id: 'supply',
    label: '物資配布・炊き出し',
    short: '物資',
    emptyReason: 'disasterOnly',
    ttlMinutes: 360,
    order: 5,
    statuses: [
      { id: 'active', label: '実施中', severity: 'good' },
      { id: 'scheduled', label: '予定あり', severity: 'warn' },
      { id: 'ended', label: '終了', severity: 'bad' },
    ],
    attrs: [{ id: 'items', label: '配布物', type: 'text' }],
  },
  {
    id: 'toilet',
    label: 'トイレ・入浴',
    short: 'トイレ・入浴',
    emptyReason: 'needsReport',
    ttlMinutes: 720,
    order: 6,
    statuses: [
      { id: 'available', label: '使える', severity: 'good' },
      { id: 'unavailable', label: '使えない', severity: 'bad' },
    ],
    attrs: [
      {
        id: 'fee',
        label: '料金',
        type: 'select',
        options: [
          { value: 'free', label: '無料' },
          { value: 'paid', label: '有料' },
        ],
      },
    ],
  },
  // ── ここから下は災害時の実需から追加したもの ──
  {
    id: 'charge',
    label: '充電できる場所',
    short: '充電',
    emptyReason: 'needsReport',
    // 停電の復旧・電源車の移動で状況が変わりやすい
    ttlMinutes: 240,
    order: 7,
    statuses: [
      { id: 'available', label: '充電できる', severity: 'good' },
      { id: 'crowded', label: '混雑・順番待ち', severity: 'warn' },
      { id: 'unavailable', label: '使えない', severity: 'bad' },
    ],
    attrs: [
      { ...WAIT_MINUTES, onlyForStatus: ['available', 'crowded'] },
      {
        id: 'chargeType',
        label: '種類',
        type: 'select',
        options: [
          { value: 'outlet', label: 'コンセント' },
          { value: 'usb', label: 'USBポート' },
          { value: 'ev', label: 'EV・給電車' },
        ],
      },
    ],
  },
  {
    id: 'comm',
    label: '携帯・Wi-Fi',
    short: '通信',
    emptyReason: 'needsReport',
    ttlMinutes: 240,
    order: 8,
    statuses: [
      { id: 'wifi', label: '無料Wi-Fiが使える', severity: 'good' },
      { id: 'online', label: '携帯がつながる', severity: 'good' },
      { id: 'weak', label: 'つながりにくい', severity: 'warn' },
      { id: 'offline', label: '圏外', severity: 'bad' },
    ],
    attrs: [
      {
        id: 'carrier',
        label: 'キャリア',
        type: 'select',
        options: [
          { value: 'docomo', label: 'ドコモ' },
          { value: 'au', label: 'au' },
          { value: 'softbank', label: 'ソフトバンク' },
          { value: 'rakuten', label: '楽天' },
        ],
      },
    ],
  },
  {
    id: 'medical',
    label: '医療機関・薬局',
    short: '医療',
    emptyReason: 'needsReport',
    ttlMinutes: 360,
    order: 9,
    statuses: [
      { id: 'open', label: '診療・営業中', severity: 'good' },
      { id: 'limited', label: '一部のみ対応', severity: 'warn' },
      { id: 'closed', label: '休診・休業', severity: 'bad' },
    ],
    attrs: [{ id: 'detail', label: '対応内容', type: 'text' }],
  },
  {
    id: 'cash',
    label: 'ATM・現金',
    short: '現金',
    emptyReason: 'needsReport',
    // 停電でカードが使えず現金が要る場面が必ず来る
    ttlMinutes: 360,
    order: 10,
    statuses: [
      { id: 'available', label: '使える', severity: 'good' },
      { id: 'crowded', label: '行列あり', severity: 'warn' },
      { id: 'unavailable', label: '使えない', severity: 'bad' },
    ],
    attrs: [{ ...WAIT_MINUTES, onlyForStatus: ['available', 'crowded'] }],
  },
  {
    id: 'laundry',
    label: 'コインランドリー',
    short: '洗濯',
    emptyReason: 'needsReport',
    ttlMinutes: 720,
    order: 11,
    statuses: [
      { id: 'open', label: '使える', severity: 'good' },
      { id: 'crowded', label: '混雑', severity: 'warn' },
      { id: 'closed', label: '使えない', severity: 'bad' },
    ],
  },
  {
    id: 'waste',
    label: '災害ごみ仮置場',
    short: '災害ごみ',
    emptyReason: 'disasterOnly',
    // 水害後の片付けで需要が跳ねる。令和6年7月豪雨では県内で床上浸水427棟
    ttlMinutes: 1440,
    order: 12,
    statuses: [
      { id: 'open', label: '搬入できる', severity: 'good' },
      { id: 'crowded', label: '混雑・待ち時間あり', severity: 'warn' },
      { id: 'closed', label: '受付終了', severity: 'bad' },
    ],
    attrs: [
      { ...WAIT_MINUTES, onlyForStatus: ['open', 'crowded'] },
      { id: 'accepts', label: '受け入れ品目', type: 'text' },
    ],
  },
  {
    id: 'lifeline',
    label: '断水・停電',
    short: 'ライフライン',
    emptyReason: 'disasterOnly',
    ttlMinutes: 1440, // 24時間
    order: 13,
    statuses: [
      { id: 'outage_power', label: '停電中', severity: 'bad' },
      { id: 'outage_water', label: '断水中', severity: 'bad' },
      { id: 'restored', label: '復旧した', severity: 'good' },
    ],
  },
  {
    id: 'road',
    label: '通行止め・道路被害',
    short: '道路',
    emptyReason: 'disasterOnly',
    ttlMinutes: 720,
    order: 14,
    statuses: [
      { id: 'closed', label: '通行止め', severity: 'bad' },
      { id: 'flooded', label: '冠水している', severity: 'bad' },
      { id: 'partial', label: '片側通行', severity: 'warn' },
      { id: 'open', label: '通行できる', severity: 'good' },
    ],
  },

];

const BY_ID = new Map(CATEGORIES.map((c) => [c.id, c]));

export function getCategory(id: string): CategoryDef | undefined {
  return BY_ID.get(id);
}

/**
 * モードごとの表示カテゴリ。
 *
 * standby（平時）は「そなえ」。発災前に位置を知っておく価値があるものだけを出す。
 *   給水拠点・自家発電付き給油所・トイレ入浴・医療 …… Googleにない情報
 * 「今どこが開いてるか」は平時には出さない。Googleのほうが正確なので、
 * 中途半端に出すとかえって信頼を損なう。
 */
const STANDBY_CATEGORIES = ['evacuation', 'shelter', 'water', 'gas', 'toilet', 'medical', 'charge'];

export function categoriesForMode(mode: Mode): CategoryDef[] {
  const all = CATEGORIES.sort((a, b) => a.order - b.order);
  return mode === 'standby'
    ? all.filter((c) => STANDBY_CATEGORIES.includes(c.id))
    : all;
}

export function getStatus(categoryId: string, statusId: string): StatusDef | undefined {
  return getCategory(categoryId)?.statuses.find((s) => s.id === statusId);
}

/** 指定した状態のときに入力・表示すべき属性 */
export function attrsForStatus(categoryId: string, statusId: string): AttrDef[] {
  const cat = getCategory(categoryId);
  if (!cat?.attrs) return [];
  return cat.attrs.filter((a) => !a.onlyForStatus || a.onlyForStatus.includes(statusId));
}
