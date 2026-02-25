const { Client, GatewayIntentBits, EmbedBuilder } = require("discord.js");
const fs = require("fs");
const http = require("http");

const TOKEN = process.env.TOKEN;
const DATA_FILE = "duty.json";

/* ================= RENDER KEEP ALIVE ================= */
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
  return `${d.getHours()}h${d.getMinutes().toString().padStart(2,"0")}`;
}

function getUser(uid) {
  const day = todayKey();

  if (!db[uid]) db[uid] = {};
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

/* ================= GTA DETECT ================= */

function isPlayingGTA(member) {
  if (!member?.presence?.activities?.length) return false;

  return member.presence.activities.some(a => {
    const text = (
      (a.name || "") + " " +
      (a.details || "") + " " +
      (a.state || "")
    ).toLowerCase();

    return text.includes("gta5vn");
  });
}

/* ================= EMBED ================= */

function buildEmbed(member, data) {
  let timeline = "";

  data.sessions.forEach(s => {
    timeline += `${fmt(s.start)} → ${fmt(s.end)}\n`;
  });

  if (data.active) {
    timeline += `${fmt(data.start)} → ...\n`;
  }

  const totalMin = Math.floor(data.total / 60000);

  const desc =
`Tên Nhân Sự : <@${member.id}>
Biển Số : ${data.plate || "Chưa ghi"}
Thời Gian Onduty :
${timeline || "Chưa có"}
Tổng Thời Gian : ${totalMin} phút
Trạng Thái : ${data.active ? "Đang trực" : "Off duty"}`;

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

  /* ONDUTY */
  if (i.commandName === "onduty") {

    if (!isPlayingGTA(member)) {
      return i.reply({ content: "❌ Vào Game Đi ĐM!", ephemeral: true });
    }

    const plate = i.options.getString("bienso");
    if (plate) data.plate = plate;

    if (!data.active) {
      data.active = true;
      data.start = now();
      save();
    }

    return i.reply({ embeds: [buildEmbed(member, data)] });
  }

  /* OFFDUTY */
  if (i.commandName === "offduty") {

    if (!data.active) {
      return i.reply({ content: "Bạn chưa onduty!", ephemeral: true });
    }

    const end = now();
    data.sessions.push({ start: data.start, end });
    data.total += end - data.start;

    data.active = false;
    data.start = null;
    save();

    return i.reply({ embeds: [buildEmbed(member, data)] });
  }
});

/* ================= AUTO OFF ================= */

client.on("presenceUpdate", (oldP, newP) => {
  const member = newP?.member;
  if (!member) return;

  const data = getUser(member.id);
  if (!data.active) return;

  const playing = isPlayingGTA(member);

  if (!playing) {
    const end = now();
    data.sessions.push({ start: data.start, end });
    data.total += end - data.start;

    data.active = false;
    data.start = null;
    save();

    member.send("⛔ Bạn đã tự động offduty (thoát GTA5VN)").catch(()=>{});
  }
});

client.login(TOKEN);
