require("dotenv").config();
const fs = require("fs");
const http = require("http");
const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  SlashCommandBuilder,
  Routes,
  REST
} = require("discord.js");

const TOKEN = process.env.TOKEN;

// ===== CONFIG =====
const GUILD_ID = "1466476014908473550";
const RESET_ROLE_ID = "1475815959616032883";
const INTERN_ROLE_ID = "1467725396433834149";
const STAFF_ROLE_ID = "1467724655766012129";

// ===== KEEP ALIVE =====
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
  if (fs.existsSync(DB_FILE)) db = JSON.parse(fs.readFileSync(DB_FILE));
}
function saveDB() {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}
loadDB();

// ===== TIME VN =====
function nowVN() {
  return new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Ho_Chi_Minh" }));
}
function dateKeyVN() {
  return nowVN().toLocaleDateString("vi-VN");
}
function formatTime(ms) {
  return new Date(ms).toLocaleTimeString("vi-VN", { hour12: false });
}
function diffText(ms) {
  const m = Math.floor(ms / 60000);
  return `${Math.floor(m / 60)} giờ ${m % 60} phút`;
}

// ===== GTA CHECK =====
function isPlayingGTA(member) {
  const p = member.presence;
  if (!p) return false;
  return p.activities?.some(a => a.name?.toLowerCase().includes("gta"));
}

// ===== USER DB =====
function getUser(id) {
  if (!db[id]) db[id] = { total: 0, days: {} };
  return db[id];
}

// ===== BUILD EMBED =====
function buildEmbed(member, user, dayKey, status) {
  const day = user.days[dayKey];
  if (!day) return null;

  let timeline = "";
  let totalDay = 0;
  const now = Date.now();

  day.sessions.forEach(s => {
    const end = s.end || now;
    timeline += `${formatTime(s.start)} ➝ ${s.end ? formatTime(s.end) : "..."}\n`;
    totalDay += end - s.start;
  });

  const isIntern = member.roles.cache.has(INTERN_ROLE_ID);

  return new EmbedBuilder()
    .setColor(status.includes("Off") ? "#ff4d4f" : "#00ff9c")
    .setAuthor({ name: "BẢNG ONDUTY" })
    .setDescription(
`**Tên Nhân Sự :** ${member}

**Biển Số :** ${day.plate || "Chưa nhập"}

**Thời Gian Onduty :**
${timeline || "Chưa có"}

**Ngày Onduty :** ${dayKey}

**Tổng Thời Gian Onduty :** ${diffText(totalDay)}
${isIntern ? `\n**Tổng Thời Gian Thực Tập :** ${diffText(user.total)}` : ""}

**Trạng Thái Hoạt Động :** ${status}`
    );
}

// ===== SEND OR UPDATE =====
async function sendOrUpdateEmbed(channel, member, user, dayKey, status) {
  const day = user.days[dayKey];
  const embed = buildEmbed(member, user, dayKey, status);
  if (!embed) return;

  if (day.messageId) {
    try {
      const ch = await client.channels.fetch(day.channelId);
      const msg = await ch.messages.fetch(day.messageId);
      if (msg) return msg.edit({ embeds: [embed] });
    } catch {}
  }

  const msg = await channel.send({ embeds: [embed] });
  day.messageId = msg.id;
  day.channelId = channel.id;
  saveDB();
}

// ===== COMMANDS =====
const commands = [
  new SlashCommandBuilder()
    .setName("onduty")
    .setDescription("Bắt đầu trực")
    .addStringOption(o =>
      o.setName("bienso").setDescription("Biển số").setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("ofduty")
    .setDescription("Kết thúc trực"),

  new SlashCommandBuilder()
    .setName("resetduty")
    .setDescription("Reset duty")
    .addUserOption(o =>
      o.setName("user").setDescription("User").setRequired(true)
    )
].map(c => c.toJSON());

client.once("clientReady", async () => {
  const rest = new REST({ version: "10" }).setToken(TOKEN);
  await rest.put(Routes.applicationGuildCommands(client.user.id, GUILD_ID), { body: commands });
  console.log("Bot ready");
});

// ===== ONDUTY =====
client.on("interactionCreate", async i => {
  if (!i.isChatInputCommand()) return;

  const member = i.member;
  const user = getUser(member.id);
  const dayKey = dateKeyVN();

  if (i.commandName === "onduty") {

    if (!isPlayingGTA(member))
      return i.reply({ content: "❌ Vào Game Đi ĐM", ephemeral: true });

    let day = user.days[dayKey];

    // ❗ đang trực → chặn
    if (day && day.sessions.some(s => !s.end))
      return i.reply({ content: "❌ Bạn đang onduty rồi", ephemeral: true });

    const plate = i.options.getString("bienso");

    if (!day) {
      day = user.days[dayKey] = {
        plate,
        sessions: [],
        messageId: null,
        channelId: null,
        lastGame: Date.now()
      };
    }

    day.plate = plate;
    day.sessions.push({ start: Date.now(), end: null });
    day.lastGame = Date.now();
    saveDB();

    await sendOrUpdateEmbed(i.channel, member, user, dayKey, "Đang trực");
    return i.reply({ content: "Onduty thành công", ephemeral: true });
  }

  // ===== OFDUTY =====
  if (i.commandName === "ofduty") {

    const day = user.days[dayKey];
    if (!day) return i.reply({ content: "Bạn chưa onduty", ephemeral: true });

    const last = day.sessions.find(s => !s.end);
    if (!last) return i.reply({ content: "Bạn đã off rồi", ephemeral: true });

    last.end = Date.now();
    user.total += last.end - last.start;
    saveDB();

    await sendOrUpdateEmbed(i.channel, member, user, dayKey, "Off");

    if (member.roles.cache.has(INTERN_ROLE_ID) && user.total >= 60 * 60 * 1000) {
      await member.roles.add(STAFF_ROLE_ID);
      await member.roles.remove(INTERN_ROLE_ID);
      i.channel.send(`🎉 ${member} chúc mừng bạn đã đủ chỉ tiêu và lên Nhân Viên`);
    }

    return i.reply({ content: "Đã offduty", ephemeral: true });
  }

  // ===== RESET =====
  if (i.commandName === "resetduty") {
    if (!member.roles.cache.has(RESET_ROLE_ID))
      return i.reply({ content: "Không có quyền", ephemeral: true });

    const u = i.options.getUser("user");
    delete db[u.id];
    saveDB();
    return i.reply(`Đã reset ${u}`);
  }
});

// ===== AUTO OFF GTA =====
client.on("presenceUpdate", async (oldP, newP) => {
  if (!newP) return;

  const id = newP.userId;
  const user = db[id];
  if (!user) return;

  const dayKey = dateKeyVN();
  const day = user.days[dayKey];
  if (!day) return;

  const playing = newP.activities?.some(a => a.name?.toLowerCase().includes("gta"));

  if (playing) {
    day.lastGame = Date.now();
    saveDB();
    return;
  }

  if (Date.now() - day.lastGame > 10 * 60 * 1000) {
    const last = day.sessions.find(s => !s.end);
    if (!last) return;

    last.end = Date.now();
    user.total += last.end - last.start;
    saveDB();

    try {
      const guild = newP.guild;
      const member = await guild.members.fetch(id);
      const ch = await client.channels.fetch(day.channelId);
      await sendOrUpdateEmbed(ch, member, user, dayKey, "Tự off (Treo Máy hoặc Thoát Game)");
    } catch {}
  }
});

// ===== AUTO OFF MIDNIGHT =====
setInterval(async () => {
  const now = nowVN();
  if (now.getHours() !== 23 || now.getMinutes() !== 59) return;

  const dayKey = dateKeyVN();

  for (const id in db) {
    const user = db[id];
    const day = user.days[dayKey];
    if (!day) continue;

    const last = day.sessions.find(s => !s.end);
    if (!last) continue;

    last.end = Date.now();
    user.total += last.end - last.start;
    saveDB();

    try {
      const guild = await client.guilds.fetch(GUILD_ID);
      const member = await guild.members.fetch(id);
      const ch = await client.channels.fetch(day.channelId);
      await sendOrUpdateEmbed(ch, member, user, dayKey, "Tự off (Qua ngày)");
    } catch {}
  }

}, 30 * 1000);

client.login(TOKEN);
