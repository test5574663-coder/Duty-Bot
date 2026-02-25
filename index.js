require("dotenv").config();
const fs = require("fs");
const http = require("http");
const { Client, GatewayIntentBits, EmbedBuilder, SlashCommandBuilder, Routes, REST } = require("discord.js");

const TOKEN = process.env.TOKEN;

// ===== CONFIG =====
const GUILD_ID = "1466476014908473550";
const RESET_ROLE_ID = "1475815959616032883";
const INTERN_ROLE_ID = "1467725396433834149";
const STAFF_ROLE_ID = "1467724655766012129";

const PORT = process.env.PORT || 3000;
http.createServer((req, res) => res.end("OK")).listen(PORT);

// ===== CLIENT =====
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildPresences
  ]
});

// ===== DATABASE =====
const DB_FILE = "./duty.json";
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

// ===== USER DB =====
function getUser(id) {
  if (!db[id]) {
    db[id] = {
      total: 0,
      days: {}
    };
  }
  return db[id];
}

// ===== BUILD EMBED (FIX GIỜ THEO NGÀY VN) =====
function buildEmbed(member, userData, dayKey, status) {
  const day = userData.days[dayKey];
  const now = nowVN();

  let timeline = "";
  let totalDay = 0;

  // mốc đầu cuối ngày VN
  const [d, m, y] = dayKey.split("/");
  const todayStart = new Date(`${y}-${m}-${d}T00:00:00+07:00`).getTime();
  const todayEnd = new Date(`${y}-${m}-${d}T23:59:59+07:00`).getTime();

  day.sessions.forEach(s => {
    const start = s.start;
    const end = s.end || now.getTime();

    // phần giao với ngày hiện tại
    const realStart = Math.max(start, todayStart);
    const realEnd = Math.min(end, todayEnd);

    if (realEnd > realStart) {
      timeline += `${formatTime(new Date(start))} ➝ ${s.end ? formatTime(new Date(s.end)) : "..."}\n`;
      totalDay += realEnd - realStart;
    }
  });

  const isIntern = member.roles.cache.has(INTERN_ROLE_ID);

  return new EmbedBuilder()
    .setColor("#00ff9c")
    .setAuthor({ name: "BẢNG ONDUTY" })
    .setDescription(
`**Tên Nhân Sự :** ${member}

**Biển Số :** ${day.plate}

**Thời Gian Onduty :**
${timeline || "Chưa có"}

**Ngày Onduty :** ${dayKey}

**Tổng Thời Gian Onduty :** ${diffText(totalDay)}
${isIntern ? `\n**Tổng Thời Gian Thực Tập :** ${diffText(userData.total)}` : ""}

**Trạng Thái Hoạt Động :** ${status}`
    );
}

// ===== SEND OR UPDATE 1 EMBED / DAY =====
async function sendOrUpdateEmbed(channel, member, user, dayKey, status) {
  const day = user.days[dayKey];
  const embed = buildEmbed(member, user, dayKey, status);

  if (day.messageId && day.channelId) {
    try {
      const ch = await client.channels.fetch(day.channelId);
      const msg = await ch.messages.fetch(day.messageId);
      if (msg) {
        await msg.edit({ embeds: [embed] });
        return;
      }
    } catch {}
  }

  const msg = await channel.send({ embeds: [embed] });
  day.messageId = msg.id;
  day.channelId = channel.id;
  saveDB();
}

// ===== SLASH COMMANDS =====
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

// ===== INTERACTION =====
client.on("interactionCreate", async i => {
  if (!i.isChatInputCommand()) return;

  const member = i.member;
  const user = getUser(member.id);
  const dayKey = formatDate(nowVN());

  // ONDUTY
  if (i.commandName === "onduty") {

    if (!isPlayingGTA(member))
      return i.reply({ content: "❌ Bạn phải đang trong GTA", ephemeral: true });

    const plate = i.options.getString("bienso");

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
    day.lastGame = Date.now();

    saveDB();

    await sendOrUpdateEmbed(i.channel, member, user, dayKey, "Đang trực");
    return i.reply({ content: "Onduty thành công", ephemeral: true });
  }

  // OFDUTY
  if (i.commandName === "ofduty") {

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
      i.channel.send(`🎉 Chúc mừng ${member} đã đủ 60 giờ và trở thành Nhân Viên!`);
    }

    await sendOrUpdateEmbed(i.channel, member, user, dayKey, "Off");
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
client.on("presenceUpdate", async (oldP, newP) => {
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

      const guild = newP.guild;
      const member = await guild.members.fetch(id);
      const ch = await client.channels.fetch(day.channelId);

      await sendOrUpdateEmbed(ch, member, user, dayKey, "Tự off (AFK GTA)");
    }
  }
});

client.login(TOKEN);
