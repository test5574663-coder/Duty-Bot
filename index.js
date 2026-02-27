require("dotenv").config();
const fs = require("fs");
const http = require("http");
const https = require("https");
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

// ===== KEEP ALIVE RENDER =====
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => res.end("OK")).listen(PORT);

setInterval(() => {
  if (process.env.RENDER_EXTERNAL_URL) {
    https.get(process.env.RENDER_EXTERNAL_URL);
  }
}, 5 * 60 * 1000);

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
  return new Date(ms).toLocaleTimeString("vi-VN", {
    hour12: false,
    timeZone: "Asia/Ho_Chi_Minh"
  });
}
function diffText(ms) {
  const m = Math.floor(ms / 60000);
  return `${Math.floor(m / 60)} giờ ${m % 60} phút`;
}

// ===== USER DB =====
function getUser(id) {
  if (!db[id]) db[id] = { total: 0, days: {} };
  return db[id];
}

// ===== EMBED =====
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

  // cộng/trừ penalty ngày
  if (day.extra) totalDay += day.extra;

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

// ===== SEND / UPDATE =====
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
    .setName("offduty")
    .setDescription("Kết thúc trực"),

  new SlashCommandBuilder()
    .setName("penalty")
    .setDescription("Cộng thời gian")
    .addUserOption(o => o.setName("user").setDescription("User").setRequired(true))
    .addIntegerOption(o => o.setName("minutes").setDescription("Phút").setRequired(true))
    .addStringOption(o =>
      o.setName("type")
        .setDescription("Loại")
        .setRequired(true)
        .addChoices(
          { name: "Onduty ngày", value: "day" },
          { name: "Thực tập tổng", value: "total" }
        )
    ),

  new SlashCommandBuilder()
    .setName("adjust")
    .setDescription("Trừ thời gian")
    .addUserOption(o => o.setName("user").setDescription("User").setRequired(true))
    .addIntegerOption(o => o.setName("minutes").setDescription("Phút").setRequired(true))
    .addStringOption(o =>
      o.setName("type")
        .setDescription("Loại")
        .setRequired(true)
        .addChoices(
          { name: "Onduty ngày", value: "day" },
          { name: "Thực tập tổng", value: "total" }
        )
    ),

  new SlashCommandBuilder()
    .setName("forced_duty")
    .setDescription("Cưỡng chế offduty")
    .addUserOption(o => o.setName("user").setDescription("User").setRequired(true))

].map(c => c.toJSON());

// ===== READY =====
client.once("ready", async () => {
  const rest = new REST({ version: "10" }).setToken(TOKEN);
  await rest.put(Routes.applicationGuildCommands(client.user.id, GUILD_ID), { body: commands });
  console.log("Bot ready");
});

// ===== COMMAND HANDLER =====
client.on("interactionCreate", async i => {
  if (!i.isChatInputCommand()) return;

  const member = await i.guild.members.fetch(i.user.id);
  const user = getUser(member.id);
  const dayKey = dateKeyVN();

  // ONDUTY
  if (i.commandName === "onduty") {
    const activities = member.presence?.activities || [];
    const playing = activities.some(a => a.name?.toLowerCase().includes("gta"));
    if (!playing)
      return i.reply({ content: "❌ Vào Game Đi ĐM!", ephemeral: true });

    let day = user.days[dayKey];
    if (day && day.sessions.some(s => !s.end))
      return i.reply({ content: "❌ Bạn đang onduty rồi", ephemeral: true });

    const plate = i.options.getString("bienso");

    if (!day) {
      day = user.days[dayKey] = {
        plate,
        sessions: [],
        messageId: null,
        channelId: null
      };
    }

    day.plate = plate;
    day.sessions.push({ start: Date.now(), end: null });
    saveDB();

    await sendOrUpdateEmbed(i.channel, member, user, dayKey, "Đang trực");
    return i.reply({ content: "Onduty thành công", ephemeral: true });
  }

  // OFFDUTY
  if (i.commandName === "offduty") {
    const day = user.days[dayKey];
    if (!day) return i.reply({ content: "Bạn chưa onduty", ephemeral: true });

    const last = day.sessions.find(s => !s.end);
    if (!last) return i.reply({ content: "Bạn đã off rồi", ephemeral: true });

    last.end = Date.now();
    user.total += last.end - last.start;
    saveDB();

    await sendOrUpdateEmbed(i.channel, member, user, dayKey, "Off");
    return i.reply({ content: "Đã offduty", ephemeral: true });
  }

  // PENALTY
  if (i.commandName === "penalty") {
    if (!member.roles.cache.has(RESET_ROLE_ID))
      return i.reply({ content: "Không có quyền", ephemeral: true });

    const u = i.options.getUser("user");
    const minutes = i.options.getInteger("minutes");
    const type = i.options.getString("type");

    const target = getUser(u.id);
    const ms = minutes * 60000;

    if (type === "total") {
      target.total += ms;
    }

    if (type === "day") {
      const day = target.days[dayKey];
      if (day) day.extra = (day.extra || 0) + ms;
    }

    saveDB();

    const m = await i.guild.members.fetch(u.id);
    await sendOrUpdateEmbed(i.channel, m, target, dayKey, "Penalty");

    return i.reply(`Đã cộng ${minutes} phút cho ${u}`);
  }

  // ADJUST
  if (i.commandName === "adjust") {
    if (!member.roles.cache.has(RESET_ROLE_ID))
      return i.reply({ content: "Không có quyền", ephemeral: true });

    const u = i.options.getUser("user");
    const minutes = i.options.getInteger("minutes");
    const type = i.options.getString("type");

    const target = getUser(u.id);
    const ms = minutes * 60000;

    if (type === "total") {
      target.total = Math.max(0, target.total - ms);
    }

    if (type === "day") {
      const day = target.days[dayKey];
      if (day) day.extra = Math.max(0, (day.extra || 0) - ms);
    }

    saveDB();

    const m = await i.guild.members.fetch(u.id);
    await sendOrUpdateEmbed(i.channel, m, target, dayKey, "Adjust");

    return i.reply(`Đã trừ ${minutes} phút của ${u}`);
  }

  // FORCED DUTY
  if (i.commandName === "forced_duty") {
    if (!member.roles.cache.has(RESET_ROLE_ID))
      return i.reply({ content: "Không có quyền", ephemeral: true });

    const u = i.options.getUser("user");
    const target = getUser(u.id);
    const day = target.days[dayKey];
    if (!day) return i.reply("User chưa onduty");

    const last = day.sessions.find(s => !s.end);
    if (!last) return i.reply("User đã off");

    last.end = Date.now();
    target.total += last.end - last.start;
    saveDB();

    const m = await i.guild.members.fetch(u.id);
    await sendOrUpdateEmbed(i.channel, m, target, dayKey, "Force Off");

    return i.reply(`Đã cưỡng chế offduty ${u}`);
  }
});

// ===== AUTO OFF GTA =====
client.on("presenceUpdate", async (oldP, newP) => {
  if (!newP?.member) return;

  const id = newP.member.id;
  const user = db[id];
  if (!user) return;

  const dayKey = dateKeyVN();
  const day = user.days[dayKey];
  if (!day) return;

  const activities = newP.member.presence?.activities || [];
  const playing = activities.some(a => a.name?.toLowerCase().includes("gta"));

  if (!playing) {
    const last = day.sessions.find(s => !s.end);
    if (!last) return;

    last.end = Date.now();
    user.total += last.end - last.start;
    saveDB();

    try {
      const ch = await client.channels.fetch(day.channelId);
      await sendOrUpdateEmbed(ch, newP.member, user, dayKey, "Tự off (ALT lấy lợi thế)");
    } catch {}
  }
});

// ===== AUTO OFF 23:59 =====
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
      const member = await client.guilds.cache.get(GUILD_ID)?.members.fetch(id);
      const ch = await client.channels.fetch(day.channelId);
      await sendOrUpdateEmbed(ch, member, user, dayKey, "Tự off (Qua Ngày Mới)");
    } catch {}
  }
}, 60 * 1000);

client.login(TOKEN);
