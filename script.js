// ===== 変数：ゲームの状態 =====
const SIZE = 6;
let board;            // SIZE×SIZEマス。0=空き, 1=プレイヤー1, 2=プレイヤー2
let turn;             // 今、マスを選ぶ人
let selected;         // 選択中のマス（-1は未選択）
let busy;             // 手押し相撲の最中かどうか
let changed = [];     // 直前に変わったマス（裏返しの演出用）
let bonus = [];       // ⚡マスの位置（一発逆転マス）
let special = {};     // 特別マス：{マスの番号: "matta" | "rest" | "swap"}
let trump = {1: 2, 2: 2};   // 張り手の残り回数
let armed = false;    // 今の勝負で張り手を使うか
let fast = false;     // 早送り
const SPECIAL_NAME = {matta:"待ったマス", rest:"お休みマス", swap:"入れ替わりマス"};
const SPECIAL_ICON = {matta:"🔁", rest:"💤", swap:"🔀"};
const mark = {1:"○", 2:"×"};
const dirs = [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]];

function name(p){
  const v = document.getElementById("n" + p).value.trim();
  return v || ("プレイヤー" + p);
}
function count(p){ return board.filter(function(v){ return v === p; }).length; }
function other(p){ return p === 1 ? 2 : 1; }

// マスの点数：角は3点、端は2点、それ以外は1点
function pts(i){
  const r = Math.floor(i / SIZE), c = i % SIZE;
  const edgeR = (r === 0 || r === SIZE - 1);
  const edgeC = (c === 0 || c === SIZE - 1);
  if (edgeR && edgeC) return 3;
  if (edgeR || edgeC) return 2;
  return 1;
}
// プレイヤーpの合計点
function score(p){
  let sum = 0;
  board.forEach(function(v, i){ if (v === p) sum += pts(i); });
  return sum;
}
function sleep(ms){ return new Promise(function(r){ setTimeout(r, ms); }); }

// ===== オセロ判定：マスiにpが置いたとき、裏返るマスの一覧 =====
function flipsFor(i, p){
  const r = Math.floor(i / SIZE), c = i % SIZE;
  const result = [];
  dirs.forEach(function(d){
    const line = [];
    let rr = r + d[0], cc = c + d[1];
    // 相手のマスが続くあいだ進む
    while (rr >= 0 && rr < SIZE && cc >= 0 && cc < SIZE && board[rr * SIZE + cc] === other(p)) {
      line.push(rr * SIZE + cc);
      rr += d[0]; cc += d[1];
    }
    // 分岐：その先が自分のマスなら、挟めたので裏返す
    if (line.length > 0 && rr >= 0 && rr < SIZE && cc >= 0 && cc < SIZE && board[rr * SIZE + cc] === p) {
      line.forEach(function(x){ result.push(x); });
    }
  });
  return result;
}

// ===== ⚡マス：同じ行・列・斜めにいる相手のマスを全部裏返す =====
function bonusFlips(i, p){
  if (!bonus.includes(i)) return [];   // 分岐：⚡マスでなければ何もなし
  const r = Math.floor(i / SIZE), c = i % SIZE;
  const result = [];
  board.forEach(function(v, j){
    const dr = Math.floor(j / SIZE) - r, dc = (j % SIZE) - c;
    const sameLine = (dr === 0) || (dc === 0) || (Math.abs(dr) === Math.abs(dc));   // 縦・横・斜め
    if (sameLine && v === other(p)) result.push(j);
  });
  return result;
}

// 通常の裏返し＋⚡の裏返し（重複なし）
function allFlips(i, p){
  const list = flipsFor(i, p);
  bonusFlips(i, p).forEach(function(x){
    if (!list.includes(x)) list.push(x);
  });
  return list;
}

// ===== オセロのルール：置けるマス（相手を1枚以上挟めるマス）の一覧 =====
function legalMoves(p){
  const list = [];
  const wiped = (count(p) === 0);   // コマが全滅していたら、空きマスならどこでも置ける
  board.forEach(function(v, i){
    if (v === 0 && (wiped || flipsFor(i, p).length > 0)) list.push(i);
  });
  return list;
}

// 次の番へ。置ける場所がなければパスして、パスした人を返す（いなければ0）
function nextTurn(){
  turn = other(turn);
  if (legalMoves(turn).length === 0 && legalMoves(other(turn)).length > 0) {
    const passed = turn;
    turn = other(turn);
    return passed;
  }
  return 0;
}

function pick(i){
  // 分岐：勝負中・埋まっている・選択済み・置けないマスは選べない
  if (busy || board[i] !== 0 || selected >= 0 || !legalMoves(turn).includes(i)) return;
  selected = i;
  armed = false;
  changed = [];
  document.getElementById("say").textContent = "";
  render();
}

// ===== 手押し相撲の動き =====
// ===== 土俵の2人（SVG）を動かす =====
const f1 = document.getElementById("f1");
const f2 = document.getElementById("f2");

let curOff = 0;   // 今の押し具合（-1〜1）

// pos: -110〜110（プラスはプレイヤー1が押している）
function setPush(pos){
  const off = pos / 110;
  curOff = off;
  f1.style.transform = "translateX(" + (145 + off * 28) + "px) skewX(" + (-off * 9) + "deg)";
  f2.style.transform = "translateX(" + (255 + off * 28) + "px) skewX(" + (-off * 9) + "deg)";
}

// 決まり手：倒れ方の違い（dx：後ろにすべる距離、rot：倒れる角度。マイナスは前に倒れる）
const KIMARITE = [
  {name:"押し出し", dx:40, rot:20},
  {name:"寄り切り", dx:30, rot:35},
  {name:"突き落とし", dx:10, rot:-65},
  {name:"はたき込み", dx:14, rot:-70},
  {name:"うっちゃり", dx:8, rot:95},
  {name:"上手投げ", dx:0, rot:120}
];

// 負けた方が倒れる。k は決まり手
function fall(loser, k){
  dong(0.55);   // 倒れたときの太鼓（中くらいの音）
  const back = (loser === 1) ? -1 : 1;   // 後ろの向き
  const el = (loser === 1) ? f1 : f2;
  const base = (loser === 1) ? 145 - 28 : 255 + 28;
  el.classList.add("fallen");
  el.style.transform = "translateX(" + (base + back * k.dx) + "px) rotate(" + (back * k.rot) + "deg)";
}

// ===== 音（ファイル不要：ブラウザで太鼓のような音を作る） =====
let audioCtx = null;
function getAudio(){
  if (!audioCtx) {
    try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return null; }
  }
  if (audioCtx.state === "suspended") audioCtx.resume();
  return audioCtx;
}

// ドン！：低い音がすっと下がる＋ぶつかるノイズ。vol は音の大きさ（1が最大）
// 残響（大きな室内の響き）：減衰するノイズを「響きの型」にする
let reverb = null;
function getReverb(ctx){
  if (!reverb) {
    const len = Math.floor(ctx.sampleRate * 1.2);
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = ir.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.5);
    }
    reverb = ctx.createConvolver();
    reverb.buffer = ir;
    const wet = ctx.createGain();
    wet.gain.value = 0.3;
    reverb.connect(wet); wet.connect(ctx.destination);
  }
  return reverb;
}

// 音を一つ鳴らす：最初の高さf0から素早いでf1へ下がり、その後ゆっくりf2へ下がる
function tone(ctx, bus, type, f0, f1, f2, drop, dur, gain, t){
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(f1, t + drop);
  o.frequency.exponentialRampToValueAtTime(f2, t + dur);
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g); g.connect(bus);
  o.start(t); o.stop(t + dur);
}

// 和太鼓の「ドン！」。vol は音の大きさ（1が最大）
function dong(vol){
  const ctx = getAudio();
  if (!ctx) return;
  const v = vol || 1;
  const t = ctx.currentTime;
  const bus = ctx.createGain();
  bus.connect(ctx.destination);
  bus.connect(getReverb(ctx));
  // 胴の音：和太鼓は低くて、余韻が長い
  tone(ctx, bus, "sine", 135, 80, 52, 0.06, 1.1, 1.1 * v, t);
  // 皮の音：高めの音がすぐに消える
  tone(ctx, bus, "triangle", 330, 170, 120, 0.05, 0.25, 0.35 * v, t);
  // バチが当たる「パン」という短いノイズ
  const len = Math.floor(ctx.sampleRate * 0.06);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const noise = ctx.createBufferSource();
  const bp = ctx.createBiquadFilter();
  const ng = ctx.createGain();
  noise.buffer = buf;
  bp.type = "bandpass";
  bp.frequency.value = 1000;
  ng.gain.value = 0.9 * v;
  noise.connect(bp); bp.connect(ng); ng.connect(bus);
  noise.start(t);
}

// 勝った方がジャンプして、ドンと着地する
async function jump(p){
  const el = (p === 1) ? f1 : f2;
  const x = ((p === 1) ? 145 : 255) + curOff * 28;
  const sk = -curOff * 9;
  el.style.transform = "translateX(" + x + "px) translateY(-46px) skewX(" + sk + "deg)";
  await sleep(380);
  el.style.transition = "transform .12s ease-in";
  el.style.transform = "translateX(" + x + "px) translateY(0px) skewX(" + sk + "deg)";
  await sleep(130);
  el.style.transition = "";
}

// 盤面と土俵をゆらす
function shake(){
  [document.getElementById("grid"), document.querySelector(".arena")].forEach(function(el){
    el.classList.remove("shake");
    void el.offsetWidth;
    el.classList.add("shake");
  });
}

// WIN! / LOSE の表示
function showResultLabels(winner){
  const w = document.getElementById("lab" + winner);
  const l = document.getElementById("lab" + other(winner));
  w.textContent = "WIN!";  w.setAttribute("class", "lab show win");
  l.textContent = "LOSE";  l.setAttribute("class", "lab show lose");
}

function resetFigures(){
  f1.classList.remove("fallen");
  f2.classList.remove("fallen");
  document.getElementById("lab1").setAttribute("class", "lab");
  document.getElementById("lab2").setAttribute("class", "lab");
  setPush(0);
}

// ===== 次の番へ（置ける場所がなければパス） =====
function endTurn(){
  const passed = nextTurn();
  if (passed) document.getElementById("say").textContent += " （" + name(passed) + " は置ける場所がなくパス）";
}



function toggleArmed(){
  if (busy || selected < 0 || !trump[turn]) return;
  armed = !armed;
  render();
}
function toggleFast(){ fast = !fast; render(); }

// ===== 1回の手押し相撲（押し合い→決着→倒れる）。勝った人（1か2）を返す =====
async function bout(p1Rate, isBonus, sp, title){
  const say = document.getElementById("say");
  const winner = Math.random() < p1Rate ? 1 : 2;   // p1Rate：プレイヤー1が勝つ確率
  const sign = winner === 1 ? 1 : -1;
  resetFigures();
  say.textContent = title;
  await sleep(isBonus ? 800 : 600 * sp);

  // 押し合い：「のこったのこった！」。⚡マスのときは回数が多く、時間も長い
  const rounds = isBonus ? 7 : (sp < 1 ? 3 : 6);
  const wait = isBonus ? 500 : 450 * sp;
  let dir = Math.random() < 0.5 ? 1 : -1;
  for (let k = 0; k < rounds; k++) {
    setPush(dir * (15 + k * (isBonus ? 5 : 8) + Math.random() * 12));
    say.textContent = k % 2 === 0 ? "のこった！" : "のこったのこった！";
    dir = -dir;
    await sleep(wait);
  }
  if (isBonus) {                 // ⚡マス：最後にもうひと溜めして、どっちが勝つか分からなくする
    setPush(0);
    say.textContent = "どっちだ…！？";
    await sleep(700);
  }
  setPush(sign * 112);          // 最後の一押しで決着
  await sleep(350 * sp);
  const kim = KIMARITE[Math.floor(Math.random() * KIMARITE.length)];   // 決まり手をランダムに選ぶ
  fall(other(winner), kim);
  showResultLabels(winner);
  say.textContent = name(winner) + " の勝ち！ 決まり手：" + kim.name;
  await sleep(900 * sp);
  return winner;
}

async function fight(){
  if (selected < 0 || busy) return;
  busy = true;
  render();

  const say = document.getElementById("say");
  const isBonus = bonus.includes(selected);   // ⚡マスなら、勝負を長くしてドキドキさせる
  const kind = special[selected];             // 特別マスの種類（ふつうのマスなら undefined）
  const sp = (fast && !isBonus) ? 0.35 : 1;   // 早送りのときは、演出を短くする
  getAudio();                                  // ボタンを押した直後に、音を使えるようにする

  // 張り手：この勝負だけ、選んだ人の勝率が70%になる（1ゲームに1回）
  const useHarite = armed;
  if (useHarite) trump[turn] -= 1;
  armed = false;
  const rate = useHarite ? 0.7 : 0.5;
  const p1Rate = (turn === 1) ? rate : 1 - rate;

  // 特別マスは、勝負の最初に正体が分かる
  let title = "はっけよーい…！";
  if (isBonus) title = "⚡ 一発逆転マスだ！ " + title;
  else if (kind) title = SPECIAL_ICON[kind] + " " + SPECIAL_NAME[kind] + "だ！ " + title;
  if (useHarite) title = "🖐 張り手！ " + title;

  let winner = await bout(p1Rate, isBonus, sp, title);

  // 待ったマス：負けた方がもう1回勝負できる（2回目の結果が最終）
  if (kind === "matta") {
    say.textContent = "🔁 待った！！ " + name(other(winner)) + " がもう1回！";
    await sleep(1300 * sp);
    winner = await bout(0.5, false, sp, "もう1回！ はっけよーい…！");
  }

  // 勝者がそのマスに置いて、オセロのように裏返す
  const flips = allFlips(selected, winner);
  if (isBonus) {
    say.textContent = "⚡ 一発逆転！！";
    await jump(winner);   // 勝った方がジャンプして…
    dong(0.7);            // ど…（1回目）
    await sleep(230);
    dong(1);              // どん！（2回目で、盤面がゆれて一気に変わる）
    shake();
  }
  let note = "";
  if (kind === "rest") {   // お休みマス：コマは置かれず、マスは空いたまま
    changed = [];
    note = " 💤 お休みマス！コマは置かれず、マスは空いたまま";
  } else {
    board[selected] = winner;
    flips.forEach(function(x){ board[x] = winner; });
    changed = flips.concat([selected]);
    note = (isBonus ? " ⚡一発逆転！" : "") + (flips.length > 0 ? " " + flips.length + "枚ひっくり返した" : " ひっくり返せなかった");
    if (kind === "swap") {   // 入れ替わりマス：置いたマスの同じ行・列にある○と×が入れ替わる
      dong(0.8);
      shake();
      const r0 = Math.floor(selected / SIZE), c0 = selected % SIZE;
      changed = [];
      board = board.map(function(v, i){
        const inCross = (Math.floor(i / SIZE) === r0) || (i % SIZE === c0);
        if (v !== 0 && inCross && i !== selected) { changed.push(i); return other(v); }
        return v;
      });
      note += " 🔀 入れ替わりマス！同じ行と列の○と×が入れ替わった";
    }
  }
  delete special[selected];   // 使った特別マスは消える
  say.textContent = name(winner) + " の勝ち！" + note;

  selected = -1;
  busy = false;
  endTurn();   // 次の番へ（置ける場所がなければパス）
  render();
}

// 2つのマスの近さ（縦・横・斜めを合わせて、一番遠い方向の差。1なら隣）
function gap(a, b){
  return Math.max(Math.abs(Math.floor(a / SIZE) - Math.floor(b / SIZE)), Math.abs((a % SIZE) - (b % SIZE)));
}

// 特別マスを置く場所を選ぶ：最初の4マスから1〜2マス以内を優先し、他の特別マスからは離す
function choosePlace(empties, starts, used){
  let best = -1, pool = [];
  empties.forEach(function(i){
    const ds = Math.min.apply(null, starts.map(function(j){ return gap(i, j); }));
    const db = used.length ? Math.min.apply(null, used.map(function(j){ return gap(i, j); })) : 3;
    const score = (ds <= 2 ? 10 : 0) + Math.min(db, 3);
    if (score > best) { best = score; pool = [i]; }
    else if (score === best) { pool.push(i); }
  });
  return pool[Math.floor(Math.random() * pool.length)];   // 最高点の中からランダム
}

function reset(){
  if (busy) return;
  board = Array(SIZE * SIZE).fill(0);
  // 最初の4マスを、中央あたりに置く
  const s = Math.floor(SIZE / 2) - 1;
  board[s * SIZE + s] = 2;
  board[s * SIZE + s + 1] = 1;
  board[(s + 1) * SIZE + s] = 1;
  board[(s + 1) * SIZE + s + 1] = 2;
  turn = 1; selected = -1; changed = [];
  // 特別マスを置く：⚡（一発逆転）と、待ったマス・お休みマス・入れ替わりマス
  bonus = [];
  special = {};
  trump = {1: 2, 2: 2};
  armed = false;
  const starts = [s * SIZE + s, s * SIZE + s + 1, (s + 1) * SIZE + s, (s + 1) * SIZE + s + 1];
  const empties = [];
  board.forEach(function(v, i){ if (v === 0) empties.push(i); });
  const kinds = [];
  for (let k = 0; k < Math.max(1, Math.floor(SIZE * SIZE / 8)); k++) kinds.push("bolt");
  kinds.push("matta", "rest", "swap");
  const used = [];
  kinds.forEach(function(kind){
    const chosen = choosePlace(empties, starts, used);
    used.push(chosen);
    empties.splice(empties.indexOf(chosen), 1);
    if (kind === "bolt") bonus.push(chosen); else special[chosen] = kind;
  });
  document.getElementById("say").textContent = "";
  resetFigures();
  render();
}

function render(){
  const c1 = score(1), c2 = score(2);   // 合計点（角3点・端2点・それ以外1点）
  const empty = board.filter(function(v){ return v === 0; }).length;
  const legal = legalMoves(turn);
  // 終了：盤面が埋まった、または両方とも置けない
  const finished = (empty === 0) || (legal.length === 0 && legalMoves(other(turn)).length === 0);
  document.getElementById("s1").textContent = c1 + "点 " + "🖐".repeat(trump[1]);
  document.getElementById("s2").textContent = c2 + "点 " + "🖐".repeat(trump[2]);
  document.getElementById("nm1").textContent = name(1);
  document.getElementById("nm2").textContent = name(2);
  // 番のプレイヤーを強調する
  document.querySelector(".pl.p1").classList.toggle("active", !finished && turn === 1);
  document.querySelector(".pl.p2").classList.toggle("active", !finished && turn === 2);
  document.querySelector(".names").classList.toggle("playing", !finished);

  const grid = document.getElementById("grid");
  grid.innerHTML = "";
  grid.style.gridTemplateColumns = "repeat(" + SIZE + ", 1fr)";
  board.forEach(function(v, i){
    const selectable = (v === 0) && !busy && !finished && selected < 0 && legal.includes(i);
    const b = document.createElement("button");
    b.className = "cell" + (v === 1 ? " c1" : v === 2 ? " c2" : "") +
      (i === selected ? " sel" : "") + (changed.includes(i) ? " flip" : "") +
      (selectable ? " ok" : "") +
      (pts(i) === 3 ? " w3" : pts(i) === 2 ? " w2" : "");
    b.textContent = v === 0 ? ((busy && i === selected) ? (bonus.includes(i) ? "⚡" : (SPECIAL_ICON[special[i]] || "")) : "") : mark[v];
    b.disabled = !selectable;
    b.setAttribute("aria-label", (Math.floor(i / SIZE) + 1) + "行" + (i % SIZE + 1) + "列");
    b.onclick = function(){ pick(i); };
    grid.appendChild(b);
  });

  const status = document.getElementById("status");
  const info = document.getElementById("info");
  const go = document.getElementById("go");

  // 分岐：終了 / 勝負中 / マス選択済み / マス未選択
  if (finished) {
    status.textContent = "ゲーム終了";
    // 分岐：どちらが多いか、同数なら引き分け
    let result;
    if (c1 > c2) result = name(1) + " の勝ち！";
    else if (c2 > c1) result = name(2) + " の勝ち！";
    else result = "引き分け！";
    info.textContent = result + "（" + c1 + " 対 " + c2 + " 点）";
  } else if (busy) {
    status.textContent = "勝負中！";
    info.textContent = "";
  } else if (selected >= 0) {
    status.textContent = name(turn) + " さんが選んだマス";
    // 勝った場合・負けた場合に裏返る数を予告する
    // 勝った人が得る点数 = 置いたマスの点数 + 裏返したマスの点数
    const gain = function(p){
      return pts(selected) + flipsFor(selected, p).reduce(function(sum, x){ return sum + pts(x); }, 0);
    };
    info.textContent = name(turn) + " が勝てば +" + gain(turn) + "点／" + name(other(turn)) + " が勝てば +" + gain(other(turn)) + "点（勝率は" + (armed ? name(turn) + " 70%" : "50%ずつ") + "）";
  } else {
    status.textContent = name(turn) + " さんがマスを選ぶ番";
    info.textContent = (count(turn) === 0 ? "コマが全滅！空きマスならどこでも選べます（点線）。残り" : "置けるマス（点線）をタップ。残り") + empty + "マス";
  }
  status.style.color = finished ? "" : (turn === 1 ? "var(--p1)" : "var(--p2)");
  go.textContent = (selected >= 0 || busy) ? "のこった！" : "はっけよーい！";   // マスを選ぶ前は「はっけよーい！」
  go.disabled = finished || busy || selected < 0;
  const hb = document.getElementById("harite");
  hb.textContent = armed ? "張り手 ON" : (trump[turn] ? "張り手×" + trump[turn] : "張り手済");
  hb.classList.toggle("on", armed);
  hb.disabled = finished || busy || selected < 0 || !trump[turn];
  document.getElementById("ff").classList.toggle("on", fast);
}

reset();