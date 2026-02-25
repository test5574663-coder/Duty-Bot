require("dotenv").config();
const fs = require("fs");
const { Client, GatewayIntentBits, EmbedBuilder, SlashCommandBuilder, Routes, REST } = require("discord.js");

const TOKEN = process.env.TOKEN;

// ===== CONFIG =====
const GUILD_ID = "1466476014908473550";
const RESET_ROLE_ID = "1475815959616032883";
const INTERN_ROLE_ID = "1467725396433834149";
const STAFF_ROLE_ID = "1467724655766012129";

const PORT = process.env.PORT || 3000;
require("http").createServer((req, res) => res.end("OK")).listen(PORT);

// ===== CLIENT =====
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildPresences,
    GatewayIntentBits.GuildMembers
  ]
});

// ===== DATABASE =====
const DB_FILE = "./dutyDB.json";
let db = {};

function loadDB() {
  if (fs.existsSync(DB_FILE)) {
    db = JSON.parse(fs.readFileSync(DB_FILE));
  }
}
function saveDB() {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}
loadDB();

// ===== TIME VN =====
function nowVN() {
  return new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Ho_Chi_Minh" }));
}
function formatTime(d) {
  return d.toLocaleTimeString("vi-VN", { hour12: false });
}
function formatDate(d) {
  return d.toLocaleDateString("vi-VN");
}
function diffText(ms) {
  const totalMin = Math.floor(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `${h} giờ ${m} phút`;
}

// ===== GTA CHECK =====
function isPlayingGTA(member) {
  const p = member.presence;
  if (!p) return false;
  return p.activities?.some(a => a.name?.toLowerCase().includes("gta"));
}

// ===== GET USER DB =====
function getUser(id) {
  if (!db[id]) {
    db[id] = {
      total: 0,
      days: {}
    };
  }
  return db[id];
}

// ===== EMBED =====
function buildEmbed(member, userData, dayKey, status) {
  const day = userData.days[dayKey];
  const now = nowVN();

  let timeline = "";
  let totalDay = 0;

  day.sessions.forEach(s => {
    const end = s.end || now;
    timeline += `${formatTime(new Date(s.start))} ➝ ${s.end ? formatTime(new Date(s.end)) : "..."}\n`;
    totalDay += end - s.start;
  });

  const isIntern = member.roles.cache.has(INTERN_ROLE_ID);

  return new EmbedBuilder()
    .setColor("#00ff9c")
    .setAuthor({ name: "BẢNG ONDUTY" })
    .setDescription(
`**Tên Nhân Sự :** ${member}

**Biển Số :** ${day.plate}

**Thời Gian Onduty :**
${timeline}

**Ngày Onduty :** ${dayKey}

**Tổng Thời Gian Onduty :** ${diffText(totalDay)}
${isIntern ? `\n**Tổng Thời Gian Thực Tập :** ${diffText(userData.total)}` : ""}

**Trạng Thái Hoạt Động :** ${status}`
    );
}

// ===== SLASH =====
const commands = [
  new SlashCommandBuilder()
    .setName("onduty")
    .setDescription("Bắt đầu trực")
    .addStringOption(o =>
      o.setName("bienso")
       .setDescription("Biển số xe")
       .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("ofduty")
    .setDescription("Kết thúc trực"),

  new SlashCommandBuilder()
    .setName("resetduty")
    .setDescription("Reset duty")
    .addUserOption(o =>
      o.setName("user")
       .setDescription("Chọn người")
       .setRequired(true)
    )
].map(c => c.toJSON());

client.once("clientReady", async () => {
  console.log("Bot ready");
  const rest = new REST({ version: "10" }).setToken(TOKEN);
  await rest.put(Routes.applicationGuildCommands(client.user.id, GUILD_ID), { body: commands });
});

// ===== ONDUTY =====
client.on("interactionCreate", async i => {
  if (!i.isChatInputCommand()) return;
  const member = i.member;

  // ONDUTY
  if (i.commandName === "onduty") {

    if (!isPlayingGTA(member))
      return i.reply({ content: "❌ Bạn phải đang trong GTA", ephemeral: true });

    const plate = i.options.getString("bienso");
    const dayKey = formatDate(nowVN());

    const user = getUser(member.id);

    if (!user.days[dayKey]) {
      user.days[dayKey] = {
        plate,
        sessions: [],
        messageId: null,
        channelId: null,
        lastGame: Date.now()
      };
    }

    const day = user.days[dayKey];
    day.plate = plate;
    day.sessions.push({ start: Date.now(), end: null });

    saveDB();

    const embed = buildEmbed(member, user, dayKey, "Đang trực");

    if (day.messageId) {
      try {
        const ch = await client.channels.fetch(day.channelId);
        const msg = await ch.messages.fetch(day.messageId);
        await msg.edit({ embeds: [embed] });
      } catch {}
    } else {
      const msg = await i.channel.send({ embeds: [embed] });
      day.messageId = msg.id;
      day.channelId = msg.channelId;
      saveDB();
    }

    return i.reply({ content: "Onduty thành công", ephemeral: true });
  }

  // OFDUTY
  if (i.commandName === "ofduty") {
    const user = getUser(member.id);
    const dayKey = formatDate(nowVN());
    const day = user.days[dayKey];

    if (!day) return i.reply({ content: "Bạn chưa onduty", ephemeral: true });

    const last = day.sessions[day.sessions.length - 1];
    if (last && !last.end) {
      last.end = Date.now();
      user.total += last.end - last.start;
    }

    saveDB();

    // lên nhân viên
    if (member.roles.cache.has(INTERN_ROLE_ID) && user.total >= 60 * 60 * 1000) {
      await member.roles.add(STAFF_ROLE_ID);
      await member.roles.remove(INTERN_ROLE_ID);
      i.channel.send(`🎉 Chúc mừng ${member} đã đủ 60h và trở thành Nhân Viên!`);
    }

    const embed = buildEmbed(member, user, dayKey, "Off");

    if (day.messageId) {
      try {
        const ch = await client.channels.fetch(day.channelId);
        const msg = await ch.messages.fetch(day.messageId);
        await msg.edit({ embeds: [embed] });
      } catch {}
    }

    return i.reply({ content: "Đã offduty", ephemeral: true });
  }

  // RESET
  if (i.commandName === "resetduty") {
    if (!member.roles.cache.has(RESET_ROLE_ID))
      return i.reply({ content: "Không có quyền", ephemeral: true });

    const u = i.options.getUser("user");
    delete db[u.id];
    saveDB();

    return i.reply(`Đã reset duty ${u}`);
  }
});

// ===== AUTO OFF GTA =====
client.on("presenceUpdate", (oldP, newP) => {
  if (!newP) return;

  const id = newP.userId;
  const user = db[id];
  if (!user) return;

  const dayKey = formatDate(nowVN());
  const day = user.days[dayKey];
  if (!day) return;

  const playing = newP.activities?.some(a => a.name?.toLowerCase().includes("gta"));

  if (playing) {
    day.lastGame = Date.now();
    saveDB();
    return;
  }

  if (Date.now() - day.lastGame > 10 * 60 * 1000) {
    const last = day.sessions[day.sessions.length - 1];
    if (last && !last.end) {
      last.end = Date.now();
      user.total += last.end - last.start;
      saveDB();
    }
  }
});

client.login(TOKEN);
