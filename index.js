const { Client, GatewayIntentBits, EmbedBuilder } = require("discord.js");
const fs = require("fs");
const http = require("http");

/* ================= CONFIG ================= */

const TOKEN = process.env.TOKEN;

const RESET_ROLES = ["1475815959616032883"]; // role quản lý
const TRAINEE_ROLE = "1467725396433834149";
const EMPLOYEE_ROLE = "1467724655766012129";
const CONGRATS_CHANNEL = "1467729036066295820";

const AFK_LIMIT = 10 * 60 * 1000;
const TRAIN_TARGET = 60 * 60 * 1000;

const DATA_FILE = "duty.json";

/* ================= KEEP RENDER ALIVE ================= */

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

function root(uid){
  if (!db[uid]) db[uid] = { traineeTotal: 0, lastPresence: now() };
  return db[uid];
}

/* ================= GTA DETECT ================= */

function isPlayingGTA(member) {
  if (!member) return false;

  const activities = member.presence?.activities;
  if (!activities || activities.length === 0) return false;

  return activities.some(a => {
    const text = (
      (a.name || "") + " " +
      (a.details || "") + " " +
      (a.state || "")
    ).toLowerCase();

    return (
      text.includes("gta") ||
      text.includes("grand theft auto") ||
      text.includes("fivem") ||
      text.includes("GTA5VN")
    );
  });
}

/* ================= EMBED ================= */

function buildEmbed(member, data, rootData) {

  let timeline = "";
  data.sessions.forEach(s => {
    timeline += `${fmt(s.start)} → ${fmt(s.end)}\n`;
  });
  if (data.active) timeline += `${fmt(data.start)} → ...\n`;

  const totalMin = Math.floor(data.total / 60000);

  let traineeLine = "";
  if (member.roles.cache.has(TRAINEE_ROLE)) {
    const h = (rootData.traineeTotal / 3600000).toFixed(1);
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

  const member = await i.guild.members.fetch(i.user.id);
  const data = getUser(member.id);
  const r = root(member.id);

  /* ONDUTY */
  if (i.commandName === "onduty") {

    if (!isPlayingGTA(member)) {
      return i.reply({ content: "❌ Vào game đi ĐM", ephemeral: true });
    }

    const plate = i.options.getString("bienso");

    if (!data.active) {
      data.active = true;
      data.start = now();
      r.lastPresence = now();
      if (plate) data.plate = plate;
      save();
    }

    return i.reply({ embeds: [buildEmbed(member, data, r)] });
  }

  /* OFFDUTY */
  if (i.commandName === "offduty") {

    if (data.active) {
      const end = now();
      data.sessions.push({ start: data.start, end });
      data.total += end - data.start;

      if (member.roles.cache.has(TRAINEE_ROLE)) {
        r.traineeTotal += end - data.start;
      }

      data.active = false;
      data.start = null;
      save();
    }

    return i.reply({ embeds: [buildEmbed(member, data, r)] });
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
  const r = root(member.id);

  if (!data.active) return;

  /* OUT GAME AUTO OFF */
  if (!isPlayingGTA(member)) {
    const end = now();
    data.sessions.push({ start: data.start, end });
    data.total += end - data.start;

    if (member.roles.cache.has(TRAINEE_ROLE)) {
      r.traineeTotal += end - data.start;
    }

    data.active = false;
    data.start = null;
    save();
    return;
  }

  /* TREO 10P */
  if (now() - r.lastPresence > AFK_LIMIT) {
    const end = now();
    data.sessions.push({ start: data.start, end });
    data.total += end - data.start;
    data.active = false;
    data.start = null;
    save();

    member.send("⚠️ Bạn bị cưỡng chế offduty do treo 10 phút").catch(()=>{});
    return;
  }

  /* UPDATE ACTIVITY */
  r.lastPresence = now();

  /* TRAINEE COMPLETE */
  if (member.roles.cache.has(TRAINEE_ROLE) &&
      r.traineeTotal >= TRAIN_TARGET &&
      !member.roles.cache.has(EMPLOYEE_ROLE)) {

    await member.roles.add(EMPLOYEE_ROLE).catch(()=>{});
    await member.roles.remove(TRAINEE_ROLE).catch(()=>{});

    const ch = member.guild.channels.cache.get(CONGRATS_CHANNEL);
    if (ch) ch.send(`🎉 Chúc mừng <@${member.id}> đã hoàn thành 60 giờ thực tập và trở thành Culi Vip !`);
  }
});

client.login(TOKEN);
