const { Client, GatewayIntentBits, EmbedBuilder } = require("discord.js");
const fs = require("fs");
const http = require("http");

/* ================= CONFIG ================= */

const TOKEN = process.env.TOKEN;

const RESET_ROLES = ["1475815959616032883"]; // role quản lý
const TRAINEE_ROLE = "1467725396433834149"; // role thực tập
const EMPLOYEE_ROLE = "1467724655766012129"; // role nhân viên
const CONGRATS_CHANNEL = "1467729036066295820"; // kênh chúc mừng

const GTA_KEYWORDS = ["gta5", "gta5vn"];
const AFK_LIMIT = 10 * 60 * 1000; // 10 phút
const TRAIN_TARGET = 60 * 60 * 1000; // 60h

const DATA_FILE = "duty.json";

/* ================= RENDER FIX ================= */

http.createServer((req, res) => {
  res.write("OK");
  res.end();
}).listen(process.env.PORT || 3000);

/* ================= DB ================= */

let db = {};
if (fs.existsSync(DATA_FILE)) db = JSON.parse(fs.readFileSync(DATA_FILE));

function save() {
  fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
}

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth()+1}-${d.getDate()}`;
}

function now() {
  return Date.now();
}

function fmt(ts) {
  const d = new Date(ts);
  return `${d.getHours()}h${d.getMinutes()}`;
}

function fmtDate() {
  const d = new Date();
  return `${d.getDate()}/${d.getMonth()+1}/${d.getFullYear()}`;
}

function getUser(uid) {
  const day = todayKey();

  if (!db[uid]) db[uid] = { traineeTotal: 0, lastPresence: now() };
  if (!db[uid][day]) {
    db[uid][day] = {
      active: false,
      start: null,
      sessions: [],
      total: 0,
      plate: ""
    };
  }

  return db[uid][day];
}

function userRoot(uid){
  if (!db[uid]) db[uid] = { traineeTotal: 0, lastPresence: now() };
  return db[uid];
}

/* ================= GTA DETECT ================= */

function isPlayingGTA(member) {
  if (!member?.presence?.activities?.length) return false;

  return member.presence.activities.some(a => {
    const n = (a.name || "").toLowerCase();
    const d = (a.details || "").toLowerCase();
    const s = (a.state || "").toLowerCase();

    return (
      n.includes("fivem") ||
      n.includes("gta") ||
      d.includes("gta") ||
      d.includes("gta5vn") ||
      s.includes("gta")
    );
  });
}
/* ================= EMBED ================= */

function buildEmbed(member, data, root) {

  let timeline = "";

  data.sessions.forEach(s => {
    timeline += `${fmt(s.start)} → ${fmt(s.end)}\n`;
  });

  if (data.active) timeline += `${fmt(data.start)} → ...\n`;

  const totalMin = Math.floor(data.total / 60000);

  let traineeLine = "";
  if (member.roles.cache.has(TRAINEE_ROLE)) {
    const h = (root.traineeTotal / 3600000).toFixed(1);
    traineeLine = `Tổng Thời Gian Thực Tập : ${h} giờ\n`;
  }

  const desc =
`Tên Nhân Sự : <@${member.id}>
Biển Số : ${data.plate || "Chưa ghi"}
Thời Gian Onduty :
${timeline || "Chưa có"}
Ngày Onduty : ${fmtDate()}
Tổng Thời Gian Onduty : ${totalMin} phút
${traineeLine}Trạng Thái Hoạt Động : ${data.active ? "Đang trực" : "Off duty"}`;

  return new EmbedBuilder()
    .setTitle("BẢNG ONDUTY")
    .setDescription(desc)
    .setColor(data.active ? 0x00ff00 : 0xff0000);
}

/* ================= BOT ================= */

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildPresences
  ]
});

client.once("ready", () => {
  console.log("Bot ready");
});

/* ================= COMMAND ================= */

client.on("interactionCreate", async i => {
  if (!i.isChatInputCommand()) return;

  const member = await i.guild.members.fetch({
  user: i.user.id,
  force: true
});
  const data = getUser(member.id);
  const root = userRoot(member.id);

  /* ONDUTY */
  if (i.commandName === "onduty") {

    if (!isPlayingGTA(member)) {
      return i.reply({ content: "❌ Bạn chưa vào game!", ephemeral: true });
    }

    const plate = i.options.getString("bienso");

    if (!data.active) {
      data.active = true;
      data.start = now();
      root.lastPresence = now();
      if (plate) data.plate = plate;
      save();
    }

    return i.reply({ embeds: [buildEmbed(member, data, root)] });
  }

  /* OFFDUTY */
  if (i.commandName === "offduty") {

    if (data.active) {
      const end = now();
      data.sessions.push({ start: data.start, end });
      data.total += end - data.start;

      if (member.roles.cache.has(TRAINEE_ROLE)) {
        root.traineeTotal += end - data.start;
      }

      data.active = false;
      data.start = null;
      save();
    }

    return i.reply({ embeds: [buildEmbed(member, data, root)] });
  }

  /* RESET */
  if (i.commandName === "resetduty") {

    if (!member.roles.cache.some(r => RESET_ROLES.includes(r.id))) {
      return i.reply({ content: "❌ Không có quyền", ephemeral: true });
    }

    const day = todayKey();
    db[member.id][day] = {
      active: false,
      start: null,
      sessions: [],
      total: 0,
      plate: ""
    };
    save();

    return i.reply({ content: "✅ Đã reset duty", ephemeral: true });
  }

  /* FORCE OFF */
  if (i.commandName === "forceoff") {

    if (!member.roles.cache.some(r => RESET_ROLES.includes(r.id))) {
      return i.reply({ content: "❌ Không có quyền", ephemeral: true });
    }

    if (data.active) {
      const end = now();
      data.sessions.push({ start: data.start, end });
      data.total += end - data.start;
      data.active = false;
      data.start = null;
      save();
    }

    return i.reply({ content: "⛔ Đã đóng onduty", ephemeral: true });
  }
});

/* ================= PRESENCE ================= */

client.on("presenceUpdate", async (oldP, newP) => {
  const member = newP?.member;
  if (!member) return;

  const data = getUser(member.id);
  const root = userRoot(member.id);

  if (!data.active) return;

  /* OUT GAME AUTO OFF */
  if (!isPlayingGTA(member)) {
    const end = now();
    data.sessions.push({ start: data.start, end });
    data.total += end - data.start;

    if (member.roles.cache.has(TRAINEE_ROLE)) {
      root.traineeTotal += end - data.start;
    }

    data.active = false;
    data.start = null;
    save();
    return;
  }

 /* TREO 10P */
if (now() - root.lastPresence > AFK_LIMIT) {
  const end = now();
  data.sessions.push({ start: data.start, end });
  data.total += end - data.start;
  data.active = false;
  data.start = null;
  save();

  member.send("⚠️ Bạn đã bị tự động offduty do treo 10 phút").catch(()=>{});
  return;
}

/* UPDATE ACTIVITY TIME */
root.lastPresence = now();

  /* TRAINEE COMPLETE */
  if (member.roles.cache.has(TRAINEE_ROLE) &&
      root.traineeTotal >= TRAIN_TARGET &&
      !member.roles.cache.has(EMPLOYEE_ROLE)) {

    await member.roles.add(EMPLOYEE_ROLE).catch(()=>{});
    await member.roles.remove(TRAINEE_ROLE).catch(()=>{});

    const ch = member.guild.channels.cache.get(CONGRATS_CHANNEL);
    if (ch) ch.send(`🎉 Chúc mừng <@${member.id}> đã hoàn thành 60 giờ thực tập và trở thành nhân viên!`);
  }
});

client.login(TOKEN);
